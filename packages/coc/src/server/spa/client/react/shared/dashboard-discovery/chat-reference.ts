import { isDashboardArtifactPath, parseDashboardChatReference } from '../../../../../shared/chat-reference';
import type { DashboardChatReference } from '../../../../../shared/chat-reference';
import { getCocClientFor } from '../../api/cocClient';
import { encodeSegment, repoHashBase } from '../../layout/routePath';
import { getDashboardTopology } from './topology';

export { parseDashboardChatReference };
export type { DashboardChatReference };

const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const valid = (reference: DashboardChatReference) => reference && isId(reference.serverIdentity)
    && isId(reference.workspaceId) && isId(reference.processId)
    && (reference.artifactPath === undefined || isDashboardArtifactPath(reference.artifactPath));
const unavailable = () => new Error('Referenced chat unavailable. Reconnect its server and try again.');

/**
 * Resolve and verify one exact chat without changing selection or ledger state.
 * The caller owns the read deadline and must navigate synchronously after awaiting.
 */
export async function resolveDashboardChatReference(reference: DashboardChatReference, signal: AbortSignal): Promise<{
    selectionId: string;
    workspaceId: string;
    processId: string;
    href: string;
    artifactPath?: string;
}> {
    signal.throwIfAborted();
    if (!valid(reference)) throw unavailable();
    const { serverIdentity, workspaceId, processId, artifactPath } = reference;
    const snapshot = getDashboardTopology();
    const route = snapshot.routes.find(({ row }) => row.online
        && row.serverIdentity === serverIdentity && row.workspaceId === workspaceId);
    if (!route || (route.row.serverKind !== 'local' && !route.baseUrl)) throw unavailable();
    const current = () => {
        signal.throwIfAborted();
        if (getDashboardTopology() !== snapshot) throw unavailable();
    };
    const client = getCocClientFor(route.baseUrl);
    const verify = async () => {
        current();
        const health = await client.health.get({ signal });
        current();
        if (health.serverIdentity !== serverIdentity) throw unavailable();
    };
    try {
        await verify();
        const result = await client.processes.get(processId, {
            workspace: workspaceId, exclude: ['conversation', 'toolCalls'],
        }, { signal });
        current();
        if (result?.process?.id !== processId || result.process.metadata?.workspaceId !== workspaceId
            || result.process.type !== 'chat') throw unavailable();
        if (artifactPath !== undefined) {
            // Reuse the guarded, realpath-checked file resolution route; never read arbitrary bytes here.
            const preview = await client.request<{ type: string; path: string; resolvedWorkspaceId: string }>(
                `/workspaces/${encodeURIComponent(workspaceId)}/files/preview`,
                { query: { path: artifactPath, resolve: true }, signal },
            );
            current();
            if (preview.type !== 'file' || preview.resolvedWorkspaceId !== workspaceId
                || typeof preview.path !== 'string'
                || preview.path.replace(/\\/g, '/') !== artifactPath.replace(/\\/g, '/')) throw unavailable();
        }
        // Detect endpoint replacement during the process read, including cached offline attachments.
        await verify();
        return { selectionId: route.selectionId, workspaceId, processId,
            ...(artifactPath === undefined ? {} : { artifactPath }),
            href: `${repoHashBase(route.selectionId)}/chats/${encodeSegment(processId)}` };
    } catch {
        signal.throwIfAborted();
        throw unavailable();
    }
}
