import { randomUUID } from 'node:crypto';
import type { DashboardVisibleWorkspace } from '@plusplusoneplusplus/coc-client';

export interface DashboardDiscoveryClient {
    id: string;
    send(data: string): void;
}

interface Capability {
    client: DashboardDiscoveryClient;
    workspaceId: string;
    revision: string;
    focused: number;
}

interface Pending {
    client: DashboardDiscoveryClient;
    cancel(error: unknown): void;
    finish(error?: unknown, workspaces?: DashboardVisibleWorkspace[]): void;
}

/** Read-only, owner-scoped requests go to one dashboard, never broadcast/container forwarding. */
export class DashboardDiscoveryRelay {
    private sequence = 0;
    private readonly clients = new Map<string, Capability>();
    private readonly pending = new Map<string, Pending>();

    advertise(client: DashboardDiscoveryClient, workspaceId: unknown, revision: unknown, focused: unknown): void {
        if (!isText(workspaceId) || !isText(revision) || typeof focused !== 'boolean') return;
        const old = this.clients.get(client.id);
        if (old && (old.client !== client || old.workspaceId !== workspaceId || old.revision !== revision)) {
            this.disconnect(old.client);
        }
        this.clients.set(client.id, { client, workspaceId, revision,
            focused: focused ? ++this.sequence : old?.focused ?? 0 });
    }

    disconnect(client: DashboardDiscoveryClient): void {
        if (this.clients.get(client.id)?.client === client) this.clients.delete(client.id);
        for (const pending of [...this.pending.values()]) {
            if (pending.client === client) pending.cancel(new Error('Dashboard discovery scope disconnected or changed'));
        }
    }

    reply(client: DashboardDiscoveryClient, reply: unknown): void {
        if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return;
        const value = reply as Record<string, unknown>;
        if (typeof value.id !== 'string') return;
        const pending = this.pending.get(value.id);
        if (!pending || pending.client !== client) return;
        if (value.ok === false) {
            pending.finish(new Error('Dashboard workspace discovery unavailable'));
        } else if (value.ok === true) {
            const workspaces = readWorkspaces(value.workspaces);
            if (!workspaces) pending.finish(new Error('Invalid dashboard workspace discovery response'));
            else pending.finish(undefined, workspaces);
        }
    }

    listWorkspaces(workspaceId: string, signal?: AbortSignal): Promise<DashboardVisibleWorkspace[]> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        if (!isText(workspaceId)) return Promise.reject(new Error('Dashboard discovery requires an owning workspace'));
        const selected = [...this.clients.values()].filter(value => value.workspaceId === workspaceId)
            .sort((a, b) => b.focused - a.focused)[0];
        if (!selected) return Promise.reject(new Error('No dashboard is available for this workspace'));
        const { client, revision } = selected;
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const cancel = (error: unknown) => {
                finish(error);
                try { client.send(JSON.stringify({ type: 'dashboard-discovery-cancel', id })); } catch { /* disconnected */ }
            };
            const abort = () => cancel(signal!.reason);
            const timer = setTimeout(() => cancel(new Error('Dashboard discovery timed out after 10s')), 10_000);
            timer.unref();
            const finish = (error?: unknown, workspaces?: DashboardVisibleWorkspace[]) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error !== undefined) reject(error); else resolve(workspaces!);
            };
            this.pending.set(id, { client, cancel, finish });
            signal?.addEventListener('abort', abort, { once: true });
            try {
                client.send(JSON.stringify({ type: 'dashboard-workspaces-request', request: { id, workspaceId, revision } }));
            } catch {
                finish(new Error('Dashboard workspace discovery unavailable'));
            }
        });
    }
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function readWorkspaces(value: unknown): DashboardVisibleWorkspace[] | undefined {
    if (!Array.isArray(value) || value.length > 2000) return;
    const result: DashboardVisibleWorkspace[] = [];
    const identities = new Set<string>();
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return;
        if (Object.keys(row).some(key => !['serverIdentity', 'serverLabel', 'serverKind', 'workspaceId', 'workspaceLabel', 'type', 'online'].includes(key))) return;
        if (!isText(row.serverLabel) || !isText(row.workspaceId) || !isText(row.workspaceLabel)
            || !['repo', 'group'].includes(row.type) || !['local', 'url', 'ssh', 'devtunnel'].includes(row.serverKind) || typeof row.online !== 'boolean'
            || (row.serverIdentity !== undefined && !isText(row.serverIdentity))) return;
        // Equal workspace ids on different installations are distinct. Unknown owners stay unknown.
        if (row.serverIdentity !== undefined) {
            const key = JSON.stringify([row.serverIdentity, row.workspaceId]);
            if (identities.has(key)) return;
            identities.add(key);
        }
        result.push({ serverLabel: row.serverLabel, serverKind: row.serverKind,
            workspaceId: row.workspaceId, workspaceLabel: row.workspaceLabel, type: row.type, online: row.online,
            ...(row.serverIdentity === undefined ? {} : { serverIdentity: row.serverIdentity }) });
    }
    return result;
}
