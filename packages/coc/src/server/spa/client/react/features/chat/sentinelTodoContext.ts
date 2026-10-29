import type { CocClient, SentinelTodoItem } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor, getSpaCocClient } from '../../api/cocClient';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import type { SentinelTodoOwner } from '../repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { SENTINEL_TODO_CONTEXT_DRAG_KIND, type SentinelTodoContextDragPayload } from './sessionContextDrag';

export function createSentinelTodoContextPayload(owner: SentinelTodoOwner, item: Pick<SentinelTodoItem, 'id' | 'title'>): SentinelTodoContextDragPayload {
    return {
        kind: SENTINEL_TODO_CONTEXT_DRAG_KIND,
        version: 1,
        sourceWorkspaceId: owner.ownerWorkspaceId,
        sourceRoutingRef: owner.ownerRoutingRef ?? null,
        sourceProcessId: owner.processId,
        todoItemId: item.id,
        label: `To-do ${item.id}`,
        title: item.title,
    };
}

export function sentinelTodoContextScopeError(
    source: Pick<SentinelTodoContextDragPayload, 'sourceWorkspaceId' | 'sourceRoutingRef' | 'sourceProcessId'>,
    owner?: SentinelTodoOwner | null,
): string | null {
    if (!owner || source.sourceWorkspaceId !== owner.ownerWorkspaceId || source.sourceProcessId !== owner.processId) {
        return 'Attach this to-do only to its owning Sentinel chat.';
    }
    const sourceRoute = resolveCloneRoute(source.sourceRoutingRef);
    const ownerRoute = resolveCloneRoute(owner.ownerRoutingRef);
    if (sourceRoute.kind === 'unresolved-remote' || ownerRoute.kind === 'unresolved-remote') {
        return 'The to-do owning server is unavailable. Reconnect it before attaching or sending.';
    }
    if (sourceRoute.kind !== ownerRoute.kind
        || (sourceRoute.kind === 'remote' && ownerRoute.kind === 'remote' && sourceRoute.baseUrl !== ownerRoute.baseUrl)) {
        return 'Attach this to-do only on its owning server.';
    }
    if (sourceRoute.kind === 'remote') {
        const sourceClone = parseRemoteCloneKey(source.sourceRoutingRef ?? '');
        const ownerClone = parseRemoteCloneKey(owner.ownerRoutingRef ?? '');
        if (!sourceClone || !ownerClone) return 'Select the concrete owning server before attaching this to-do.';
        if (sourceClone.serverId !== ownerClone.serverId) return 'Attach this to-do only on its owning server.';
    }
    return null;
}

export function getSentinelTodoContextClient(owner: SentinelTodoOwner): CocClient {
    const route = resolveCloneRoute(owner.ownerRoutingRef);
    if (route.kind === 'unresolved-remote') throw new Error('The to-do owning server is unavailable.');
    return route.kind === 'remote' ? getCocClientFor(route.baseUrl) : getSpaCocClient();
}

/** Reads only the owning ledger; no target-repo lookup or mutation is involved. */
export async function resolveSentinelTodoContext(
    source: SentinelTodoContextDragPayload,
    owner: SentinelTodoOwner,
    signal?: AbortSignal,
): Promise<SentinelTodoItem> {
    signal?.throwIfAborted();
    const error = sentinelTodoContextScopeError(source, owner);
    if (error) throw new Error(error);
    const route = resolveCloneRoute(owner.ownerRoutingRef);
    const client = getSentinelTodoContextClient(owner);
    const ledger = await client.sentinelTodos.get(owner.ownerWorkspaceId, owner.processId, { itemId: source.todoItemId, ...(signal ? { signal } : {}) });
    signal?.throwIfAborted();
    const currentRoute = resolveCloneRoute(owner.ownerRoutingRef);
    if (currentRoute.kind !== route.kind
        || (route.kind === 'remote' && currentRoute.kind === 'remote' && route.baseUrl !== currentRoute.baseUrl)) {
        throw new Error('The to-do owning server changed while loading. Try again.');
    }
    const item = ledger.items.find(item => item.id === source.todoItemId);
    if (!item) throw new Error('This to-do is missing. Refresh the ledger and remove its context chip.');
    return item;
}
