/**
 * DB Browser Handler — admin endpoints for inspecting and mutating the SQLite database.
 *
 * Exposes table list with row counts, paginated table data, row editing, and row deletion.
 * Only works when the process store is SQLite-backed.
 */

import * as url from 'url';
import type * as http from 'http';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { handleAPIError, badRequest } from '../errors';

/** Validates that a table name is a safe SQL identifier (letters, digits, underscores). */
function isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/** Column metadata from PRAGMA table_info. */
interface ColumnInfo {
    cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
}

/** Validates the table exists and returns column metadata + PK column names. */
function validateTableAndGetMeta(db: any, tableName: string): { columns: ColumnInfo[]; columnNames: Set<string>; pkColumnNames: Set<string> } {
    if (!tableName || !isValidIdentifier(tableName)) {
        throw badRequest(`Invalid table name: ${tableName}`);
    }

    const tableExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    ).get(tableName) as { name: string } | undefined;

    if (!tableExists) {
        throw badRequest(`Table not found: ${tableName}`);
    }

    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as ColumnInfo[];
    const columnNames = new Set(columns.map(c => c.name));
    const pkColumnNames = new Set(columns.filter(c => c.pk > 0).map(c => c.name));

    return { columns, columnNames, pkColumnNames };
}

/** Validates that all keys in the provided object are actual PK columns. */
function validatePkColumns(pkColumnNames: Set<string>, providedPk: Record<string, unknown>): void {
    for (const key of Object.keys(providedPk)) {
        if (!pkColumnNames.has(key)) {
            throw badRequest(`Column "${key}" is not a primary key column`);
        }
    }
}

/** Validates that all provided column names exist in the table. */
function validateColumnNames(columnNames: Set<string>, providedNames: string[], tableName: string): void {
    for (const key of providedNames) {
        if (!columnNames.has(key)) {
            throw badRequest(`Column "${key}" does not exist in table "${tableName}"`);
        }
    }
}

