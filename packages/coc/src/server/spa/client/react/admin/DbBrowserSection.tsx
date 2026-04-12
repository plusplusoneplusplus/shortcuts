/**
 * DbBrowserSection — browser for the SQLite database tables.
 * Shows a table list sidebar with row counts, a paginated data grid,
 * inline row editing via the PUT endpoint, and row deletion (single + bulk).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Dialog, Spinner, useToast, ToastContainer } from '../shared';
import { getApiBase } from '../utils/config';
import { useApp } from '../context/AppContext';
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
    const { toasts, addToast, removeToast } = useToast();
    // Track whether the initial deep-link table has been consumed
    const deepLinkConsumed = useRef(false);

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
            // If a deep-link table was provided and exists, keep it; otherwise auto-select first
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
        clearSelection();
        // Table selection = navigation — creates a history entry
        location.hash = buildDbBrowserHash(name, 1, null, null);
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

                {editError && (
                    <div className="p-2 text-sm text-red-500 mb-2" data-testid="db-edit-error">{editError}</div>
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

                        {/* ── Bulk action bar ── */}
                        {selectedRows.size > 0 && (
                            <div className="flex items-center gap-3 px-3 py-2 mb-2 rounded bg-[var(--bg-secondary)] border border-[var(--border)]" data-testid="db-bulk-bar">
                                <span className="text-xs text-[var(--text-secondary)]" data-testid="db-bulk-count">
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
                                    Clear Selection
                                </Button>
                            </div>
                        )}

                        <div className="overflow-x-auto border border-[var(--border)] rounded">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border)]">
                                        <th className="px-2 py-1.5 w-8">
                                            <input
                                                type="checkbox"
                                                checked={tableData.rows.length > 0 && tableData.rows.every(r => selectedRows.has(serializeRowKey(r, tableData.columns)))}
                                                onChange={toggleSelectAll}
                                                data-testid="db-select-all"
                                                className="cursor-pointer"
                                            />
                                        </th>
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
                                        <th className="px-2 py-1.5 text-left font-semibold text-[var(--text-secondary)] whitespace-nowrap w-28">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {tableData.rows.length === 0 ? (
                                        <tr>
                                            <td colSpan={tableData.columns.length + 2} className="px-2 py-4 text-center text-[var(--text-tertiary)]">
                                                No rows
                                            </td>
                                        </tr>
                                    ) : (
                                        tableData.rows.map((row, idx) => {
                                            const editing = isEditingThisRow(row);
                                            const rowKey = serializeRowKey(row, tableData.columns);
                                            const isSelected = selectedRows.has(rowKey);
                                            return (
                                                <tr key={idx} className={`border-b border-[var(--border)] ${editing ? 'bg-[var(--accent)]/5' : isSelected ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-secondary)]/50'}`}>
                                                    <td className="px-2 py-1 w-8 align-top">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleRowSelection(rowKey)}
                                                            data-testid={`db-select-row-${idx}`}
                                                            className="cursor-pointer"
                                                        />
                                                    </td>
                                                    {tableData.columns.map(col => (
                                                        <td key={col.name} className="px-2 py-1 max-w-xs align-top">
                                                            <EditableCell
                                                                value={editing ? (col.name in editValues ? editValues[col.name] : row[col.name]) : row[col.name]}
                                                                column={col}
                                                                isEditing={editing}
                                                                onChange={(v) => setEditValues(prev => ({ ...prev, [col.name]: v }))}
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className="px-2 py-1 whitespace-nowrap align-top">
                                                        {editing ? (
                                                            <span className="flex gap-1">
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
                                                            <span className="flex gap-1">
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleEditStart(row)}
                                                                    data-testid={`db-edit-row-${idx}`}
                                                                    title="Edit row"
                                                                    disabled={!!editingRow}
                                                                >
                                                                    ✏️
                                                                </Button>
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={() => handleDeleteSingle(row)}
                                                                    data-testid={`db-delete-row-${idx}`}
                                                                    title="Delete row"
                                                                    disabled={!!editingRow}
                                                                >
                                                                    🗑️
                                                                </Button>
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
                        {tableData.totalPages > 1 && (
                            <div className="flex items-center justify-between pt-2">
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
                                    ← Previous
                                </Button>
                                <span className="text-xs text-[var(--text-tertiary)]">
                                    Page {tableData.page} of {tableData.totalPages} ({tableData.total.toLocaleString()} total)
                                </span>
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
