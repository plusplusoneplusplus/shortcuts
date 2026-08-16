import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NoteEditorToolbar } from '../../../../src/server/spa/client/react/features/notes/editor/NoteEditorToolbar';
import { TABLE_CELL_COLORS } from '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableCellBackground';

const tableWidthMocks = vi.hoisted(() => ({
    activeTableHasColumnWidths: vi.fn(() => false),
    clearActiveTableColumnWidths: vi.fn(() => true),
}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/tableColumnWidths',
    () => tableWidthMocks,
);

// Header-ness is read off a real ProseMirror doc, which the mock editor has no
// way to supply, so the helper is stubbed here and exercised for real in
// tableHeaderState.test.ts.
const tableHeaderMocks = vi.hoisted(() => ({
    tableHeaderState: vi.fn(() => ({ row: false, column: false })),
}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/tableHeaderState',
    () => tableHeaderMocks,
);

// Wrap state is likewise read off a real doc; the real helpers are covered in
// tableColumnWrap.test.ts.
const tableWrapMocks = vi.hoisted(() => ({
    activeColumnWrap: vi.fn((): string | null => 'wrap'),
    toggleActiveColumnWrap: vi.fn(() => true),
}));
vi.mock(
    '../../../../src/server/spa/client/react/features/notes/editor/extensions/tableColumnWrap',
    () => tableWrapMocks,
);

beforeEach(() => {
    tableWidthMocks.activeTableHasColumnWidths.mockReset().mockReturnValue(false);
    tableWidthMocks.clearActiveTableColumnWidths.mockReset().mockReturnValue(true);
    tableHeaderMocks.tableHeaderState.mockReset().mockReturnValue({ row: false, column: false });
    tableWrapMocks.activeColumnWrap.mockReset().mockReturnValue('wrap');
    tableWrapMocks.toggleActiveColumnWrap.mockReset().mockReturnValue(true);
});

// ── Mock editor factory ─────────────────────────────────────────────────────

function makeMockEditor(
    isActiveOverride?: (name: string, attrs?: Record<string, unknown>) => boolean,
    getAttributesOverride?: (name: string) => Record<string, unknown>,
    // Per-command `editor.can()` answers; anything unlisted reads as allowed,
    // so existing tests keep the enabled rendering they were written against.
    canOverride?: Record<string, boolean>,
) {
    const insertTable = vi.fn(() => ({ run: vi.fn() }));
    const addColumnBefore = vi.fn(() => ({ run: vi.fn() }));
    const addColumnAfter = vi.fn(() => ({ run: vi.fn() }));
    const deleteColumn = vi.fn(() => ({ run: vi.fn() }));
    const addRowBefore = vi.fn(() => ({ run: vi.fn() }));
    const addRowAfter = vi.fn(() => ({ run: vi.fn() }));
    const deleteRow = vi.fn(() => ({ run: vi.fn() }));
    const deleteTable = vi.fn(() => ({ run: vi.fn() }));
    const setCellAttribute = vi.fn(() => ({ run: vi.fn() }));
    const toggleHeaderRow = vi.fn(() => ({ run: vi.fn() }));
    const toggleHeaderColumn = vi.fn(() => ({ run: vi.fn() }));
    const toggleHeaderCell = vi.fn(() => ({ run: vi.fn() }));
    const moveTableRowUp = vi.fn(() => ({ run: vi.fn() }));
    const moveTableRowDown = vi.fn(() => ({ run: vi.fn() }));
    const moveTableColumnLeft = vi.fn(() => ({ run: vi.fn() }));
    const moveTableColumnRight = vi.fn(() => ({ run: vi.fn() }));

    const focusResult = {
        toggleBold: () => ({ run: vi.fn() }),
        toggleItalic: () => ({ run: vi.fn() }),
        toggleStrike: () => ({ run: vi.fn() }),
        toggleHighlight: vi.fn(() => ({ run: vi.fn() })),
        setHighlight: vi.fn(() => ({ run: vi.fn() })),
        unsetHighlight: vi.fn(() => ({ run: vi.fn() })),
        setColor: vi.fn(() => ({ run: vi.fn() })),
        unsetColor: vi.fn(() => ({ run: vi.fn() })),
        setFontFamily: vi.fn(() => ({ run: vi.fn() })),
        unsetFontFamily: vi.fn(() => ({ run: vi.fn() })),
        setFontSize: vi.fn(() => ({ run: vi.fn() })),
        unsetFontSize: vi.fn(() => ({ run: vi.fn() })),
        toggleHeading: vi.fn(() => ({ run: vi.fn() })),
        setParagraph: vi.fn(() => ({ run: vi.fn() })),
        toggleBulletList: vi.fn(() => ({ run: vi.fn() })),
        toggleOrderedList: vi.fn(() => ({ run: vi.fn() })),
        toggleTaskList: vi.fn(() => ({ run: vi.fn() })),
        setTextAlign: vi.fn(() => ({ run: vi.fn() })),
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
        setCellAttribute,
        toggleHeaderRow,
        toggleHeaderColumn,
        toggleHeaderCell,
        moveTableRowUp,
        moveTableRowDown,
        moveTableColumnLeft,
        moveTableColumnRight,
    };

    const canResult = new Proxy({}, {
        get: (_target, prop: string) => () => canOverride?.[prop] ?? true,
    });

    return {
        isActive: vi.fn((name: string, attrs?: Record<string, unknown>) =>
            isActiveOverride ? isActiveOverride(name, attrs) : false),
        getAttributes: vi.fn((name: string) =>
            getAttributesOverride ? getAttributesOverride(name) : {}),
        can: vi.fn(() => canResult),
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

    // ── Row / column moves (AC-11, AC-12) ───────────────────────────────────

    const MOVE_BUTTONS = [
        ['Move column left', 'moveTableColumnLeft'],
        ['Move column right', 'moveTableColumnRight'],
        ['Move row up', 'moveTableRowUp'],
        ['Move row down', 'moveTableRowDown'],
    ] as const;

    it('hides the move buttons when the cursor is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);

        for (const [label] of MOVE_BUTTONS) {
            expect(screen.queryByLabelText(label)).toBeNull();
        }
    });

    it('shows all four move buttons inside a table', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        for (const [label] of MOVE_BUTTONS) {
            expect(screen.getByLabelText(label)).toBeDefined();
        }
    });

    for (const [label, command] of MOVE_BUTTONS) {
        it(`"${label}" calls ${command}`, () => {
            const editor = makeMockEditor((name) => name === 'table');
            render(<NoteEditorToolbar editor={editor as never} />);

            fireEvent.mouseDown(screen.getByLabelText(label));
            expect(editor._focusResult[command]).toHaveBeenCalled();
        });

        it(`"${label}" renders disabled and dispatches nothing when can() says no`, () => {
            const editor = makeMockEditor(
                (name) => name === 'table',
                undefined,
                { [command]: false },
            );
            render(<NoteEditorToolbar editor={editor as never} />);

            const button = screen.getByLabelText(label);
            expect(button.getAttribute('aria-disabled')).toBe('true');
            expect((button as HTMLButtonElement).disabled).toBe(true);

            fireEvent.mouseDown(button);
            expect(editor._focusResult[command]).not.toHaveBeenCalled();
        });

        it(`"${label}" is enabled when can() allows it`, () => {
            const editor = makeMockEditor((name) => name === 'table');
            render(<NoteEditorToolbar editor={editor as never} />);

            const button = screen.getByLabelText(label);
            expect(button.getAttribute('aria-disabled')).toBe('false');
            expect((button as HTMLButtonElement).disabled).toBe(false);
        });
    }

    it('disables the move buttons on an editor without the TableReorder extension', () => {
        // `can()` on such an editor has no move commands at all; the strip must
        // still render rather than throwing on the missing method.
        const editor = makeMockEditor((name) => name === 'table');
        editor.can = vi.fn(() => ({})) as never;
        render(<NoteEditorToolbar editor={editor as never} />);

        for (const [label] of MOVE_BUTTONS) {
            expect((screen.getByLabelText(label) as HTMLButtonElement).disabled).toBe(true);
        }
    });

    // ── Header shape toggles (AC-01, AC-02, AC-04) ──────────────────────────

    const HEADER_BUTTONS = [
        ['Toggle header row', 'toggleHeaderRow'],
        ['Toggle header column', 'toggleHeaderColumn'],
        ['Toggle header cell', 'toggleHeaderCell'],
    ] as const;

    it('hides the header toggles when the cursor is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);

        for (const [label] of HEADER_BUTTONS) {
            expect(screen.queryByLabelText(label)).toBeNull();
        }
    });

    it('shows exactly the three header toggles inside a table', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        for (const [label] of HEADER_BUTTONS) {
            expect(screen.getByLabelText(label)).toBeDefined();
        }
        const strip = screen.getByTestId('table-controls-row');
        const headerButtons = Array.from(strip.querySelectorAll('button'))
            .filter((b) => (b.getAttribute('aria-label') ?? '').startsWith('Toggle header'));
        expect(headerButtons.length).toBe(3);
    });

    for (const [label, command] of HEADER_BUTTONS) {
        it(`"${label}" calls ${command} once and keeps editor focus`, () => {
            const editor = makeMockEditor((name) => name === 'table');
            render(<NoteEditorToolbar editor={editor as never} />);

            const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
            fireEvent(screen.getByLabelText(label), event);

            expect(editor._focusResult[command]).toHaveBeenCalledTimes(1);
            // preventDefault on mousedown is what stops the editor from blurring.
            expect(event.defaultPrevented).toBe(true);
        });
    }

    it('header row / column buttons reflect tableHeaderState via aria-pressed', () => {
        const shapes = [
            { row: false, column: false },
            { row: true, column: false },
            { row: false, column: true },
            { row: true, column: true },
        ];

        for (const shape of shapes) {
            tableHeaderMocks.tableHeaderState.mockReturnValue(shape);
            const editor = makeMockEditor((name) => name === 'table');
            const { unmount } = render(<NoteEditorToolbar editor={editor as never} />);

            const rowBtn = screen.getByLabelText('Toggle header row');
            const colBtn = screen.getByLabelText('Toggle header column');
            expect(rowBtn.getAttribute('aria-pressed')).toBe(String(shape.row));
            expect(colBtn.getAttribute('aria-pressed')).toBe(String(shape.column));
            // Pressed background matches what the rest of the toolbar uses.
            expect(rowBtn.className.includes('bg-[#e8e8e8]')).toBe(shape.row);
            expect(colBtn.className.includes('bg-[#e8e8e8]')).toBe(shape.column);

            // Per-cell state is ambiguous across a multi-cell selection, so the
            // cell button stays a plain action.
            expect(screen.getByLabelText('Toggle header cell').hasAttribute('aria-pressed'))
                .toBe(false);
            unmount();
        }
    });

    // ── "Reset column widths" (AC-08) ───────────────────────────────────────
    //
    // The width helpers walk a real ProseMirror doc, which the mock editor has
    // no way to supply, so they are stubbed here and exercised for real in
    // tableColumnWidths.test.ts.

    it('hides "Reset column widths" when the cursor is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByLabelText('Reset column widths')).toBeNull();
    });

    it('shows "Reset column widths" when the cursor is inside a table', () => {
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Reset column widths')).toBeDefined();
    });

    it('disables "Reset column widths" when no cell has a colwidth', () => {
        tableWidthMocks.activeTableHasColumnWidths.mockReturnValue(false);
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        const btn = screen.getByLabelText('Reset column widths') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);

        fireEvent.mouseDown(btn);
        expect(tableWidthMocks.clearActiveTableColumnWidths).not.toHaveBeenCalled();
    });

    it('enables "Reset column widths" when the table carries a colwidth', () => {
        tableWidthMocks.activeTableHasColumnWidths.mockReturnValue(true);
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        expect((screen.getByLabelText('Reset column widths') as HTMLButtonElement).disabled).toBe(false);
    });

    it('"Reset column widths" clears the widths exactly once', () => {
        tableWidthMocks.activeTableHasColumnWidths.mockReturnValue(true);
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Reset column widths'));

        expect(tableWidthMocks.clearActiveTableColumnWidths).toHaveBeenCalledTimes(1);
        expect(tableWidthMocks.clearActiveTableColumnWidths).toHaveBeenCalledWith(editor);
    });

    it('"Reset column widths" preventDefaults its mousedown so editor focus survives', () => {
        tableWidthMocks.activeTableHasColumnWidths.mockReturnValue(true);
        const editor = makeMockEditor((name) => name === 'table');
        render(<NoteEditorToolbar editor={editor as never} />);

        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        fireEvent(screen.getByLabelText('Reset column widths'), event);

        expect(event.defaultPrevented).toBe(true);
    });
});

