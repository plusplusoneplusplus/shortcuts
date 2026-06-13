/**
 * CanvasPanel — side panel rendering a chat-linked markdown canvas.
 *
 * The AI edits the canvas through the canvas LLM tools (live updates arrive
 * via the `canvas-updated` SSE event surfaced by `useChatSSE`); the user edits
 * it directly here in Edit mode with debounced revision-checked autosave.
 * A 409 save conflict or a remote AI update over local unsaved edits shows a
 * banner offering to load the latest server version.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { Canvas } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';
import { useMarkdownPreview } from '../../hooks/ui/useMarkdownPreview';
import type { CanvasUpdatedEvent } from '../chat/hooks/useChatSSE';

const AUTOSAVE_DELAY_MS = 800;

type ViewMode = 'preview' | 'edit';
type SaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'error';

export interface CanvasPanelProps {
    workspaceId: string;
    canvasId: string;
    /** Latest live canvas event from the chat SSE stream (AI edits). */
    liveEvent: CanvasUpdatedEvent | null;
    onClose?: () => void;
}

export function CanvasPanel({ workspaceId, canvasId, liveEvent, onClose }: CanvasPanelProps) {
    const [canvas, setCanvas] = useState<Canvas | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mode, setMode] = useState<ViewMode>('preview');
    const [draft, setDraft] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);

    const previewRef = useRef<HTMLDivElement>(null);
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const canvasRef = useRef<Canvas | null>(null);
    canvasRef.current = canvas;
    const dirtyRef = useRef(false);
    dirtyRef.current = dirty;
    const draftRef = useRef('');
    draftRef.current = draft;

    const loadCanvas = useCallback(async () => {
        try {
            const loaded = await getSpaCocClient().canvases.get(workspaceId, canvasId);
            setCanvas(loaded);
            setDraft(loaded.content);
            setDirty(false);
            setSaveState('idle');
            setRemoteUpdatePending(false);
            setLoadError(null);
        } catch {
            setLoadError('Failed to load canvas');
        } finally {
            setLoading(false);
        }
    }, [workspaceId, canvasId]);

    // Initial load / canvas switch
    useEffect(() => {
        setLoading(true);
        setCanvas(null);
        setLoadError(null);
        void loadCanvas();
    }, [loadCanvas]);

    // Live AI updates: refresh in place, or flag a pending update when the
    // user has unsaved local edits so their draft is not clobbered.
    useEffect(() => {
        if (!liveEvent || liveEvent.canvasId !== canvasId) return;
        const current = canvasRef.current;
        if (current && liveEvent.revision <= current.revision) return;
        if (dirtyRef.current) {
            setRemoteUpdatePending(true);
        } else {
            void loadCanvas();
        }
    }, [liveEvent, canvasId, loadCanvas]);

    // Debounced revision-checked autosave of user edits
    useEffect(() => {
        if (!dirty) return;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            const current = canvasRef.current;
            if (!current) return;
            const savedDraft = draft;
            setSaveState('saving');
            getSpaCocClient().canvases
                .save(workspaceId, canvasId, { content: savedDraft, expectedRevision: current.revision })
                .then(saved => {
                    setCanvas({ ...saved, content: savedDraft });
                    // Keep the dirty mark if the user typed while the save was in flight
                    if (draftRef.current === savedDraft) {
                        setDirty(false);
                        setSaveState('saved');
                    }
                })
                .catch(err => {
                    if (err instanceof CocApiError && err.status === 409) {
                        setSaveState('conflict');
                    } else {
                        setSaveState('error');
                    }
                });
        }, AUTOSAVE_DELAY_MS);
        return () => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        };
    }, [draft, dirty, workspaceId, canvasId]);

    const { html } = useMarkdownPreview({
        content: canvas?.content ?? '',
        containerRef: previewRef,
        loading: loading || mode !== 'preview',
    });

    const statusLabel = saveState === 'saving' ? 'Saving…'
        : saveState === 'saved' ? 'Saved'
        : saveState === 'conflict' ? 'Save conflict'
        : saveState === 'error' ? 'Save failed'
        : dirty ? 'Unsaved edits' : '';

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#fafafa] dark:bg-[#1e1e1e]" data-testid="canvas-panel">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#474749] shrink-0">
                <span className="text-xs font-semibold truncate flex-1" title={canvas?.title ?? ''} data-testid="canvas-panel-title">
                    {canvas?.title || 'Canvas'}
                </span>
                {canvas && (
                    <span className="text-[10px] text-[#848484] shrink-0" data-testid="canvas-panel-revision">
                        rev {canvas.revision}
                    </span>
                )}
                {statusLabel && (
                    <span
                        className={`text-[10px] shrink-0 ${saveState === 'conflict' || saveState === 'error' ? 'text-red-500' : 'text-[#848484]'}`}
                        data-testid="canvas-panel-save-state"
                    >
                        {statusLabel}
                    </span>
                )}
                <div className="flex rounded border border-[#e0e0e0] dark:border-[#474749] overflow-hidden shrink-0">
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[10px] ${mode === 'preview' ? 'bg-[#e8e8e8] dark:bg-[#3a3a3c] font-semibold' : ''}`}
                        onClick={() => setMode('preview')}
                        data-testid="canvas-panel-mode-preview"
                    >
                        Preview
                    </button>
                    <button
                        type="button"
                        className={`px-2 py-0.5 text-[10px] ${mode === 'edit' ? 'bg-[#e8e8e8] dark:bg-[#3a3a3c] font-semibold' : ''}`}
                        onClick={() => setMode('edit')}
                        data-testid="canvas-panel-mode-edit"
                    >
                        Edit
                    </button>
                </div>
                {onClose && (
                    <button
                        type="button"
                        className="text-[#848484] hover:text-[#333] dark:hover:text-[#ddd] px-1 shrink-0"
                        onClick={onClose}
                        aria-label="Close canvas panel"
                        data-testid="canvas-panel-close"
                    >
                        ✕
                    </button>
                )}
            </div>

            {/* Conflict / remote update banners */}
            {saveState === 'conflict' && (
                <div className="px-3 py-2 text-[11px] bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800" data-testid="canvas-panel-conflict-banner">
                    The canvas changed while you were editing.{' '}
                    <button type="button" className="underline font-semibold" onClick={() => void loadCanvas()}>
                        Load latest (discards your edits)
                    </button>
                </div>
            )}
            {remoteUpdatePending && saveState !== 'conflict' && (
                <div className="px-3 py-2 text-[11px] bg-sky-50 dark:bg-sky-950 border-b border-sky-200 dark:border-sky-800" data-testid="canvas-panel-remote-update-banner">
                    The AI updated this canvas.{' '}
                    <button type="button" className="underline font-semibold" onClick={() => void loadCanvas()}>
                        Load latest (discards your edits)
                    </button>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {loading ? (
                    <div className="text-xs text-[#848484] py-6 text-center">Loading canvas…</div>
                ) : loadError ? (
                    <div className="text-xs text-red-500 py-6 text-center" data-testid="canvas-panel-error">{loadError}</div>
                ) : mode === 'edit' ? (
                    <textarea
                        className="w-full h-full min-h-[200px] text-xs p-3 bg-transparent resize-none font-mono outline-none"
                        value={draft}
                        onChange={e => {
                            setDraft(e.target.value);
                            setDirty(true);
                            setSaveState('idle');
                        }}
                        data-testid="canvas-panel-editor"
                    />
                ) : (
                    <div
                        ref={previewRef}
                        className="markdown-body text-xs p-3"
                        data-testid="canvas-panel-preview"
                        dangerouslySetInnerHTML={{ __html: html || '<span class="italic text-[#848484]">Empty canvas.</span>' }}
                    />
                )}
            </div>
        </div>
    );
}
