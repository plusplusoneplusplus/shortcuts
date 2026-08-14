import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ToolbarDropdown, Sep } from './ToolbarDropdown';
import { activeTableHasColumnWidths, clearActiveTableColumnWidths } from '../tableColumnWidths';
import { tableHeaderState } from '../tableHeaderState';
import { TABLE_CELL_COLORS, activeCellBackgroundColor } from '../extensions/tableCellBackground';
import { activeColumnWrap, toggleActiveColumnWrap } from '../extensions/tableColumnWrap';

// ── Table insert button with hover size picker ──────────────────────────────

/** Fixed picker size — hovering never grows the grid past this. */
export const TABLE_PICKER_COLS = 10;
export const TABLE_PICKER_ROWS = 8;

export function TableInsertButton({ editor }: { editor: Editor }) {
    const [hover, setHover] = useState<{ col: number; row: number } | null>(null);

    return (
        <ToolbarDropdown
            panelTestId="table-size-picker"
            // A reopened picker must not still show the previous hover extent.
            onClose={() => setHover(null)}
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Insert table"
                    aria-label="Insert table"
                    aria-haspopup="true"
                    aria-expanded={open}
                    className={
                        'h-7 w-7 rounded flex items-center justify-center text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050] ' +
                        (open ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c]' : '')
                    }
                    onMouseDown={(e) => {
                        e.preventDefault(); // keep editor focus
                        toggle();
                    }}
                >
                    ⊞
                </button>
            )}
            renderPanel={({ close }) => (
                <div onMouseLeave={() => setHover(null)}>
                    <div className="flex flex-col gap-0.5">
                        {Array.from({ length: TABLE_PICKER_ROWS }, (_, ri) => ri + 1).map((row) => (
                            <div key={row} className="flex gap-0.5">
                                {Array.from({ length: TABLE_PICKER_COLS }, (_, ci) => ci + 1).map((col) => {
                                    const selected = hover !== null && col <= hover.col && row <= hover.row;
                                    return (
                                        <button
                                            key={col}
                                            type="button"
                                            aria-label={`${col} × ${row} table`}
                                            data-testid={`table-size-cell-${col}-${row}`}
                                            data-selected={selected ? 'true' : 'false'}
                                            className={
                                                'w-4 h-4 rounded-sm border ' +
                                                (selected
                                                    ? 'border-[#0078d4] bg-[#cce4f7] dark:bg-[#0e639c]'
                                                    : 'border-[#ccc] dark:border-[#555]')
                                            }
                                            onMouseEnter={() => setHover({ col, row })}
                                            onMouseDown={(e) => {
                                                e.preventDefault(); // keep editor focus
                                                editor.chain().focus()
                                                    .insertTable({ rows: row, cols: col, withHeaderRow: true })
                                                    .run();
                                                close();
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                    <div
                        className="mt-1 text-center text-[10px] text-[#666] dark:text-[#999]"
                        data-testid="table-size-label"
                    >
                        {hover ? `${hover.col} × ${hover.row}` : 'Insert table'}
                    </div>
                </div>
            )}
        />
    );
}

// ── Table contextual controls ───────────────────────────────────────────────

const TABLE_BTN_CLS = 'h-7 px-1.5 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]';
const SWATCH_CLS = 'w-6 h-6 rounded-sm border hover:scale-110 transition-transform';

export type TableMoveCommand =
    | 'moveTableRowUp'
    | 'moveTableRowDown'
    | 'moveTableColumnLeft'
    | 'moveTableColumnRight';

export interface TableToolbarState {
    /** Whether the caret is inside a table at all — the strip renders only then. */
    inTable: boolean;
    /** Whether the active table carries explicit column widths to reset. */
    hasWidths: boolean;
    /** Whether the table has a header row / header column. */
    headers: { row: boolean; column: boolean };
    /** Whether the active column is set to not wrap. */
    noWrap: boolean;
    /** Which move commands are legal right now. */
    canMove: Record<TableMoveCommand, boolean>;
}

/**
 * Everything the table strip needs to read off the editor.
 *
 * Deliberately not memoised: it is recomputed on every toolbar render, which a
 * selection or doc change already triggers — so the buttons follow the caret
 * from cell to cell and enable the moment a border is dragged.
 *
 * Header-ness and wrap mode are structural, so they are read off the doc rather
 * than from `isActive`. The move commands report their own legality — boundaries,
 * the pinned header row, merged cells, multi-row selections — so their button
 * state is just `can()`. Optional chaining keeps the strip alive against an
 * editor built without the TableReorder extension: the moves read as unavailable
 * rather than throwing out of the whole toolbar.
 */
export function useTableToolbarState(editor: Editor): TableToolbarState {
    const inTable = editor.isActive('table');
    const can = (command: TableMoveCommand) => editor.can?.()?.[command]?.() === true;
    return {
        inTable,
        hasWidths: inTable && activeTableHasColumnWidths(editor),
        headers: inTable ? tableHeaderState(editor) : { row: false, column: false },
        noWrap: inTable && activeColumnWrap(editor) === 'nowrap',
        canMove: {
            moveTableColumnLeft: inTable && can('moveTableColumnLeft'),
            moveTableColumnRight: inTable && can('moveTableColumnRight'),
            moveTableRowUp: inTable && can('moveTableRowUp'),
            moveTableRowDown: inTable && can('moveTableRowDown'),
        },
    };
}

/**
 * Cell fill picker for the table strip.
 *
 * `setCellAttribute` walks a `CellSelection` and falls back to the cell holding
 * the caret, so one call covers a single cell, a whole row, a whole column and
 * an arbitrary rectangle — which is why there are no separate "fill row" /
 * "fill column" buttons. Unlike the highlight button the trigger is not a split
 * button: there is no sensible default fill to toggle, so clicking it only
 * opens the panel.
 */
function TableCellColorButton({ editor }: { editor: Editor }) {
    const activeToken = activeCellBackgroundColor(editor);
    const activeSwatch = TABLE_CELL_COLORS.find((c) => c.token === activeToken);

    const apply = (token: string | null, close: () => void) => {
        editor.chain().focus().setCellAttribute('backgroundColor', token).run();
        close();
    };

    return (
        <ToolbarDropdown
            panelTestId="table-cell-color-picker"
            panelClassName="flex gap-1 p-1.5"
            renderTrigger={({ open, toggle, triggerRef }) => (
                <button
                    ref={triggerRef}
                    type="button"
                    title="Cell fill color"
                    aria-label="Cell fill color"
                    aria-haspopup="true"
                    aria-expanded={open}
                    className={TABLE_BTN_CLS + ' inline-flex items-center gap-1'}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        toggle();
                    }}
                >
                    <span
                        data-testid="table-cell-color-current"
                        data-token={activeToken ?? ''}
                        className="inline-block w-3 h-3 rounded-sm border border-[#ccc] dark:border-[#555]"
                        style={activeSwatch ? { backgroundColor: activeSwatch.swatch } : undefined}
                    />
                    Fill
                </button>
            )}
            renderPanel={({ close }) => (
                <>
                    {TABLE_CELL_COLORS.map(({ token, name, swatch }) => (
                        <button
                            key={token}
                            type="button"
                            title={`Fill ${name}`}
                            aria-label={`Fill ${name}`}
                            aria-pressed={activeToken === token}
                            data-testid={`table-cell-color-${token}`}
                            className={
                                SWATCH_CLS + ' '
                                + (activeToken === token
                                    ? 'border-[#0078d4] ring-1 ring-[#0078d4]'
                                    : 'border-[#ccc] dark:border-[#555]')
                            }
                            style={{ backgroundColor: swatch }}
                            onMouseDown={(e) => {
                                e.preventDefault();
                                apply(token, close);
                            }}
                        />
                    ))}
                    {/* Clearing sets the attribute to null, which drops the inline
                        style — so a header cell falls back to the default grey. */}
                    <button
                        type="button"
                        title="Clear cell fill"
                        aria-label="Clear cell fill"
                        data-testid="table-cell-color-clear"
                        className={SWATCH_CLS + ' border-[#ccc] dark:border-[#555] flex items-center justify-center text-xs text-[#888]'}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            apply(null, close);
                        }}
                    >
                        ✕
                    </button>
                </>
            )}
        />
    );
}

/**
 * The contextual table strip, rendered as a secondary toolbar row while the
 * caret sits inside a table.
 */
export function TableToolbarControls({ editor }: { editor: Editor }) {
    const { inTable, hasWidths, headers, noWrap, canMove } = useTableToolbarState(editor);
    if (!inTable) return null;

    const tc = () => editor.chain().focus();
    const btnCls = TABLE_BTN_CLS;
    const pressedCls = ' bg-[#e8e8e8] dark:bg-[#3c3c3c]';
    const disabledCls = ' disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';

    return (
        <div
            className="flex items-center gap-0.5 px-2 py-0.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#2a2a2a] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
            data-testid="table-controls-row"
        >
            {/* Column operations */}
            <button type="button" title="Add column before" aria-label="Add column before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnBefore().run(); }}>
                Add Col ←
            </button>
            <button type="button" title="Add column after" aria-label="Add column after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addColumnAfter().run(); }}>
                Add Col →
            </button>
            <button type="button" title="Delete column" aria-label="Delete column"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteColumn().run(); }}>
                Del Col
            </button>
            {/* Pressed means "this column does not wrap" — the non-default
                state, matching how the header toggles read. */}
            <button type="button" title="Toggle column text wrapping" aria-label="Toggle column text wrapping"
                aria-pressed={noWrap}
                data-testid="table-wrap-toggle"
                className={btnCls + (noWrap ? pressedCls : '')}
                onMouseDown={(e) => { e.preventDefault(); toggleActiveColumnWrap(editor); }}>
                Wrap
            </button>
            {/* Move one position, not a drag: the column holding the caret
                swaps with its neighbour, and the moved column stays selected so
                repeat clicks keep walking it along. Appended after the wrap
                toggle so the existing column buttons keep their positions. */}
            <button type="button" title="Move column left" aria-label="Move column left"
                disabled={!canMove.moveTableColumnLeft}
                aria-disabled={!canMove.moveTableColumnLeft}
                className={btnCls + disabledCls}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!canMove.moveTableColumnLeft) return;
                    tc().moveTableColumnLeft().run();
                }}>
                Move Col ←
            </button>
            <button type="button" title="Move column right" aria-label="Move column right"
                disabled={!canMove.moveTableColumnRight}
                aria-disabled={!canMove.moveTableColumnRight}
                className={btnCls + disabledCls}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!canMove.moveTableColumnRight) return;
                    tc().moveTableColumnRight().run();
                }}>
                Move Col →
            </button>
            <Sep />
            {/* Row operations */}
            <button type="button" title="Add row before" aria-label="Add row before"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowBefore().run(); }}>
                Add Row ↑
            </button>
            <button type="button" title="Add row after" aria-label="Add row after"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().addRowAfter().run(); }}>
                Add Row ↓
            </button>
            <button type="button" title="Delete row" aria-label="Delete row"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteRow().run(); }}>
                Del Row
            </button>
            {/* The header row is pinned at index 0 — a header row anywhere else
                puts the GFM `| --- |` separator in the wrong place and stops the
                note round-tripping — so the extension disables both directions
                around it. */}
            <button type="button" title="Move row up" aria-label="Move row up"
                disabled={!canMove.moveTableRowUp}
                aria-disabled={!canMove.moveTableRowUp}
                className={btnCls + disabledCls}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!canMove.moveTableRowUp) return;
                    tc().moveTableRowUp().run();
                }}>
                Move Row ↑
            </button>
            <button type="button" title="Move row down" aria-label="Move row down"
                disabled={!canMove.moveTableRowDown}
                aria-disabled={!canMove.moveTableRowDown}
                className={btnCls + disabledCls}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!canMove.moveTableRowDown) return;
                    tc().moveTableRowDown().run();
                }}>
                Move Row ↓
            </button>
            <Sep />
            {/* Cell fill — applies across whatever the current cell selection is */}
            <TableCellColorButton editor={editor} />
            <Sep />
            {/* Table-level */}
            <button type="button" title="Reset column widths" aria-label="Reset column widths"
                disabled={!hasWidths}
                className={btnCls + ' disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent'}
                onMouseDown={(e) => {
                    e.preventDefault();
                    if (!hasWidths) return;
                    clearActiveTableColumnWidths(editor);
                }}>
                Reset Widths
            </button>
            <button type="button" title="Delete table" aria-label="Delete table"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().deleteTable().run(); }}>
                Del Table
            </button>
            <Sep />
            {/* Header shape — appended last so the buttons above keep their
                positions. Anything other than a plain header row makes the table
                serialize as raw HTML instead of a GFM pipe table. */}
            <button type="button" title="Toggle header row" aria-label="Toggle header row"
                aria-pressed={headers.row}
                className={btnCls + (headers.row ? pressedCls : '')}
                onMouseDown={(e) => { e.preventDefault(); tc().toggleHeaderRow().run(); }}>
                Header Row
            </button>
            <button type="button" title="Toggle header column" aria-label="Toggle header column"
                aria-pressed={headers.column}
                className={btnCls + (headers.column ? pressedCls : '')}
                onMouseDown={(e) => { e.preventDefault(); tc().toggleHeaderColumn().run(); }}>
                Header Col
            </button>
            {/* No pressed state: the selection can span cells in mixed states, so
                there is no single bit to show. */}
            <button type="button" title="Toggle header cell" aria-label="Toggle header cell"
                className={btnCls}
                onMouseDown={(e) => { e.preventDefault(); tc().toggleHeaderCell().run(); }}>
                Header Cell
            </button>
        </div>
    );
}