// ── "Toggle column text wrapping" (AC-04) ───────────────────────────────────

describe('NoteEditorToolbar — column wrap toggle', () => {
    const inTable = (name: string) => name === 'table';

    it('hides the wrap toggle when the caret is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.queryByTestId('table-wrap-toggle')).toBeNull();
        expect(screen.queryByLabelText('Toggle column text wrapping')).toBeNull();
    });

    it('shows the wrap toggle inside a table, in the column group before the first separator', () => {
        const editor = makeMockEditor(inTable);
        render(<NoteEditorToolbar editor={editor as never} />);

        const btn = screen.getByTestId('table-wrap-toggle');
        expect(btn.getAttribute('aria-label')).toBe('Toggle column text wrapping');
        expect(btn.getAttribute('title')).toBe('Toggle column text wrapping');
        expect(btn.textContent).toBe('Wrap');

        // It belongs to the column operations group: "Del Col" is its immediate
        // left-hand neighbour and nothing between them.
        const strip = screen.getByTestId('table-controls-row');
        const buttons = Array.from(strip.querySelectorAll('button'));
        const delColIndex = buttons.findIndex((b) => b.getAttribute('aria-label') === 'Delete column');
        expect(buttons[delColIndex + 1]).toBe(btn);
    });

    it('reflects the column wrap mode via aria-pressed and the pressed background', () => {
        for (const [mode, pressed] of [['wrap', false], ['nowrap', true]] as const) {
            tableWrapMocks.activeColumnWrap.mockReturnValue(mode);
            const editor = makeMockEditor(inTable);
            const { unmount } = render(<NoteEditorToolbar editor={editor as never} />);

            const btn = screen.getByTestId('table-wrap-toggle');
            expect(btn.getAttribute('aria-pressed')).toBe(String(pressed));
            expect(btn.className.includes('bg-[#e8e8e8]')).toBe(pressed);
            unmount();
        }
    });

    it('treats a null wrap mode as not pressed', () => {
        tableWrapMocks.activeColumnWrap.mockReturnValue(null);
        const editor = makeMockEditor(inTable);
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.getByTestId('table-wrap-toggle').getAttribute('aria-pressed')).toBe('false');
    });

    it('toggles the column exactly once and keeps editor focus', () => {
        const editor = makeMockEditor(inTable);
        render(<NoteEditorToolbar editor={editor as never} />);

        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        fireEvent(screen.getByTestId('table-wrap-toggle'), event);

        expect(tableWrapMocks.toggleActiveColumnWrap).toHaveBeenCalledTimes(1);
        expect(tableWrapMocks.toggleActiveColumnWrap).toHaveBeenCalledWith(editor);
        // preventDefault on mousedown is what stops the editor from blurring.
        expect(event.defaultPrevented).toBe(true);
    });
});

