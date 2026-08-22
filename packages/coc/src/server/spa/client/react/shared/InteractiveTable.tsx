/**
 * InteractiveTable — TanStack Table v8 wrapper for sorted, filtered,
 * paginated tables with numeric column aggregation.
 *
 * Rendered via portal into the DOM position of the original static
 * `<table>` produced by forge's `renderTable()`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    flexRender,
    type ColumnDef,
    type SortingState,
    type ColumnFiltersState,
    type ColumnSizingState,
    type VisibilityState,
} from '@tanstack/react-table';
import type { ColumnAlignment, ExtractedTableData } from './extractTablesFromHtml';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Rows above which pagination kicks in. */
const PAGINATION_THRESHOLD = 25;

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Column type inference
// ---------------------------------------------------------------------------

/** Strip HTML tags to get plain text for type inference and aggregation. */
function stripHtml(html: string): string {
    // Fast path for plain text (no tags)
    if (!html.includes('<')) return html.trim();
    const tmp = document.createElement('span');
    tmp.innerHTML = html;
    return (tmp.textContent ?? '').trim();
}

/**
 * Return true when every non-empty cell in a column parses as a finite number.
 * Accepts commas as thousands separators (e.g. "1,234.56").
 */
export function isNumericColumn(cells: string[]): boolean {
    let nonEmpty = 0;
    for (const raw of cells) {
        const text = stripHtml(raw);
        if (text === '' || text === '-' || text === '—') continue;
        nonEmpty++;
        const normalized = text.replace(/,/g, '');
        if (isNaN(Number(normalized)) || !isFinite(Number(normalized))) return false;
    }
    return nonEmpty > 0;
}

// ---------------------------------------------------------------------------
// Column widths
// ---------------------------------------------------------------------------

/** Smallest share of the table any single column may take, in percent. */
const MIN_COLUMN_SHARE = 8;

/** Largest share of the table any single column may take, in percent. */
const MAX_COLUMN_SHARE = 70;

/**
 * Length at the given percentile of a sorted-ascending list. Used instead of the
 * maximum so a single unusually long row does not decide the column's width.
 */
function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

/**
 * Derive each column's share of the table width from the length of the text it
 * holds, as percentages summing to 100.
 *
 * The ratio comes straight from the strings already in props — no DOM
 * measurement, so no forced reflow and nothing that only works in a real
 * browser. Character count is a rough stand-in for rendered width in a
 * proportional font, which is enough to tell "narrower" from "wider"; the user
 * can still drag a column that lands off.
 */
export function computeColumnWeights(headers: string[], rows: string[][]): number[] {
    const colCount = headers.length;
    if (colCount === 0) return [];

    const even = 100 / colCount;
    const raw: number[] = [];
    for (let col = 0; col < colCount; col++) {
        const cellLengths = rows
            .map(r => stripHtml(r[col] ?? '').length)
            .sort((a, b) => a - b);
        raw.push(Math.max(stripHtml(headers[col] ?? '').length, percentile(cellLengths, 90)));
    }

    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= 0) return raw.map(() => even);

    const shares = raw.map(w => (w / total) * 100);

    // The clamp has to give way when an even split already sits outside it —
    // a single column cannot stay under 70%, and 13+ columns cannot each clear 8%.
    const minShare = Math.min(MIN_COLUMN_SHARE, even);
    const maxShare = Math.max(MAX_COLUMN_SHARE, even);

    // Pin the worst offender, then hand what is left to the columns still free
    // to move, and look again. Doing one at a time keeps the total at 100: a
    // column that was only under the floor because a neighbour was hogging the
    // width gets pulled back up by the redistribution instead of being pinned.
    const clamped = new Array<boolean>(colCount).fill(false);
    for (let pass = 0; pass < colCount; pass++) {
        let worst = -1;
        let worstBy = 0;
        for (let col = 0; col < colCount; col++) {
            if (clamped[col]) continue;
            const over = shares[col] - maxShare;
            const under = minShare - shares[col];
            const by = Math.max(over, under);
            if (by > worstBy) {
                worstBy = by;
                worst = col;
            }
        }
        if (worst < 0) break;

        shares[worst] = shares[worst] > maxShare ? maxShare : minShare;
        clamped[worst] = true;

        let fixedTotal = 0;
        let freeTotal = 0;
        let freeCount = 0;
        for (let col = 0; col < colCount; col++) {
            if (clamped[col]) fixedTotal += shares[col];
            else {
                freeTotal += shares[col];
                freeCount++;
            }
        }
        if (freeCount === 0) break;

        const remaining = 100 - fixedTotal;
        for (let col = 0; col < colCount; col++) {
            if (clamped[col]) continue;
            shares[col] = freeTotal > 0 ? (shares[col] / freeTotal) * remaining : remaining / freeCount;
        }
    }

    return shares;
}

