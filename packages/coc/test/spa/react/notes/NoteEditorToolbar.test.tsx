import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';

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

describe('NoteEditorToolbar — table size picker', () => {
    it('picker is hidden by default', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('table-size-picker')).toBeNull();
    });

    it('clicking ⊞ opens the picker and does not insert a table', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        expect(screen.getByTestId('table-size-picker')).toBeDefined();
        expect(editor._focusResult.insertTable).not.toHaveBeenCalled();
    });

    it('renders a fixed 10 × 8 grid of cells', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        const picker = screen.getByTestId('table-size-picker');
        expect(picker.querySelectorAll('button').length).toBe(80);
        expect(screen.getByLabelText('10 × 8 table')).toBeDefined();
        expect(screen.queryByLabelText('11 × 8 table')).toBeNull();
        expect(screen.queryByLabelText('10 × 9 table')).toBeNull();
    });

    it('shows a neutral label until a cell is hovered', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        expect(screen.getByTestId('table-size-label').textContent).toBe('Insert table');
    });

    it('hovering a cell shows the live size and highlights the rectangle', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        fireEvent.mouseEnter(screen.getByLabelText('4 × 2 table'));

        expect(screen.getByTestId('table-size-label').textContent).toBe('4 × 2');
        // inside the rectangle
        expect(screen.getByTestId('table-size-cell-1-1').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('table-size-cell-4-2').getAttribute('data-selected')).toBe('true');
        // outside it
        expect(screen.getByTestId('table-size-cell-5-2').getAttribute('data-selected')).toBe('false');
        expect(screen.getByTestId('table-size-cell-4-3').getAttribute('data-selected')).toBe('false');
    });

    it('clicking the hovered cell inserts that size and closes the picker', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        fireEvent.mouseEnter(screen.getByLabelText('4 × 2 table'));
        fireEvent.mouseDown(screen.getByLabelText('4 × 2 table'));

        expect(editor._focusResult.insertTable).toHaveBeenCalledWith({
            rows: 2,
            cols: 4,
            withHeaderRow: true,
        });
        expect(screen.queryByTestId('table-size-picker')).toBeNull();
    });

    it('always passes withHeaderRow for a 1 × 1 pick', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        fireEvent.mouseDown(screen.getByLabelText('1 × 1 table'));

        expect(editor._focusResult.insertTable).toHaveBeenCalledWith({
            rows: 1,
            cols: 1,
            withHeaderRow: true,
        });
    });

    it('Escape closes the picker without inserting', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByTestId('table-size-picker')).toBeNull();
        expect(editor._focusResult.insertTable).not.toHaveBeenCalled();
    });

    it('an outside click closes the picker without inserting', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        fireEvent.mouseDown(document.body);

        expect(screen.queryByTestId('table-size-picker')).toBeNull();
        expect(editor._focusResult.insertTable).not.toHaveBeenCalled();
    });

    it('reopening the picker resets the hover label', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const trigger = screen.getByLabelText('Insert table');

        fireEvent.mouseDown(trigger);
        fireEvent.mouseEnter(screen.getByLabelText('3 × 3 table'));
        expect(screen.getByTestId('table-size-label').textContent).toBe('3 × 3');

        fireEvent.mouseDown(trigger); // close
        fireEvent.mouseDown(trigger); // reopen
        expect(screen.getByTestId('table-size-label').textContent).toBe('Insert table');
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

    it('does not render a chat panel toggle (chat toggle lives in MyWorkView header)', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('chat-panel-toggle')).toBeNull();
    });

    it('keeps unavailable Notes Chat visible with a disabled reason', () => {
        const editor = makeMockEditor();
        const onToggleChatPanel = vi.fn();
        const reason = 'AI note actions are available only in the managed Notes collection';
        render(
            <NoteEditorToolbar
                editor={editor as never}
                onToggleChatPanel={onToggleChatPanel}
                chatDisabledReason={reason}
            />,
        );

        const toggle = screen.getByTestId('chat-panel-toggle');
        expect(toggle).toBeDisabled();
        expect(toggle.getAttribute('title')).toBe(reason);
        expect(toggle.getAttribute('aria-label')).toBe(reason);
        fireEvent.click(toggle);
        expect(onToggleChatPanel).not.toHaveBeenCalled();
    });
});

describe('NoteEditorToolbar — table controls secondary row', () => {
    it('renders table controls in a separate secondary row below the toolbar', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);
        const secondaryRow = screen.getByTestId('table-controls-row');
        expect(secondaryRow).toBeDefined();
        expect(secondaryRow.className).toContain('border-b');
    });

    it('does not render secondary row when not in a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('table-controls-row')).toBeNull();
    });

    it('table buttons use clear labels instead of cryptic symbols', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Add column before').textContent).toContain('Add Col');
        expect(screen.getByLabelText('Add column after').textContent).toContain('Add Col');
        expect(screen.getByLabelText('Delete column').textContent).toContain('Del Col');
        expect(screen.getByLabelText('Add row before').textContent).toContain('Add Row');
        expect(screen.getByLabelText('Add row after').textContent).toContain('Add Row');
        expect(screen.getByLabelText('Delete row').textContent).toContain('Del Row');
        expect(screen.getByLabelText('Delete table').textContent).toContain('Del Table');
    });
});

describe('NoteEditorToolbar — styled text-mark buttons', () => {
    it('Bold button renders with <strong> tag', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const boldBtn = screen.getByLabelText('Bold');
        expect(boldBtn.querySelector('strong')).not.toBeNull();
    });

    it('Italic button renders with <em> tag', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const italicBtn = screen.getByLabelText('Italic');
        expect(italicBtn.querySelector('em')).not.toBeNull();
    });

    it('Strikethrough button renders with <s> tag', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const strikeBtn = screen.getByLabelText('Strikethrough');
        expect(strikeBtn.querySelector('s')).not.toBeNull();
    });

    it('Heading 1 button is wider (w-8) than standard buttons', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const h1Btn = screen.getByLabelText('Heading 1');
        expect(h1Btn.className).toContain('w-8');
        expect(h1Btn.className).toContain('text-sm');
    });

    it('Heading 2 button has semibold weight', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const h2Btn = screen.getByLabelText('Heading 2');
        expect(h2Btn.className).toContain('font-semibold');
    });
});
