/**
 * CanvasSelectionToolbar — the selection action bar and the anchored comment
 * compose box.
 *
 * Both are absolute overlays on purpose: toggling them must not shift the
 * canvas text underneath (regression — a static bar re-flowed the preview and
 * moved the very text the user had just selected).
 */

export interface CanvasSelectionToolbarProps {
    selection: string | null;
    /** Hidden while browsing an older revision — history views are read-only. */
    visible: boolean;
    onAskAi?: () => void;
    onStartComment: () => void;
    commentAnchor: string | null;
    commentDraft: string;
    onCommentDraftChange: (text: string) => void;
    onSubmitComment: () => void;
    onCancelComment: () => void;
}

export function CanvasSelectionToolbar({
    selection, visible, onAskAi, onStartComment,
    commentAnchor, commentDraft, onCommentDraftChange, onSubmitComment, onCancelComment,
}: CanvasSelectionToolbarProps) {
    return (
        <>
            {visible && selection && (
                <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-2 px-3 py-1.5 text-[11px] border-b border-[#e0e0e0] dark:border-[#474749] bg-[#f0f0f0] dark:bg-[#28282a]" data-testid="canvas-panel-selection-bar">
                    <span className="flex-1 truncate italic text-[#848484]">“{selection}”</span>
                    {onAskAi && (
                        <button type="button" className="underline font-semibold shrink-0 text-[#1e1e1e] dark:text-[#cccccc]" onClick={onAskAi} data-testid="canvas-panel-ask-ai">
                            Ask AI
                        </button>
                    )}
                    <button type="button" className="underline font-semibold shrink-0 text-[#1e1e1e] dark:text-[#cccccc]" onClick={onStartComment} data-testid="canvas-panel-add-comment">
                        Comment
                    </button>
                </div>
            )}

            {commentAnchor && (
                <div className="absolute top-0 inset-x-0 z-10 px-3 py-2 border-b border-[#e0e0e0] dark:border-[#474749] bg-[#f0f0f0] dark:bg-[#28282a]" data-testid="canvas-panel-comment-compose">
                    <div className="text-[10px] italic text-[#848484] truncate mb-1">On: “{commentAnchor}”</div>
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            className="flex-1 text-[11px] px-2 py-1 rounded border border-[#e0e0e0] dark:border-[#474749] bg-white dark:bg-[#1e1e1e] outline-none"
                            placeholder="Comment for the AI…"
                            value={commentDraft}
                            onChange={e => onCommentDraftChange(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') onSubmitComment(); }}
                            data-testid="canvas-panel-comment-input"
                        />
                        <button
                            type="button"
                            className="text-[11px] underline font-semibold text-[#1e1e1e] dark:text-[#cccccc] disabled:opacity-40"
                            disabled={!commentDraft.trim()}
                            onClick={onSubmitComment}
                            data-testid="canvas-panel-comment-submit"
                        >
                            Add
                        </button>
                        <button
                            type="button"
                            className="text-[11px] underline text-[#848484]"
                            onClick={onCancelComment}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </>
    );
}
