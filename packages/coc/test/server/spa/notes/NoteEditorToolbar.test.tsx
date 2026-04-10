// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/repos/notes/NoteEditorToolbar';

function createTestEditor(content = '<p>Hello world</p>') {
    return new Editor({
        element: document.createElement('div'),
        extensions: [StarterKit],
        content,
    });
}

describe('NoteEditorToolbar — comment button', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('renders comment button when onCommentCreate is provided', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />);

        expect(screen.getByTestId('toolbar-comment-btn')).toBeInTheDocument();
    });

    it('hides comment button when onCommentCreate is not provided', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);

        expect(screen.queryByTestId('toolbar-comment-btn')).not.toBeInTheDocument();
    });

    it('disables comment button when selection is empty', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />);

        const btn = screen.getByTestId('toolbar-comment-btn');
        expect(btn).toBeDisabled();
        expect(btn.className).toContain('opacity-40');
        expect(btn.className).toContain('cursor-not-allowed');
    });

    it('enables comment button when text is selected', async () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />);

        // Select "world"
        act(() => {
            editor.commands.setTextSelection({ from: 7, to: 12 });
        });

        const btn = screen.getByTestId('toolbar-comment-btn');
        expect(btn).not.toBeDisabled();
        expect(btn.className).not.toContain('opacity-40');
    });

    it('calls onCommentCreate when comment button is clicked with selection', () => {
        const onCommentCreate = vi.fn();
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={onCommentCreate} />);

        // Select text first
        act(() => {
            editor.commands.setTextSelection({ from: 7, to: 12 });
        });

        fireEvent.mouseDown(screen.getByTestId('toolbar-comment-btn'));
        expect(onCommentCreate).toHaveBeenCalledTimes(1);
    });

    it('does not call onCommentCreate when clicked without selection', () => {
        const onCommentCreate = vi.fn();
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={onCommentCreate} />);

        fireEvent.mouseDown(screen.getByTestId('toolbar-comment-btn'));
        expect(onCommentCreate).not.toHaveBeenCalled();
    });

    it('prevents default on mouseDown to keep editor focus', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />);

        act(() => {
            editor.commands.setTextSelection({ from: 7, to: 12 });
        });

        const btn = screen.getByTestId('toolbar-comment-btn');
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        const prevented = !btn.dispatchEvent(event);
        expect(prevented).toBe(true);
    });

    it('shows a separator before the comment button', () => {
        editor = createTestEditor();
        const { container } = render(
            <NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />,
        );

        // The comment button should be preceded by a separator div
        const btn = screen.getByTestId('toolbar-comment-btn');
        const prev = btn.previousElementSibling;
        expect(prev).not.toBeNull();
        // The separator has the class w-px
        expect(prev!.className).toContain('w-px');
    });

    it('has correct aria-label and title', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onCommentCreate={() => {}} />);

        const btn = screen.getByTestId('toolbar-comment-btn');
        expect(btn.getAttribute('aria-label')).toBe('Add comment');
        expect(btn.getAttribute('title')).toBe('Add comment (Ctrl+Shift+M)');
    });
});
