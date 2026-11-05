import type { SentinelRefrain } from '@plusplusoneplusplus/coc-client';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import type { SentinelTodoOwner } from '../repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { getSentinelTodoContextClient, sentinelTodoContextScopeError } from './sentinelTodoContext';

export const SENTINEL_REFRAIN_DRAG_MIME = 'application/vnd.coc.sentinel-refrain+json';
export interface SentinelRefrainDragPayload {
    kind: 'coc.sentinel-refrain';
    version: 1;
    sourceWorkspaceId: string;
    sourceRoutingRef: string | null;
    sourceProcessId: string;
    refrainId: string;
}

export function createSentinelRefrainDragPayload(owner: SentinelTodoOwner, job: Pick<SentinelRefrain, 'id'>): SentinelRefrainDragPayload {
    return { kind: 'coc.sentinel-refrain', version: 1, sourceWorkspaceId: owner.ownerWorkspaceId,
        sourceRoutingRef: owner.ownerRoutingRef ?? null, sourceProcessId: owner.processId, refrainId: job.id };
}

export function hasSentinelRefrainDrag(data: Pick<DataTransfer, 'types'>): boolean {
    return Array.from(data.types).includes(SENTINEL_REFRAIN_DRAG_MIME);
}

export function readSentinelRefrainDrag(data: Pick<DataTransfer, 'getData'>): SentinelRefrainDragPayload | null {
    try {
        const value = JSON.parse(data.getData(SENTINEL_REFRAIN_DRAG_MIME));
        if (value?.kind !== 'coc.sentinel-refrain' || value.version !== 1
            || ![value.sourceWorkspaceId, value.sourceProcessId, value.refrainId].every(id => typeof id === 'string' && id.trim())
            || !(value.sourceRoutingRef === null || (typeof value.sourceRoutingRef === 'string' && value.sourceRoutingRef.trim()))) return null;
        return value;
    } catch { return null; }
}

/** Read the saved definition from the exact owner; the drag carries no executable instructions. */
export async function resolveSentinelRefrainInstructions(source: SentinelRefrainDragPayload, owner?: SentinelTodoOwner | null): Promise<string> {
    if (!owner) throw new Error('Attach this refrain only to its owning Sentinel chat.');
    const error = sentinelTodoContextScopeError(source, owner);
    if (error) throw new Error(error.replaceAll('to-do', 'refrain'));
    const route = resolveCloneRoute(owner.ownerRoutingRef);
    const client = getSentinelTodoContextClient(owner);
    const { jobs } = await client.sentinelTodos.jobs.list(owner.ownerWorkspaceId, owner.processId);
    const currentRoute = resolveCloneRoute(owner.ownerRoutingRef);
    if (currentRoute.kind !== route.kind
        || (route.kind === 'remote' && currentRoute.kind === 'remote' && route.baseUrl !== currentRoute.baseUrl)) {
        throw new Error('The refrain owning server changed while loading. Try again.');
    }
    const job = jobs.find(job => job.id === source.refrainId);
    if (!job) throw new Error('This refrain is missing. Refresh the Refrains list.');
    if (!job.instructions.trim()) throw new Error('This refrain has no saved instructions.');
    return job.instructions;
}
