import { useEffect, useMemo, useState } from 'react';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import { ExtensionCanvasView } from '../features/canvas/ExtensionCanvasView';
import { KustoView, parseKustoContent } from '../features/canvas/KustoView';
import { useCocClient } from '../repos/cloneRouting';
import { useChatRenderContext } from '../features/chat/conversation/ChatRenderContext';
import { useUnifiedPanelHostForChat } from '../features/repo-detail/unified-right-panel/unifiedPanelHost';
import { canvasEmbedTabInput } from '../features/repo-detail/unified-right-panel/unifiedCanvasEmbeds';
import { openUnifiedPanelTab } from '../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { useWorkspacesWithRemoteOptional } from '../repos/workspacesWithRemote';
import { ExcalidrawPreview } from './ExcalidrawPreview';
import { useKustoEmbedGroup } from './KustoEmbedGroup';

export interface CanvasEmbedProps {
    workspaceId: string;
    canvasId: string;
}

/** Compact one-line summary of a Kusto canvas for its collapsed header. */
function kustoSummary(canvas: Canvas): string {
    const parsed = parseKustoContent(canvas.content);
    if (parsed.lastRun?.status === 'error') return 'Query failed';
    const rowCount = parsed.lastRun?.rowCount ?? parsed.rows.length;
    if (rowCount > 0 || parsed.columns.length > 0) {
        return `${rowCount.toLocaleString()} row${rowCount === 1 ? '' : 's'}`;
    }
    return 'Not run yet';
}

/**
 * Inline Kusto canvas embed. When several appear in one conversation the group
 * keeps only the most recent one expanded; earlier ones collapse to a header
 * the reader can click open. The reader's manual toggle wins over the default.
 */
function KustoCanvasEmbed({
    workspaceId,
    canvas,
    onCanvasSaved,
}: {
    workspaceId: string;
    canvas: Canvas;
    onCanvasSaved: (canvas: Canvas) => void;
}) {
    const group = useKustoEmbedGroup();
    const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
    // Header slot that hosts the cluster/database editors, keeping them out of
    // the body so the embed stays compact.
    const [connectionSlotEl, setConnectionSlotEl] = useState<HTMLDivElement | null>(null);
    // `null` means "follow the group default"; a boolean is an explicit choice.
    const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

    // Depend on the stable `register`/`isLast` functions, not the whole context
    // value: that object's identity changes on every version bump, so depending
    // on it here would re-run this effect and re-register in an infinite loop.
    const register = group?.register;
    useEffect(() => {
        if (!register || !wrapperEl) return;
        return register(wrapperEl);
    }, [register, wrapperEl]);

    // Without a group every embed stays expanded (standalone preview behavior).
    const isLast = group ? group.isLast(wrapperEl) : true;
    const expanded = userExpanded ?? isLast;
    const summary = useMemo(() => kustoSummary(canvas), [canvas]);

    return (
        <div
            ref={setWrapperEl}
            className="my-3 overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]"
            data-testid="canvas-embed-kusto"
            data-expanded={expanded ? 'true' : 'false'}
        >
            <div className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#172033] dark:text-[#cccccc] ${expanded ? 'border-b border-[#dce3ee] dark:border-[#3c3c3c]' : ''}`}>
                <button
                    type="button"
                    className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2 text-left hover:opacity-80"
                    onClick={() => setUserExpanded(!expanded)}
                    aria-expanded={expanded}
                    data-testid="canvas-embed-kusto-toggle"
                >
                    <span className="text-[10px] text-[#848484]" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    <span className="min-w-0 truncate font-semibold">{canvas.title || 'Kusto query'}</span>
                </button>
                {/* When expanded, KustoView portals its cluster/database editors here. */}
                {expanded && (
                    <div
                        ref={setConnectionSlotEl}
                        className="flex flex-1 min-w-0 items-center gap-2"
                        data-testid="canvas-embed-kusto-connection-slot"
                    />
                )}
                <span className="ml-auto shrink-0 pl-1 text-[10px] text-[#657188] dark:text-[#a0a0a0]" data-testid="canvas-embed-kusto-summary">{summary}</span>
            </div>
            {expanded && (
                <div className="h-[420px] overflow-hidden">
                    <KustoView
                        workspaceId={workspaceId}
                        canvas={canvas}
                        onCanvasSaved={onCanvasSaved}
                        compact
                        connectionInHeader
                        connectionSlot={connectionSlotEl}
                    />
                </div>
            )}
        </div>
    );
}

