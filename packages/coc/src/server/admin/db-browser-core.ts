import * as url from 'url';
import type { Database as DatabaseType } from 'better-sqlite3';
import { badRequest } from '../errors';

export interface DbBrowserColumn {
    name: string;
    type: string;
    notnull: boolean;
    pk: boolean;
}

export interface DbBrowserTable {
    name: string;
    rowCount: number;
}

export interface DbBrowserTableData {
    table: string;
    columns: DbBrowserColumn[];
    rows: Record<string, unknown>[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

interface ColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
}

export function isValidDbIdentifier(name: string): boolean {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

export function parseTableDataQuery(reqUrl: string | undefined): {
    page: number;
    pageSize: number;
    sortColumn?: string;
    sortOrder: 'ASC' | 'DESC';
    offset: number;
} {
    const parsed = url.parse(reqUrl || '/', true);
    const page = Math.max(1, parseInt(parsed.query.page as string, 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(parsed.query.pageSize as string, 10) || 50));
    const sortColumn = parsed.query.sort as string | undefined;
    const sortOrderRaw = (parsed.query.order as string || '').toLowerCase();
    const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC';
    return {
        page,
        pageSize,
        sortColumn,
        sortOrder,
        offset: (page - 1) * pageSize,
    };
}

export function validateTableAndGetMeta(db: DatabaseType, tableName: string): {
    columns: ColumnInfo[];
    columnNames: Set<string>;
    pkColumnNames: Set<string>;
} {
    if (!tableName || !isValidDbIdentifier(tableName)) {
        throw badRequest(`Invalid table name: ${tableName}`);
    }

    const tableExists = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(tableName) as { name: string } | undefined;

    if (!tableExists) {
        throw badRequest(`Table not found: ${tableName}`);
    }

    const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all() as ColumnInfo[];
    const columnNames = new Set(columns.map(c => c.name));
    const pkColumnNames = new Set(columns.filter(c => c.pk > 0).map(c => c.name));

    return { columns, columnNames, pkColumnNames };
}

export function listTables(db: DatabaseType): DbBrowserTable[] {
    const rows = db.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    ).all() as { name: string }[];

    return rows.map(row => {
        const count = db.prepare(`SELECT COUNT(*) AS cnt FROM "${row.name}"`).get() as { cnt: number };
        return { name: row.name, rowCount: count.cnt };
    });
}

export function getTableData(db: DatabaseType, tableName: string, reqUrl: string | undefined): DbBrowserTableData {
    const { columns, columnNames } = validateTableAndGetMeta(db, tableName);
    const { page, pageSize, sortColumn, sortOrder, offset } = parseTableDataQuery(reqUrl);
    const hasValidSort = sortColumn !== undefined && sortColumn !== '' && columnNames.has(sortColumn);
    const total = (db.prepare(`SELECT COUNT(*) AS cnt FROM "${tableName}"`).get() as { cnt: number }).cnt;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const orderClause = hasValidSort ? ` ORDER BY "${sortColumn}" ${sortOrder}` : '';
    const rows = db.prepare(`SELECT * FROM "${tableName}"${orderClause} LIMIT ? OFFSET ?`).all(pageSize, offset) as Record<string, unknown>[];

    return {
        table: tableName,
        columns: columns.map(c => ({ name: c.name, type: c.type, notnull: !!c.notnull, pk: !!c.pk })),
        rows,
        total,
        page,
        pageSize,
        totalPages,
    };
}

export function validatePkColumns(pkColumnNames: Set<string>, providedPk: Record<string, unknown>): void {
    for (const key of Object.keys(providedPk)) {
        if (!pkColumnNames.has(key)) {
            throw badRequest(`Column "${key}" is not a primary key column`);
        }
    }
}

export function validateColumnNames(columnNames: Set<string>, providedNames: string[], tableName: string): void {
    for (const key of providedNames) {
        if (!columnNames.has(key)) {
            throw badRequest(`Column "${key}" does not exist in table "${tableName}"`);
        }
    }
}

export function updateRow(
    db: DatabaseType,
    tableName: string,
    pkColumns: Record<string, unknown>,
    updates: Record<string, unknown>,
): { row: Record<string, unknown>; changes: number } | undefined {
    const { columnNames, pkColumnNames } = validateTableAndGetMeta(db, tableName);
    validatePkColumns(pkColumnNames, pkColumns);
    validateColumnNames(columnNames, Object.keys(updates), tableName);

    for (const key of Object.keys(updates)) {
        if (pkColumnNames.has(key)) {
            throw badRequest(`Cannot update primary key column "${key}"`);
        }
    }

    const setClauses = Object.keys(updates).map(col => `"${col}" = ?`);
    const whereClauses = Object.keys(pkColumns).map(col => `"${col}" = ?`);
    const params = [...Object.values(updates), ...Object.values(pkColumns)];
    const result = db.prepare(`UPDATE "${tableName}" SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`).run(...params);

    if (result.changes === 0) return undefined;

    const row = db.prepare(
        `SELECT * FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`,
    ).get(...Object.values(pkColumns)) as Record<string, unknown>;

    return { row, changes: result.changes };
}

export function deleteRow(
    db: DatabaseType,
    tableName: string,
    pkColumns: Record<string, unknown>,
): number {
    const { pkColumnNames } = validateTableAndGetMeta(db, tableName);
    validatePkColumns(pkColumnNames, pkColumns);

    const whereClauses = Object.keys(pkColumns).map(col => `"${col}" = ?`);
    const result = db.prepare(`DELETE FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`).run(...Object.values(pkColumns));
    return result.changes;
}

export function deleteRowsBulk(
    db: DatabaseType,
    tableName: string,
    rows: Record<string, unknown>[],
): { deleted: number; requested: number } {
    const { pkColumnNames } = validateTableAndGetMeta(db, tableName);

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length === 0) {
            throw badRequest(`Invalid row at index ${i}: must be a non-empty object`);
        }
        validatePkColumns(pkColumnNames, row);
    }

    const pkCols = [...pkColumnNames];
    const whereClauses = pkCols.map(col => `"${col}" = ?`).join(' AND ');
    const deleteStmt = db.prepare(`DELETE FROM "${tableName}" WHERE ${whereClauses}`);

    let totalDeleted = 0;
    const runTransaction = db.transaction(() => {
        for (const row of rows) {
            const params = pkCols.map(col => row[col]);
            totalDeleted += deleteStmt.run(...params).changes;
        }
    });
    runTransaction();

    return { deleted: totalDeleted, requested: rows.length };
}
