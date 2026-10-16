import { randomUUID } from 'node:crypto';
import type { DashboardChatQuery, DashboardChatSearchResult, DashboardVisibleWorkspace } from '@plusplusoneplusplus/coc-client';

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
    kind: 'workspaces' | 'chats';
    cancel(error: unknown): void;
    reply(value: Record<string, unknown>): void;
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

    reply(client: DashboardDiscoveryClient, reply: unknown, kind: Pending['kind'] = 'workspaces'): void {
        if (!isRecord(reply)) return;
        const value = reply;
        if (typeof value.id !== 'string') return;
        const pending = this.pending.get(value.id);
        if (!pending || pending.client !== client || pending.kind !== kind) return;
        pending.reply(value);
    }

    listWorkspaces(workspaceId: string, signal?: AbortSignal): Promise<DashboardVisibleWorkspace[]> {
        return this.request(workspaceId, 'workspaces', {}, value => readWorkspaces(value.workspaces), signal);
    }

    searchChats(workspaceId: string, query: DashboardChatQuery, signal?: AbortSignal): Promise<DashboardChatSearchResult> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        if (!query || !query.target || !isText(query.target.serverIdentity) || !isText(query.target.workspaceId)
            || !isText(query.title) || !Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100
            || !Number.isSafeInteger(query.offset) || query.offset < 0) {
            return Promise.reject(new Error('Invalid dashboard chat query'));
        }
        // Snapshot caller-owned selectors before asynchronous reply validation.
        const pinned: DashboardChatQuery = { target: { serverIdentity: query.target.serverIdentity,
            workspaceId: query.target.workspaceId }, title: query.title, limit: query.limit, offset: query.offset };
        return this.request(workspaceId, 'chats', { query: pinned }, value => readChats(value.result, pinned), signal);
    }

    private request<T>(
        workspaceId: string, kind: Pending['kind'], payload: object,
        read: (value: Record<string, unknown>) => T | undefined, signal?: AbortSignal,
    ): Promise<T> {
        if (signal?.aborted) return Promise.reject(signal.reason);
        if (!isText(workspaceId)) return Promise.reject(new Error('Dashboard discovery requires an owning workspace'));
        const selected = [...this.clients.values()].filter(value => value.workspaceId === workspaceId)
            .sort((a, b) => b.focused - a.focused)[0];
        if (!selected) return Promise.reject(new Error('No dashboard is available for this workspace'));
        const { client, revision } = selected;
        const id = randomUUID();
        const subject = kind === 'workspaces' ? 'workspace' : 'chat';
        return new Promise((resolve, reject) => {
            const cancel = (error: unknown) => {
                finish(error);
                try { client.send(JSON.stringify({ type: 'dashboard-discovery-cancel', id })); } catch { /* disconnected */ }
            };
            const abort = () => cancel(signal!.reason);
            const timer = setTimeout(() => cancel(new Error('Dashboard discovery timed out after 10s')), 10_000);
            timer.unref();
            const finish = (error?: unknown, result?: T) => {
                if (!this.pending.delete(id)) return;
                clearTimeout(timer);
                signal?.removeEventListener('abort', abort);
                if (error !== undefined) reject(error); else resolve(result!);
            };
            this.pending.set(id, { client, kind, cancel, reply(value) {
                if (value.ok === false) finish(new Error(`Dashboard ${subject} discovery unavailable`));
                else if (value.ok === true) {
                    const result = read(value);
                    if (result === undefined) finish(new Error(`Invalid dashboard ${subject} discovery response`));
                    else finish(undefined, result);
                }
            } });
            signal?.addEventListener('abort', abort, { once: true });
            try {
                client.send(JSON.stringify({ type: `dashboard-${kind}-request`, request: { id, workspaceId, revision, ...payload } }));
            } catch {
                finish(new Error(`Dashboard ${subject} discovery unavailable`));
            }
        });
    }
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isServerKind(value: unknown): value is DashboardVisibleWorkspace['serverKind'] {
    return value === 'local' || value === 'url' || value === 'ssh' || value === 'devtunnel';
}

function readChats(value: unknown, query: DashboardChatQuery): DashboardChatSearchResult | undefined {
    if (!isRecord(value) || Object.keys(value).some(key => ![
        'target', 'serverLabel', 'workspaceLabel', 'serverKind', 'verification', 'total', 'conversations',
    ].includes(key))) return;
    const target = value.target;
    if (!isRecord(target) || Object.keys(target).some(key => !['serverIdentity', 'workspaceId'].includes(key))
        || target.serverIdentity !== query.target.serverIdentity || target.workspaceId !== query.target.workspaceId
        || !isText(value.serverLabel) || !isText(value.workspaceLabel)
        || !isServerKind(value.serverKind)
        || (value.verification !== 'verified' && value.verification !== 'unverified')
        || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < 0
        || !Array.isArray(value.conversations) || value.conversations.length !== Math.min(query.limit, Math.max(0, value.total - query.offset))) return;
    const conversations: DashboardChatSearchResult['conversations'] = [];
    const ids = new Set<string>();
    for (const row of value.conversations) {
        if (!isRecord(row) || Object.keys(row).some(key => !['processId', 'title'].includes(key))
            || !isText(row.processId) || typeof row.title !== 'string' || row.title.length > 4096
            || !row.title.toLowerCase().includes(query.title.trim().toLowerCase()) || ids.has(row.processId)) return;
        ids.add(row.processId);
        conversations.push({ processId: row.processId, title: row.title });
    }
    return { target: { ...query.target }, serverLabel: value.serverLabel, workspaceLabel: value.workspaceLabel,
        serverKind: value.serverKind,
        verification: value.verification, total: value.total, conversations };
}

function readWorkspaces(value: unknown): DashboardVisibleWorkspace[] | undefined {
    if (!Array.isArray(value) || value.length > 2000) return;
    const result: DashboardVisibleWorkspace[] = [];
    const identities = new Set<string>();
    for (const row of value) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return;
        if (Object.keys(row).some(key => !['serverIdentity', 'serverLabel', 'serverKind', 'workspaceId', 'workspaceLabel', 'type', 'online'].includes(key))) return;
        if (!isText(row.serverLabel) || !isText(row.workspaceId) || !isText(row.workspaceLabel)
            || !['repo', 'group'].includes(row.type) || !isServerKind(row.serverKind) || typeof row.online !== 'boolean'
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