describe('NoteEditorToolbar — cell fill color picker', () => {
    const inTable = (name: string) => name === 'table';

    function openPicker(editor: ReturnType<typeof makeMockEditor>) {
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Cell fill color'));
        return screen.getByTestId('table-cell-color-picker');
    }

    it('hides the fill button when the caret is outside a table', () => {
        const editor = makeMockEditor(() => false);
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByLabelText('Cell fill color')).toBeNull();
    });

    it('shows the fill button inside a table with the panel closed', () => {
        const editor = makeMockEditor(inTable);
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.getByLabelText('Cell fill color')).toBeDefined();
        expect(screen.queryByTestId('table-cell-color-picker')).toBeNull();
    });

    it('opens the panel without touching the document', () => {
        const editor = makeMockEditor(inTable);
        const panel = openPicker(editor);

        expect(panel).toBeDefined();
        expect(screen.getByLabelText('Cell fill color').getAttribute('aria-expanded')).toBe('true');
        expect(editor._focusResult.setCellAttribute).not.toHaveBeenCalled();
    });

    it('renders exactly the exported palette plus a clear button', () => {
        const editor = makeMockEditor(inTable);
        openPicker(editor);

        for (const { token, name } of TABLE_CELL_COLORS) {
            const swatch = screen.getByTestId(`table-cell-color-${token}`);
            expect(swatch.getAttribute('aria-label')).toBe(`Fill ${name}`);
        }
        expect(screen.getByTestId('table-cell-color-clear')).toBeDefined();
        expect(
            screen.getByTestId('table-cell-color-picker').querySelectorAll('button').length,
        ).toBe(TABLE_CELL_COLORS.length + 1);
    });

    it.each(TABLE_CELL_COLORS.map((c) => c.token))(
        'clicking the %s swatch sets the token and closes the panel',
        (token) => {
            const editor = makeMockEditor(inTable);
            openPicker(editor);

            fireEvent.mouseDown(screen.getByTestId(`table-cell-color-${token}`));

            expect(editor._focusResult.setCellAttribute).toHaveBeenCalledWith('backgroundColor', token);
            expect(screen.queryByTestId('table-cell-color-picker')).toBeNull();
        },
    );

    it('clicking clear unsets the fill and closes the panel', () => {
        const editor = makeMockEditor(inTable);
        openPicker(editor);

        fireEvent.mouseDown(screen.getByTestId('table-cell-color-clear'));

        expect(editor._focusResult.setCellAttribute).toHaveBeenCalledWith('backgroundColor', null);
        expect(screen.queryByTestId('table-cell-color-picker')).toBeNull();
    });

    it('prevents the mousedown default on the trigger and on a swatch', () => {
        const editor = makeMockEditor(inTable);
        render(<NoteEditorToolbar editor={editor as never} />);

        const triggerEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        fireEvent(screen.getByLabelText('Cell fill color'), triggerEvent);
        expect(triggerEvent.defaultPrevented).toBe(true);

        const swatchEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        fireEvent(screen.getByTestId('table-cell-color-green'), swatchEvent);
        expect(swatchEvent.defaultPrevented).toBe(true);
    });

    it('marks only the current cell token as pressed', () => {
        const editor = makeMockEditor(inTable, (name) =>
            name === 'tableCell' ? { backgroundColor: 'green' } : {});
        openPicker(editor);

        for (const { token } of TABLE_CELL_COLORS) {
            expect(screen.getByTestId(`table-cell-color-${token}`).getAttribute('aria-pressed'))
                .toBe(String(token === 'green'));
        }
        expect(screen.getByTestId('table-cell-color-current').getAttribute('data-token')).toBe('green');
    });

    it('reads the token off a header cell when the caret sits in a th', () => {
        const editor = makeMockEditor(inTable, (name) =>
            name === 'tableHeader' ? { backgroundColor: 'blue' } : {});
        openPicker(editor);

        expect(screen.getByTestId('table-cell-color-blue').getAttribute('aria-pressed')).toBe('true');
    });

    it('marks nothing pressed for an unfilled cell or an unknown token', () => {
        for (const attrs of [{}, { backgroundColor: 'chartreuse' }]) {
            const editor = makeMockEditor(inTable, () => attrs);
            const { unmount } = render(<NoteEditorToolbar editor={editor as never} />);
            fireEvent.mouseDown(screen.getByLabelText('Cell fill color'));

            for (const { token } of TABLE_CELL_COLORS) {
                expect(screen.getByTestId(`table-cell-color-${token}`).getAttribute('aria-pressed'))
                    .toBe('false');
            }
            expect(screen.getByTestId('table-cell-color-current').getAttribute('data-token')).toBe('');
            unmount();
        }
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

describe('NoteEditorToolbar — color dropdown', () => {
    it('renders the merged "A" color trigger instead of a standalone HL button', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Text and highlight color')).toBeDefined();
        expect(screen.queryByLabelText('Highlight')).toBeNull();
        expect(screen.queryByLabelText('Highlight colors')).toBeNull();
    });

    it('color panel is hidden by default', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('color-dropdown-panel')).toBeNull();
    });

    it('clicking the trigger shows both labelled sections', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        const panel = screen.getByTestId('color-dropdown-panel');
        expect(panel.textContent).toContain('Text Color');
        expect(panel.textContent).toContain('Highlight Color');
    });

    it('each section has 10 swatches plus its own reset row', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        const panel = screen.getByTestId('color-dropdown-panel');
        // (10 swatches + 1 reset) x 2 sections
        expect(panel.querySelectorAll('button').length).toBe(22);
        expect(screen.getByLabelText('Default text color')).toBeDefined();
        expect(screen.getByLabelText('Remove highlight')).toBeDefined();
    });

    it('clicking a text swatch calls setColor with that color', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        fireEvent.mouseDown(screen.getByLabelText('Text Blue'));
        expect(editor._focusResult.setColor).toHaveBeenCalledWith('#3b82f6');
    });

    it('clicking a highlight swatch calls setHighlight with that color', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        fireEvent.mouseDown(screen.getByLabelText('Highlight Pink'));
        expect(editor._focusResult.setHighlight).toHaveBeenCalledWith({ color: '#ffc8dd' });
    });

    it('keeps the original six highlight swatches so existing notes still match', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        for (const name of ['Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Purple']) {
            expect(screen.getByLabelText(`Highlight ${name}`)).toBeDefined();
        }
    });

    // Each reset must touch only its own mark — that is the whole point of two
    // sections sharing one panel.
    it('the text reset calls unsetColor and leaves the highlight alone', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        fireEvent.mouseDown(screen.getByLabelText('Default text color'));
        expect(editor._focusResult.unsetColor).toHaveBeenCalled();
        expect(editor._focusResult.unsetHighlight).not.toHaveBeenCalled();
    });

    it('the highlight reset calls unsetHighlight and leaves the text color alone', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        fireEvent.mouseDown(screen.getByLabelText('Remove highlight'));
        expect(editor._focusResult.unsetHighlight).toHaveBeenCalled();
        expect(editor._focusResult.unsetColor).not.toHaveBeenCalled();
    });

    it('the trigger bar reflects the selection\'s text color', () => {
        const editor = makeMockEditor(
            undefined,
            (name) => (name === 'textStyle' ? { color: 'rgb(59, 130, 246)' } : {}),
        );
        render(<NoteEditorToolbar editor={editor as never} />);
        // The browser reports the style back as `rgb(...)`; the trigger has to
        // canonicalize it or the active swatch never matches.
        expect(screen.getByTestId('color-dropdown-bar').getAttribute('style')).toContain('rgb(59, 130, 246)');
        fireEvent.mouseDown(screen.getByLabelText('Text and highlight color'));
        expect(screen.getByLabelText('Text Blue').getAttribute('aria-pressed')).toBe('true');
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

});

