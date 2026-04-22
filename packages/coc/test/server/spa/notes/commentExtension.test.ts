// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import { BlockCommentExtension, blockCommentPluginKey } from
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/blockComment';

function createTestEditor(options?: {
    onCommentActivated?: (id: string | null) => void;
    onBlockCommentActivated?: (id: string | null) => void;
    content?: string;
}) {
    return new Editor({
        element: document.createElement('div'),
        extensions: [
            StarterKit,
            CommentExtension.configure({
                onCommentActivated: options?.onCommentActivated ?? (() => {}),
            }),
            BlockCommentExtension.configure({
                onBlockCommentActivated: options?.onBlockCommentActivated ?? (() => {}),
            }),
        ],
        content: options?.content ?? '<p>Hello world</p>',
    });
}

describe('CommentExtension (inline)', () => {
    let editor: Editor;

    afterEach(() => {
        editor?.destroy();
    });

    it('applies mark with setComment(id) and renders data-comment-id attribute', () => {
        editor = createTestEditor();
        // Select "world" (positions 7–12 in "Hello world")
        editor.commands.setTextSelection({ from: 7, to: 12 });
        editor.commands.setComment('thread-1');

        const html = editor.getHTML();
        expect(html).toContain('data-comment-id="thread-1"');

        // Verify the mark exists in the document model
        let foundMark = false;
        editor.state.doc.descendants((node) => {
            for (const mark of node.marks) {
                if (mark.type.name === 'comment' && mark.attrs.commentId === 'thread-1') {
                    foundMark = true;
                }
            }
        });
        expect(foundMark).toBe(true);
    });

    it('removes mark with unsetComment(id) from all occurrences', () => {
        editor = createTestEditor({ content: '<p>Hello world and more</p>' });

        // Apply comment to "Hello"
        editor.commands.setTextSelection({ from: 1, to: 6 });
        editor.commands.setComment('thread-1');

        // Apply same comment to "more"
        editor.commands.setTextSelection({ from: 17, to: 21 });
        editor.commands.setComment('thread-1');

        // Verify marks exist
        expect(editor.getHTML()).toContain('data-comment-id="thread-1"');

        // Remove comment
        editor.commands.unsetComment('thread-1');

        // Verify no marks remain
        let foundMark = false;
        editor.state.doc.descendants((node) => {
            for (const mark of node.marks) {
                if (mark.type.name === 'comment' && mark.attrs.commentId === 'thread-1') {
                    foundMark = true;
                }
            }
        });
        expect(foundMark).toBe(false);
    });

    it('fires onCommentActivated when cursor enters a comment mark', () => {
        const spy = vi.fn();
        editor = createTestEditor({ onCommentActivated: spy });

        // Apply comment to "world"
        editor.commands.setTextSelection({ from: 7, to: 12 });
        editor.commands.setComment('thread-1');

        spy.mockClear();

        // Move cursor into the commented range
        editor.commands.setTextSelection(8);

        expect(spy).toHaveBeenCalledWith('thread-1');
    });

    it('fires onCommentActivated(null) when cursor leaves comment mark', () => {
        const spy = vi.fn();
        editor = createTestEditor({ onCommentActivated: spy });

        // Apply comment to "world"
        editor.commands.setTextSelection({ from: 7, to: 12 });
        editor.commands.setComment('thread-1');

        // Move into the mark
        editor.commands.setTextSelection(8);
        spy.mockClear();

        // Move cursor out of the mark (position 2 = inside "Hello")
        editor.commands.setTextSelection(2);

        expect(spy).toHaveBeenCalledWith(null);
    });

    it('supports overlapping marks with different commentIds', () => {
        editor = createTestEditor();

        // Apply 'thread-1' to "Hello world" (full text)
        editor.commands.setTextSelection({ from: 1, to: 12 });
        editor.commands.setComment('thread-1');

        // Apply 'thread-2' to "lo wor" (overlapping substring)
        editor.commands.setTextSelection({ from: 4, to: 10 });
        editor.commands.setComment('thread-2');

        // Both marks should exist in the document
        const foundIds = new Set<string>();
        editor.state.doc.descendants((node) => {
            for (const mark of node.marks) {
                if (mark.type.name === 'comment') {
                    foundIds.add(mark.attrs.commentId as string);
                }
            }
        });
        expect(foundIds.has('thread-1')).toBe(true);
        expect(foundIds.has('thread-2')).toBe(true);
    });

    it('setComment returns false for empty commentId', () => {
        editor = createTestEditor();
        editor.commands.setTextSelection({ from: 1, to: 6 });
        const result = editor.commands.setComment('');
        expect(result).toBe(false);
    });
});