function CanvasDocumentPreview({ canvas }: { canvas: Canvas }) {
    const label = canvas.type === 'code' ? canvas.language || 'code' : 'markdown';

    return (
        <section className="my-3 overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]" data-testid="canvas-embed-document">
            <header className="border-b border-[#dce3ee] bg-[#f7f9fc] px-3 py-2 text-xs font-semibold text-[#172033] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#cccccc]">
                {canvas.title} <span className="font-normal text-[#657188] dark:text-[#a0a0a0]">({label})</span>
            </header>
            <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap p-3 text-xs">{canvas.content}</pre>
        </section>
    );
}

/**
 * The embed's "open in panel" action (AC-04).
 *
 * Rendered only when a unified right panel is on screen for THIS embed's chat:
 * elsewhere the inline preview is still the only surface, so there is nothing
 * to open into and the embed keeps exactly its current shape. The canvas is
 * filed against the chat it was embedded in and the clone it was fetched from,
 * so a background transcript can never repoint the visible panel.
 */
function CanvasEmbedOpenAction({
    workspaceId,
    canvasId,
    title,
}: {
    workspaceId: string;
    canvasId: string;
    title: string;
}) {
    const { chatId } = useChatRenderContext();
    const host = useUnifiedPanelHostForChat(chatId);
    const workspaces = useWorkspacesWithRemoteOptional();

    const input = useMemo(
        () =>
            host === null
                ? null
                : canvasEmbedTabInput({
                    canvasId,
                    title,
                    // The clone the embed itself reads from; the host's id is
                    // only the panel's scope (a group id inside a repo group).
                    ownerWorkspaceId: workspaceId,
                    scopeWorkspaceId: host.workspaceId,
                    chatId: host.chatId,
                    workspaces,
                }),
        [host, workspaceId, canvasId, title, workspaces],
    );

    if (host === null || input === null) return null;

    return (
        <div className="mt-3 -mb-2 flex justify-end">
            <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-[#657188] hover:bg-[#eef1f6] hover:text-[#172033] dark:text-[#a0a0a0] dark:hover:bg-[#2d2d2d] dark:hover:text-[#cccccc]"
                onClick={() => openUnifiedPanelTab(host.workspaceId, input)}
                data-testid="canvas-embed-open-in-panel"
                title="Open this canvas as a tab in the right panel"
            >
                Open in panel ↗
            </button>
        </div>
    );
}

export function CanvasEmbed({ workspaceId, canvasId }: CanvasEmbedProps) {
    const client = useCocClient(workspaceId);
    const [canvas, setCanvas] = useState<Canvas | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setCanvas(null);
        setError(null);

        client.canvases.get(workspaceId, canvasId)
            .then(loaded => {
                if (!cancelled) setCanvas(loaded);
            })
            .catch(err => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : 'Failed to load canvas');
                }
            });

        return () => { cancelled = true; };
    }, [client, workspaceId, canvasId]);

    if (error) {
        return <div className="my-3 text-xs text-red-500" data-testid="canvas-embed-error">Failed to load canvas: {error}</div>;
    }
    if (!canvas) {
        return <div className="my-3 text-xs text-[#848484]" data-testid="canvas-embed-loading">Loading canvas…</div>;
    }
    return (
        <>
            {/* Every canvas type shares one open action, above its own chrome. */}
            <CanvasEmbedOpenAction
                workspaceId={workspaceId}
                canvasId={canvasId}
                title={canvas.title}
            />
            {canvas.type === 'excalidraw' ? (
                <ExcalidrawPreview workspaceId={workspaceId} canvasId={canvasId} canvas={canvas} />
            ) : canvas.type === 'kusto' ? (
                <KustoCanvasEmbed
                    workspaceId={workspaceId}
                    canvas={canvas}
                    onCanvasSaved={setCanvas}
                />
            ) : canvas.type === 'extension' ? (
                <div className="my-3 h-[400px] overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]" data-testid="canvas-embed-extension">
                    <ExtensionCanvasView
                        workspaceId={workspaceId}
                        canvas={canvas}
                        onCanvasSaved={setCanvas}
                    />
                </div>
            ) : (
                <CanvasDocumentPreview canvas={canvas} />
            )}
        </>
    );
}
