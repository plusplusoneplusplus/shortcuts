/**
 * CanvasCommentsPanel — the anchored-comment list at the bottom of the panel,
 * with the batch "Send N to AI" action for the still-open comments.
 */

import type { CanvasComment } from '@plusplusoneplusplus/coc-client';

export interface CanvasCommentsPanelProps {
    comments: CanvasComment[];
    openComments: CanvasComment[];
    sending: boolean;
    /** Omitted when the host has no follow-up path (e.g. the pop-out window). */
    onSend?: () => void;
    onDelete: (commentId: string) => void;
}

export function CanvasCommentsPanel({ comments, openComments, sending, onSend, onDelete }: CanvasCommentsPanelProps) {
    if (comments.length === 0) return null;
    return (
        <div className="shrink-0 max-h-48 overflow-y-auto border-t border-[#e0e0e0] dark:border-[#474749]" data-testid="canvas-panel-comments">
            <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold text-[#848484]">
                <span className="flex-1">Comments ({comments.length})</span>
                {onSend && openComments.length > 0 && (
                    <button
                        type="button"
                        className="underline font-semibold disabled:opacity-40"
                        disabled={sending}
                        onClick={onSend}
                        data-testid="canvas-panel-send-comments"
                    >
                        {sending ? 'Sending…' : `Send ${openComments.length} to AI`}
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
                            onClick={() => onDelete(comment.id)}
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
    );
}
