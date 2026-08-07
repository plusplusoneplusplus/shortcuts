/**
 * CanvasPanel — side panel rendering a chat-linked canvas.
 *
 * This is a composition root: it owns the public props, the workspace-routed
 * client, fullscreen chrome, and layout. Everything else lives in kernels:
 *
 *  - `useCanvasRecord`   — load, live `canvas-updated` reconciliation, reload
 *                          nonce, debounced revision-checked autosave, conflicts
 *  - `useCanvasVersions` — per-revision browsing and restore-as-latest
 *  - `useCanvasComments` — selection anchoring, comment CRUD, send-to-AI batch
 *  - `useCanvasExport`   — copy / download / save-to-Notes / export-as-HTML
 *  - `useCreateKustoCanvas` — AC-07 blank Kusto canvas creation
 *
 * and in the presentational pieces under `components/` (header, banners, body
 * renderer, selection toolbar, comments panel).
 *
 * The AI edits the canvas through the canvas LLM tools (live updates arrive via
 * the `canvas-updated` SSE event surfaced by `useChatSSE`); the user edits it
 * directly here in Edit mode. A 409 save conflict or a remote AI update over
 * local unsaved edits shows a banner offering to load the latest server version.
 *
 * Canvas types: markdown, `code` (Monaco + fenced preview, SVG code rendered),
 * `excalidraw` (view-only scene), `extension` (sandboxed-iframe UI over JSON
 * shared state), and `kusto` (live query + table/chart).
 *
 * The routed client stays here — every kernel receives it explicitly, so remote
 * clone workspaces keep hitting the workspace-owning server (AC-07).
 */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Canvas, CanvasSummary } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../repos/cloneRouting';
