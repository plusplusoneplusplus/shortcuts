/**
 * Source links become chat-owned file tabs on the resource's concrete server.
 * In-repo paths use Explorer's editable blob transport; outside-root paths and
 * forced source views use the workspace-authorized read-only preview transport.
 * Group ownership and directory navigation are resolved by resolveChatFileLink.
 */

import { isAbsolutePath } from '../../../utils/path-resolution';
import {
    getSourceCanvasWorkspaceRelativePath,
    isSourceCanvasResolveError,
    resolveSourceCanvasTarget,
    type SourceCanvasWorkspace,
} from '../../chat/source-canvas/resolve';
import type { SourceCanvasFileRef } from '../../chat/source-canvas/types';
import { resourcePathName } from './unifiedPanelOpenMenuModel';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';
import { getRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { WORKSPACE_PREVIEW_PREFIX } from '../../../shared/file-viewer/workspacePreview';

/** A workspace as this module needs it: resolution fields plus a display name. */
export interface SourceLinkWorkspace extends SourceCanvasWorkspace {
    rootPath?: string;
    name?: string;
    remote?: { serverId?: unknown; cloneKey?: unknown } | null;
}

export interface SourceLinkTabInputArgs {
    /** The clicked reference, exactly as the `coc-open-source-canvas` event carried it. */
    fileRef: SourceCanvasFileRef;
    /** Every workspace path resolution may choose from — remote clones included. */
    workspaces: ReadonlyArray<SourceLinkWorkspace>;
    /** Concrete selection that owns the source chat, when the panel is on a direct remote clone. */
    sourceSelectionId?: string;
    /** The panel's own workspace (a group id in a repo group); only for repo labelling. */
    scopeWorkspaceId: string;
    /** The chat the link was clicked in, never whichever chat is selected later. */
    chatId: string | null;
    forceSourceViewer?: boolean;
}

export function sourceLinkWorkspaces(
    workspaces: ReadonlyArray<SourceLinkWorkspace>, sourceSelectionId?: string,
): ReadonlyArray<SourceLinkWorkspace> {
    const sourceRemote = parseRemoteCloneKey(sourceSelectionId);
    return sourceSelectionId ? workspaces.filter(ws => (
        sourceRemote
            ? parseRemoteCloneKey(getRemoteCloneKey(ws))?.serverId === sourceRemote.serverId
            : !getRemoteCloneKey(ws)
    )) : workspaces;
}

/**
 * Build a resolved file descriptor; notes, directories, and unprobed groups
 * are handled separately by resolveChatFileLink.
 */
export function sourceLinkTabInput(args: SourceLinkTabInputArgs): OpenUnifiedTabInput | null {
    const { fileRef, workspaces, sourceSelectionId, scopeWorkspaceId, chatId } = args;

    if (fileRef.kind === 'note' || fileRef.kind === 'dir') return null;
    if (!fileRef.fullPath) return null;

    const sourceRemote = parseRemoteCloneKey(sourceSelectionId);
    const candidates = sourceLinkWorkspaces(workspaces, sourceSelectionId);
    const resolved = resolveSourceCanvasTarget(fileRef, candidates);
    if (isSourceCanvasResolveError(resolved)) return null;

    // A relative result is a repo-group ref left for server-side member probing;
    // there is no single clone to route a blob read at.
    if (!isAbsolutePath(resolved.path)) return null;

    const workspace = (
        sourceRemote?.workspaceId === resolved.wsId
            ? candidates.find(ws => getRemoteCloneKey(ws) === sourceSelectionId)
            : undefined
    ) ?? candidates.find(ws => ws.id === resolved.wsId);
    const rootPath = typeof workspace?.rootPath === 'string' ? workspace.rootPath.trim() : '';
    if (!rootPath) return null;

    // Outside-root paths must never reach the writable repo blob endpoint.
    const relativePath = getSourceCanvasWorkspaceRelativePath(resolved.path, rootPath);
    if (relativePath === '.' || relativePath === '') return null;
    const readOnlyPreview = args.forceSourceViewer || isAbsolutePath(relativePath);

    const repoLabel = resolved.wsId === scopeWorkspaceId ? undefined : workspace?.name;

    return {
        kind: 'file',
        // The clone the bytes come from — a group member or a remote clone — so
        // the read routes to its own server rather than the page origin.
        ownerWorkspaceId: resolved.wsId,
        ownerRoutingRef: getRemoteCloneKey(workspace)
            ?? (sourceRemote?.workspaceId === resolved.wsId ? sourceSelectionId : null),
        chatId,
        resourceId: readOnlyPreview ? WORKSPACE_PREVIEW_PREFIX + resolved.path : relativePath,
        label: resourcePathName(resolved.path),
        ...(repoLabel === undefined ? {} : { repoLabel }),
        ...(fileRef.line === undefined ? {} : { line: fileRef.line }),
        ...(fileRef.endLine === undefined ? {} : { endLine: fileRef.endLine }),
    };
}