/** Parse a cell value to a number (strip HTML + commas). Returns NaN for non-numeric. */
function parseNumeric(html: string): number {
    const text = stripHtml(html).replace(/,/g, '');
    return Number(text);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface AggregationResult {
    sum: number;
    avg: number;
    min: number;
    max: number;
    count: number;
}

function computeAggregation(rows: string[][]): Map<number, AggregationResult> {
    const result = new Map<number, AggregationResult>();
    if (rows.length === 0) return result;

    const colCount = rows[0]?.length ?? 0;
    for (let col = 0; col < colCount; col++) {
        const cells = rows.map(r => r[col] ?? '');
        if (!isNumericColumn(cells)) continue;

        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        let count = 0;
        for (const cell of cells) {
            const n = parseNumeric(cell);
            if (isNaN(n)) continue;
            sum += n;
            if (n < min) min = n;
            if (n > max) max = n;
            count++;
        }
        if (count > 0) {
            result.set(col, { sum, avg: sum / count, min, max, count });
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/** Build a CSV string from headers + rows (plain text, no HTML). */
export function tableToCsv(headers: string[], rows: string[][]): string {
    const escape = (v: string) => {
        const text = stripHtml(v);
        if (text.includes('"') || text.includes(',') || text.includes('\n')) {
            return '"' + text.replace(/"/g, '""') + '"';
        }
        return text;
    };
    const lines = [headers.map(h => escape(h)).join(',')];
    for (const row of rows) {
        lines.push(row.map(c => escape(c)).join(','));
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
    // Use locale formatting with up to 2 decimal places
    return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const ALIGN_CLASS: Record<ColumnAlignment, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
};

/**
 * Effective alignment for a column: numeric columns default to right so digits
 * line up, but an explicit non-left `alignments` entry from the caller wins.
 */
function effectiveAlign(align: ColumnAlignment, numeric: boolean): ColumnAlignment {
    return numeric && align === 'left' ? 'right' : align;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface InteractiveTableProps extends ExtractedTableData {
    /** Unique key for React reconciliation. */
    tableKey: string;
    /**
     * Fill the parent's height and own the vertical scroll, so the header
     * sticks while the body scrolls. Opt-in: chat markdown tables leave this
     * off and keep growing inline.
     */
    fillHeight?: boolean;
}

type RowData = Record<string, string>;

export function InteractiveTable({
    headers,
    alignments,
    rows,
    originalMarkdown,
    tableKey,
    fillHeight = false,
}: InteractiveTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [showFilters, setShowFilters] = useState(false);
    const [showColPicker, setShowColPicker] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});

    const colPickerRef = useRef<HTMLDivElement>(null);
    const colPickerBtnRef = useRef<HTMLButtonElement>(null);
    const tableElRef = useRef<HTMLTableElement>(null);
    /** Widths measured the first time a resize starts — used to reset a column. */
    const seededSizesRef = useRef<ColumnSizingState>({});
    const columnSizingRef = useRef<ColumnSizingState>({});
    columnSizingRef.current = columnSizing;

    /**
     * Before the first drag, capture every column's laid-out width so the table
     * can swap the <colgroup> percentages for explicit pixels without the other
     * columns jumping. A no-op once seeded, or when nothing has been laid out
     * yet (e.g. jsdom, where every measured width is 0).
     */
    const seedColumnSizes = useCallback(() => {
        if (Object.keys(columnSizingRef.current).length > 0) return;
        const el = tableElRef.current;
        if (!el) return;
        const cells = Array.from(
            el.querySelectorAll<HTMLTableCellElement>('thead th[data-col-id]')
        );
        const measured: ColumnSizingState = {};
        let total = 0;
        for (const cell of cells) {
            const id = cell.dataset.colId;
            if (!id) continue;
            const width = Math.round(cell.getBoundingClientRect().width);
            measured[id] = width;
            total += width;
        }
        if (total <= 0) return;
        seededSizesRef.current = measured;
        columnSizingRef.current = measured;
        setColumnSizing(measured);
    }, []);

    /** Double-click on the handle puts the column back to its measured width. */
    const resetColumnSize = useCallback((columnId: string) => {
        setColumnSizing(prev => {
            const seeded = seededSizesRef.current[columnId];
            if (seeded === undefined) {
                const next = { ...prev };
                delete next[columnId];
                return next;
            }
            return { ...prev, [columnId]: seeded };
        });
    }, []);

    // Close column picker on outside click
    useEffect(() => {
        if (!showColPicker) return;
        const handler = (e: MouseEvent) => {
            if (
                colPickerRef.current &&
                !colPickerRef.current.contains(e.target as Node) &&
                colPickerBtnRef.current &&
                !colPickerBtnRef.current.contains(e.target as Node)
            ) {
                setShowColPicker(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showColPicker]);

    // Escape key exits fullscreen
    useEffect(() => {
        if (!isFullscreen) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsFullscreen(false);
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isFullscreen]);

    const exitFullscreen = useCallback(() => setIsFullscreen(false), []);

    // Stable column IDs
    const colIds = useMemo(() => headers.map((_, i) => `col_${i}`), [headers]);

    // Build column defs
    const columns = useMemo<ColumnDef<RowData>[]>(() => {
        return headers.map((header, i) => {
            const id = colIds[i];
            const align = alignments[i] ?? 'left';
            const cellValues = rows.map(r => r[i] ?? '');
            const numeric = isNumericColumn(cellValues);

            return {
                id,
                accessorFn: (row: RowData) => row[id] ?? '',
                header: () => (
                    <span dangerouslySetInnerHTML={{ __html: header }} />
                ),
                cell: (info) => (
                    <span dangerouslySetInnerHTML={{ __html: info.getValue<string>() }} />
                ),
                filterFn: (row, columnId, filterValue: string) => {
                    const cellHtml = row.getValue<string>(columnId);
                    const text = stripHtml(cellHtml).toLowerCase();
                    return text.includes(filterValue.toLowerCase());
                },
                sortingFn: numeric
                    ? (rowA, rowB, columnId) => {
                        const a = parseNumeric(rowA.getValue<string>(columnId));
                        const b = parseNumeric(rowB.getValue<string>(columnId));
                        if (isNaN(a) && isNaN(b)) return 0;
                        if (isNaN(a)) return 1;
                        if (isNaN(b)) return -1;
                        return a - b;
                    }
                    : (rowA, rowB, columnId) => {
                        const a = stripHtml(rowA.getValue<string>(columnId)).toLowerCase();
                        const b = stripHtml(rowB.getValue<string>(columnId)).toLowerCase();
                        return a.localeCompare(b);
                    },
                meta: { align, numeric },
            };
        });
    }, [headers, alignments, rows, colIds]);

    // Build row data
    const data = useMemo<RowData[]>(() => {
        return rows.map(row => {
            const obj: RowData = {};
            colIds.forEach((id, i) => {
                obj[id] = row[i] ?? '';
            });
            return obj;
        });
    }, [rows, colIds]);

    const needsPagination = rows.length > PAGINATION_THRESHOLD;

    const table = useReactTable({
        data,
        columns,
        state: { sorting, columnFilters, columnVisibility, columnSizing },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
        onColumnSizingChange: setColumnSizing,
        enableColumnResizing: true,
        columnResizeMode: 'onChange',
        defaultColumn: { minSize: 56 },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        ...(needsPagination ? { getPaginationRowModel: getPaginationRowModel() } : {}),
        initialState: needsPagination ? { pagination: { pageSize: PAGE_SIZE } } : undefined,
    });

    // Aggregations (computed on ALL rows, not just current page)
    const aggregations = useMemo(() => computeAggregation(rows), [rows]);

    // Copy handlers
    const handleCopyMarkdown = async () => {
        try {
            await navigator.clipboard.writeText(originalMarkdown);
            setCopyFeedback('md');
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch { /* ignore */ }
    };

    const handleCopyCsv = async () => {
        try {
            const plainHeaders = headers.map(h => stripHtml(h));
            const csv = tableToCsv(plainHeaders, rows);
            await navigator.clipboard.writeText(csv);
            setCopyFeedback('csv');
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch { /* ignore */ }
    };

    const filteredRowCount = table.getFilteredRowModel().rows.length;

    // Share of the table each column gets before any drag, derived from the
    // length of the text it holds.
    const columnWeights = useMemo(() => computeColumnWeights(headers, rows), [headers, rows]);

    // Explicit widths only kick in once the user has actually dragged a handle;
    // until then the <colgroup> percentages decide the ratio.
    const hasSizedColumns = Object.keys(columnSizing).length > 0;

    // Count visible columns for "prevent hiding all" logic
    const visibleColumnCount = table.getVisibleLeafColumns().length;

    const tableContent = (
        <div
            className={`interactive-table${fillHeight ? ' interactive-table-fill' : ''}${
                isFullscreen ? ' interactive-table-fullscreen-inner' : ''
            }`}
            data-testid={`interactive-table-${tableKey}`}
        >
            {/* Toolbar — chrome, excluded from native text selection/copy */}
            <div className="interactive-table-toolbar select-none">
                <span className="interactive-table-row-count">
                    {filteredRowCount !== rows.length
                        ? `${filteredRowCount} of ${rows.length} rows`
                        : `${rows.length} rows`}
                </span>
                <div className="interactive-table-actions">
                    <button
                        className="interactive-table-btn"
                        onClick={() => setShowFilters(f => !f)}
                        title={showFilters ? 'Hide filters' : 'Show filters'}
                    >
                        {showFilters ? '✕' : '⊞'} <span className="interactive-table-btn-label">Filter</span>
                    </button>
                    <div className="interactive-table-col-picker-wrapper">
                        <button
                            ref={colPickerBtnRef}
                            className="interactive-table-btn"
                            onClick={() => setShowColPicker(v => !v)}
                            title="Toggle column visibility"
                        >
                            ⊞ <span className="interactive-table-btn-label">Columns</span>
                        </button>
                        {showColPicker && (
                            <div ref={colPickerRef} className="interactive-table-col-picker select-none" data-testid="col-picker">
                                {table.getAllLeafColumns().map(col => {
                                    const idx = colIds.indexOf(col.id);
                                    const label = idx >= 0 ? stripHtml(headers[idx]) : col.id;
                                    const isVisible = col.getIsVisible();
                                    const isLastVisible = isVisible && visibleColumnCount <= 1;
                                    return (
                                        <label key={col.id} className="interactive-table-col-picker-row">
                                            <input
                                                type="checkbox"
                                                checked={isVisible}
                                                disabled={isLastVisible}
                                                onChange={col.getToggleVisibilityHandler()}
                                            />
                                            {label}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <button
                        className="interactive-table-btn"
                        onClick={handleCopyMarkdown}
                        title="Copy as Markdown"
                    >
                        {copyFeedback === 'md' ? '✓' : '⧉'}{' '}
                        <span className="interactive-table-btn-label">
                            {copyFeedback === 'md' ? 'Copied' : 'Markdown'}
                        </span>
                    </button>
                    <button
                        className="interactive-table-btn"
                        onClick={handleCopyCsv}
                        title="Copy as CSV"
                    >
                        {copyFeedback === 'csv' ? '✓' : '⧉'}{' '}
                        <span className="interactive-table-btn-label">
                            {copyFeedback === 'csv' ? 'Copied' : 'CSV'}
                        </span>
                    </button>
                    <button
                        className="interactive-table-btn"
                        onClick={() => setIsFullscreen(f => !f)}
                        title={isFullscreen ? 'Exit fullscreen' : 'Expand table'}
                    >
                        {isFullscreen ? '⤡' : '⤢'}{' '}
                        <span className="interactive-table-btn-label">
                            {isFullscreen ? 'Exit' : 'Expand'}
                        </span>
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="interactive-table-scroll">
                <table
                    ref={tableElRef}
                    className={`md-table interactive-md-table${
                        hasSizedColumns ? ' interactive-md-table-resized' : ''
                    }`}
                    // Once the columns carry explicit widths the table has to be
                    // exactly as wide as their sum. Leaving it at `max-content`
                    // lets Chrome re-measure the content and hand the slack to
                    // the widest column, which makes the table jump the moment
                    // the widths are seeded — before any drag has happened.
                    style={hasSizedColumns ? { width: table.getTotalSize() } : undefined}
                >
                    {/* Before the first drag the ratio comes from the content.
                        Hidden columns are skipped so each <col> lines up with a
                        rendered cell; once dragged, the explicit px widths on
                        the <th> take over and this goes away. */}
                    {!hasSizedColumns && (
                        <colgroup>
                            {table.getVisibleLeafColumns().map(col => {
                                const idx = colIds.indexOf(col.id);
                                const weight = idx >= 0 ? columnWeights[idx] : undefined;
                                return (
                                    <col
                                        key={col.id}
                                        data-col-id={col.id}
                                        style={
                                            weight === undefined
                                                ? undefined
                                                : { width: `${weight.toFixed(2)}%` }
                                        }
                                    />
                                );
                            })}
                        </colgroup>
                    )}
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => {
                                    const meta = header.column.columnDef.meta as
                                        | { align: ColumnAlignment; numeric: boolean }
                                        | undefined;
                                    const numeric = meta?.numeric ?? false;
                                    const align = effectiveAlign(meta?.align ?? 'left', numeric);
                                    const sortDir = header.column.getIsSorted();

                                    return (
                                        <th
                                            key={header.id}
                                            data-col-id={header.column.id}
                                            className={`table-cell interactive-table-cell interactive-table-th ${
                                                ALIGN_CLASS[align]
                                            }${numeric ? ' interactive-table-numeric' : ''} ${
                                                header.column.getCanSort() ? 'cursor-pointer' : ''
                                            }`}
                                            style={
                                                hasSizedColumns
                                                    ? { width: header.getSize() }
                                                    : undefined
                                            }
                                            onClick={header.column.getToggleSortingHandler()}
                                        >
                                            <span className="interactive-table-header-content">
                                                {flexRender(header.column.columnDef.header, header.getContext())}
                                                {sortDir && (
                                                    <span className="interactive-table-sort-indicator select-none">
                                                        {sortDir === 'asc' ? ' ▲' : ' ▼'}
                                                    </span>
                                                )}
                                            </span>
                                            {showFilters && (
                                                <input
                                                    className="interactive-table-filter-input select-none"
                                                    type="text"
                                                    placeholder="Filter…"
                                                    value={(header.column.getFilterValue() as string) ?? ''}
                                                    onChange={e => header.column.setFilterValue(e.target.value)}
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            )}
                                            {header.column.getCanResize() && (
                                                <span
                                                    className={`interactive-table-resizer select-none${
                                                        header.column.getIsResizing()
                                                            ? ' interactive-table-resizer-active'
                                                            : ''
                                                    }`}
                                                    data-testid={`interactive-table-resizer-${header.column.id}`}
                                                    role="separator"
                                                    aria-orientation="vertical"
                                                    // Hovering seeds the widths a tick before the drag
                                                    // starts, so the first drag has a real start size.
                                                    onPointerEnter={seedColumnSizes}
                                                    onMouseDown={e => {
                                                        e.stopPropagation();
                                                        seedColumnSizes();
                                                        header.getResizeHandler()(e);
                                                    }}
                                                    onTouchStart={e => {
                                                        e.stopPropagation();
                                                        seedColumnSizes();
                                                        header.getResizeHandler()(e);
                                                    }}
                                                    // The handle lives inside the sortable header cell,
                                                    // so it must swallow the click too.
                                                    onClick={e => e.stopPropagation()}
                                                    onDoubleClick={e => {
                                                        e.stopPropagation();
                                                        resetColumnSize(header.column.id);
                                                    }}
                                                />
                                            )}
                                        </th>
                                    );
                                })}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => (
                            <tr key={row.id}>
                                {row.getVisibleCells().map(cell => {
                                    const meta = cell.column.columnDef.meta as
                                        | { align: ColumnAlignment; numeric: boolean }
                                        | undefined;
                                    const numeric = meta?.numeric ?? false;
                                    const align = effectiveAlign(meta?.align ?? 'left', numeric);
                                    const plain = stripHtml(cell.getValue<string>() ?? '');
                                    return (
                                        <td
                                            key={cell.id}
                                            className={`table-cell interactive-table-cell ${ALIGN_CLASS[align]}${
                                                numeric ? ' interactive-table-numeric' : ''
                                            }`}
                                            title={plain === '' ? undefined : plain}
                                        >
                                            {/* The <td> is exactly as wide as its column under
                                                fixed layout; the inner block carries the clipping
                                                so an over-long value ellipsizes cleanly instead of
                                                bleeding past the cell padding. */}
                                            <span className="interactive-table-cell-text">
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </span>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                    {aggregations.size > 0 && (
                        <tfoot>
                            <tr className="interactive-table-agg-row select-none">
                                {colIds.map((id, i) => {
                                    const col = table.getColumn(id);
                                    if (col && !col.getIsVisible()) return null;
                                    const agg = aggregations.get(i);
                                    if (!agg) {
                                        return <td key={id} className="table-cell interactive-table-cell interactive-table-agg-cell" />;
                                    }
                                    return (
                                        <td key={id} className="table-cell interactive-table-cell interactive-table-agg-cell text-right">
                                            <span className="interactive-table-agg-label">Σ</span>{' '}
                                            {formatNumber(agg.sum)}
                                            <span className="interactive-table-agg-sep"> · </span>
                                            <span className="interactive-table-agg-label">x̄</span>{' '}
                                            {formatNumber(agg.avg)}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* Pagination */}
            {needsPagination && (
                <div className="interactive-table-pagination select-none">
                    <button
                        className="interactive-table-page-btn"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                    >
                        «
                    </button>
                    <button
                        className="interactive-table-page-btn"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        ‹
                    </button>
                    <span className="interactive-table-page-info">
                        Page {table.getState().pagination.pageIndex + 1} of{' '}
                        {table.getPageCount()}
                    </span>
                    <button
                        className="interactive-table-page-btn"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        ›
                    </button>
                    <button
                        className="interactive-table-page-btn"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                    >
                        »
                    </button>
                </div>
            )}
        </div>
    );

    if (isFullscreen) {
        return (
            <div
                className="interactive-table-backdrop"
                data-testid="interactive-table-backdrop"
                onClick={exitFullscreen}
            >
                <div
                    className="interactive-table-fullscreen-panel"
                    onClick={e => e.stopPropagation()}
                >
                    {tableContent}
                </div>
            </div>
        );
    }

    return tableContent;
}