describe('NoteEditorToolbar — font family dropdown', () => {
    /** Reports a font stack on the textStyle mark, the way Tiptap does. */
    function fontEditor(fontFamily: string) {
        return makeMockEditor(undefined, (name) => (name === 'textStyle' ? { fontFamily } : {}));
    }

    it('renders the trigger reading "Default" with no font on the selection', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Font family')).toBeDefined();
        expect(screen.getByTestId('font-dropdown-label').textContent).toBe('Default');
    });

    it('the menu is hidden until the trigger is clicked', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('font-dropdown-menu')).toBeNull();
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        expect(screen.getByTestId('font-dropdown-menu')).toBeDefined();
    });

    it('lists exactly the six fonts, in order', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        const items = Array.from(
            screen.getByTestId('font-dropdown-menu').querySelectorAll('[role="menuitem"]'),
        // Last span is the label; the first is the ✓ column.
        ).map((el) => el.querySelector('span:last-child')?.textContent);
        expect(items).toEqual(['Default', 'Sans', 'Serif', 'Mono', 'Arial', 'Times']);
    });

    it('each font row previews itself by rendering its label in its own stack', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        const monoLabel = screen.getByTestId('font-item-mono').querySelector('span:last-child');
        expect(monoLabel?.getAttribute('style')).toContain('JetBrains Mono');
        // The reset row has no font of its own to preview.
        expect(screen.getByTestId('font-item-default').querySelector('span:last-child')?.getAttribute('style'))
            .toBeFalsy();
    });

    for (const { testId, stack } of [
        { testId: 'font-item-sans', stack: '-apple-system, "Segoe UI", Roboto, sans-serif' },
        { testId: 'font-item-serif', stack: 'Georgia, "Times New Roman", serif' },
        { testId: 'font-item-mono', stack: '"JetBrains Mono", Consolas, "SF Mono", Menlo, monospace' },
        { testId: 'font-item-arial', stack: 'Arial, Helvetica, sans-serif' },
        { testId: 'font-item-times', stack: '"Times New Roman", Times, serif' },
    ]) {
        it(`${testId} calls setFontFamily with its stack`, () => {
            const editor = makeMockEditor();
            render(<NoteEditorToolbar editor={editor as never} />);
            fireEvent.mouseDown(screen.getByLabelText('Font family'));
            fireEvent.mouseDown(screen.getByTestId(testId));
            expect(editor._focusResult.setFontFamily).toHaveBeenCalledWith(stack);
            expect(editor._focusResult.unsetFontFamily).not.toHaveBeenCalled();
        });
    }

    it('the Default row unsets the mark instead of setting a font', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        fireEvent.mouseDown(screen.getByTestId('font-item-default'));
        expect(editor._focusResult.unsetFontFamily).toHaveBeenCalled();
        expect(editor._focusResult.setFontFamily).not.toHaveBeenCalled();
    });

    it('picking a font closes the menu', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        fireEvent.mouseDown(screen.getByTestId('font-item-mono'));
        expect(screen.queryByTestId('font-dropdown-menu')).toBeNull();
    });

    it('the trigger names the selection\'s font and checkmarks its row', () => {
        const editor = fontEditor('"JetBrains Mono", Consolas, "SF Mono", Menlo, monospace');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-dropdown-label').textContent).toBe('Mono');
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        expect(screen.getByTestId('font-item-mono').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('font-item-default').getAttribute('aria-checked')).toBe('false');
    });

    it('matches the row even after the browser rewrites the stack\'s quoting', () => {
        // A real browser reports `element.style.fontFamily` back with its own
        // quote and spacing conventions; without normalization no row matches.
        const editor = fontEditor("'JetBrains Mono',Consolas,'SF Mono',Menlo,monospace");
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-dropdown-label').textContent).toBe('Mono');
    });

    it('falls back to Default for a foreign font without crashing', () => {
        const editor = fontEditor('Comic Sans MS, cursive');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-dropdown-label').textContent).toBe('Default');
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        expect(screen.getByTestId('font-item-default').getAttribute('aria-checked')).toBe('true');
    });

    it('closes on Escape', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font family'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('font-dropdown-menu')).toBeNull();
    });
});

