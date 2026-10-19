import type { DashboardWorkspaceTarget } from '@plusplusoneplusplus/coc-client';
import { getCocClientFor } from '../../api/cocClient';
import { decodeSegment, encodeSegment, repoHashBase } from '../../layout/routePath';
import { getDashboardTopology } from './topology';

export interface DashboardChatReference extends DashboardWorkspaceTarget {
    processId: string;
}

const isId = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.length <= 512;
const valid = (reference: DashboardChatReference) => reference && isId(reference.serverIdentity)
    && isId(reference.workspaceId) && isId(reference.processId);
const unavailable = () => new Error('Referenced chat unavailable. Reconnect its server and try again.');

/** Durable links contain identity only; aliases and transport endpoints are resolved on open. */
export function parseDashboardChatReference(hash: string): DashboardChatReference | null {
    const parts = hash.split('/');
    if (parts.length !== 4 || parts[0] !== '#chat-references' || hash.includes('?')) return null;
    try {
        const [serverIdentity, workspaceId, processId] = parts.slice(1).map(decodeSegment);
        const reference = { serverIdentity, workspaceId, processId };
        return valid(reference) ? reference : null;
    } catch {
        return null;
    }
}

/**
 * Resolve and verify one exact chat without changing selection or ledger state.
 * The caller owns the read deadline and must navigate synchronously after awaiting.
 */
export async function resolveDashboardChatReference(reference: DashboardChatReference, signal: AbortSignal): Promise<{
    selectionId: string;
    workspaceId: string;
    processId: string;
    href: string;
}> {
    signal.throwIfAborted();
    if (!valid(reference)) throw unavailable();
    const { serverIdentity, workspaceId, processId } = reference;
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
        // Detect endpoint replacement during the process read, including cached offline attachments.
        await verify();
        return { selectionId: route.selectionId, workspaceId, processId,
            href: `${repoHashBase(route.selectionId)}/chats/${encodeSegment(processId)}` };
    } catch {
        signal.throwIfAborted();
        throw unavailable();
    }
}
