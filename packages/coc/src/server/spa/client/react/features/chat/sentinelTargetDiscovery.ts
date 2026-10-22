import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../../api/cocClient';
import { getDashboardTopology } from '../../shared/dashboard-discovery/topology';
import { targetSpans, type SentinelTarget } from '../../../../../shared/sentinel-target-reference';

export interface SentinelTargetResult {
    target: SentinelTarget;
    name: string;
    owner: string;
    online: boolean;
    members?: number;
    error?: string;
}
const unavailable = () => new Error('Target discovery unavailable. Reconnect the owning server and retry.');
const key = (t: SentinelTarget) => JSON.stringify(t);
export type TargetTopology = ReturnType<typeof getDashboardTopology>;

/** Concrete endpoint and durable identity are checked independently, before and after inventory I/O. */
export async function discoverSentinelTargets(snapshot: TargetTopology, signal: AbortSignal, targets?: readonly SentinelTarget[]): Promise<SentinelTargetResult[]> {
    const current = () => { signal.throwIfAborted(); if (getDashboardTopology() !== snapshot) throw unavailable(); };
    current();
    const servers = new Map(snapshot.servers.filter(machine => !targets || targets.some(t => t.serverIdentity === machine.serverIdentity)).map(machine => [machine.serverIdentity, { machine, routes: snapshot.routes.filter(r => r.row.serverIdentity === machine.serverIdentity) }]));
    const results: SentinelTargetResult[] = [];
    const pending = [...servers.entries()];
    const worker = async () => {
        while (pending.length) {
            const [identity, { machine, routes }] = pending.shift()!;
            const owner = machine.serverKind === 'local' ? 'Local' : machine.serverLabel;
            const seen = new Set<string>();
            const rows: SentinelTargetResult[] = routes.flatMap(({ row }) => {
                const target: SentinelTarget = row.type === 'group'
                    ? { kind: 'group', serverIdentity: identity, groupId: row.workspaceId }
                    : { kind: 'workspace', serverIdentity: identity, workspaceId: row.workspaceId };
                if (seen.has(key(target))) return [];
                seen.add(key(target));
                return [{ target, name: row.workspaceLabel, owner, online: row.online }];
            });
            const server: SentinelTargetResult = { target: { kind: 'server', serverIdentity: identity }, name: owner, owner, online: machine.online };
            if (!server.online) { results.push(server, ...rows.map(r => ({ ...r, online: false }))); continue; }
            try {
                if (machine.serverKind !== 'local' && !machine.baseUrl) throw unavailable();
                const client = getCocClientFor(machine.baseUrl);
                const verify = async () => {
                    current();
                    const health = await client.health.get({ signal });
                    current();
                    if (health.serverIdentity !== identity) throw unavailable();
                };
                await verify();
                const inventory = await client.request<{ workspaces: { id: string; name: string }[] }>('/workspaces', { signal });
                current();
                if (!Array.isArray(inventory?.workspaces)) throw unavailable();
                for (const row of rows) {
                    current();
                    if (row.target.kind === 'workspace') {
                        const workspaceId = row.target.workspaceId;
                        const live = inventory.workspaces.find(w => w.id === workspaceId);
                        if (!live) { row.online = false; row.error = 'Workspace unavailable'; }
                        else row.name = live.name || row.name;
                    } else if (row.target.kind === 'group') {
                        try {
                            const group = await client.request<{ id: string; name: string; members: unknown[] }>(
                                `/repo-groups/${encodeURIComponent(row.target.groupId)}`, { signal });
                            current();
                            if (group?.id !== row.target.groupId || !Array.isArray(group.members)) throw unavailable();
                            row.name = group.name || row.name; row.members = group.members.length;
                        } catch { current(); row.online = false; row.error = 'Group discovery failed. Retry.'; }
                    }
                }
                await verify();
                results.push(server, ...rows);
            } catch {
                current();
                results.push({ ...server, online: false, error: 'Discovery failed. Retry.' },
                    ...rows.map(r => ({ ...r, online: false, error: 'Discovery failed. Retry.' })));
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
    current();
    return results.sort((a, b) => a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name) || key(a.target).localeCompare(key(b.target)));
}

/** Run before every explicit send; the owner policy and target inventory never fall back by name. */
export async function validateSentinelTargetSend(text: string, ownerClient: CocClient, signal: AbortSignal, ownerSelectionId?: string): Promise<void> {
    const refs = targetSpans(text);
    if (!refs.length) return;
    const snapshot = getDashboardTopology();
    // The sending client must still belong to the exact composer owner, even when
    // a routing endpoint has been replaced since the draft was opened.
    const endpoint = ownerClient.options?.baseUrl?.replace(/\/+$/, '') ?? '';
    const ownerRoute = snapshot.routes.find(route =>
        (!ownerSelectionId || route.selectionId === ownerSelectionId || route.row.workspaceId === ownerSelectionId)
        && (route.baseUrl?.replace(/\/+$/, '') ?? '') === endpoint);
    const ownerIdentity = ownerRoute?.row.serverIdentity;
    if (!ownerIdentity) throw unavailable();
    const verifyOwner = async () => {
        signal.throwIfAborted();
        const health = await ownerClient.health.get({ signal });
        signal.throwIfAborted();
        if (getDashboardTopology() !== snapshot || health.serverIdentity !== ownerIdentity) throw unavailable();
    };
    await verifyOwner();
    const config = await ownerClient.request<{ features?: { sentinelTargetAutocompleteEnabled?: boolean } }>('/config/runtime', { signal });
    signal.throwIfAborted();
    if (config?.features?.sentinelTargetAutocompleteEnabled !== true) throw new Error('Target references are disabled on this Sentinel’s owning server. Remove them or enable the feature before sending.');
    const results = await discoverSentinelTargets(snapshot, signal, refs.map(ref => ref.target));
    if (refs.some(ref => !results.some(row => row.online && key(row.target) === key(ref.target)))) throw unavailable();
    await verifyOwner();
}
