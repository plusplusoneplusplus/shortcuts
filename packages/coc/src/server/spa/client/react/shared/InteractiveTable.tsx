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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface InteractiveTableProps extends ExtractedTableData {
    /** Unique key for React reconciliation. */
    tableKey: string;
}

type RowData = Record<string, string>;

export function InteractiveTable({
    headers,
    alignments,
    rows,
    originalMarkdown,
    tableKey,
}: InteractiveTableProps) {
    const [sorting, setSorting] = useState<SortingState>([]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
    const [showFilters, setShowFilters] = useState(false);
    const [showColPicker, setShowColPicker] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    const colPickerRef = useRef<HTMLDivElement>(null);
    const colPickerBtnRef = useRef<HTMLButtonElement>(null);

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
        state: { sorting, columnFilters, columnVisibility },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onColumnVisibilityChange: setColumnVisibility,
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

    // Count visible columns for "prevent hiding all" logic
    const visibleColumnCount = table.getVisibleLeafColumns().length;

    const tableContent = (
        <div className={`interactive-table${isFullscreen ? ' interactive-table-fullscreen-inner' : ''}`} data-testid={`interactive-table-${tableKey}`}>
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
                        {showFilters ? '✕ Filter' : '⊞ Filter'}
                    </button>
                    <div className="interactive-table-col-picker-wrapper">
                        <button
                            ref={colPickerBtnRef}
                            className="interactive-table-btn"
                            onClick={() => setShowColPicker(v => !v)}
                            title="Toggle column visibility"
                        >
                            ⊞ Columns
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
                        {copyFeedback === 'md' ? '✓ Copied' : '⧉ Markdown'}
                    </button>
                    <button
                        className="interactive-table-btn"
                        onClick={handleCopyCsv}
                        title="Copy as CSV"
                    >
                        {copyFeedback === 'csv' ? '✓ Copied' : '⧉ CSV'}
                    </button>
                    <button
                        className="interactive-table-btn"
                        onClick={() => setIsFullscreen(f => !f)}
                        title={isFullscreen ? 'Exit fullscreen' : 'Expand table'}
                    >
                        {isFullscreen ? '⤡ Exit' : '⤢ Expand'}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="interactive-table-scroll">
                <table className="md-table interactive-md-table">
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => {
                                    const meta = header.column.columnDef.meta as
                                        | { align: ColumnAlignment; numeric: boolean }
                                        | undefined;
                                    const align = meta?.align ?? 'left';
                                    const sortDir = header.column.getIsSorted();

                                    return (
                                        <th
                                            key={header.id}
                                            className={`table-cell interactive-table-th ${ALIGN_CLASS[align]} ${
                                                header.column.getCanSort() ? 'cursor-pointer' : ''
                                            }`}
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
                                    const align = meta?.align ?? 'left';
                                    return (
                                        <td
                                            key={cell.id}
                                            className={`table-cell ${ALIGN_CLASS[align]}`}
                                        >
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                                        return <td key={id} className="table-cell interactive-table-agg-cell" />;
                                    }
                                    return (
                                        <td key={id} className="table-cell interactive-table-agg-cell text-right">
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
