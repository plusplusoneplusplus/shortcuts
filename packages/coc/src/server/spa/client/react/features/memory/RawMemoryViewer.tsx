/**
 * RawMemoryViewer — read-only browser for the repo's raw-memory.db.
 *
 * Shows a table list sidebar with row counts, a paginated data grid,
 * sortable columns, and expandable long/JSON cells.
 * Inspired by the admin DbBrowserSection but stripped to read-only.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button, Spinner } from '../../ui';
import { memoryApi } from './memoryApi';
import type { RawDbTableInfo, RawDbTableData, RawDbColumnInfo } from './memoryApi';

const MAX_CELL_LENGTH = 120;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

// ── Presentational helpers ──────────────────────────────────────────────────

function isJsonLike(str: string): boolean {
    const trimmed = str.trimStart();
    return (trimmed.startsWith('{') || trimmed.startsWith('[')) && str.length > 40;
}

function CellValue({ value }: { value: unknown }) {
    const [expanded, setExpanded] = useState(false);
    const str = value === null ? 'NULL' : value === undefined ? '' : String(value);
    const isNull = value === null;
    const needsTruncation = str.length > MAX_CELL_LENGTH && !expanded;

    if (isNull) {
        return <span className="text-[var(--text-tertiary)] italic text-[10px]">NULL</span>;
    }

    if (needsTruncation) {
        const jsonLike = isJsonLike(str);
        return (
            <span
                className="cursor-pointer hover:text-[var(--accent)] transition-colors"
                title="Click to expand"
                onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                data-testid="raw-cell-truncated"
            >
                {jsonLike ? (
                    <code className="text-[10px] bg-[var(--bg-secondary)] px-1 py-0.5 rounded break-all">{str.slice(0, MAX_CELL_LENGTH)}…</code>
                ) : (
                    <>{str.slice(0, MAX_CELL_LENGTH)}…</>
                )}
            </span>
        );
    }

    if (expanded && str.length > MAX_CELL_LENGTH) {
        const jsonLike = isJsonLike(str);
        let displayStr = str;
        if (jsonLike) {
            try { displayStr = JSON.stringify(JSON.parse(str), null, 2); } catch { /* keep original */ }
        }
        return (
            <span
                className="cursor-pointer hover:text-[var(--accent)] transition-colors"
                title="Click to collapse"
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                data-testid="raw-cell-expanded"
            >
                {jsonLike ? (
                    <pre className="text-[10px] bg-[var(--bg-secondary)] p-1.5 rounded whitespace-pre-wrap break-all max-h-60 overflow-auto border border-[var(--border)]">{displayStr}</pre>
                ) : (
                    <span className="break-all">{str}</span>
                )}
            </span>
        );
    }

    return <span>{str}</span>;
}

function ColumnTypeBadge({ col }: { col: RawDbColumnInfo }) {
    const typeColors: Record<string, string> = {
        INTEGER: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
        TEXT: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
        REAL: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
        BLOB: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    };
    const colorClass = typeColors[col.type.toUpperCase()] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
    return (
        <span className={`inline-block ml-1.5 px-1 py-0 text-[9px] font-medium rounded ${colorClass}`}>
            {col.type}
        </span>
    );
}

function TableSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <div className="relative">
            <input
                type="text"
                placeholder="Filter tables…"
                value={value}
                onChange={e => onChange(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-[var(--bg-primary)] border border-[var(--border)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-colors"
                data-testid="raw-table-search"
            />
            {value && (
                <button
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs"
                    onClick={() => onChange('')}
                    title="Clear filter"
                >
                    ×
                </button>
            )}
        </div>
    );
}

// ── Main component ──────────────────────────────────────────────────────────

interface RawMemoryViewerProps {
    repoId: string;
}

export function RawMemoryViewer({ repoId }: RawMemoryViewerProps) {
    const [tables, setTables] = useState<RawDbTableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [tableData, setTableData] = useState<RawDbTableData | null>(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [tableFilter, setTableFilter] = useState('');
    const [dbExists, setDbExists] = useState(true);

    const filteredTables = useMemo(() => {
        if (!tableFilter) return tables;
        const lower = tableFilter.toLowerCase();
        return tables.filter(t => t.name.toLowerCase().includes(lower));
    }, [tables, tableFilter]);

    const fetchTables = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await memoryApi.getRawDbTables(repoId);
            setTables(data.tables);
            setDbExists(data.tables.length > 0);
            if (data.tables.length > 0 && !selectedTable) {
                setSelectedTable(data.tables[0].name);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [repoId]);

    const fetchTableData = useCallback(async (tableName: string, p: number, sort: string | null, order: 'asc' | 'desc' | null) => {
        setDataLoading(true);
        setError(null);
        try {
            const data = await memoryApi.getRawDbTable(
                repoId,
                tableName,
                p,
                pageSize,
                sort ?? undefined,
                order ?? undefined,
            );
            setTableData(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDataLoading(false);
        }
    }, [repoId, pageSize]);

    useEffect(() => { fetchTables(); }, [fetchTables]);

    useEffect(() => {
        if (selectedTable) {
            fetchTableData(selectedTable, page, sortColumn, sortOrder);
        }
    }, [selectedTable, page, sortColumn, sortOrder, fetchTableData]);

    const handleTableSelect = (name: string) => {
        setSelectedTable(name);
        setPage(1);
        setSortColumn(null);
        setSortOrder(null);
    };

    const handlePageSizeChange = (newSize: number) => {
        setPageSize(newSize);
        setPage(1);
    };

    const handleSort = (colName: string) => {
        if (sortColumn !== colName) {
            setSortColumn(colName);
            setSortOrder('desc');
        } else if (sortOrder === 'desc') {
            setSortColumn(colName);
            setSortOrder('asc');
        } else {
            setSortColumn(null);
            setSortOrder(null);
        }
        setPage(1);
    };

    const rowOffset = tableData ? (tableData.page - 1) * tableData.pageSize : 0;

    // ── Loading state ──
    if (loading) {
        return (
            <div className="flex items-center justify-center p-8" data-testid="raw-viewer-loading">
                <Spinner size="sm" />
            </div>
        );
    }

    // ── DB does not exist ──
    if (!dbExists && !error) {
        return (
            <div className="flex items-center justify-center p-8 text-center" data-testid="raw-viewer-empty">
                <div>
                    <p className="text-sm text-[var(--text-secondary)] mb-1">No raw memory database found</p>
                    <p className="text-xs text-[var(--text-tertiary)]">
                        Raw memory records will appear here after AI captures facts during conversations.
                    </p>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchTables}
                        className="mt-3"
                        data-testid="raw-viewer-retry"
                    >
                        Refresh
                    </Button>
                </div>
            </div>
        );
    }

    // ── Error state ──
    if (error && tables.length === 0) {
        return (
            <div className="p-4 text-[var(--text-secondary)]" data-testid="raw-viewer-error">
                <p className="text-red-500 text-sm">{error}</p>
                <Button variant="ghost" size="sm" onClick={fetchTables} className="mt-2">
                    Retry
                </Button>
            </div>
        );
    }

    return (
        <div className="flex gap-0 min-h-[400px]" data-testid="raw-memory-viewer">
            {/* ── Table list sidebar ── */}
            <div className="w-48 shrink-0 border-r border-[var(--border)] pr-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Tables</h3>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{tables.length}</span>
                </div>
                {tables.length > 3 && <TableSearchInput value={tableFilter} onChange={setTableFilter} />}
                <ul className="space-y-0.5 overflow-y-auto flex-1 -mr-1 pr-1" data-testid="raw-table-list">
                    {filteredTables.map(t => (
                        <li key={t.name}>
                            <button
                                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                                    selectedTable === t.name
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                }`}
                                onClick={() => handleTableSelect(t.name)}
                                data-testid={`raw-table-${t.name}`}
                                title={t.name}
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="font-medium truncate">{t.name}</span>
                                    <span className={`shrink-0 text-[10px] tabular-nums ${selectedTable === t.name ? 'text-white/70' : 'text-[var(--text-tertiary)]'}`}>
                                        {t.rowCount.toLocaleString()}
                                    </span>
                                </div>
                            </button>
                        </li>
                    ))}
                    {filteredTables.length === 0 && tableFilter && (
                        <li className="px-2 py-3 text-xs text-[var(--text-tertiary)] text-center">No matching tables</li>
                    )}
                </ul>
            </div>

            {/* ── Table data panel ── */}
            <div className="flex-1 min-w-0 pl-4 flex flex-col">
                {error && (
                    <div className="p-2 text-sm text-red-500 mb-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">{error}</div>
                )}

                {dataLoading && (
                    <div className="flex items-center justify-center p-8 flex-1"><Spinner size="sm" /></div>
                )}

                {!dataLoading && tableData && (
                    <>
                        {/* ── Table header bar ── */}
                        <div className="flex items-center justify-between mb-2 gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                                    {tableData.table}
                                </h3>
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)] tabular-nums border border-[var(--border)]">
                                    {tableData.total.toLocaleString()} rows
                                </span>
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-secondary)] text-[var(--text-tertiary)] tabular-nums border border-[var(--border)]">
                                    {tableData.columns.length} cols
                                </span>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => fetchTableData(tableData.table, page, sortColumn, sortOrder)}
                                title="Refresh data"
                                data-testid="raw-refresh"
                            >
                                ↻
                            </Button>
                        </div>

                        {/* ── Data grid ── */}
                        <div className="overflow-x-auto border border-[var(--border)] rounded-lg flex-1 relative">
                            <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 z-10">
                                    <tr className="bg-[var(--bg-secondary)] border-b-2 border-[var(--border)]">
                                        <th className="px-2 py-2 text-center text-[10px] font-medium text-[var(--text-tertiary)] w-10" title="Row number">
                                            #
                                        </th>
                                        {tableData.columns.map(col => (
                                            <th
                                                key={col.name}
                                                className="px-2 py-2 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap cursor-pointer select-none hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50 transition-colors"
                                                title={`${col.type}${col.pk ? ' (PK)' : ''}${col.notnull ? ' NOT NULL' : ''} — Click to sort`}
                                                onClick={() => handleSort(col.name)}
                                                data-testid={`raw-sort-${col.name}`}
                                            >
                                                <div className="flex items-center gap-0.5">
                                                    <span>{col.name}</span>
                                                    {col.pk && <span className="text-[var(--accent)] text-[10px]" title="Primary Key">PK</span>}
                                                    <ColumnTypeBadge col={col} />
                                                    {sortColumn === col.name && (
                                                        <span className="ml-0.5 text-[var(--accent)] text-[10px]">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                                                    )}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.rows.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableData.columns.length + 1} className="px-2 py-8 text-center text-[var(--text-tertiary)]" data-testid="raw-no-rows">
                                                No rows
                                            </td>
                                        </tr>
                                    ) : (
                                        tableData.rows.map((row, idx) => {
                                            const rowNum = rowOffset + idx + 1;
                                            return (
                                                <tr
                                                    key={idx}
                                                    className="border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]/50 transition-colors"
                                                >
                                                    <td className="px-2 py-1.5 text-center text-[10px] text-[var(--text-tertiary)] tabular-nums w-10 align-top" data-testid={`raw-row-num-${idx}`}>
                                                        {rowNum}
                                                    </td>
                                                    {tableData.columns.map(col => (
                                                        <td key={col.name} className="px-2 py-1.5 max-w-xs align-top">
                                                            <CellValue value={row[col.name]} />
                                                        </td>
                                                    ))}
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* ── Pagination ── */}
                        <div className="flex items-center justify-between pt-2 gap-2 flex-wrap">
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(1)} title="First page">
                                    ⟪
                                </Button>
                                <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                                    ← Prev
                                </Button>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-[var(--text-tertiary)] tabular-nums">
                                    Page {tableData.page} of {tableData.totalPages}
                                </span>
                                <span className="text-[var(--border)]">·</span>
                                <span className="text-[10px] text-[var(--text-tertiary)] tabular-nums">
                                    {tableData.total.toLocaleString()} rows
                                </span>
                                <span className="text-[var(--border)]">·</span>
                                <select
                                    className="text-[10px] bg-[var(--bg-primary)] border border-[var(--border)] rounded px-1 py-0.5 text-[var(--text-secondary)] cursor-pointer"
                                    value={pageSize}
                                    onChange={e => handlePageSizeChange(Number(e.target.value))}
                                    data-testid="raw-page-size"
                                    title="Rows per page"
                                >
                                    {PAGE_SIZE_OPTIONS.map(s => (
                                        <option key={s} value={s}>{s} / page</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button variant="ghost" size="sm" disabled={page >= tableData.totalPages} onClick={() => setPage(p => p + 1)}>
                                    Next →
                                </Button>
                                <Button variant="ghost" size="sm" disabled={page >= tableData.totalPages} onClick={() => setPage(tableData.totalPages)} title="Last page">
                                    ⟫
                                </Button>
                            </div>
                        </div>
                    </>
                )}

                {!dataLoading && !tableData && !error && (
                    <div className="flex items-center justify-center p-8 text-[var(--text-tertiary)] flex-1">
                        Select a table to browse its contents
                    </div>
                )}
            </div>
        </div>
    );
}