import { ContextMenu, type ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { copyImageToClipboard } from '../../utils/format';
import { ToastContext } from '../../contexts/ToastContext';
import { isKustoEnabled } from '../../utils/config';
import { canvasKind, saveStatusLabel, type ViewMode } from './canvas-panel-model';
import { useCanvasRecord } from './hooks/useCanvasRecord';
import { useCanvasVersions } from './hooks/useCanvasVersions';
import { useCanvasComments } from './hooks/useCanvasComments';
import { useCanvasExport } from './hooks/useCanvasExport';
import { useCreateKustoCanvas } from './hooks/useCreateKustoCanvas';
import { CanvasPanelHeader } from './components/CanvasPanelHeader';
import { CanvasPanelBanners } from './components/CanvasPanelBanners';
import { CanvasSelectionToolbar } from './components/CanvasSelectionToolbar';
import { CanvasBodyRenderer } from './components/CanvasBodyRenderer';
import { CanvasCommentsPanel } from './components/CanvasCommentsPanel';
import type { CanvasUpdatedEvent } from '../chat/hooks/useChatSSE';

export interface CanvasPanelProps {
    workspaceId: string;
    canvasId: string;
    /** Latest live canvas event from the chat SSE stream (AI edits). */
    liveEvent: CanvasUpdatedEvent | null;
    onClose?: () => void;
    /** Prefills the chat composer with a selection-targeted edit prompt. */
    onAskAi?: (prompt: string) => void;
    /** Sends a message to the AI through the normal follow-up path (turn-boundary delivery when busy). */
    onSendToAi?: (message: string) => Promise<void>;
    /** Notifies the host when the panel enters/exits fullscreen (for layout adjustments). */
    onFullscreenChange?: (fullscreen: boolean) => void;
    /** Opens the canvas in a standalone pop-out window. Hidden when omitted (e.g. inside the pop-out itself). */
    onPopOut?: () => void;
    /** All agent canvases linked to the current conversation, in API order. */
    availableCanvases?: CanvasSummary[];
    /** Switches the host panel to another linked agent canvas. */
    onSelectCanvas?: (canvasId: string) => void;
    /** Notifies the host that a new canvas was created here (AC-07) so it can refresh its list. */
    onCanvasCreated?: (canvasId: string) => void;
    /** Bumping this value forces a reload from the server (used by the pop-out window on focus). */
    reloadNonce?: number;
}

export function CanvasPanel({
    workspaceId, canvasId, liveEvent, onClose, onAskAi, onSendToAi, onFullscreenChange,
    onPopOut, availableCanvases = [], onSelectCanvas, onCanvasCreated, reloadNonce,
}: CanvasPanelProps) {
    // AC-07: canvas get/save/versions/comments + save-to-notes target the clone.
    const client = useCocClient(workspaceId);
    const [mode, setMode] = useState<ViewMode>('preview');
    const [isFullscreen, setIsFullscreen] = useState(false);
    // Right-click "Copy image" menu for inline preview images (position + resolved src).
    const [imageMenu, setImageMenu] = useState<{ x: number; y: number; src: string } | null>(null);
    // Optional — the panel renders inside a ToastProvider in the app and pop-out
    // shells, but tests may mount it bare, so degrade gracefully when absent.
    const toast = useContext(ToastContext);
    const notify = useCallback((message: string, kind: 'error' | 'info') => {
        toast?.addToast(message, kind);
    }, [toast]);

    const record = useCanvasRecord({ client, workspaceId, canvasId, liveEvent, reloadNonce });
    const { canvas, canvasRef, loadNonce, adoptSaved } = record;

    const versions = useCanvasVersions({
        client, workspaceId, canvasId, canvas, canvasRef, loadNonce,
        adoptSaved, setSaveState: record.setSaveState,
    });
    const comments = useCanvasComments({
        client, workspaceId, canvasId, canvas, canvasRef, loadNonce, onAskAi, onSendToAi,
    });
    const exporter = useCanvasExport({ client, workspaceId, canvasRef, notify });
    const kusto = useCreateKustoCanvas({
        client, workspaceId, canvasRef, availableCanvases, onCanvasCreated, onSelectCanvas, notify,
    });

    const toggleFullscreen = useCallback(() => {
        setIsFullscreen(prev => {
            const next = !prev;
            onFullscreenChange?.(next);
            return next;
        });
    }, [onFullscreenChange]);

    // Exit fullscreen on Escape
    useEffect(() => {
        if (!isFullscreen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setIsFullscreen(false);
                onFullscreenChange?.(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isFullscreen, onFullscreenChange]);

    const { viewingVersion } = versions;
    const displayedContent = viewingVersion ? viewingVersion.content : (canvas?.content ?? '');
    const kind = canvasKind(canvas, displayedContent);
    const panelTitle = canvas?.title || availableCanvases.find(item => item.id === canvasId)?.title || 'Canvas';

    const handleCanvasSaved = useCallback((saved: Canvas) => adoptSaved(saved), [adoptSaved]);

    const imageMenuItems = useMemo((): ContextMenuItem[] => [{
        label: 'Copy image',
        icon: '🖼️',
        onClick: async () => {
            if (!imageMenu) return;
            try {
                await copyImageToClipboard(imageMenu.src);
            } catch {
                notify('Failed to copy image', 'error');
            }
        },
    }], [imageMenu, notify]);

    return (
        <div
            className={isFullscreen
                ? 'fixed inset-0 z-50 flex flex-col min-h-0 bg-[#fafafa] dark:bg-[#1e1e1e]'
                : 'flex flex-col h-full min-h-0 bg-[#fafafa] dark:bg-[#1e1e1e]'}
            data-testid="canvas-panel"
            data-fullscreen={isFullscreen ? 'true' : 'false'}
        >
            <CanvasPanelHeader
                canvas={canvas}
                canvasId={canvasId}
                title={panelTitle}
                kind={kind}
                availableCanvases={availableCanvases}
                onSelectCanvas={onSelectCanvas}
                versions={versions}
                exporter={exporter}
                saveState={record.saveState}
                statusLabel={saveStatusLabel(record.saveState, record.dirty)}
                mode={mode}
                onModeChange={setMode}
                kustoEnabled={isKustoEnabled()}
                creatingKusto={kusto.creating}
                onCreateKusto={() => void kusto.create()}
                onPopOut={onPopOut}
                isFullscreen={isFullscreen}
                onToggleFullscreen={toggleFullscreen}
                onClose={onClose && (() => {
                    if (isFullscreen) { setIsFullscreen(false); onFullscreenChange?.(false); }
                    onClose();
                })}
            />

            <CanvasPanelBanners
                canvas={canvas}
                viewingVersion={viewingVersion}
                dirty={record.dirty}
                restoring={versions.restoring}
                onRestore={() => void versions.restore()}
                onBackToLatest={versions.backToLatest}
                saveState={record.saveState}
                remoteUpdatePending={record.remoteUpdatePending}
                onLoadLatest={() => void record.reload()}
            />

            {/* Body — relative wrapper so the selection/comment overlays float
                above the content instead of pushing it and shifting the text. */}
            <div className="relative flex-1 min-h-0">
                <CanvasSelectionToolbar
                    selection={comments.selection}
                    visible={!viewingVersion}
                    onAskAi={onAskAi && comments.askAi}
                    onStartComment={comments.startComment}
                    commentAnchor={comments.commentAnchor}
                    commentDraft={comments.commentDraft}
                    onCommentDraftChange={comments.setCommentDraft}
                    onSubmitComment={() => void comments.submitComment()}
                    onCancelComment={comments.cancelComment}
                />

                <div className="h-full overflow-y-auto">
                    <CanvasBodyRenderer
                        workspaceId={workspaceId}
                        canvasId={canvasId}
                        loading={record.loading}
                        loadError={record.loadError}
                        canvas={canvas}
                        kind={kind}
                        viewingVersion={viewingVersion}
                        viewingRevision={versions.viewingRevision}
                        displayedContent={displayedContent}
                        mode={mode}
                        draft={record.draft}
                        onDraftChange={record.editDraft}
                        onCanvasSaved={handleCanvasSaved}
                        onSelectionChange={comments.setSelection}
                        onImageMenu={setImageMenu}
                        notify={notify}
                    />
                </div>
            </div>

            {!viewingVersion && (
                <CanvasCommentsPanel
                    comments={comments.comments}
                    openComments={comments.openComments}
                    sending={comments.sendingComments}
                    onSend={onSendToAi && (() => void comments.sendComments())}
                    onDelete={id => void comments.deleteComment(id)}
                />
            )}

            {/* Right-click "Copy image" menu for inline preview images. */}
            {imageMenu && (
                <ContextMenu
                    position={{ x: imageMenu.x, y: imageMenu.y }}
                    items={imageMenuItems}
                    onClose={() => setImageMenu(null)}
                />
            )}
        </div>
    );
}
