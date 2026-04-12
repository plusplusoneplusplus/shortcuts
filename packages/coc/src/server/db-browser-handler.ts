/**
 * DB Browser Handler — read-only admin endpoints for inspecting the SQLite database.
 *
 * Exposes table list with row counts and paginated table data.
 * Only works when the process store is SQLite-backed.
 */

import * as url from 'url';
import type * as http from 'http';
import type { Route } from './types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON } from './api-handler';
import { handleAPIError, badRequest } from './errors';

/** Validates that a table name is a safe SQL identifier (letters, digits, underscores). */
function isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
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
                if (!tableName || !isValidIdentifier(tableName)) {
                    throw badRequest(`Invalid table name: ${tableName}`);
                }

                const db = store.getDatabase();

                // Verify table exists
                const tableExists = db.prepare(
                    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
                ).get(tableName) as { name: string } | undefined;

                if (!tableExists) {
                    throw badRequest(`Table not found: ${tableName}`);
                }

                // Parse pagination params
                const parsed = url.parse(req.url || '/', true);
                const page = Math.max(1, parseInt(parsed.query.page as string, 10) || 1);
                const pageSize = Math.min(200, Math.max(1, parseInt(parsed.query.pageSize as string, 10) || 50));
                const offset = (page - 1) * pageSize;

                // Column metadata
                const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as {
                    cid: number; name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
                }[];
                const columnNames = new Set(columns.map(c => c.name));

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
}
