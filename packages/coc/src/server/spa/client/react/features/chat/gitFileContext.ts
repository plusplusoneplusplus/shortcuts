import { GIT_FILE_CONTEXT_DRAG_KIND, type GitFileContextDragPayload } from './sessionContextDrag';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
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
        || !isReviewedFileRevision(data.revision)
        || (data.side !== 'base' && data.side !== 'head')
        || typeof data.filePath !== 'string' || !data.filePath || data.filePath.includes('\0')
        || data.filePath.startsWith('/') || /^[A-Za-z]:/.test(data.filePath)
        || data.filePath.includes('\\') || data.filePath.split('/').some(part => part === '..' || part === '.')
    ) return null;
    return {
        kind: GIT_FILE_CONTEXT_DRAG_KIND, version: 1,
        sourceWorkspaceId: data.sourceWorkspaceId,
        sourceRoutingRef: data.sourceRoutingRef,
        filePath: data.filePath, revision: data.revision, side: data.side,
        label: `${data.filePath} @ ${data.revision.slice(0, 7)}${data.revision.endsWith('^') ? '^' : ''}`,
    };
}

export function gitFileContextKey(source: Pick<GitFileContextDragPayload, 'sourceRoutingRef' | 'sourceWorkspaceId' | 'filePath' | 'revision'>): string {
    const remote = parseRemoteCloneKey(source.sourceRoutingRef ?? '');
    return JSON.stringify(['git-file', remote?.serverId ?? null, source.sourceWorkspaceId, source.revision, source.filePath]);
}

export function gitFileContextScopeError(source: Pick<GitFileContextDragPayload, 'sourceRoutingRef' | 'sourceWorkspaceId'>, owner?: string | null): string | null {
    return gitCommitContextScopeError(source, owner)?.replace(/commit/g, 'file') ?? null;
}
