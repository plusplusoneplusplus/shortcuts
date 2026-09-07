/**
 * unifiedSourceLinks — turns a clicked chat source-file link into a read-only
 * `file` tab descriptor for the unified right panel (AC-04).
 *
 * An assistant response links a path, not a resource: the ref may be relative
 * to the file it was mentioned in, absolute on the agent's host, tilde-prefixed,
 * or workspace-relative, and the workspace it belongs to has to be inferred. All
 * of that already has one implementation — `resolveSourceCanvasTarget`, the
 * resolution the docked source canvas uses — so this module reuses it and then
 * answers the one extra question a panel tab asks: which clone owns the bytes,
 * and what path does that clone's blob API want?
 *
 * The panel's file view is the Explorer's `PreviewPane`, which reads
 * `repoId` + a repo-relative path. So a link only becomes a tab when the
 * resolution lands INSIDE a known workspace root:
 *
 *  - a repo-group ref stays relative on purpose (only the server can probe the
 *    live members in stored order), and
 *  - an absolute path outside every known root is not readable through a repo's
 *    blob endpoint at all.
 *
 * Both return `null`, which is the caller's signal to keep the existing docked
 * source canvas — whose `previewWorkspaceFile` transport does handle those —
 * rather than open a tab that could only render an error.
 *
 * The descriptor is always `readOnly`. A chat source link is a reference, not an
 * authorization: `openTab` takes that bit from the entry point, so the same file
 * opened from the Explorer stays editable and this one never widens.
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

/** A workspace as this module needs it: resolution fields plus a display name. */
export interface SourceLinkWorkspace extends SourceCanvasWorkspace {
    name?: string;
}

export interface SourceLinkTabInputArgs {
    /** The clicked reference, exactly as the `coc-open-source-canvas` event carried it. */
    fileRef: SourceCanvasFileRef;
    /** Every workspace path resolution may choose from — remote clones included. */
    workspaces: ReadonlyArray<SourceLinkWorkspace>;
    /** The panel's own workspace (a group id in a repo group); only for repo labelling. */
    scopeWorkspaceId: string;
    /** The chat the link was clicked in, never whichever chat is selected later. */
    chatId: string | null;
}

/**
 * The tab a chat source link opens, or `null` when this ref belongs on the
 * docked source canvas instead (a note or folder ref, or a path that does not
 * resolve to a file inside a known workspace root).
 */
export function sourceLinkTabInput(args: SourceLinkTabInputArgs): OpenUnifiedTabInput | null {
    const { fileRef, workspaces, scopeWorkspaceId, chatId } = args;

    // Notes and folders are their own views, not files. Notes are workspace-owned
    // and folders open the Explorer; both keep the existing surface until their
    // own entry points land.
    if (fileRef.kind === 'note' || fileRef.kind === 'dir') return null;
    if (!fileRef.fullPath) return null;

    const resolved = resolveSourceCanvasTarget(fileRef, workspaces);
    if (isSourceCanvasResolveError(resolved)) return null;

    // A relative result is a repo-group ref left for server-side member probing;
    // there is no single clone to route a blob read at.
    if (!isAbsolutePath(resolved.path)) return null;

    const workspace = workspaces.find(ws => ws.id === resolved.wsId);
    const rootPath = typeof workspace?.rootPath === 'string' ? workspace.rootPath.trim() : '';
    if (!rootPath) return null;

    // Outside the root this returns the input path unchanged (still absolute),
    // and `.` for the root itself — neither is a file the repo blob API can read.
    const relativePath = getSourceCanvasWorkspaceRelativePath(resolved.path, rootPath);
    if (relativePath === '.' || relativePath === '' || isAbsolutePath(relativePath)) return null;

    const repoLabel = resolved.wsId === scopeWorkspaceId ? undefined : workspace?.name;

    return {
        kind: 'file',
        // The clone the bytes come from — a group member or a remote clone — so
        // the read routes to its own server rather than the page origin.
        ownerWorkspaceId: resolved.wsId,
        chatId,
        resourceId: relativePath,
        label: resourcePathName(relativePath),
        ...(repoLabel === undefined ? {} : { repoLabel }),
        readOnly: true,
        ...(fileRef.line === undefined ? {} : { line: fileRef.line }),
    };
}