describe('NoteEditorToolbar — font size dropdown', () => {
    /** Reports a font size on the textStyle mark, the way Tiptap does. */
    function sizeEditor(fontSize: string) {
        return makeMockEditor(undefined, (name) => (name === 'textStyle' ? { fontSize } : {}));
    }

    /** The label text of each row in the open menu, in render order. */
    function menuLabels() {
        return Array.from(
            screen.getByTestId('font-size-dropdown-menu').querySelectorAll('[role="menuitem"]'),
        // Last span is the label; the first is the ✓ column.
        ).map((el) => el.querySelector('span:last-child')?.textContent);
    }

    it('renders the trigger reading "Default" with no size on the selection', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByLabelText('Font size')).toBeDefined();
        expect(screen.getByTestId('font-size-dropdown-label').textContent).toBe('Default');
    });

    it('the menu is hidden until the trigger is clicked', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.queryByTestId('font-size-dropdown-menu')).toBeNull();
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        expect(screen.getByTestId('font-size-dropdown-menu')).toBeDefined();
    });

    it('lists all fourteen sizes, in order', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        expect(menuLabels()).toEqual([
            'Default', '8', '9', '10', '11', '12', '14', '16', '18', '24', '30', '36', '48', '60',
        ]);
    });

    for (const px of [8, 12, 24, 60]) {
        it(`the ${px} row calls setFontSize with ${px}px`, () => {
            const editor = makeMockEditor();
            render(<NoteEditorToolbar editor={editor as never} />);
            fireEvent.mouseDown(screen.getByLabelText('Font size'));
            fireEvent.mouseDown(screen.getByTestId(`font-size-item-${px}`));
            expect(editor._focusResult.setFontSize).toHaveBeenCalledWith(`${px}px`);
            expect(editor._focusResult.unsetFontSize).not.toHaveBeenCalled();
        });
    }

    it('the Default row unsets the mark instead of setting a size', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        fireEvent.mouseDown(screen.getByTestId('font-size-item-default'));
        expect(editor._focusResult.unsetFontSize).toHaveBeenCalled();
        expect(editor._focusResult.setFontSize).not.toHaveBeenCalled();
    });

    it('picking a size closes the menu', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        fireEvent.mouseDown(screen.getByTestId('font-size-item-24'));
        expect(screen.queryByTestId('font-size-dropdown-menu')).toBeNull();
    });

    it('the trigger shows the selection\'s size and checkmarks its row', () => {
        const editor = sizeEditor('24px');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-size-dropdown-label').textContent).toBe('24');
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        expect(screen.getByTestId('font-size-item-24').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('font-size-item-default').getAttribute('aria-checked')).toBe('false');
    });

    it('matches the row even after the browser rewrites the length', () => {
        // A real browser reports `element.style.fontSize` back in its own
        // spelling; without normalization no row would match.
        const editor = sizeEditor('24.0px');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-size-dropdown-label').textContent).toBe('24');
    });

    it('falls back to Default for an off-ladder size without crashing', () => {
        const editor = sizeEditor('13px');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('font-size-dropdown-label').textContent).toBe('Default');
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        expect(screen.getByTestId('font-size-item-default').getAttribute('aria-checked')).toBe('true');
    });

    it('closes on Escape', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Font size'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('font-size-dropdown-menu')).toBeNull();
    });

    it('sits immediately to the left of Bold in the toolbar', () => {
        const editor = makeMockEditor();
        const { container } = render(<NoteEditorToolbar editor={editor as never} />);
        const trigger = screen.getByTestId('font-size-dropdown');
        const bold = screen.getByLabelText('Bold');
        // compareDocumentPosition: FOLLOWING means bold comes after the trigger.
        expect(trigger.compareDocumentPosition(bold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // …and nothing else renders between them.
        const controls = Array.from(container.querySelectorAll('button'));
        expect(controls.indexOf(bold) - controls.indexOf(trigger)).toBe(1);
    });
});

// ── Heading & list dropdowns ────────────────────────────────────────────────

/** Marks one heading level active, the way TipTap's isActive('heading', {level}) does. */
function headingEditor(level: number) {
    return makeMockEditor((name, attrs) => name === 'heading' && (attrs?.level === level || attrs === undefined));
}

