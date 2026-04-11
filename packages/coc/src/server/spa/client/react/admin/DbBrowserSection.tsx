/**
 * DbBrowserSection — read-only browser for the SQLite database tables.
 * Shows a table list sidebar with row counts and a paginated data grid.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button, Spinner } from '../shared';
import { getApiBase } from '../utils/config';

interface TableInfo {
    name: string;
    rowCount: number;
}

interface ColumnInfo {
    name: string;
    type: string;
    notnull: boolean;
    pk: boolean;
}

interface TableData {
    table: string;
    columns: ColumnInfo[];
    rows: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

const MAX_CELL_LENGTH = 120;

function CellValue({ value }: { value: unknown }) {
    const [expanded, setExpanded] = useState(false);
    const str = value === null ? 'NULL' : value === undefined ? '' : String(value);
    const isNull = value === null;
    const needsTruncation = str.length > MAX_CELL_LENGTH && !expanded;

    if (isNull) {
        return <span className="text-[var(--text-tertiary)] italic">NULL</span>;
    }

    if (needsTruncation) {
        return (
            <span
                className="cursor-pointer hover:text-[var(--accent)]"
                title="Click to expand"
                onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
            >
                {str.slice(0, MAX_CELL_LENGTH)}…
            </span>
        );
    }

    if (expanded && str.length > MAX_CELL_LENGTH) {
        return (
            <span
                className="cursor-pointer hover:text-[var(--accent)]"
                title="Click to collapse"
                onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            >
                {str}
            </span>
        );
    }

    return <span>{str}</span>;
}

export function DbBrowserSection() {
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [tableData, setTableData] = useState<TableData | null>(null);
    const [page, setPage] = useState(1);
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Fetch table list
    const fetchTables = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${getApiBase()}/admin/db/tables`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setTables(data.tables);
            // Auto-select first table if none selected
            if (!selectedTable && data.tables.length > 0) {
                setSelectedTable(data.tables[0].name);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    // Fetch table data
    const fetchTableData = useCallback(async (tableName: string, p: number, sort: string | null, order: 'asc' | 'desc' | null) => {
        setDataLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams({ page: String(p), pageSize: '50' });
            if (sort && order) {
                params.set('sort', sort);
                params.set('order', order);
            }
            const res = await fetch(`${getApiBase()}/admin/db/tables/${encodeURIComponent(tableName)}?${params}`);
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            const data: TableData = await res.json();
            setTableData(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setDataLoading(false);
        }
    }, []);

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

    const handleSort = (colName: string) => {
        if (sortColumn !== colName) {
            setSortColumn(colName);
            setSortOrder('asc');
        } else if (sortOrder === 'asc') {
            setSortOrder('desc');
        } else {
            setSortColumn(null);
            setSortOrder(null);
        }
        setPage(1);
    };

    if (loading) {
        return <div className="flex items-center justify-center p-8"><Spinner size="sm" /></div>;
    }

    if (error && tables.length === 0) {
        return (
            <div className="p-4 text-[var(--text-secondary)]">
                <p className="text-red-500">{error}</p>
            </div>
        );
    }

    return (
        <div className="flex gap-4 min-h-[400px]">
            {/* ── Table list sidebar ── */}
            <div className="w-48 shrink-0 border-r border-[var(--border)] pr-3">
                <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wide mb-2">Tables</h3>
                <ul className="space-y-0.5">
                    {tables.map(t => (
                        <li key={t.name}>
                            <button
                                className={`w-full text-left px-2 py-1.5 rounded text-sm transition-colors ${
                                    selectedTable === t.name
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                }`}
                                onClick={() => handleTableSelect(t.name)}
                                data-testid={`db-table-${t.name}`}
                            >
                                <span className="font-medium">{t.name}</span>
                                <span className={`ml-1 text-xs ${selectedTable === t.name ? 'text-white/70' : 'text-[var(--text-tertiary)]'}`}>
                                    ({t.rowCount.toLocaleString()})
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>

            {/* ── Table data panel ── */}
            <div className="flex-1 min-w-0">
                {dataLoading && (
                    <div className="flex items-center justify-center p-8"><Spinner size="sm" /></div>
                )}

                {error && (
                    <div className="p-2 text-sm text-red-500 mb-2">{error}</div>
                )}

                {!dataLoading && tableData && (
                    <>
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                                {tableData.table}
                                <span className="ml-2 font-normal text-[var(--text-tertiary)]">
                                    ({tableData.total.toLocaleString()} rows)
                                </span>
                            </h3>
                        </div>

                        <div className="overflow-x-auto border border-[var(--border)] rounded">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                                        {tableData.columns.map(col => (
                                            <th
                                                key={col.name}
                                                className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap cursor-pointer select-none hover:text-[var(--text-primary)] transition-colors"
                                                title={`${col.type}${col.pk ? ' (PK)' : ''}${col.notnull ? ' NOT NULL' : ''} — Click to sort`}
                                                onClick={() => handleSort(col.name)}
                                                data-testid={`db-sort-${col.name}`}
                                            >
                                                {col.name}
                                                {col.pk && <span className="ml-1 text-[var(--accent)]">🔑</span>}
                                                {sortColumn === col.name && (
                                                    <span className="ml-1 text-[var(--accent)]">{sortOrder === 'asc' ? '▲' : '▼'}</span>
                                                )}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.rows.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableData.columns.length} className="px-2 py-4 text-center text-[var(--text-tertiary)]">
                                                No rows
                                            </td>
                                        </tr>
                                    ) : (
                                        tableData.rows.map((row, idx) => (
                                            <tr key={idx} className="border-b border-[var(--border)] hover:bg-[var(--bg-secondary)]/50">
                                                {tableData.columns.map(col => (
                                                    <td key={col.name} className="px-2 py-1 max-w-xs truncate align-top">
                                                        <CellValue value={row[col.name]} />
                                                    </td>
                                                ))}
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>

                        {/* ── Pagination ── */}
                        {tableData.totalPages > 1 && (
                            <div className="flex items-center justify-between pt-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => setPage(p => p - 1)}
                                >
                                    ← Previous
                                </Button>
                                <span className="text-xs text-[var(--text-tertiary)]">
                                    Page {tableData.page} of {tableData.totalPages} ({tableData.total.toLocaleString()} total)
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page >= tableData.totalPages}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    Next →
                                </Button>
                            </div>
                        )}
                    </>
                )}

                {!dataLoading && !tableData && !error && (
                    <div className="flex items-center justify-center p-8 text-[var(--text-tertiary)]">
                        Select a table to browse its contents
                    </div>
                )}
            </div>
        </div>
    );
}
