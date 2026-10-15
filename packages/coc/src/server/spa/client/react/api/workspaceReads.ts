import type { CocClient } from '@plusplusoneplusplus/coc-client';

export function workspaceReadSource(client: CocClient): string {
    return JSON.stringify([client.options?.baseUrl ?? '', client.options?.apiBasePath ?? '']);
}

export function workspaceReadCacheKey(workspaceId: string, source?: string): string {
    // Page-origin snapshots retain the local key; remote and container owners
    // have independent entries even when their wire workspace ids collide.
    if (!source || source === '["",""]' || source === '["","/api"]') return workspaceId;
    return JSON.stringify([source, workspaceId]);
}

function shareWorkspaceRead<T>(read: (client: CocClient, workspaceId: string, refresh: boolean) => Promise<T>) {
    type ReadGroup = { pending?: Promise<T>; latest?: Promise<T>; active: number };
    const pendingByClient = new WeakMap<CocClient, Map<string, ReadGroup>>();
    const sharedRead = (client: CocClient, workspaceId: string, refresh = false): Promise<T> => {
        let pending = pendingByClient.get(client);
        if (!pending) {
            pending = new Map();
            pendingByClient.set(client, pending);
        }
        let group = pending.get(workspaceId);
        if (group?.pending && !refresh) return group.pending;
        if (!group) {
            group = { active: 0 };
            pending.set(workspaceId, group);
        }
        const requests = pending;
        const current = group;
        current.active++;
        const promise: Promise<T> = read(client, workspaceId, refresh).then(
            value => current.latest && current.latest !== promise ? current.latest : value,
            error => {
                if (current.latest && current.latest !== promise) return current.latest;
                throw error;
            },
        ).finally(() => {
            if (current.pending === promise) current.pending = undefined;
            if (--current.active === 0) requests.delete(workspaceId);
        });
        current.latest = promise;
        current.pending = promise;
        return promise;
    };
    return Object.assign(sharedRead, {
        invalidate(client: CocClient, workspaceId: string): void {
            const group = pendingByClient.get(client)?.get(workspaceId);
            if (group) group.pending = undefined;
        },
    });
}

// Refreshes supersede pending snapshots, including results awaited by older readers.
export const readWorkspaceGitInfo = shareWorkspaceRead(
    (client, workspaceId, refresh) => refresh
        ? client.workspaces.gitInfo(workspaceId, { refresh: true })
        : client.workspaces.gitInfo(workspaceId),
);

export const readWorkspaceQueue = shareWorkspaceRead(
    (client, workspaceId) => client.queue.list({ repoId: workspaceId }),
);