describe('NoteEditorToolbar — heading dropdown', () => {
    it('replaces the flat H1/H2/H3 buttons with a single trigger', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('heading-dropdown')).toBeDefined();
        expect(screen.queryByLabelText('Heading 1')).toBeNull();
        expect(screen.queryByLabelText('Heading 2')).toBeNull();
        expect(screen.queryByLabelText('Heading 3')).toBeNull();
    });

    it('trigger reads "H" in a paragraph and opens the menu on click', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const trigger = screen.getByTestId('heading-dropdown');
        expect(screen.getByTestId('heading-dropdown-label').textContent).toBe('H');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');

        fireEvent.mouseDown(trigger);
        const menu = screen.getByTestId('heading-dropdown-menu');
        expect(menu.getAttribute('role')).toBe('menu');
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('heading-item-paragraph')).toBeDefined();
        for (const level of [1, 2, 3, 4, 5, 6]) {
            const item = screen.getByTestId(`heading-item-${level}`);
            expect(item.getAttribute('role')).toBe('menuitem');
            expect(item.textContent).toContain(`Heading ${level}`);
        }
    });

    it('trigger reads the active heading level and marks it in the menu', () => {
        const editor = headingEditor(2);
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('heading-dropdown-label').textContent).toBe('H2');

        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        expect(screen.getByTestId('heading-item-2').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('heading-item-1').getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId('heading-item-paragraph').getAttribute('aria-checked')).toBe('false');
    });

    it('marks Paragraph active when no heading is active', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        expect(screen.getByTestId('heading-item-paragraph').getAttribute('aria-checked')).toBe('true');
    });

    it('selecting a level runs toggleHeading with that level and closes the menu', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        fireEvent.mouseDown(screen.getByTestId('heading-item-4'));

        expect(editor._focusResult.toggleHeading).toHaveBeenCalledWith({ level: 4 });
        expect(editor._focusResult.toggleHeading).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('heading-dropdown-menu')).toBeNull();
    });

    it('selecting Paragraph runs setParagraph', () => {
        const editor = headingEditor(3);
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        fireEvent.mouseDown(screen.getByTestId('heading-item-paragraph'));

        expect(editor._focusResult.setParagraph).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('heading-dropdown-menu')).toBeNull();
    });

    it('activates an item with Enter and with Space', () => {
        for (const key of ['Enter', ' ']) {
            const editor = makeMockEditor();
            const { unmount } = render(<NoteEditorToolbar editor={editor as never} />);
            fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
            fireEvent.keyDown(screen.getByTestId('heading-item-1'), { key });
            expect(editor._focusResult.toggleHeading).toHaveBeenCalledWith({ level: 1 });
            unmount();
        }
    });

    it('ArrowDown / ArrowUp move focus between menu items', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        // Focus opens on the checked item — Paragraph.
        expect(document.activeElement).toBe(screen.getByTestId('heading-item-paragraph'));

        const menu = screen.getByTestId('heading-dropdown-menu');
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
        expect(document.activeElement).toBe(screen.getByTestId('heading-item-1'));
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
        expect(document.activeElement).toBe(screen.getByTestId('heading-item-paragraph'));
    });

    it('Escape closes the menu and returns focus to the trigger', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('heading-dropdown-menu')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('heading-dropdown'));
    });

    it('an outside click closes the menu', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('heading-dropdown'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('heading-dropdown-menu')).toBeNull();
    });
});

describe('NoteEditorToolbar — list dropdown', () => {
    it('replaces the flat list buttons with a single trigger', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('list-dropdown')).toBeDefined();
        expect(screen.queryByLabelText('Bullet list')).toBeNull();
        expect(screen.queryByLabelText('Ordered list')).toBeNull();
        expect(screen.queryByLabelText('Task list')).toBeNull();
    });

    it('opens a menu with the three list types', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const trigger = screen.getByTestId('list-dropdown');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

        fireEvent.mouseDown(trigger);
        expect(screen.getByTestId('list-dropdown-menu').getAttribute('role')).toBe('menu');
        expect(screen.getByTestId('list-item-bullet').textContent).toContain('Bullet List');
        expect(screen.getByTestId('list-item-ordered').textContent).toContain('Ordered List');
        expect(screen.getByTestId('list-item-task').textContent).toContain('Task List');
    });

    it.each([
        ['list-item-bullet', 'toggleBulletList'],
        ['list-item-ordered', 'toggleOrderedList'],
        ['list-item-task', 'toggleTaskList'],
    ])('%s runs %s and closes the menu', (testId, command) => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('list-dropdown'));
        fireEvent.mouseDown(screen.getByTestId(testId));

        expect((editor._focusResult as Record<string, ReturnType<typeof vi.fn>>)[command])
            .toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('list-dropdown-menu')).toBeNull();
    });

    it('shows the trigger active and marks the active list type', () => {
        const editor = makeMockEditor((name) => name === 'taskList');
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('list-dropdown').className).toContain('bg-[#e8e8e8]');

        fireEvent.mouseDown(screen.getByTestId('list-dropdown'));
        expect(screen.getByTestId('list-item-task').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('list-item-bullet').getAttribute('aria-checked')).toBe('false');
    });

    it('Escape closes the menu and an outside click closes it too', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('list-dropdown'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('list-dropdown-menu')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('list-dropdown'));

        fireEvent.mouseDown(screen.getByTestId('list-dropdown'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('list-dropdown-menu')).toBeNull();
    });
});

describe('NoteEditorToolbar — alignment dropdown', () => {
    /**
     * `activeAlignOption` calls `editor.isActive({ textAlign })` with the
     * attributes alone, so the override reads its first argument as an object.
     */
    const alignedTo = (current: string) =>
        ((name: string) => (name as unknown as { textAlign?: string })?.textAlign === current) as
            (name: string, attrs?: Record<string, unknown>) => boolean;

    it('replaces the four flat alignment buttons with a single trigger', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('align-dropdown')).toBeDefined();
        for (const label of ['Align left', 'Align center', 'Align right', 'Justify']) {
            expect(screen.queryByLabelText(label)).toBeNull();
        }
    });

    it('opens a menu with the four alignments', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const trigger = screen.getByTestId('align-dropdown');
        expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
        expect(trigger.getAttribute('aria-label')).toBe('Text alignment');

        fireEvent.mouseDown(trigger);
        const menu = screen.getByTestId('align-dropdown-menu');
        expect(menu.getAttribute('role')).toBe('menu');
        expect(menu.getAttribute('aria-label')).toBe('Text alignment');
        expect(screen.getByTestId('align-item-left').textContent).toContain('Align left');
        expect(screen.getByTestId('align-item-center').textContent).toContain('Align center');
        expect(screen.getByTestId('align-item-right').textContent).toContain('Align right');
        expect(screen.getByTestId('align-item-justify').textContent).toContain('Justify');
    });

    it.each([
        ['align-item-left', 'left'],
        ['align-item-center', 'center'],
        ['align-item-right', 'right'],
        ['align-item-justify', 'justify'],
    ])('%s runs setTextAlign("%s") and closes the menu', (testId, value) => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('align-dropdown'));
        fireEvent.mouseDown(screen.getByTestId(testId));

        expect(editor._focusResult.setTextAlign).toHaveBeenCalledTimes(1);
        expect(editor._focusResult.setTextAlign).toHaveBeenCalledWith(value);
        expect(screen.queryByTestId('align-dropdown-menu')).toBeNull();
    });

    it('shows the left-align icon and no highlight when nothing is aligned', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('align-dropdown-label').textContent).toBe('⫷');
        expect(screen.getByTestId('align-dropdown').className).not.toContain('bg-[#e8e8e8]');
    });

    it.each([
        ['center', '≡', 'align-item-center'],
        ['right', '⫸', 'align-item-right'],
        ['justify', '☰', 'align-item-justify'],
    ])('reflects %s alignment in the trigger and the checked row', (value, icon, testId) => {
        const editor = makeMockEditor(alignedTo(value));
        render(<NoteEditorToolbar editor={editor as never} />);
        expect(screen.getByTestId('align-dropdown-label').textContent).toBe(icon);
        expect(screen.getByTestId('align-dropdown').className).toContain('bg-[#e8e8e8]');

        fireEvent.mouseDown(screen.getByTestId('align-dropdown'));
        expect(screen.getByTestId(testId).getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('align-item-left').getAttribute('aria-checked')).toBe('false');
        // Focus lands on the checked row when the menu opens.
        expect(document.activeElement).toBe(screen.getByTestId(testId));
    });

    it('Escape closes the menu and an outside click closes it too', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByTestId('align-dropdown'));
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('align-dropdown-menu')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('align-dropdown'));

        fireEvent.mouseDown(screen.getByTestId('align-dropdown'));
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('align-dropdown-menu')).toBeNull();
    });
});

