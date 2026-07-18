import { useEffect, useState } from 'react';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import { ExtensionCanvasView } from '../features/canvas/ExtensionCanvasView';
import { ExplorationView } from '../features/canvas/ExplorationView';
import { useCocClient } from '../repos/cloneRouting';
import { ExcalidrawPreview } from './ExcalidrawPreview';

export interface CanvasEmbedProps {
    workspaceId: string;
    canvasId: string;
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
    if (canvas.type === 'exploration') {
        return (
            <div className="my-3 h-[460px] overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]" data-testid="canvas-embed-exploration">
                <ExplorationView
                    workspaceId={workspaceId}
                    canvas={canvas}
                    onCanvasSaved={setCanvas}
                    compact
                />
            </div>
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
