/**
 * DbBrowserSection — browser for the SQLite database tables.
 * Shows a table list sidebar with row counts, a paginated data grid,
 * inline row editing via the PUT endpoint, and row deletion (single + bulk).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Dialog, Spinner, useToast, ToastContainer } from '../shared';
import { getApiBase } from '../utils/config';
import { useApp } from '../contexts/AppContext';
import { buildDbBrowserHash } from '../layout/Router';

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
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;

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

function ColumnTypeBadge({ col }: { col: ColumnInfo }) {
    const typeColors: Record<string, string> = {
        INTEGER: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
        TEXT: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
        REAL: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
        BLOB: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
    };
    const colorClass = typeColors[col.type.toUpperCase()] || 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400';
    return (
        <span className={`inline-block ml-1.5 px-1 py-0 text-[9px] font-medium rounded ${colorClass}`} data-testid={`db-col-type-${col.name}`}>
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
                data-testid="db-table-search"
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

function EditableCell({ value, column, isEditing, onChange }: {
    value: unknown;
    column: ColumnInfo;
    isEditing: boolean;
    onChange: (value: string) => void;
}) {
    if (!isEditing || column.pk) {
        return (
            <span className={column.pk && isEditing ? 'text-[var(--text-tertiary)]' : undefined}>
                <CellValue value={value} />
            </span>
        );
    }

    return (
        <input
            type="text"
            className="w-full px-1 py-0.5 text-xs bg-[var(--bg-primary)] border border-[var(--accent)] rounded text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            defaultValue={value === null || value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value)}
            data-testid={`db-edit-${column.name}`}
        />
    );
}

function getRowPkValues(row: Record<string, unknown>, columns: ColumnInfo[]): Record<string, unknown> {
    const pk: Record<string, unknown> = {};
    for (const col of columns) {
        if (col.pk) pk[col.name] = row[col.name];
    }
    return pk;
}

function serializeRowKey(row: Record<string, unknown>, columns: ColumnInfo[]): string {
    return JSON.stringify(getRowPkValues(row, columns));
}

export function DbBrowserSection() {
    const { state, dispatch } = useApp();
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(state.adminDbTable);
    const [tableData, setTableData] = useState<TableData | null>(null);
    const [page, setPage] = useState(state.adminDbPage);
    const [pageSize, setPageSize] = useState(50);
    const [sortColumn, setSortColumn] = useState<string | null>(state.adminDbSort);
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(state.adminDbOrder);
    const [loading, setLoading] = useState(true);
    const [dataLoading, setDataLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingRow, setEditingRow] = useState<Record<string, unknown> | null>(null);
    const [editValues, setEditValues] = useState<Record<string, unknown>>({});
    const [saving, setSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);
    const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
    const [deleting, setDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<'single' | 'bulk'>('single');
    const [singleDeleteRow, setSingleDeleteRow] = useState<Record<string, unknown> | null>(null);
    const [tableFilter, setTableFilter] = useState('');
    const { toasts, addToast, removeToast } = useToast();
    const deepLinkConsumed = useRef(false);

    const filteredTables = useMemo(() => {
        if (!tableFilter) return tables;
        const lower = tableFilter.toLowerCase();
        return tables.filter(t => t.name.toLowerCase().includes(lower));
    }, [tables, tableFilter]);

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
            if (!deepLinkConsumed.current && state.adminDbTable) {
                deepLinkConsumed.current = true;
                const exists = data.tables.some((t: TableInfo) => t.name === state.adminDbTable);
                if (exists) {
                    setSelectedTable(state.adminDbTable);
                } else if (data.tables.length > 0) {
                    setSelectedTable(data.tables[0].name);
                }
            } else if (!selectedTable && data.tables.length > 0) {
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
            const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
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
    }, [pageSize]);

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
        clearSelection();
        location.hash = buildDbBrowserHash(name, 1, null, null);
    };

    const handlePageSizeChange = (newSize: number) => {
        setPageSize(newSize);
        setPage(1);
        if (selectedTable) {
            history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, 1, sortColumn, sortOrder));
        }
    };

    const handleSort = (colName: string) => {
        let newSortCol: string | null;
        let newSortOrder: 'asc' | 'desc' | null;
        if (sortColumn !== colName) {
            newSortCol = colName;
            newSortOrder = 'desc';
        } else if (sortOrder === 'desc') {
            newSortCol = colName;
            newSortOrder = 'asc';
        } else {
            newSortCol = null;
            newSortOrder = null;
        }
        setSortColumn(newSortCol);
        setSortOrder(newSortOrder);
        setPage(1);
        // Sort/page changes = in-place state — no history entry
        history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, 1, newSortCol, newSortOrder));
    };

    const handleEditStart = (row: Record<string, unknown>) => {
        setEditingRow(row);
        setEditValues({});
        setEditError(null);
    };

    const handleEditCancel = () => {
        setEditingRow(null);
        setEditValues({});
        setEditError(null);
    };

    const handleEditSave = async () => {
        if (!tableData || !editingRow) return;

        const pkColumns: Record<string, unknown> = {};
        const updates: Record<string, unknown> = {};

        for (const col of tableData.columns) {
            if (col.pk) {
                pkColumns[col.name] = editingRow[col.name];
            }
        }

        // Collect only changed values
        for (const [colName, newValue] of Object.entries(editValues)) {
            const originalValue = editingRow[colName];
            const originalStr = originalValue === null || originalValue === undefined ? '' : String(originalValue);
            if (String(newValue) !== originalStr) {
                updates[colName] = newValue === '' ? null : newValue;
            }
        }

        if (Object.keys(updates).length === 0) {
            handleEditCancel();
            return;
        }

        setSaving(true);
        setEditError(null);
        try {
            const res = await fetch(
                `${getApiBase()}/admin/db/tables/${encodeURIComponent(tableData.table)}/rows`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pkColumns, updates }),
                }
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `HTTP ${res.status}`);
            }
            setEditingRow(null);
            setEditValues({});
            setEditError(null);
            // Refresh to show updated data
            fetchTableData(tableData.table, page, sortColumn, sortOrder);
        } catch (err) {
            setEditError(err instanceof Error ? err.message : String(err));
        } finally {
            setSaving(false);
        }
    };

    const isEditingThisRow = (row: Record<string, unknown>) => {
        if (!editingRow || !tableData) return false;
        return tableData.columns.filter(c => c.pk).every(c => row[c.name] === editingRow[c.name]);
    };

    // ── Selection helpers ─────────────────────────────────────────────────────
    const toggleRowSelection = (key: string) => {
        setSelectedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (!tableData) return;
        const allKeys = tableData.rows.map(r => serializeRowKey(r, tableData.columns));
        const allSelected = allKeys.length > 0 && allKeys.every(k => selectedRows.has(k));
        if (allSelected) {
            setSelectedRows(new Set());
        } else {
            setSelectedRows(new Set(allKeys));
        }
    };

    const clearSelection = () => setSelectedRows(new Set());

    // ── Delete handlers ───────────────────────────────────────────────────────
    const handleDeleteSingle = (row: Record<string, unknown>) => {
        setSingleDeleteRow(row);
        setDeleteTarget('single');
        setShowDeleteConfirm(true);
    };

    const handleDeleteBulk = () => {
        setDeleteTarget('bulk');
        setShowDeleteConfirm(true);
    };

    const handleDeleteConfirm = async () => {
        if (!tableData) return;
        setDeleting(true);
        try {
            if (deleteTarget === 'single' && singleDeleteRow) {
                const pkColumns = getRowPkValues(singleDeleteRow, tableData.columns);
                const res = await fetch(
                    `${getApiBase()}/admin/db/tables/${encodeURIComponent(tableData.table)}/rows`,
                    {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ pkColumns }),
                    }
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }
                addToast('1 row deleted', 'success');
            } else {
                // Bulk delete
                const rows = Array.from(selectedRows).map(key => JSON.parse(key) as Record<string, unknown>);
                const res = await fetch(
                    `${getApiBase()}/admin/db/tables/${encodeURIComponent(tableData.table)}/rows/delete-bulk`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rows }),
                    }
                );
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }
                const result = await res.json();
                addToast(`${result.deleted} row(s) deleted`, 'success');
            }
            clearSelection();
            setSingleDeleteRow(null);
            setShowDeleteConfirm(false);
            fetchTableData(tableData.table, page, sortColumn, sortOrder);
        } catch (err) {
            addToast(err instanceof Error ? err.message : String(err), 'error');
            setShowDeleteConfirm(false);
        } finally {
            setDeleting(false);
        }
    };

    const handleDeleteCancel = () => {
        setShowDeleteConfirm(false);
        setSingleDeleteRow(null);
    };

    const deleteCount = deleteTarget === 'single' ? 1 : selectedRows.size;

    const rowOffset = tableData ? (tableData.page - 1) * tableData.pageSize : 0;

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
        <div className="flex gap-0 min-h-[500px]">
            {/* ── Table list sidebar ── */}
            <div className="w-52 shrink-0 border-r border-[var(--border)] pr-3 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Tables</h3>
                    <span className="text-[10px] text-[var(--text-tertiary)]">{tables.length}</span>
                </div>
                <TableSearchInput value={tableFilter} onChange={setTableFilter} />
                <ul className="space-y-0.5 overflow-y-auto flex-1 -mr-1 pr-1" data-testid="db-table-list">
                    {filteredTables.map(t => (
                        <li key={t.name}>
                            <button
                                className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors group ${
                                    selectedTable === t.name
                                        ? 'bg-[var(--accent)] text-white'
                                        : 'hover:bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                                }`}
                                onClick={() => handleTableSelect(t.name)}
                                data-testid={`db-table-${t.name}`}
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

                {editError && (
                    <div className="p-2 text-sm text-red-500 mb-2 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" data-testid="db-edit-error">{editError}</div>
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
                            <div className="flex items-center gap-2 shrink-0">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => fetchTableData(tableData.table, page, sortColumn, sortOrder)}
                                    title="Refresh data"
                                    data-testid="db-refresh"
                                >
                                    ↻
                                </Button>
                            </div>
                        </div>

                        {/* ── Bulk action bar ── */}
                        {selectedRows.size > 0 && (
                            <div className="flex items-center gap-3 px-3 py-1.5 mb-2 rounded-lg bg-[var(--accent)]/5 border border-[var(--accent)]/20" data-testid="db-bulk-bar">
                                <span className="text-xs font-medium text-[var(--accent)]" data-testid="db-bulk-count">
                                    {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''} selected
                                </span>
                                <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={handleDeleteBulk}
                                    data-testid="db-bulk-delete"
                                >
                                    Delete Selected
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearSelection}
                                    data-testid="db-bulk-clear"
                                >
                                    Clear
                                </Button>
                            </div>
                        )}

                        {/* ── Data grid ── */}
                        <div className="overflow-x-auto border border-[var(--border)] rounded-lg flex-1 relative">
                            <table className="w-full text-xs border-collapse">
                                <thead className="sticky top-0 z-10">
                                    <tr className="bg-[var(--bg-secondary)] border-b-2 border-[var(--border)]">
                                        <th className="px-2 py-2 w-8 text-center sticky left-0 bg-[var(--bg-secondary)]">
                                            <input
                                                type="checkbox"
                                                checked={tableData.rows.length > 0 && tableData.rows.every(r => selectedRows.has(serializeRowKey(r, tableData.columns)))}
                                                onChange={toggleSelectAll}
                                                data-testid="db-select-all"
                                                className="cursor-pointer"
                                            />
                                        </th>
                                        <th className="px-2 py-2 text-center text-[10px] font-medium text-[var(--text-tertiary)] w-10" title="Row number">
                                            #
                                        </th>
                                        {tableData.columns.map(col => (
                                            <th
                                                key={col.name}
                                                className="px-2 py-2 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap cursor-pointer select-none hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]/50 transition-colors"
                                                title={`${col.type}${col.pk ? ' (PK)' : ''}${col.notnull ? ' NOT NULL' : ''} — Click to sort`}
                                                onClick={() => handleSort(col.name)}
                                                data-testid={`db-sort-${col.name}`}
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
                                        <th className="px-2 py-2 text-center font-semibold text-[var(--text-secondary)] whitespace-nowrap w-20 sticky right-0 bg-[var(--bg-secondary)]">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.rows.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableData.columns.length + 3} className="px-2 py-8 text-center text-[var(--text-tertiary)]">
                                                No rows
                                            </td>
                                        </tr>
                                    ) : (
                                        tableData.rows.map((row, idx) => {
                                            const editing = isEditingThisRow(row);
                                            const rowKey = serializeRowKey(row, tableData.columns);
                                            const isSelected = selectedRows.has(rowKey);
                                            const rowNum = rowOffset + idx + 1;
                                            return (
                                                <tr
                                                    key={idx}
                                                    className={`border-b border-[var(--border)] transition-colors ${
                                                        editing
                                                            ? 'bg-[var(--accent)]/5'
                                                            : isSelected
                                                                ? 'bg-[var(--accent)]/10'
                                                                : 'hover:bg-[var(--bg-secondary)]/50'
                                                    }`}
                                                >
                                                    <td className="px-2 py-1.5 w-8 align-top text-center sticky left-0 bg-inherit">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleRowSelection(rowKey)}
                                                            data-testid={`db-select-row-${idx}`}
                                                            className="cursor-pointer"
                                                        />
                                                    </td>
                                                    <td className="px-2 py-1.5 text-center text-[10px] text-[var(--text-tertiary)] tabular-nums w-10 align-top" data-testid={`db-row-num-${idx}`}>
                                                        {rowNum}
                                                    </td>
                                                    {tableData.columns.map(col => (
                                                        <td key={col.name} className="px-2 py-1.5 max-w-xs align-top">
                                                            <EditableCell
                                                                value={editing ? (col.name in editValues ? editValues[col.name] : row[col.name]) : row[col.name]}
                                                                column={col}
                                                                isEditing={editing}
                                                                onChange={(v) => setEditValues(prev => ({ ...prev, [col.name]: v }))}
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className="px-2 py-1.5 whitespace-nowrap align-top text-center sticky right-0 bg-inherit">
                                                        {editing ? (
                                                            <span className="flex gap-1 justify-center">
                                                                <Button
                                                                    variant="primary"
                                                                    size="sm"
                                                                    loading={saving}
                                                                    onClick={handleEditSave}
                                                                    data-testid="db-edit-save"
                                                                >
                                                                    Save
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    disabled={saving}
                                                                    onClick={handleEditCancel}
                                                                    data-testid="db-edit-cancel"
                                                                >
                                                                    Cancel
                                                                </Button>
                                                            </span>
                                                        ) : (
                                                            <span className="flex gap-0.5 justify-center">
                                                                <button
                                                                    className="p-1 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    onClick={() => handleEditStart(row)}
                                                                    data-testid={`db-edit-row-${idx}`}
                                                                    title="Edit row"
                                                                    disabled={!!editingRow}
                                                                >
                                                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z"/></svg>
                                                                </button>
                                                                <button
                                                                    className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-tertiary)] hover:text-red-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                    onClick={() => handleDeleteSingle(row)}
                                                                    data-testid={`db-delete-row-${idx}`}
                                                                    title="Delete row"
                                                                    disabled={!!editingRow}
                                                                >
                                                                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M5.33 4V2.67a1.33 1.33 0 011.34-1.34h2.66a1.33 1.33 0 011.34 1.34V4m2 0v9.33a1.33 1.33 0 01-1.34 1.34H4.67a1.33 1.33 0 01-1.34-1.34V4h9.34z"/></svg>
                                                                </button>
                                                            </span>
                                                        )}
                                                    </td>
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
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => {
                                        setPage(1);
                                        history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, 1, sortColumn, sortOrder));
                                    }}
                                    title="First page"
                                >
                                    ⟪
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page <= 1}
                                    onClick={() => {
                                        const newPage = page - 1;
                                        setPage(newPage);
                                        history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, newPage, sortColumn, sortOrder));
                                    }}
                                >
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
                                    data-testid="db-page-size"
                                    title="Rows per page"
                                >
                                    {PAGE_SIZE_OPTIONS.map(s => (
                                        <option key={s} value={s}>{s} / page</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-center gap-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page >= tableData.totalPages}
                                    onClick={() => {
                                        const newPage = page + 1;
                                        setPage(newPage);
                                        history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, newPage, sortColumn, sortOrder));
                                    }}
                                >
                                    Next →
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={page >= tableData.totalPages}
                                    onClick={() => {
                                        setPage(tableData.totalPages);
                                        history.replaceState(null, '', '#' + buildDbBrowserHash(selectedTable, tableData.totalPages, sortColumn, sortOrder));
                                    }}
                                    title="Last page"
                                >
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

            {/* ── Delete confirmation dialog ── */}
            <Dialog
                open={showDeleteConfirm}
                onClose={handleDeleteCancel}
                title="Confirm Delete"
                footer={
                    <>
                        <Button variant="ghost" size="sm" onClick={handleDeleteCancel} disabled={deleting} data-testid="db-delete-cancel">
                            Cancel
                        </Button>
                        <Button variant="danger" size="sm" loading={deleting} onClick={handleDeleteConfirm} data-testid="db-delete-confirm">
                            Delete
                        </Button>
                    </>
                }
            >
                <p data-testid="db-delete-message">
                    Are you sure you want to delete {deleteCount} row{deleteCount !== 1 ? 's' : ''}? This action cannot be undone.
                </p>
            </Dialog>

            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </div>
    );
}