// ── Find & replace ──────────────────────────────────────────────────────────

/**
 * The base mock editor has no find-and-replace storage or commands — the panel
 * tolerates that (it renders empty state), but asserting on wiring needs both.
 */
function makeFindMockEditor(overrides: Partial<Record<string, unknown>> = {}) {
    const base = makeMockEditor();
    const commands = {
        setSearchTerm: vi.fn(),
        setReplaceTerm: vi.fn(),
        setCaseSensitive: vi.fn(),
        setWholeWord: vi.fn(),
        setUseRegex: vi.fn(),
        replace: vi.fn(),
        replaceAll: vi.fn(),
        goToNextResult: vi.fn(),
        goToPreviousResult: vi.fn(),
        clearSearch: vi.fn(),
    };
    return {
        ...base,
        commands,
        on: vi.fn(),
        off: vi.fn(),
        state: { selection: { empty: true } },
        storage: {
            findAndReplace: {
                searchTerm: '',
                replaceTerm: '',
                caseSensitive: false,
                useRegex: false,
                wholeWord: false,
                results: [],
                currentIndex: null,
                ...(overrides.findAndReplace as object ?? {}),
            },
        },
        _commands: commands,
    };
}

describe('NoteEditorToolbar — find & replace', () => {
    it('renders the find button in the formatting group', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.getByLabelText('Find and replace')).toBeDefined();
    });

    it('the panel is closed until the find button is pressed', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        expect(screen.queryByTestId('find-replace-panel')).toBeNull();

        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        expect(screen.getByTestId('find-replace-panel')).toBeDefined();
        expect(screen.getByTestId('find-input')).toBeDefined();
        expect(screen.getByTestId('replace-input')).toBeDefined();
    });

    it('the find button toggles the panel back closed and clears the search', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        const btn = screen.getByLabelText('Find and replace');

        fireEvent.mouseDown(btn);
        fireEvent.mouseDown(btn);

        expect(screen.queryByTestId('find-replace-panel')).toBeNull();
        // Stale match outlines must not survive the panel closing.
        expect(editor._commands.clearSearch).toHaveBeenCalled();
    });

    it('the close button clears the search and hides the panel', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.mouseDown(screen.getByTestId('find-close-btn'));

        expect(screen.queryByTestId('find-replace-panel')).toBeNull();
        expect(editor._commands.clearSearch).toHaveBeenCalled();
    });

    it('typing in the find input pushes the term to the editor', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.change(screen.getByTestId('find-input'), { target: { value: 'alpha' } });

        expect(editor._commands.setSearchTerm).toHaveBeenCalledWith('alpha');
    });

    it('typing in the replace input pushes the replacement to the editor', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.change(screen.getByTestId('replace-input'), { target: { value: 'omega' } });

        expect(editor._commands.setReplaceTerm).toHaveBeenCalledWith('omega');
    });

    it('shows the 1-based match position out of the total', () => {
        const editor = makeFindMockEditor({
            findAndReplace: {
                searchTerm: 'alpha',
                results: [{ from: 1, to: 6 }, { from: 10, to: 15 }, { from: 20, to: 25 }],
                currentIndex: 1,
            },
        });
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        expect(screen.getByTestId('find-match-count').textContent).toBe('2 / 3');
    });

    it('reports no results for a term that matches nothing', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));
        fireEvent.change(screen.getByTestId('find-input'), { target: { value: 'zzz' } });

        expect(screen.getByTestId('find-match-count').textContent).toBe('No results');
    });

    it('navigation and replace buttons are disabled while there are no matches', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        for (const id of ['find-prev-btn', 'find-next-btn', 'replace-btn', 'replace-all-btn']) {
            expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true);
        }
    });

    it('next / previous drive the editor when matches exist', () => {
        const editor = makeFindMockEditor({
            findAndReplace: { searchTerm: 'a', results: [{ from: 1, to: 2 }], currentIndex: 0 },
        });
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.mouseDown(screen.getByTestId('find-next-btn'));
        fireEvent.mouseDown(screen.getByTestId('find-prev-btn'));

        expect(editor._commands.goToNextResult).toHaveBeenCalled();
        expect(editor._commands.goToPreviousResult).toHaveBeenCalled();
    });

    it('Enter jumps to the next match and Shift+Enter to the previous one', () => {
        const editor = makeFindMockEditor({
            findAndReplace: { searchTerm: 'a', results: [{ from: 1, to: 2 }], currentIndex: 0 },
        });
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));
        const input = screen.getByTestId('find-input');

        fireEvent.keyDown(input, { key: 'Enter' });
        expect(editor._commands.goToNextResult).toHaveBeenCalled();

        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(editor._commands.goToPreviousResult).toHaveBeenCalled();
    });

    it('Escape in the find input closes the panel', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.keyDown(screen.getByTestId('find-input'), { key: 'Escape' });

        expect(screen.queryByTestId('find-replace-panel')).toBeNull();
        expect(editor._commands.clearSearch).toHaveBeenCalled();
    });

    it('replace and replace-all drive the editor when matches exist', () => {
        const editor = makeFindMockEditor({
            findAndReplace: { searchTerm: 'a', results: [{ from: 1, to: 2 }], currentIndex: 0 },
        });
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.mouseDown(screen.getByTestId('replace-btn'));
        fireEvent.mouseDown(screen.getByTestId('replace-all-btn'));

        expect(editor._commands.replace).toHaveBeenCalled();
        expect(editor._commands.replaceAll).toHaveBeenCalled();
    });

    it('the modifier toggles drive case, whole-word and regex', () => {
        const editor = makeFindMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        fireEvent.mouseDown(screen.getByTestId('find-case-toggle'));
        fireEvent.mouseDown(screen.getByTestId('find-whole-word-toggle'));
        fireEvent.mouseDown(screen.getByTestId('find-regex-toggle'));

        expect(editor._commands.setCaseSensitive).toHaveBeenCalledWith(true);
        expect(editor._commands.setWholeWord).toHaveBeenCalledWith(true);
        expect(editor._commands.setUseRegex).toHaveBeenCalledWith(true);
    });

    it('whole-word is disabled in regex mode, where the extension ignores it', () => {
        const editor = makeFindMockEditor({ findAndReplace: { useRegex: true } });
        render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        const wholeWord = screen.getByTestId('find-whole-word-toggle') as HTMLButtonElement;
        expect(wholeWord.disabled).toBe(true);

        fireEvent.mouseDown(wholeWord);
        expect(editor._commands.setWholeWord).not.toHaveBeenCalled();
    });

    it('seeds the find input from a non-empty selection', () => {
        const editor = makeFindMockEditor();
        editor.state = {
            selection: { empty: false, from: 1, to: 6 },
            doc: { textBetween: () => 'alpha' },
        } as never;
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        expect((screen.getByTestId('find-input') as HTMLInputElement).value).toBe('alpha');
        expect(editor._commands.setSearchTerm).toHaveBeenCalledWith('alpha');
    });

    it('hides the find button and the panel in source mode', () => {
        // Source mode mounts a separate raw-markdown editor the extension does
        // not reach, so the control must not read as available-but-broken.
        const editor = makeFindMockEditor();
        const { rerender } = render(<NoteEditorToolbar editor={editor as never} />);
        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));
        expect(screen.getByTestId('find-replace-panel')).toBeDefined();

        rerender(<NoteEditorToolbar editor={editor as never} hidden />);

        expect(screen.queryByLabelText('Find and replace')).toBeNull();
        expect(screen.queryByTestId('find-replace-panel')).toBeNull();
        // Switching modes must also drop the highlights from the rich editor.
        expect(editor._commands.clearSearch).toHaveBeenCalled();
    });

    it('renders without crashing on an editor that lacks the extension', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Find and replace'));

        expect(screen.getByTestId('find-replace-panel')).toBeDefined();
        expect(screen.getByTestId('find-match-count').textContent).toBe('');
    });
});

