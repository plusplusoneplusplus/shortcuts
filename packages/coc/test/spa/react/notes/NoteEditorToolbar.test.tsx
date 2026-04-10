import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/repos/notes/NoteEditorToolbar';

// ── Mock editor factory ─────────────────────────────────────────────────────

function makeMockEditor(isActiveOverride?: (name: string) => boolean) {
    const insertTable = vi.fn(() => ({ run: vi.fn() }));
    const addColumnBefore = vi.fn(() => ({ run: vi.fn() }));
    const addColumnAfter = vi.fn(() => ({ run: vi.fn() }));
    const deleteColumn = vi.fn(() => ({ run: vi.fn() }));
    const addRowBefore = vi.fn(() => ({ run: vi.fn() }));
    const addRowAfter = vi.fn(() => ({ run: vi.fn() }));
    const deleteRow = vi.fn(() => ({ run: vi.fn() }));
    const deleteTable = vi.fn(() => ({ run: vi.fn() }));

    const focusResult = {
        toggleBold: () => ({ run: vi.fn() }),
        toggleItalic: () => ({ run: vi.fn() }),
        toggleStrike: () => ({ run: vi.fn() }),
        toggleHighlight: vi.fn(() => ({ run: vi.fn() })),
        unsetHighlight: vi.fn(() => ({ run: vi.fn() })),
        toggleHeading: () => ({ run: vi.fn() }),
        toggleBulletList: () => ({ run: vi.fn() }),
        toggleOrderedList: () => ({ run: vi.fn() }),
        toggleTaskList: () => ({ run: vi.fn() }),
        toggleBlockquote: () => ({ run: vi.fn() }),
        toggleCode: () => ({ run: vi.fn() }),
        toggleCodeBlock: () => ({ run: vi.fn() }),
        setLink: () => ({ run: vi.fn() }),
        unsetLink: () => ({ run: vi.fn() }),
        setHorizontalRule: () => ({ run: vi.fn() }),
        insertTable,
        addColumnBefore,
        addColumnAfter,
        deleteColumn,
        addRowBefore,
        addRowAfter,
        deleteRow,
        deleteTable,
    };

    return {
        isActive: vi.fn((name: string) => isActiveOverride ? isActiveOverride(name) : false),
        getAttributes: vi.fn(() => ({})),
        chain: () => ({ focus: () => focusResult }),
        _focusResult: focusResult,
    };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('NoteEditorToolbar — table controls', () => {
    it('renders "Insert table" button in toolbar', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Insert table')).toBeDefined();
    });

    it('hides table context controls when cursor is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.queryByLabelText('Add column before')).toBeNull();
        expect(screen.queryByLabelText('Add column after')).toBeNull();
        expect(screen.queryByLabelText('Delete column')).toBeNull();
        expect(screen.queryByLabelText('Add row before')).toBeNull();
        expect(screen.queryByLabelText('Add row after')).toBeNull();
        expect(screen.queryByLabelText('Delete row')).toBeNull();
        expect(screen.queryByLabelText('Delete table')).toBeNull();
    });

    it('shows table context controls when cursor is inside a table', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.getByLabelText('Add column before')).toBeDefined();
        expect(screen.getByLabelText('Add column after')).toBeDefined();
        expect(screen.getByLabelText('Delete column')).toBeDefined();
        expect(screen.getByLabelText('Add row before')).toBeDefined();
        expect(screen.getByLabelText('Add row after')).toBeDefined();
        expect(screen.getByLabelText('Delete row')).toBeDefined();
        expect(screen.getByLabelText('Delete table')).toBeDefined();
    });

    it('"Insert table" calls insertTable with correct args', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Insert table'));
        expect(editor._focusResult.insertTable).toHaveBeenCalledWith({
            rows: 3,
            cols: 3,
            withHeaderRow: true,
        });
    });

    it('"Add column before" calls addColumnBefore', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Add column before'));
        expect(editor._focusResult.addColumnBefore).toHaveBeenCalled();
    });

    it('"Add column after" calls addColumnAfter', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Add column after'));
        expect(editor._focusResult.addColumnAfter).toHaveBeenCalled();
    });

    it('"Delete column" calls deleteColumn', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Delete column'));
        expect(editor._focusResult.deleteColumn).toHaveBeenCalled();
    });

    it('"Add row before" calls addRowBefore', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Add row before'));
        expect(editor._focusResult.addRowBefore).toHaveBeenCalled();
    });

    it('"Add row after" calls addRowAfter', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Add row after'));
        expect(editor._focusResult.addRowAfter).toHaveBeenCalled();
    });

    it('"Delete row" calls deleteRow', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Delete row'));
        expect(editor._focusResult.deleteRow).toHaveBeenCalled();
    });

    it('"Delete table" calls deleteTable', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Delete table'));
        expect(editor._focusResult.deleteTable).toHaveBeenCalled();
    });
});

describe('NoteEditorToolbar — highlight controls', () => {
    it('renders "Highlight" button in toolbar', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Highlight')).toBeDefined();
    });

    it('renders "Highlight colors" dropdown arrow', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Highlight colors')).toBeDefined();
    });

    it('clicking Highlight button calls toggleHighlight with default color', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Highlight'));
        expect(editor._focusResult.toggleHighlight).toHaveBeenCalledWith({ color: '#fff3b0' });
    });

    it('color picker is hidden by default', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('highlight-color-picker')).toBeNull();
    });

    it('clicking dropdown arrow shows color picker', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Highlight colors'));
        expect(screen.getByTestId('highlight-color-picker')).toBeDefined();
    });

    it('color picker has 6 color swatches plus remove button', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Highlight colors'));
        const picker = screen.getByTestId('highlight-color-picker');
        // 6 color buttons + 1 remove button = 7
        expect(picker.querySelectorAll('button').length).toBe(7);
    });

    it('clicking a color swatch calls toggleHighlight with that color', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Highlight colors'));
        fireEvent.mouseDown(screen.getByLabelText('Highlight Pink'));
        expect(editor._focusResult.toggleHighlight).toHaveBeenCalledWith({ color: '#ffc8dd' });
    });

    it('clicking Remove highlight calls unsetHighlight', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Highlight colors'));
        fireEvent.mouseDown(screen.getByLabelText('Remove highlight'));
        expect(editor._focusResult.unsetHighlight).toHaveBeenCalled();
    });

    it('highlight button shows active state when highlight is active', () => {
        const editor = makeMockEditor((name) => name === 'highlight');
        render(<NoteEditorToolbar editor={editor as never} />);
        const btn = screen.getByLabelText('Highlight');
        expect(btn.className).toContain('font-bold');
    });
});
