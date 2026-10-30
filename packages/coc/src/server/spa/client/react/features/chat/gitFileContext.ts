import { GIT_FILE_CONTEXT_DRAG_KIND, type GitFileContextDragPayload } from './sessionContextDrag';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { gitCommitContextScopeError } from './gitCommitContext';

/** Accept immutable commits (or their first parent), never mutable branch names. */
export function isReviewedFileRevision(value: unknown): value is string {
    return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})(?:\^)?$/i.test(value);
}

export function createGitFileContextPayload(value: unknown): GitFileContextDragPayload | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as Partial<GitFileContextDragPayload>;
    if (data.kind !== GIT_FILE_CONTEXT_DRAG_KIND || data.version !== 1
        || typeof data.sourceWorkspaceId !== 'string' || !data.sourceWorkspaceId.trim()
        || (data.sourceRoutingRef !== null && typeof data.sourceRoutingRef !== 'string')
        || (data.side === 'working-tree' ? data.revision !== undefined
            : (data.side !== 'base' && data.side !== 'head') || !isReviewedFileRevision(data.revision))
        || typeof data.filePath !== 'string' || !data.filePath || data.filePath.includes('\0')
        || data.filePath.startsWith('/') || /^[A-Za-z]:/.test(data.filePath)
        || data.filePath.includes('\\') || data.filePath.split('/').some(part => part === '..' || part === '.')
    ) return null;
    const base = {
        kind: GIT_FILE_CONTEXT_DRAG_KIND, version: 1 as const,
        sourceWorkspaceId: data.sourceWorkspaceId,
        sourceRoutingRef: data.sourceRoutingRef,
        filePath: data.filePath,
    };
    if (data.side === 'working-tree' || data.revision === undefined) return { ...base, side: 'working-tree', label: data.filePath };
    return {
        ...base, revision: data.revision, side: data.side,
        label: `${data.filePath} @ ${data.revision.slice(0, 7)}${data.revision.endsWith('^') ? '^' : ''}`,
    };
}

export function gitFileContextKey(source: Pick<GitFileContextDragPayload, 'sourceRoutingRef' | 'sourceWorkspaceId' | 'filePath' | 'revision'>): string {
    const remote = parseRemoteCloneKey(source.sourceRoutingRef ?? '');
    return JSON.stringify(['git-file', remote?.serverId ?? null, source.sourceWorkspaceId, source.revision ?? null, source.filePath]);
}

/** The open source-tab file a right-panel tab drag carries, or null when its owner is unknown or the path is not repo-relative. */
export function createWorkingTreeFileContextPayload(tab: { ownerWorkspaceId: string; ownerRoutingRef?: string | null; resourceId: string }): GitFileContextDragPayload | null {
    const ownerKnown = tab.ownerRoutingRef != null || resolveCloneRoute(tab.ownerWorkspaceId).kind === 'local';
    return ownerKnown ? createGitFileContextPayload({
        kind: GIT_FILE_CONTEXT_DRAG_KIND, version: 1, sourceWorkspaceId: tab.ownerWorkspaceId,
        sourceRoutingRef: tab.ownerRoutingRef ?? null, filePath: tab.resourceId, side: 'working-tree',
    }) : null;
}

export function gitFileContextDuplicateError(source: Pick<GitFileContextDragPayload, 'side'>): string {
    return source.side === 'working-tree' ? 'This file is already attached to the message.' : 'This file revision is already attached to the message.';
}

export function gitFileContextScopeError(source: Pick<GitFileContextDragPayload, 'sourceRoutingRef' | 'sourceWorkspaceId'>, owner?: string | null): string | null {
    return gitCommitContextScopeError(source, owner)?.replace(/commit/g, 'file') ?? null;
}
