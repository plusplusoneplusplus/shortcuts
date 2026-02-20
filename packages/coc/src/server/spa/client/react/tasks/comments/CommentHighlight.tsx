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

/**
 * Build a Range spanning the first occurrence of `needle` inside `container`.
 * Returns null when the text isn't found.
 */
export function buildTextRange(container: Node, needle: string): Range | null {
    const fullText = container.textContent || '';
    const idx = fullText.indexOf(needle);
    if (idx === -1) return null;

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
        if (startSet && nodeEnd >= idx + needle.length) {
            range.setEnd(walker.currentNode, idx + needle.length - currentOffset);
            break;
        }
        currentOffset = nodeEnd;
    }

    return startSet ? range : null;
}

/**
 * Wrap a Range in a <mark> element. Uses `surroundContents` for simple
 * single-node ranges, and falls back to `extractContents` + `insertNode`
 * when the range crosses element boundaries.
 */
export function wrapRangeInMark(range: Range, attrs: Record<string, string>): HTMLElement | null {
    const mark = document.createElement('mark');
    for (const [k, v] of Object.entries(attrs)) mark.setAttribute(k, v);

    try {
        range.surroundContents(mark);
        return mark;
    } catch {
        // surroundContents fails when the range crosses element boundaries
    }

    try {
        const fragment = range.extractContents();
        mark.appendChild(fragment);
        range.insertNode(mark);
        return mark;
    } catch {
        return null;
    }
}

const MARK_CLASS = 'bg-yellow-200 dark:bg-yellow-800/50 cursor-pointer rounded-sm';

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

        const openComments = comments.filter(c => c.status === 'open' && c.selectedText);

        for (const comment of openComments) {
            const range = buildTextRange(container, comment.selectedText);
            if (!range) continue;

            wrapRangeInMark(range, {
                'data-comment-id': comment.id,
                'class': MARK_CLASS,
                'role': 'mark',
                'aria-label': 'Commented text',
            });
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
