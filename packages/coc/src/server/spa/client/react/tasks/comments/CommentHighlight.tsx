/**
 * CommentHighlight — injects <mark> highlights into preview HTML for open comments.
 */

import { useEffect } from 'react';
import type { TaskComment } from '../../../task-comments-types';

export interface CommentHighlightProps {
    comments: TaskComment[];
    containerRef: React.RefObject<HTMLDivElement | null>;
    onCommentClick: (comment: TaskComment) => void;
}

export function CommentHighlight({ comments, containerRef, onCommentClick }: CommentHighlightProps) {
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Clear existing highlights
        container.querySelectorAll('mark[data-comment-id]').forEach(el => {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }
        });

        // Add highlights for open comments
        const openComments = comments.filter(c => c.status === 'open' && c.selectedText);

        for (const comment of openComments) {
            const text = container.textContent || '';
            const idx = text.indexOf(comment.selectedText);
            if (idx === -1) continue;

            const range = document.createRange();
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            let currentOffset = 0;
            let startSet = false;

            while (walker.nextNode()) {
                const nodeText = walker.currentNode.textContent || '';
                const nodeEnd = currentOffset + nodeText.length;

                if (!startSet && nodeEnd > idx) {
                    range.setStart(walker.currentNode, idx - currentOffset);
                    startSet = true;
                }
                if (startSet && nodeEnd >= idx + comment.selectedText.length) {
                    range.setEnd(walker.currentNode, idx + comment.selectedText.length - currentOffset);
                    break;
                }
                currentOffset = nodeEnd;
            }

            if (!startSet) continue;

            const mark = document.createElement('mark');
            mark.setAttribute('data-comment-id', comment.id);
            mark.className = 'bg-yellow-200 dark:bg-yellow-800/50 cursor-pointer rounded-sm';
            mark.setAttribute('role', 'mark');
            mark.setAttribute('aria-label', 'Commented text');

            try {
                range.surroundContents(mark);
            } catch {
                // surroundContents fails if selection crosses element boundaries
            }
        }

        // Click handler for highlights
        const handleClick = (e: Event) => {
            const target = (e.target as HTMLElement).closest('mark[data-comment-id]');
            if (!target) return;
            const id = target.getAttribute('data-comment-id');
            const comment = comments.find(c => c.id === id);
            if (comment) onCommentClick(comment);
        };

        container.addEventListener('click', handleClick);
        return () => container.removeEventListener('click', handleClick);
    }, [comments, containerRef, onCommentClick]);

    return null;
}
