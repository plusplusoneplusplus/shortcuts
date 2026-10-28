import type { WorkspacesResponse } from '@plusplusoneplusplus/coc-client';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useUnifiedPanelHost } from '../../features/repo-detail/unified-right-panel/unifiedPanelHost';
import { resolveChatFileLink, OPEN_PANEL_DIRECTORY_EVENT } from '../../features/repo-detail/unified-right-panel/resolveChatFileLink';
import { openUnifiedPanelTab } from '../../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import type { OpenUnifiedTabInput } from '../../features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { buildRemoteCloneKey, getRemoteCloneKey, parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';
import { useWorkspacesWithRemoteOptional } from '../../repos/workspacesWithRemote';
import { workspacePreviewClient, WORKSPACE_PREVIEW_PREFIX } from '../file-viewer/workspacePreview';
import { FloatingDialog } from '../../ui/FloatingDialog';
import { getSpaCocClientErrorMessage } from '../../api/cocClient';
import type { SourceCanvasFileRef } from '../../features/chat/source-canvas/types';
import { isSourceCanvasDirectoryPath } from '../file-path-utils';
import type { FileReference } from './file-path-preview';

const PreviewPane = lazy(() => import('../../features/repo-detail/explorer/PreviewPane').then(module => ({ default: module.PreviewPane })));

/** Bind delegated Markdown clicks to the displayed resource, not the selected chat. */
export function MarkdownFileLinkScope({ workspaceId, routingRef, sourceFilePath, onNavigate, children }: {
    workspaceId: string;
    routingRef?: string | null;
    sourceFilePath?: string;
    children: ReactNode;
    onNavigate?: (ref: SourceCanvasFileRef) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const host = useUnifiedPanelHost();
    const owner = useWorkspaceOwner(workspaceId);
    const workspaces = useWorkspacesWithRemoteOptional();
    const [error, setError] = useState<string | null>(null);
    const fallbackReveal = useRef(0);
    const [fallback, setFallback] = useState<OpenUnifiedTabInput | null>(null);
    const rawWorkspaceId = parseRemoteCloneKey(workspaceId)?.workspaceId ?? workspaceId;
    const ownerRoute = routingRef !== undefined ? routingRef
        : owner ? (parseRemoteCloneKey(owner.selectionId) ? owner.selectionId : null)
        : parseRemoteCloneKey(workspaceId) ? workspaceId
        : getRemoteCloneKey(workspaces.find(ws => ws.id === workspaceId)) ?? undefined;

    useEffect(() => {
        const element = container.current;
        if (!element) return;
        let request: AbortController | undefined;
        setError(null);
        setFallback(null);
        const handle = (event: Event) => {
            if (event.defaultPrevented) return;
            const ref = (event as CustomEvent<FileReference>).detail;
            if (!ref?.filePath) return;
            event.preventDefault();
            event.stopPropagation();
            request?.abort();
            if (!rawWorkspaceId) {
                setError('No workspace is available to open this file.');
                return;
            }
            const controller = new AbortController();
            request = controller;
            setError(null);
            const fileRef: SourceCanvasFileRef = {
                fullPath: ref.filePath, wsId: rawWorkspaceId,
                sourceFilePath,
                line: ref.line, endLine: ref.endLine,
                kind: isSourceCanvasDirectoryPath(ref.filePath) ? 'dir' : 'code',
            };
            if (!host && onNavigate) {
                onNavigate(fileRef);
                return;
            }
            void (async () => {
                // Read current roots from the resource's own server. In a pop-out
                // the workspace list need not have been loaded by the app shell.
                const route = ownerRoute === undefined ? resolveCloneRoute(workspaceId) : resolveCloneRoute(ownerRoute);
                if (route.kind !== 'local' && !parseRemoteCloneKey(ownerRoute)) {
                    throw new Error('The owning remote server is unavailable.');
                }
                const client = workspacePreviewClient(rawWorkspaceId, ownerRoute ?? null);
                const result = await client.request<WorkspacesResponse>('/workspaces', { signal: controller.signal });
                if (controller.signal.aborted) return;
                const remote = parseRemoteCloneKey(ownerRoute);
                const candidates = (result.workspaces ?? []).map(ws => ({
                    ...ws,
                    ...(remote ? { remote: { serverId: remote.serverId, cloneKey: buildRemoteCloneKey(remote.serverId, ws.id) } } : {}),
                }));
                const target = await resolveChatFileLink({
                    fileRef,
                    workspaces: candidates,
                    sourceSelectionId: ownerRoute ?? rawWorkspaceId,
                    scopeWorkspaceId: host?.workspaceId ?? rawWorkspaceId,
                    chatId: host?.chatId ?? null,
                }, controller.signal);
                if (controller.signal.aborted || !element.isConnected) return;
                if (workspacePreviewClient(rawWorkspaceId, ownerRoute ?? null) !== client) {
                    throw new Error('The owning remote server changed. Please open the link again.');
                }
                if (target.type === 'directory') {
                    window.dispatchEvent(new CustomEvent(OPEN_PANEL_DIRECTORY_EVENT, { detail: target.detail }));
                    if (!target.detail.handled) throw new Error('The folder panel is unavailable in this view.');
                } else if (host) {
                    openUnifiedPanelTab(host.workspaceId, target.input);
                } else {
                    // Standalone/pop-out previews use the same editor and the
                    // workspace-authorized read-only transport, without navigating.
                    fallbackReveal.current++;
                    setFallback(target.input);
                }
            })().catch(cause => {
                if (!controller.signal.aborted) setError(getSpaCocClientErrorMessage(cause, 'Failed to open file.'));
            });
        };
        element.addEventListener('coc-open-file-reference', handle);
        return () => {
            request?.abort();
            element.removeEventListener('coc-open-file-reference', handle);
        };
    }, [workspaceId, rawWorkspaceId, ownerRoute, sourceFilePath, host, onNavigate]);

    return (
        <div ref={container} className="h-full min-h-0" data-markdown-file-links=""
            data-ws-id={rawWorkspaceId} data-source-file={sourceFilePath}>
            {error && <div role="alert" className="p-2 text-xs text-red-500">{error}</div>}
            {children}
            {fallback && <FloatingDialog title={fallback.label} open resizable noPadding className="w-[80vw] h-[70vh]" onClose={() => setFallback(null)}>
                <Suspense fallback={<div>Loading…</div>}>
                    <PreviewPane repoId={fallback.ownerWorkspaceId} routingRef={fallback.ownerRoutingRef}
                        filePath={fallback.resourceId.startsWith(WORKSPACE_PREVIEW_PREFIX)
                            ? fallback.resourceId : WORKSPACE_PREVIEW_PREFIX + fallback.resourceId}
                        fileName={fallback.label} revealLine={fallback.line} endLine={fallback.endLine}
                        revealNonce={fallbackReveal.current} />
                </Suspense>
            </FloatingDialog>}
        </div>
    );
}
