// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';

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

describe('NoteEditorToolbar — modeToggle prop', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('renders modeToggle content when provided', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        expect(screen.getByTestId('custom-mode-toggle')).toBeInTheDocument();
    });

    it('does not render modeToggle wrapper when omitted', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        expect(screen.queryByTestId('custom-mode-toggle')).not.toBeInTheDocument();
    });

    it('renders modeToggle after comments toggle when both present', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                onToggleCommentsPanel={() => {}}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        const comments = screen.getByTestId('comments-panel-toggle');
        const mode = screen.getByTestId('custom-mode-toggle');
        // mode toggle should come after comments toggle in DOM order
        expect(comments.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders modeToggle with ml-auto spacer when no comments toggle', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        const mode = screen.getByTestId('custom-mode-toggle');
        const spacer = mode.previousElementSibling;
        expect(spacer).not.toBeNull();
        expect(spacer!.className).toContain('ml-auto');
    });
});

describe('NoteEditorToolbar — hidden prop (source mode)', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('hides formatting buttons when hidden is true', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                hidden={true}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        // toolbar container is still rendered
        expect(screen.getByTestId('note-editor-toolbar')).toBeInTheDocument();
        // but formatting buttons are gone
        expect(screen.queryByLabelText('Bold')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Italic')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Heading 1')).not.toBeInTheDocument();
    });

    it('shows formatting buttons when hidden is false', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                hidden={false}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        expect(screen.getByLabelText('Bold')).toBeInTheDocument();
        expect(screen.getByLabelText('Italic')).toBeInTheDocument();
    });

    it('keeps right-end controls visible when formatting is hidden', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                hidden={true}
                onToggleCommentsPanel={() => {}}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        expect(screen.getByTestId('comments-panel-toggle')).toBeInTheDocument();
        expect(screen.getByTestId('custom-mode-toggle')).toBeInTheDocument();
    });

    it('returns null when editor is null', () => {
        const { container } = render(
            <NoteEditorToolbar
                editor={null}
                modeToggle={<span>Mode</span>}
            />,
        );
        expect(container.innerHTML).toBe('');
    });
});
