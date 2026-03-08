/**
 * CommentReply — a single reply row inside a CommentCard.
 */

import type { AnyCommentReply } from '../../../shared-comment-types';

function formatRelative(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return d.toLocaleDateString();
}

interface CommentReplyProps {
    reply: AnyCommentReply;
}

export function CommentReply({ reply }: CommentReplyProps) {
    return (
        <div
            className={`flex flex-col gap-0.5 px-2 py-1.5 text-xs border-l-2 ${
                reply.isAI
                    ? 'border-[#0078d4] bg-[#0078d4]/5 dark:border-[#3794ff] dark:bg-[#3794ff]/5'
                    : 'border-[#e0e0e0] dark:border-[#3c3c3c]'
            }`}
            data-testid={`comment-reply-${reply.id}`}
        >
            <div className="flex items-center gap-2 text-[10px] text-[#848484]">
                <span className="font-medium">{reply.isAI ? '🤖 AI' : reply.author}</span>
                <span>{formatRelative(reply.createdAt)}</span>
            </div>
            <div className="text-[#1e1e1e] dark:text-[#cccccc]">{reply.text}</div>
        </div>
    );
}
