import { useEffect, useId, useMemo, useState } from 'react';
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
    /** Transcript-owned choice survives HTML portal remounts, per occurrence. */
    disclosureState?: { expanded?: boolean; onChange: (expanded: boolean) => void };
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

function CanvasDocumentPreview({ canvas }: { canvas: Canvas }) {
    const label = canvas.type === 'code' ? canvas.language || 'code' : 'markdown';

    return (
        <section data-testid="canvas-embed-document">
            <div className="px-3 pt-2 text-xs text-[#657188] dark:text-[#a0a0a0]">{label}</div>
            <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap p-3 text-xs">{canvas.content}</pre>
        </section>
    );
}

/**
 * The embed's "open in panel" action (AC-04).
 *
 * Rendered only when a unified right panel is on screen for THIS embed's chat:
 * elsewhere the inline preview is still the only surface. The canvas is
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
        <button
            type="button"
            className="shrink-0 rounded px-1.5 py-1 text-[11px] text-[#657188] hover:bg-[#eef1f6] hover:text-[#172033] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#007acc] dark:text-[#a0a0a0] dark:hover:bg-[#2d2d2d] dark:hover:text-[#cccccc]"
            onClick={() => openUnifiedPanelTab(host.workspaceId, input)}
            data-testid="canvas-embed-open-in-panel"
            title="Open this canvas as a tab in the right panel"
        >
            Open in panel ↗
        </button>
    );
}

export function CanvasEmbed({ workspaceId, canvasId, disclosureState }: CanvasEmbedProps) {
    const { chatId, conversationOwnerKey } = useChatRenderContext();
    return <CanvasEmbedContent key={JSON.stringify([conversationOwnerKey, workspaceId, chatId, canvasId])} workspaceId={workspaceId} canvasId={canvasId} disclosureState={disclosureState} />;
}

function CanvasEmbedContent({ workspaceId, canvasId, disclosureState }: CanvasEmbedProps) {
    const { conversationMode } = useChatRenderContext();
    const client = useCocClient(workspaceId);
    const [canvas, setCanvas] = useState<Canvas | null>(null);
    const [error, setError] = useState<string | null>(null);
    const bodyId = useId();
    const group = useKustoEmbedGroup();
    const [wrapperEl, setWrapperEl] = useState<HTMLDivElement | null>(null);
    const [connectionSlotEl, setConnectionSlotEl] = useState<HTMLDivElement | null>(null);
    // A manual choice overrides conversation and Kusto group defaults.
    const [userExpanded, setUserExpanded] = useState<boolean | null>(() => disclosureState?.expanded ?? null);
    const isKusto = canvas?.type === 'kusto';
    const summary = useMemo(() => isKusto ? kustoSummary(canvas) : null, [canvas, isKusto]);
    const register = group?.register;

    useEffect(() => {
        if (!isKusto || !register || !wrapperEl) return;
        return register(wrapperEl);
    }, [isKusto, register, wrapperEl]);

    const expanded = userExpanded ?? (conversationMode !== 'sentinel' && (!isKusto || !group || group.isLast(wrapperEl)));
    const title = canvas?.title || (isKusto ? 'Kusto query' : canvas || error ? 'Canvas' : 'Loading canvas…');

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

    return (
        <div
            ref={setWrapperEl}
            className="my-3 overflow-hidden rounded-md border border-[#dce3ee] dark:border-[#3c3c3c]"
            data-testid={isKusto ? 'canvas-embed-kusto' : 'canvas-embed'}
            data-expanded={expanded ? 'true' : 'false'}
        >
            <div className={`flex w-full items-center gap-2 bg-[#f7f9fc] px-3 py-1 text-xs text-[#172033] dark:bg-[#252526] dark:text-[#cccccc] ${expanded ? 'border-b border-[#dce3ee] dark:border-[#3c3c3c]' : ''}`}>
                <button
                    type="button"
                    className={`flex min-w-0 items-center gap-2 rounded py-1 text-left hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#007acc] ${isKusto && expanded ? 'max-w-[45%]' : 'flex-1'}`}
                    onClick={() => {
                        setUserExpanded(!expanded);
                        disclosureState?.onChange(!expanded);
                    }}
                    aria-expanded={expanded}
                    aria-controls={bodyId}
                    data-testid={isKusto ? 'canvas-embed-kusto-toggle' : 'canvas-embed-toggle'}
                    title={title}
                >
                    <span className="text-[10px] text-[#848484]" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    <span className="min-w-0 truncate font-semibold">{title}</span>
                </button>
                {canvas && <span className="shrink-0 text-[10px] text-[#657188] dark:text-[#a0a0a0]">{canvas.type === 'code' ? canvas.language || 'code' : canvas.type}</span>}
                {isKusto && (
                    <>
                        <div
                            ref={setConnectionSlotEl}
                            className="flex min-w-0 flex-1 items-center gap-2"
                            style={expanded ? undefined : { display: 'none' }}
                            {...(!expanded ? { inert: '' } : {})}
                            data-testid="canvas-embed-kusto-connection-slot"
                        />
                        <span className="shrink-0 text-[10px] text-[#657188] dark:text-[#a0a0a0]" data-testid="canvas-embed-kusto-summary">{summary}</span>
                    </>
                )}
                {canvas && (
                    <CanvasEmbedOpenAction workspaceId={workspaceId} canvasId={canvasId} title={canvas.title} />
                )}
            </div>
            {/* Keep iframe/editor state and the Kusto portal target alive across toggles. */}
            <div
                id={bodyId}
                hidden={!expanded}
                style={expanded ? undefined : { display: 'none' }}
                {...(!expanded ? { inert: '' } : {})}
                data-testid="canvas-embed-body"
            >
                {error ? (
                    <div className="p-3 text-xs text-red-500" data-testid="canvas-embed-error">Failed to load canvas: {error}</div>
                ) : !canvas ? (
                    <div className="p-3 text-xs text-[#848484]" data-testid="canvas-embed-loading">Loading canvas…</div>
                ) : canvas.type === 'copilot-extension' ? (
                    <div className="p-3 text-xs text-[#848484]">Open in the CoC desktop app</div>
                ) : canvas.type === 'excalidraw' ? (
                    <ExcalidrawPreview workspaceId={workspaceId} canvasId={canvasId} canvas={canvas} />
                ) : canvas.type === 'kusto' ? (
                    <div className="h-[420px] overflow-hidden">
                        <KustoView
                            workspaceId={workspaceId}
                            canvas={canvas}
                            onCanvasSaved={setCanvas}
                            compact
                            connectionInHeader
                            connectionSlot={connectionSlotEl}
                        />
                    </div>
                ) : canvas.type === 'extension' ? (
                    <div className="h-[400px] overflow-hidden" data-testid="canvas-embed-extension">
                        <ExtensionCanvasView
                            workspaceId={workspaceId}
                            canvas={canvas}
                            onCanvasSaved={setCanvas}
                        />
                    </div>
                ) : (
                    <CanvasDocumentPreview canvas={canvas} />
                )}
            </div>
        </div>
    );
}
