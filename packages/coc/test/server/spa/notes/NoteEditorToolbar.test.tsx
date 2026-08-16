// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Highlight } from '@tiptap/extension-highlight';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';

function createTestEditor(content = '<p>Hello world</p>') {
    return new Editor({
        element: document.createElement('div'),
        // The color dropdown drives setColor/setHighlight, so the test editor
        // needs the same mark extensions RichEditorCore registers.
        extensions: [StarterKit, Highlight.configure({ multicolor: true }), TextStyle, Color],
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

    it('renders modeToggle before comments toggle when both present', () => {
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
        // mode toggle is leftmost, so it comes before comments toggle in DOM order
        expect(mode.compareDocumentPosition(comments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders modeToggle as the leftmost toolbar control', () => {
        editor = createTestEditor();
        const { container } = render(
            <NoteEditorToolbar
                editor={editor}
                modeToggle={<span data-testid="custom-mode-toggle">Mode</span>}
            />,
        );
        const toolbar = container.querySelector('[data-testid="note-editor-toolbar"]');
        const mode = screen.getByTestId('custom-mode-toggle');
        // no ml-auto spacer before it — it's the first child of the toolbar
        expect(mode.previousElementSibling).toBeNull();
        expect(toolbar!.firstElementChild).toBe(mode);
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
        expect(screen.queryByLabelText('Heading level')).not.toBeInTheDocument();
        expect(screen.queryByTestId('list-dropdown')).not.toBeInTheDocument();
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

describe('NoteEditorToolbar — refresh button', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('renders refresh button when onRefresh is provided', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={() => {}} />);
        expect(screen.getByTestId('note-editor-refresh-btn')).toBeInTheDocument();
    });

    it('does not render refresh button when onRefresh is omitted', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        expect(screen.queryByTestId('note-editor-refresh-btn')).not.toBeInTheDocument();
    });

    it('calls onRefresh when clicked', () => {
        const onRefresh = vi.fn();
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTestId('note-editor-refresh-btn'));
        expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('is disabled when refreshing is true', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={() => {}} refreshing={true} />);
        expect(screen.getByTestId('note-editor-refresh-btn')).toBeDisabled();
    });

    it('is enabled when refreshing is false', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={() => {}} refreshing={false} />);
        expect(screen.getByTestId('note-editor-refresh-btn')).not.toBeDisabled();
    });

    it('has correct aria-label and title', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={() => {}} />);
        const btn = screen.getByTestId('note-editor-refresh-btn');
        expect(btn.getAttribute('aria-label')).toBe('Refresh');
        expect(btn.getAttribute('title')).toBe('Refresh (Ctrl+Shift+R)');
    });

    it('refresh button appears before toolbarRight content', () => {
        editor = createTestEditor();
        render(
            <NoteEditorToolbar
                editor={editor}
                onRefresh={() => {}}
                toolbarRight={<span data-testid="toolbar-right-content">Extra</span>}
            />,
        );
        const refreshBtn = screen.getByTestId('note-editor-refresh-btn');
        const toolbarRight = screen.getByTestId('toolbar-right-content');
        expect(refreshBtn.compareDocumentPosition(toolbarRight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders refresh button in both rich and source (hidden) modes', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} onRefresh={() => {}} hidden={true} />);
        expect(screen.getByTestId('note-editor-refresh-btn')).toBeInTheDocument();
    });
});

describe('NoteEditorToolbar — color dropdown', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('replaces the old split HL button with a single "A" trigger', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        expect(screen.getByLabelText('Text and highlight color')).toBeInTheDocument();
        expect(screen.queryByText('HL')).not.toBeInTheDocument();
    });

    it('shows a Text Color and a Highlight Color section with palette swatches', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));

        const panel = screen.getByTestId('color-dropdown-panel');
        expect(panel.textContent).toContain('Text Color');
        expect(panel.textContent).toContain('Highlight Color');
        // The swatch itself carries the literal palette hex — that value is what
        // ends up in the `.md` file, so it is worth asserting on.
        expect(screen.getByLabelText('Highlight Yellow').getAttribute('style'))
            .toContain('rgb(255, 243, 176)');
        expect(screen.getByLabelText('Text Red').getAttribute('style'))
            .toContain('rgb(239, 68, 68)');
    });

    it('keeps the editor selection by suppressing mousedown on trigger and swatches', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);

        // `fireEvent` returns false when the handler called preventDefault.
        const trigger = screen.getByLabelText('Text and highlight color');
        expect(fireEvent.mouseDown(trigger)).toBe(false);
        expect(fireEvent.mouseDown(screen.getByLabelText('Text Blue'))).toBe(false);

        fireEvent.mouseDown(trigger);
        expect(fireEvent.mouseDown(screen.getByLabelText('Highlight Green'))).toBe(false);
        fireEvent.mouseDown(trigger);
        expect(fireEvent.mouseDown(screen.getByLabelText('Default text color'))).toBe(false);
    });

    // The two sections share one panel, so the risk is that one reset wipes both
    // marks. Driven through the real toolbar against a real editor.
    it('applies both marks to one selection and resets them independently', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        const trigger = screen.getByLabelText('Text and highlight color');
        const selectWord = () => editor.commands.setTextSelection({ from: 1, to: 6 });

        selectWord();
        fireEvent.mouseDown(trigger);
        fireEvent.mouseDown(screen.getByLabelText('Text Blue'));
        selectWord();
        fireEvent.mouseDown(trigger);
        fireEvent.mouseDown(screen.getByLabelText('Highlight Green'));

        selectWord();
        expect(editor.getAttributes('textStyle').color).toBe('#3b82f6');
        expect(editor.getAttributes('highlight').color).toBe('#b9f5d0');
        expect(editor.getHTML()).toContain('<mark');

        // Clearing the text color must leave the highlight standing…
        fireEvent.mouseDown(trigger);
        fireEvent.mouseDown(screen.getByLabelText('Default text color'));
        selectWord();
        expect(editor.getAttributes('textStyle').color).toBeUndefined();
        expect(editor.getAttributes('highlight').color).toBe('#b9f5d0');

        // …and clearing the highlight afterwards leaves nothing behind.
        fireEvent.mouseDown(trigger);
        fireEvent.mouseDown(screen.getByLabelText('Remove highlight'));
        selectWord();
        expect(editor.isActive('highlight')).toBe(false);
    });
});

describe('NoteEditorToolbar — dark-mode text color', () => {
    let editor: Editor;

    afterEach(() => {
        cleanup();
        editor?.destroy();
        vi.restoreAllMocks();
    });

    it('sets an explicit base text color so formatting icons stay visible in dark mode', () => {
        editor = createTestEditor();
        render(<NoteEditorToolbar editor={editor} />);
        const toolbar = screen.getByTestId('note-editor-toolbar');
        // Without an explicit color the icon buttons inherit near-black and
        // vanish on the dark toolbar background.
        expect(toolbar.className).toContain('text-[#1e1e1e]');
        expect(toolbar.className).toContain('dark:text-[#cccccc]');
    });
});