export function registerDbBrowserRoutes(routes: Route[], store: ProcessStore): void {

    // ── GET /api/admin/db/tables ─────────────────────────────────────────
    routes.push({
        method: 'GET',
        pattern: '/api/admin/db/tables',
        handler: async (_req: http.IncomingMessage, res: http.ServerResponse) => {
            try {
                if (!(store instanceof SqliteProcessStore)) {
                    sendJSON(res, 501, { error: 'Database browser is only available with the SQLite store backend.' });
                    return;
                }
                const db = store.getDatabase();
                const rows = db.prepare(
                    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
                ).all() as { name: string }[];

                const tables = rows.map(row => {
                    const count = db.prepare(`SELECT COUNT(*) AS cnt FROM "${row.name}"`).get() as { cnt: number };
                    return { name: row.name, rowCount: count.cnt };
                });

                sendJSON(res, 200, { tables });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ── GET /api/admin/db/tables/:name ───────────────────────────────────
    routes.push({
        method: 'GET',
        pattern: /^\/api\/admin\/db\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                if (!(store instanceof SqliteProcessStore)) {
                    sendJSON(res, 501, { error: 'Database browser is only available with the SQLite store backend.' });
                    return;
                }

                const tableName = decodeURIComponent(match![1]);
                const db = store.getDatabase();
                const { columns, columnNames } = validateTableAndGetMeta(db, tableName);

                // Parse pagination params
                const parsed = url.parse(req.url || '/', true);
                const page = Math.max(1, parseInt(parsed.query.page as string, 10) || 1);
                const pageSize = Math.min(200, Math.max(1, parseInt(parsed.query.pageSize as string, 10) || 50));
                const offset = (page - 1) * pageSize;

                // Parse sort params
                const sortColumn = parsed.query.sort as string | undefined;
                const sortOrderRaw = (parsed.query.order as string || '').toLowerCase();
                const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
                const hasValidSort = sortColumn !== undefined && sortColumn !== '' && columnNames.has(sortColumn);

                // Row count
                const total = (db.prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`).get() as { cnt: number }).cnt;
                const totalPages = Math.max(1, Math.ceil(total / pageSize));

                // Row data
                const orderClause = hasValidSort ? ` ORDER BY "${sortColumn}" ${sortOrder}` : '';
                const rows = db.prepare(`SELECT * FROM "${tableName}"${orderClause} LIMIT ? OFFSET ?`).all(pageSize, offset);

                sendJSON(res, 200, {
                    table: tableName,
                    columns: columns.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk })),
                    rows,
                    total,
                    page,
                    pageSize,
                    totalPages,
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ── PUT /api/admin/db/tables/:name/rows ─────────────────────────────
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/admin\/db\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                if (!(store instanceof SqliteProcessStore)) {
                    sendJSON(res, 501, { error: 'Database browser is only available with the SQLite store backend.' });
                    return;
                }

                const tableName = decodeURIComponent(match![1]);
                const db = store.getDatabase();
                const { columnNames, pkColumnNames } = validateTableAndGetMeta(db, tableName);

                // Parse request body
                let body: any;
                try {
                    body = await parseBody(req);
                } catch {
                    throw badRequest('Invalid JSON body');
                }

                const { pkColumns, updates } = body || {};

                if (!pkColumns || typeof pkColumns !== 'object' || Array.isArray(pkColumns) || Object.keys(pkColumns).length === 0) {
                    throw badRequest('Missing or invalid pkColumns: must be a non-empty object');
                }
                if (!updates || typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
                    throw badRequest('Missing or invalid updates: must be a non-empty object');
                }

                validatePkColumns(pkColumnNames, pkColumns);
                validateColumnNames(columnNames, Object.keys(updates), tableName);

                // Reject updates to PK columns
                for (const key of Object.keys(updates)) {
                    if (pkColumnNames.has(key)) {
                        throw badRequest(`Cannot update primary key column "${key}"`);
                    }
                }

                // Build parameterized UPDATE statement
                const setClauses = Object.keys(updates).map(col => `"${col}" = ?`);
                const whereClauses = Object.keys(pkColumns).map(col => `"${col}" = ?`);
                const params = [...Object.values(updates), ...Object.values(pkColumns)];

                const sql = `UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
                const result = db.prepare(sql).run(...params);

                if (result.changes === 0) {
                    sendJSON(res, 404, { error: 'Row not found' });
                    return;
                }

                // Re-fetch the updated row
                const fetchWhere = Object.keys(pkColumns).map(col => `"${col}" = ?`);
                const fetchParams = Object.values(pkColumns);
                const row = db.prepare(
                    `SELECT * FROM "${tableName}" WHERE ${fetchWhere.join(' AND ')}`
                ).get(...fetchParams);

                sendJSON(res, 200, { row, changes: result.changes });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ── DELETE /api/admin/db/tables/:name/rows ──────────────────────────
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/admin\/db\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                if (!(store instanceof SqliteProcessStore)) {
                    sendJSON(res, 501, { error: 'Database browser is only available with the SQLite store backend.' });
                    return;
                }

                const tableName = decodeURIComponent(match![1]);
                const db = store.getDatabase();
                const { pkColumnNames } = validateTableAndGetMeta(db, tableName);

                // Parse request body
                let body: any;
                try {
                    body = await parseBody(req);
                } catch {
                    throw badRequest('Invalid JSON body');
                }

                const { pkColumns } = body || {};

                if (!pkColumns || typeof pkColumns !== 'object' || Array.isArray(pkColumns) || Object.keys(pkColumns).length === 0) {
                    throw badRequest('Missing or invalid pkColumns: must be a non-empty object');
                }

                validatePkColumns(pkColumnNames, pkColumns);

                // Build parameterized DELETE statement
                const whereClauses = Object.keys(pkColumns).map(col => `"${col}" = ?`);
                const params = Object.values(pkColumns);

                const sql = `DELETE FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`;
                const result = db.prepare(sql).run(...params);

                if (result.changes === 0) {
                    sendJSON(res, 404, { error: 'Row not found' });
                    return;
                }

                sendJSON(res, 200, { deleted: result.changes });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    // ── POST /api/admin/db/tables/:name/rows/delete-bulk ────────────────
    routes.push({
        method: 'POST',
        pattern: /^\/api\/admin\/db\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows\/delete-bulk$/,
        handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
            try {
                if (!(store instanceof SqliteProcessStore)) {
                    sendJSON(res, 501, { error: 'Database browser is only available with the SQLite store backend.' });
                    return;
                }

                const tableName = decodeURIComponent(match![1]);
                const db = store.getDatabase();
                const { pkColumnNames } = validateTableAndGetMeta(db, tableName);

                let body: any;
                try {
                    body = await parseBody(req);
                } catch {
                    throw badRequest('Invalid JSON body');
                }

                const { rows } = body || {};

                if (!Array.isArray(rows) || rows.length === 0) {
                    throw badRequest('Missing or invalid rows: must be a non-empty array');
                }
                if (rows.length > 1000) {
                    throw badRequest(`Too many rows: ${rows.length} exceeds maximum of 1000`);
                }

                // Validate every row before executing any deletes
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length === 0) {
                        throw badRequest(`Invalid row at index ${i}: must be a non-empty object`);
                    }
                    validatePkColumns(pkColumnNames, row);
                }

                // Execute all deletes in a transaction
                const whereClauses = [...pkColumnNames].map(col => `"${col}" = ?`).join(' AND ');
                const deleteStmt = db.prepare(`DELETE FROM "${tableName}" WHERE ${whereClauses}`);
                const pkCols = [...pkColumnNames];

                let totalDeleted = 0;
                const runTransaction = db.transaction(() => {
                    for (const row of rows) {
                        const params = pkCols.map(col => row[col]);
                        const result = deleteStmt.run(...params);
                        totalDeleted += result.changes;
                    }
                });
                runTransaction();

                sendJSON(res, 200, { deleted: totalDeleted, requested: rows.length });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}
