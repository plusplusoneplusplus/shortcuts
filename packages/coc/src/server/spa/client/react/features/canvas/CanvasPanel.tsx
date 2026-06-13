/**
 * CanvasPanel — side panel rendering a chat-linked markdown canvas.
 *
 * The AI edits the canvas through the canvas LLM tools (live updates arrive
 * via the `canvas-updated` SSE event surfaced by `useChatSSE`); the user edits
 * it directly here in Edit mode with debounced revision-checked autosave.
 * A 409 save conflict or a remote AI update over local unsaved edits shows a
 * banner offering to load the latest server version.
 *
 * Phase 2 surfaces:
 *  - Version stepper: browse per-revision snapshots read-only and restore an
 *    older state as a new revision (never rewriting history).
 *  - Selection actions: selecting canvas text offers "Ask AI" (prefills the
 *    chat composer via `onAskAi`) and "Comment" (anchored comment).
 *  - Comments: anchored open comments can be sent to the AI in one batch via
 *    `onSendToAi`; delivery uses the normal follow-up path, so a busy AI
 *    receives them at the next turn boundary.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CocApiError } from '@plusplusoneplusplus/coc-client';
import type { Canvas, CanvasComment, CanvasVersion, CanvasVersionMeta } from '@plusplusoneplusplus/coc-client';
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
    /** Prefills the chat composer with a selection-targeted edit prompt. */
    onAskAi?: (prompt: string) => void;
    /** Sends a message to the AI through the normal follow-up path (turn-boundary delivery when busy). */
    onSendToAi?: (message: string) => Promise<void>;
}

function buildAskAiPrompt(canvas: Canvas, selection: string): string {
    return `Regarding this selection from canvas "${canvas.title}" (canvasId: ${canvas.id}, revision ${canvas.revision}):\n\n"""\n${selection}\n"""\n\n`;
}

function buildCommentsMessage(canvas: Canvas, comments: CanvasComment[]): string {
    const lines = comments.map((c, i) => `${i + 1}. On "${c.anchorText}": ${c.body}`);
    return `Please address these comments on canvas "${canvas.title}" (canvasId: ${canvas.id}, revision ${canvas.revision}):\n\n${lines.join('\n')}\n\nApply the requested changes with update_canvas (use read_canvas first if you need the current content).`;
}

