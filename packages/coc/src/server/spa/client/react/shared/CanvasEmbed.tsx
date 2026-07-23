import { useEffect, useMemo, useState } from 'react';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import { ExtensionCanvasView } from '../features/canvas/ExtensionCanvasView';
import { KustoView, parseKustoContent } from '../features/canvas/KustoView';
import { useCocClient } from '../repos/cloneRouting';
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
                    className="flex min-w-0 items-center gap-2 text-left hover:opacity-80"
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
                        className="flex min-w-0 items-center gap-1.5"
                        data-testid="canvas-embed-kusto-connection-slot"
                    />
                )}
                <span className="ml-auto shrink-0 text-[10px] text-[#657188] dark:text-[#a0a0a0]" data-testid="canvas-embed-kusto-summary">{summary}</span>
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
    if (canvas.type === 'excalidraw') {
        return <ExcalidrawPreview workspaceId={workspaceId} canvasId={canvasId} canvas={canvas} />;
    }
    if (canvas.type === 'kusto') {
        return (
            <KustoCanvasEmbed
                workspaceId={workspaceId}
                canvas={canvas}
                onCanvasSaved={setCanvas}
            />
        );
    }
    if (canvas.type === 'extension') {
        return (
            <div className="my-3 h-[400px] overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]" data-testid="canvas-embed-extension">
                <ExtensionCanvasView
                    workspaceId={workspaceId}
                    canvas={canvas}
                    onCanvasSaved={setCanvas}
                />
            </div>
        );
    }
    return <CanvasDocumentPreview canvas={canvas} />;
}