// ── Shared dropdown primitive ───────────────────────────────────────────────

/**
 * Every toolbar dropdown routes through one `ToolbarDropdown` primitive, so
 * dismissal behaviour is asserted once per consumer rather than per panel
 * feature. Regression guard for the refactor that removed the hand-rolled
 * outside-click/Escape listeners from HighlightButton and TableInsertButton.
 */
describe('NoteEditorToolbar — shared dropdown behaviour', () => {
    const dropdowns = [
        { trigger: 'Text and highlight color', panel: 'color-dropdown-panel' },
        { trigger: 'Insert table', panel: 'table-size-picker' },
    ];

    for (const { trigger, panel } of dropdowns) {
        describe(trigger, () => {
            it('reflects open state in aria-expanded', () => {
                const editor = makeMockEditor();
                render(<NoteEditorToolbar editor={editor as never} />);
                const btn = screen.getByLabelText(trigger);

                expect(btn.getAttribute('aria-haspopup')).toBe('true');
                expect(btn.getAttribute('aria-expanded')).toBe('false');

                fireEvent.mouseDown(btn);
                expect(btn.getAttribute('aria-expanded')).toBe('true');
            });

            it('closes when the trigger is clicked again', () => {
                const editor = makeMockEditor();
                render(<NoteEditorToolbar editor={editor as never} />);

                fireEvent.mouseDown(screen.getByLabelText(trigger));
                expect(screen.getByTestId(panel)).toBeDefined();

                fireEvent.mouseDown(screen.getByLabelText(trigger));
                expect(screen.queryByTestId(panel)).toBeNull();
            });

            it('closes on Escape', () => {
                const editor = makeMockEditor();
                render(<NoteEditorToolbar editor={editor as never} />);

                fireEvent.mouseDown(screen.getByLabelText(trigger));
                expect(screen.getByTestId(panel)).toBeDefined();

                fireEvent.keyDown(document, { key: 'Escape' });
                expect(screen.queryByTestId(panel)).toBeNull();
            });

            it('closes on an outside mousedown', () => {
                const editor = makeMockEditor();
                render(<NoteEditorToolbar editor={editor as never} />);

                fireEvent.mouseDown(screen.getByLabelText(trigger));
                expect(screen.getByTestId(panel)).toBeDefined();

                fireEvent.mouseDown(document.body);
                expect(screen.queryByTestId(panel)).toBeNull();
            });

            it('stays open when the mousedown lands inside the panel', () => {
                const editor = makeMockEditor();
                render(<NoteEditorToolbar editor={editor as never} />);

                fireEvent.mouseDown(screen.getByLabelText(trigger));
                fireEvent.mouseDown(screen.getByTestId(panel));

                expect(screen.getByTestId(panel)).toBeDefined();
            });
        });
    }

    it('clears the table hover extent when the picker is reopened', () => {
        const editor = makeMockEditor();
        render(<NoteEditorToolbar editor={editor as never} />);

        fireEvent.mouseDown(screen.getByLabelText('Insert table'));
        fireEvent.mouseEnter(screen.getByTestId('table-size-cell-3-2'));
        expect(screen.getByTestId('table-size-label').textContent).toBe('3 × 2');

        fireEvent.keyDown(document, { key: 'Escape' });
        fireEvent.mouseDown(screen.getByLabelText('Insert table'));

        expect(screen.getByTestId('table-size-label').textContent).toBe('Insert table');
    });
});
