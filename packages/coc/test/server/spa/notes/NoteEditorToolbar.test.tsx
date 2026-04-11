// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
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

describe('NoteEditorToolbar — comments panel toggle', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('renders toggle when onToggleCommentsPanel is provided', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onToggleCommentsPanel={() => {}} />);
        expect(screen.getByTestId('comments-panel-toggle')).toBeInTheDocument();
    });

    it('does not render toggle when onToggleCommentsPanel is omitted', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        expect(screen.queryByTestId('comments-panel-toggle')).not.toBeInTheDocument();
    });

    it('shows active style when commentsPanelOpen is true', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                commentsPanelOpen={true}
                onToggleCommentsPanel={() => {}}
            />,
        );
        const btn = screen.getByTestId('comments-panel-toggle');
        expect(btn.className).toContain('bg-[#e8e8e8]');
        expect(btn.getAttribute('aria-label')).toBe('Hide comments');
    });

    it('shows inactive style when commentsPanelOpen is false', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                commentsPanelOpen={false}
                onToggleCommentsPanel={() => {}}
            />,
        );
        const btn = screen.getByTestId('comments-panel-toggle');
        expect(btn.className).toContain('text-[#888]');
        expect(btn.getAttribute('aria-label')).toBe('Show comments');
    });

    it('shows count badge when commentCount > 0', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                onToggleCommentsPanel={() => {}}
                commentCount={5}
            />,
        );
        const badge = screen.getByTestId('comments-toggle-count');
        expect(badge.textContent).toBe('5');
    });

    it('hides count badge when commentCount is 0', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                onToggleCommentsPanel={() => {}}
                commentCount={0}
            />,
        );
        expect(screen.queryByTestId('comments-toggle-count')).not.toBeInTheDocument();
    });

    it('calls onToggleCommentsPanel on click', () => {
        const onToggle = vi.fn();
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                onToggleCommentsPanel={onToggle}
            />,
        );
        fireEvent.click(screen.getByTestId('comments-panel-toggle'));
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('toggle is right-aligned via ml-auto spacer', () => {
        editor = createTestEditor();
        const { container } = render(
            <NoteEditorToolbar
                editor={editor}
                onToggleCommentsPanel={() => {}}
            />,
        );
        const toggle = screen.getByTestId('comments-panel-toggle');
        const spacer = toggle.previousElementSibling;
        expect(spacer).not.toBeNull();
        expect(spacer!.className).toContain('ml-auto');
    });
});
