/**
 * Inline comment mark extension for Tiptap.
 *
 * Originally from @sereneinserenade/tiptap-comment-extension (MIT).
 * Inlined to remove the unmaintained dependency and fix the
 * `setComment` return-type bug (original returned void instead of boolean).
 */

import { Mark, mergeAttributes } from '@tiptap/core';
import type { Range } from '@tiptap/core';
import type { Mark as PMMark } from '@tiptap/pm/model';

// ── Tiptap command type augmentation ────────────────────────────────────────

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        comment: {
            /** Apply the `comment` mark to the current selection. */
            setComment: (commentId: string) => ReturnType;
            /** Remove all `comment` marks with the given commentId. */
            unsetComment: (commentId: string) => ReturnType;
        };
    }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface MarkWithRange {
    mark: PMMark;
    range: Range;
}

export interface CommentOptions {
    HTMLAttributes: Record<string, any>;
    onCommentActivated: (commentId: string | null) => void;
}

export interface CommentStorage {
    activeCommentId: string | null;
}

// ── Extension ───────────────────────────────────────────────────────────────

export const CommentExtension = Mark.create<CommentOptions, CommentStorage>({
    name: 'comment',

    addOptions() {
        return {
            HTMLAttributes: {},
            onCommentActivated: () => {},
        };
    },

    addAttributes() {
        return {
            commentId: {
                default: null,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-comment-id'),
                renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId }),
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-comment-id]',
                getAttrs: (el: HTMLElement) =>
                    !!(el.getAttribute('data-comment-id')?.trim()) && null,
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
            0,
        ];
    },

    onSelectionUpdate() {
        const { $from } = this.editor.state.selection;
        const marks = $from.marks();

        if (!marks.length) {
            this.storage.activeCommentId = null;
            this.options.onCommentActivated(this.storage.activeCommentId);
            return;
        }

        const commentMark = this.editor.schema.marks.comment;
        const activeCommentMark = marks.find((mark) => mark.type === commentMark);
        this.storage.activeCommentId = activeCommentMark?.attrs.commentId || null;
        this.options.onCommentActivated(this.storage.activeCommentId);
    },

    addStorage() {
        return {
            activeCommentId: null,
        };
    },

    addCommands() {
        return {
            setComment:
                (commentId: string) =>
                    ({ commands }) => {
                        if (!commentId) return false;
                        return commands.setMark('comment', { commentId });
                    },

            unsetComment:
                (commentId: string) =>
                    ({ tr, dispatch }) => {
                        if (!commentId) return false;

                        const commentMarksWithRange: MarkWithRange[] = [];
                        tr.doc.descendants((node, pos) => {
                            const mark = node.marks.find(
                                (m) => m.type.name === 'comment' && m.attrs.commentId === commentId,
                            );
                            if (!mark) return;
                            commentMarksWithRange.push({
                                mark,
                                range: { from: pos, to: pos + node.nodeSize },
                            });
                        });

                        commentMarksWithRange.forEach(({ mark, range }) => {
                            tr.removeMark(range.from, range.to, mark);
                        });

                        return dispatch?.(tr) ?? false;
                    },
        };
    },
});