describe('BlockCommentExtension', () => {
    let editor: Editor;

    afterEach(() => {
        editor?.destroy();
    });

    it('applies block decoration with setBlockComment(id)', () => {
        editor = createTestEditor({ content: '<p>First</p><p>Second</p>' });

        // Place cursor in second paragraph
        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');

        const pluginState = blockCommentPluginKey.getState(editor.state);
        expect(pluginState).toBeDefined();
        expect(pluginState!.comments.has('block-1')).toBe(true);
    });

    it('removes block decoration with unsetBlockComment(id)', () => {
        editor = createTestEditor({ content: '<p>First</p><p>Second</p>' });

        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');

        // Verify it was added
        let pluginState = blockCommentPluginKey.getState(editor.state);
        expect(pluginState!.comments.has('block-1')).toBe(true);

        // Remove it
        editor.commands.unsetBlockComment('block-1');

        pluginState = blockCommentPluginKey.getState(editor.state);
        expect(pluginState!.comments.has('block-1')).toBe(false);
    });

    it('decoration survives document edits (position mapping)', () => {
        editor = createTestEditor({ content: '<p>First</p><p>Second</p>' });

        // Apply block comment to second paragraph
        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');

        // Insert text at the beginning of first paragraph (shifts second para)
        editor.commands.setTextSelection(1);
        editor.commands.insertContent('Prefix ');

        // Block comment should still exist after the edit
        const pluginState = blockCommentPluginKey.getState(editor.state);
        expect(pluginState).toBeDefined();
        expect(pluginState!.comments.has('block-1')).toBe(true);
        expect(pluginState!.comments.get('block-1')!.length).toBeGreaterThan(0);
    });

    it('fires onBlockCommentActivated callback on selection change', () => {
        const spy = vi.fn();
        editor = createTestEditor({
            content: '<p>First</p><p>Second</p>',
            onBlockCommentActivated: spy,
        });

        // Apply block comment to second paragraph
        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');

        spy.mockClear();

        // Move cursor into the decorated block
        editor.commands.setTextSelection(10);

        expect(spy).toHaveBeenCalledWith('block-1');
    });

    it('fires onBlockCommentActivated(null) when leaving decorated block', () => {
        const spy = vi.fn();
        editor = createTestEditor({
            content: '<p>First</p><p>Second</p>',
            onBlockCommentActivated: spy,
        });

        // Apply block comment to second paragraph and move into it
        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');
        editor.commands.setTextSelection(10);

        spy.mockClear();

        // Move cursor to first paragraph (not decorated)
        editor.commands.setTextSelection(2);

        expect(spy).toHaveBeenCalledWith(null);
    });

    it('block decoration renders data-block-comment-id attribute in DOM', () => {
        editor = createTestEditor({ content: '<p>First</p><p>Second</p>' });

        editor.commands.setTextSelection(9);
        editor.commands.setBlockComment('block-1');

        const el = editor.view.dom.querySelector('[data-block-comment-id="block-1"]');
        expect(el).not.toBeNull();
        expect(el?.classList.contains('block-comment')).toBe(true);
    });
});