export function CanvasPanel({ workspaceId, canvasId, liveEvent, onClose, onAskAi, onSendToAi }: CanvasPanelProps) {
    const [canvas, setCanvas] = useState<Canvas | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [mode, setMode] = useState<ViewMode>('preview');
    const [draft, setDraft] = useState('');
    const [dirty, setDirty] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [remoteUpdatePending, setRemoteUpdatePending] = useState(false);
    const [versions, setVersions] = useState<CanvasVersionMeta[]>([]);
    const [viewingVersion, setViewingVersion] = useState<CanvasVersion | null>(null);
    const [restoring, setRestoring] = useState(false);
    const [selection, setSelection] = useState<string | null>(null);
    const [commentAnchor, setCommentAnchor] = useState<string | null>(null);
    const [commentDraft, setCommentDraft] = useState('');
    const [comments, setComments] = useState<CanvasComment[]>([]);
    const [sendingComments, setSendingComments] = useState(false);

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
            const client = getSpaCocClient();
            const loaded = await client.canvases.get(workspaceId, canvasId);
            setCanvas(loaded);
            setDraft(loaded.content);
            setDirty(false);
            setSaveState('idle');
            setRemoteUpdatePending(false);
            setLoadError(null);
            client.canvases.listVersions(workspaceId, canvasId)
                .then(setVersions)
                .catch(() => { /* version history is best-effort */ });
            client.canvases.listComments(workspaceId, canvasId)
                .then(setComments)
                .catch(() => { /* comments are best-effort */ });
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
        setViewingVersion(null);
        setSelection(null);
        setCommentAnchor(null);
        setCommentDraft('');
        setComments([]);
        setVersions([]);
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

    // ------------------------------------------------------------------
    // Version stepper
    // ------------------------------------------------------------------

    const viewingRevision = viewingVersion?.revision ?? canvas?.revision ?? 0;
    const olderMeta = versions.find(v => v.revision < viewingRevision);
    const newerMeta = [...versions].reverse().find(v => v.revision > viewingRevision);

    const openVersion = useCallback((meta: CanvasVersionMeta) => {
        if (canvas && meta.revision >= canvas.revision) {
            setViewingVersion(null);
            return;
        }
        getSpaCocClient().canvases.getVersion(workspaceId, canvasId, meta.revision)
            .then(setViewingVersion)
            .catch(() => { /* keep current view on fetch failure */ });
    }, [workspaceId, canvasId, canvas]);

    const handleRestore = useCallback(async () => {
        const current = canvasRef.current;
        if (!current || !viewingVersion || restoring) return;
        setRestoring(true);
        try {
            const saved = await getSpaCocClient().canvases.save(workspaceId, canvasId, {
                content: viewingVersion.content,
                expectedRevision: current.revision,
            });
            setCanvas(saved);
            setDraft(saved.content);
            setDirty(false);
            setSaveState('saved');
            setViewingVersion(null);
            getSpaCocClient().canvases.listVersions(workspaceId, canvasId)
                .then(setVersions)
                .catch(() => { /* best-effort */ });
        } catch (err) {
            setSaveState(err instanceof CocApiError && err.status === 409 ? 'conflict' : 'error');
        } finally {
            setRestoring(false);
        }
    }, [workspaceId, canvasId, viewingVersion, restoring]);

    // ------------------------------------------------------------------
    // Selection actions + comments
    // ------------------------------------------------------------------

    const handlePreviewMouseUp = useCallback(() => {
        const text = window.getSelection()?.toString().trim() ?? '';
        setSelection(text.length > 0 ? text : null);
    }, []);

    const handleEditorSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.currentTarget;
        const text = target.value.substring(target.selectionStart ?? 0, target.selectionEnd ?? 0).trim();
        setSelection(text.length > 0 ? text : null);
    }, []);

    const handleAskAi = useCallback(() => {
        if (!canvas || !selection || !onAskAi) return;
        onAskAi(buildAskAiPrompt(canvas, selection));
        setSelection(null);
    }, [canvas, selection, onAskAi]);

    const handleStartComment = useCallback(() => {
        if (!selection) return;
        setCommentAnchor(selection);
        setCommentDraft('');
        setSelection(null);
    }, [selection]);

    const handleSubmitComment = useCallback(async () => {
        if (!commentAnchor || !commentDraft.trim()) return;
        try {
            const comment = await getSpaCocClient().canvases.addComment(workspaceId, canvasId, {
                anchorText: commentAnchor,
                body: commentDraft.trim(),
            });
            setComments(prev => [...prev, comment]);
            setCommentAnchor(null);
            setCommentDraft('');
        } catch { /* leave the compose box open on failure */ }
    }, [workspaceId, canvasId, commentAnchor, commentDraft]);

    const handleDeleteComment = useCallback(async (commentId: string) => {
        try {
            await getSpaCocClient().canvases.deleteComment(workspaceId, canvasId, commentId);
            setComments(prev => prev.filter(c => c.id !== commentId));
        } catch { /* keep the comment on failure */ }
    }, [workspaceId, canvasId]);

    const openComments = comments.filter(c => c.status === 'open');

    const handleSendComments = useCallback(async () => {
        const current = canvasRef.current;
        if (!current || !onSendToAi || openComments.length === 0 || sendingComments) return;
        setSendingComments(true);
        try {
            await onSendToAi(buildCommentsMessage(current, openComments));
            const updates = await Promise.all(openComments.map(c =>
                getSpaCocClient().canvases.setCommentStatus(workspaceId, canvasId, c.id, 'sent').catch(() => null),
            ));
            setComments(prev => prev.map(c => updates.find(u => u?.id === c.id) ?? c));
        } catch { /* comments stay open if the send failed */ } finally {
            setSendingComments(false);
        }
    }, [workspaceId, canvasId, onSendToAi, openComments, sendingComments]);

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    const displayedContent = viewingVersion ? viewingVersion.content : (canvas?.content ?? '');
    const { html } = useMarkdownPreview({
        content: displayedContent,
        containerRef: previewRef,
        loading: loading || (!viewingVersion && mode !== 'preview'),
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
                    <span className="flex items-center gap-0.5 text-[10px] text-[#848484] shrink-0">
                        <button
                            type="button"
                            className="px-1 disabled:opacity-30"
                            disabled={!olderMeta}
                            onClick={() => olderMeta && openVersion(olderMeta)}
                            aria-label="View older version"
                            data-testid="canvas-panel-version-older"
                        >
                            ‹
                        </button>
                        <span data-testid="canvas-panel-revision">rev {viewingRevision}</span>
                        <button
                            type="button"
                            className="px-1 disabled:opacity-30"
                            disabled={!viewingVersion}
                            onClick={() => newerMeta ? openVersion(newerMeta) : setViewingVersion(null)}
                            aria-label="View newer version"
                            data-testid="canvas-panel-version-newer"
                        >
                            ›
                        </button>
                    </span>
                )}
                {statusLabel && !viewingVersion && (
                    <span
                        className={`text-[10px] shrink-0 ${saveState === 'conflict' || saveState === 'error' ? 'text-red-500' : 'text-[#848484]'}`}
                        data-testid="canvas-panel-save-state"
                    >
                        {statusLabel}
                    </span>
                )}
                {!viewingVersion && (
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
                )}
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

            {/* History banner */}
            {viewingVersion && canvas && (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] bg-violet-50 dark:bg-violet-950 border-b border-violet-200 dark:border-violet-800" data-testid="canvas-panel-history-banner">
                    <span className="flex-1">
                        Viewing rev {viewingVersion.revision} of {canvas.revision} ({viewingVersion.editor === 'ai' ? 'AI' : 'you'}, read-only)
                    </span>
                    <button
                        type="button"
                        className="underline font-semibold disabled:opacity-40"
                        disabled={dirty || restoring}
                        title={dirty ? 'Save or discard your unsaved edits first' : undefined}
                        onClick={() => void handleRestore()}
                        data-testid="canvas-panel-restore"
                    >
                        {restoring ? 'Restoring…' : 'Restore as latest'}
                    </button>
                    <button type="button" className="underline" onClick={() => setViewingVersion(null)} data-testid="canvas-panel-back-to-latest">
                        Back to latest
                    </button>
                </div>
            )}

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

            {/* Selection action bar */}
            {!viewingVersion && selection && (
                <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-[#e0e0e0] dark:border-[#474749] bg-[#f0f0f0] dark:bg-[#28282a]" data-testid="canvas-panel-selection-bar">
                    <span className="flex-1 truncate italic text-[#848484]">“{selection}”</span>
                    {onAskAi && (
                        <button type="button" className="underline font-semibold shrink-0" onClick={handleAskAi} data-testid="canvas-panel-ask-ai">
                            Ask AI
                        </button>
                    )}
                    <button type="button" className="underline font-semibold shrink-0" onClick={handleStartComment} data-testid="canvas-panel-add-comment">
                        Comment
                    </button>
                </div>
            )}

            {/* Comment compose box */}
            {commentAnchor && (
                <div className="px-3 py-2 border-b border-[#e0e0e0] dark:border-[#474749] bg-[#f0f0f0] dark:bg-[#28282a]" data-testid="canvas-panel-comment-compose">
                    <div className="text-[10px] italic text-[#848484] truncate mb-1">On: “{commentAnchor}”</div>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            className="flex-1 text-[11px] px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] outline-none"
                            placeholder="Comment for the AI…"
                            value={commentDraft}
                            onChange={e => setCommentDraft(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void handleSubmitComment(); }}
                            data-testid="canvas-panel-comment-input"
                        />
                        <button
                            type="button"
                            className="text-[11px] underline font-semibold disabled:opacity-40"
                            disabled={!commentDraft.trim()}
                            onClick={() => void handleSubmitComment()}
                            data-testid="canvas-panel-comment-submit"
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            className="text-[11px] underline text-[#848484]"
                            onClick={() => { setCommentAnchor(null); setCommentDraft(''); }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {loading ? (
                    <div className="text-xs text-[#848484] py-6 text-center">Loading canvas…</div>
                ) : loadError ? (
                    <div className="text-xs text-red-500 py-6 text-center" data-testid="canvas-panel-error">{loadError}</div>
                ) : !viewingVersion && mode === 'edit' ? (
                    <textarea
                        className="w-full h-full min-h-[200px] text-xs p-3 bg-transparent resize-none font-mono outline-none"
                        value={draft}
                        onChange={e => {
                            setDraft(e.target.value);
                            setDirty(true);
                            setSaveState('idle');
                        }}
                        onSelect={handleEditorSelect}
                        data-testid="canvas-panel-editor"
                    />
                ) : (
                    <div
                        ref={previewRef}
                        className="markdown-body text-xs p-3"
                        data-testid="canvas-panel-preview"
                        onMouseUp={handlePreviewMouseUp}
                        dangerouslySetInnerHTML={{ __html: html || '<span class="italic text-[#848484]">Empty canvas.</span>' }}
                    />
                )}
            </div>

            {/* Comments section */}
            {comments.length > 0 && !viewingVersion && (
                <div className="shrink-0 max-h-48 overflow-y-auto border-t border-[#e0e0e0] dark:border-[#474749]" data-testid="canvas-panel-comments">
                    <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold text-[#848484]">
                        <span className="flex-1">Comments ({comments.length})</span>
                        {onSendToAi && openComments.length > 0 && (
                            <button
                                type="button"
                                className="underline font-semibold disabled:opacity-40"
                                disabled={sendingComments}
                                onClick={() => void handleSendComments()}
                                data-testid="canvas-panel-send-comments"
                            >
                                {sendingComments ? 'Sending…' : `Send ${openComments.length} to AI`}
                            </button>
                        )}
                    </div>
                    {comments.map(comment => (
                        <div key={comment.id} className="px-3 py-1.5 border-t border-[#ececec] dark:border-[#333335] text-[11px]" data-testid={`canvas-comment-${comment.id}`}>
                            <div className="flex items-center gap-2">
                                <span className="flex-1 italic text-[#848484] truncate">“{comment.anchorText}”</span>
                                <span className={`text-[9px] uppercase shrink-0 ${comment.status === 'open' ? 'text-sky-600' : comment.status === 'sent' ? 'text-amber-600' : 'text-emerald-600'}`}>
                                    {comment.status}
                                </span>
                                <button
                                    type="button"
                                    className="text-[#848484] hover:text-red-500 shrink-0"
                                    onClick={() => void handleDeleteComment(comment.id)}
                                    aria-label="Delete comment"
                                    data-testid={`canvas-comment-delete-${comment.id}`}
                                >
                                    ✕
                                </button>
                            </div>
                            <div>{comment.body}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
