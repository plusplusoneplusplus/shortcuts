import { getDashboardTopology } from '../../../shared/dashboard-discovery/topology';
import { resolveCloneRoute } from '../../../repos/cloneRegistry';
import { createSentinelTodoContextPayload, getSentinelTodoContextClient, resolveSentinelTodoContext } from '../../chat/sentinelTodoContext';
import { formatAttachedContext } from '../../chat/hooks/useAttachedContext';
import type { SentinelTodoOwner } from './sentinelTodoPanelModel';

const unavailable = () => new Error('The to-do owning Sentinel is unavailable. Reconnect its server and try again.');

/** Capture the ledger owner, never the selected chat or a job's target repository. */
export function captureSentinelTodoMessageTarget(owner: SentinelTodoOwner, itemId: string) {
    const route = resolveCloneRoute(owner.ownerRoutingRef);
    if (route.kind === 'unresolved-remote' || !itemId.trim() || !owner.processId.trim()) throw unavailable();
    const matches = getDashboardTopology().routes.filter(entry => entry.row.online
        && entry.row.workspaceId === owner.ownerWorkspaceId
        && (route.kind === 'remote'
            ? entry.selectionId === owner.ownerRoutingRef && entry.baseUrl === route.baseUrl
            : entry.row.serverKind === 'local' && !entry.baseUrl));
    if (matches.length !== 1 || !matches[0].row.serverIdentity) throw unavailable();
    const entry = matches[0];
    return Object.freeze({
        owner: Object.freeze({ ...owner, ownerRoutingRef: owner.ownerRoutingRef ?? null }),
        itemId,
        serverIdentity: entry.row.serverIdentity!,
        baseUrl: entry.baseUrl,
        workspaceLabel: entry.row.workspaceLabel,
        serverLabel: entry.row.serverLabel,
    });
}

export type SentinelTodoMessageTarget = ReturnType<typeof captureSentinelTodoMessageTarget>;

/** Read-only preparation shared by dialog open and explicit send. Callers abort on draft changes. */
export async function resolveSentinelTodoMessageContext(
    target: SentinelTodoMessageTarget,
    gates: { sentinelTodos: boolean; sessionContextAttachments: boolean },
    signal: AbortSignal,
) {
    signal.throwIfAborted();
    if (!gates.sentinelTodos || !gates.sessionContextAttachments) {
        throw new Error('To-do context attachments must be enabled before messaging this Sentinel.');
    }
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Loading the owning Sentinel timed out. Try again.')), 10_000);
    const boundedSignal = controller.signal;
    const snapshot = getDashboardTopology();
    const assertCurrent = () => {
        signal.throwIfAborted();
        boundedSignal.throwIfAborted();
        if (getDashboardTopology() !== snapshot) throw unavailable();
        const current = captureSentinelTodoMessageTarget(target.owner, target.itemId);
        if (current.serverIdentity !== target.serverIdentity || current.baseUrl !== target.baseUrl) throw unavailable();
    };
    let rejectAbort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
        rejectAbort = () => reject(boundedSignal.reason);
        boundedSignal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
        // Race as well as passing the signal: abandoned reads must settle even if a transport ignores abort.
        return await Promise.race([cancelled, (async () => {
            assertCurrent();
            const client = getSentinelTodoContextClient(target.owner);
            const verifyHealth = async () => {
                const health = await client.health.get({ signal: boundedSignal });
                assertCurrent();
                if (health.serverIdentity !== target.serverIdentity) throw unavailable();
            };
            await verifyHealth();
            const { process } = await client.processes.get(target.owner.processId, {
                workspace: target.owner.ownerWorkspaceId, exclude: ['conversation', 'toolCalls'],
            }, { signal: boundedSignal });
            assertCurrent();
            if (process?.id !== target.owner.processId || process.type !== 'chat'
                || process.metadata?.workspaceId !== target.owner.ownerWorkspaceId
                || process.metadata?.mode !== 'sentinel') throw unavailable();
            const payload = createSentinelTodoContextPayload(target.owner, { id: target.itemId, title: '' });
            const item = await resolveSentinelTodoContext(payload, target.owner, boundedSignal);
            assertCurrent();
            await verifyHealth();
            const context = formatAttachedContext([{
                ...createSentinelTodoContextPayload(target.owner, item),
                kind: 'sentinel-todo', id: item.id, preview: item.title, resolvedItem: item,
            }]);
            return { client, process, item, context, assertCurrent };
        })()]);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        boundedSignal.removeEventListener('abort', rejectAbort);
    }
}
