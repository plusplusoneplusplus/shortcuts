import { getRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { isAbsolutePath } from '../../../utils/path-resolution';
import { workspacePreviewClient } from '../../../shared/file-viewer/workspacePreview';
import { getSourceCanvasWorkspaceRelativePath, isSourceCanvasResolveError, resolveSourceCanvasTarget } from '../../chat/source-canvas/resolve';
import { sourceLinkTabInput, sourceLinkWorkspaces, type SourceLinkTabInputArgs } from './unifiedSourceLinks';
import { noteTabInput } from './unifiedNoteTabs';
import { routingRefForPanelOwner } from './unifiedPanelOwnerRouting';
import type { OpenUnifiedTabInput } from './unifiedPanelTabsModel';

export const OPEN_PANEL_DIRECTORY_EVENT = 'coc-open-panel-directory';

export interface OpenPanelDirectoryDetail {
    scopeWorkspaceId: string;
    chatId: string | null;
    ownerWorkspaceId: string;
    ownerRoutingRef?: string | null;
    path: string;
    handled?: boolean;
}

export type ChatFileLinkTarget =
    | { type: 'tab'; input: OpenUnifiedTabInput }
    | { type: 'directory'; detail: OpenPanelDirectoryDetail };

/** Probe group ownership without reading bytes or granting a group write route. */
export async function resolveChatFileLink(
    args: SourceLinkTabInputArgs, signal: AbortSignal,
): Promise<ChatFileLinkTarget> {
    const candidates = sourceLinkWorkspaces(args.workspaces, args.sourceSelectionId);
    let ref = args.fileRef;
    let forceSourceViewer = args.forceSourceViewer === true;
    const resolved = resolveSourceCanvasTarget(ref, candidates);
    if (isSourceCanvasResolveError(resolved)) throw new Error(resolved.error);
    const group = resolved.wsId.startsWith('group-');
    let directory = ref.kind === 'dir';
    if (group || directory) {
        const owner = candidates.find(ws => ws.id === resolved.wsId);
        const route = getRemoteCloneKey(owner)
            ?? routingRefForPanelOwner(args.sourceSelectionId ?? null, resolved.wsId);
        const metadata = await workspacePreviewClient(resolved.wsId, route).request<{
            path: string; resolvedWorkspaceId: string; type: string;
        }>(`/workspaces/${encodeURIComponent(resolved.wsId)}/files/preview`, {
            query: { path: resolved.path, resolve: true }, signal,
        });
        if (typeof metadata.path !== 'string' || !isAbsolutePath(metadata.path)
            || typeof metadata.resolvedWorkspaceId !== 'string' || !metadata.resolvedWorkspaceId
            || (metadata.type !== 'file' && metadata.type !== 'directory')) {
            throw new Error('The file owner could not be resolved.');
        }
        ref = { ...ref, fullPath: metadata.path, wsId: metadata.resolvedWorkspaceId, sourceFilePath: undefined };
        directory = metadata.type === 'directory';
        // Group Markdown remains read-only, even when its member is now known.
        forceSourceViewer ||= group;
    }
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    if (directory) {
        const sourceRemote = parseRemoteCloneKey(args.sourceSelectionId);
        const owner = candidates.find(ws => ws.id === ref.wsId);
        const path = getSourceCanvasWorkspaceRelativePath(ref.fullPath, owner?.rootPath);
        if (!owner || isAbsolutePath(path)) throw new Error('This folder is outside the workspace Explorer.');
        return {
            type: 'directory',
            detail: {
                scopeWorkspaceId: args.scopeWorkspaceId,
                chatId: args.chatId,
                ownerWorkspaceId: owner.id,
                ownerRoutingRef: getRemoteCloneKey(owner)
                    ?? routingRefForPanelOwner(sourceRemote ? args.sourceSelectionId : null, owner.id),
                path,
            },
        };
    }
    const input = ref.kind === 'note' && !forceSourceViewer
        ? noteTabInput({ ...args, fileRef: ref, workspaces: candidates })
        : sourceLinkTabInput({ ...args, fileRef: { ...ref, kind: 'code' }, workspaces: candidates, forceSourceViewer });
    if (!input) throw new Error('No workspace can open this file.');
    return { type: 'tab', input };
}
