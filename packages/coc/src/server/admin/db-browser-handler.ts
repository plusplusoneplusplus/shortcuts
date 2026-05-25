/**
 * Generic DB Browser Handler.
 *
 * Exposes a single source-based API for approved SQLite databases. Sources are
 * resolved server-side; callers never provide filesystem paths or SQL strings.
 */

import * as url from 'url';
import type * as http from 'http';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { Route } from '../types';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { sendJSON, parseBody } from '../core/api-handler';
import { APIError, badRequest, forbidden, handleAPIError, notFound } from '../errors';
import {
    deleteRow,
    deleteRowsBulk,
    getTableData,
    isValidDbIdentifier,
    listTables,
    updateRow,
} from './db-browser-core';

type DbBrowserSourceId = 'process-db';

interface DbBrowserSourceCapabilities {
    readonly: boolean;
    updateRows: boolean;
    deleteRows: boolean;
    bulkDeleteRows: boolean;
}

interface DbBrowserSourceMetadata {
    id: DbBrowserSourceId;
    label: string;
    description: string;
    requiredParams: string[];
    capabilities: DbBrowserSourceCapabilities;
}

interface ResolvedDbSource {
    metadata: DbBrowserSourceMetadata;
    db?: DatabaseType;
    missing?: boolean;
    close?: () => void;
}

const PROCESS_DB_SOURCE: DbBrowserSourceMetadata = {
    id: 'process-db',
    label: 'Process database',
    description: 'Main CoC SQLite process store database.',
    requiredParams: [],
    capabilities: { readonly: false, updateRows: true, deleteRows: true, bulkDeleteRows: true },
};

const SOURCES = [PROCESS_DB_SOURCE] as const;

function getQuery(req: http.IncomingMessage): Record<string, string | string[] | undefined> {
    return url.parse(req.url || '/', true).query;
}

function getSingleQueryParam(query: Record<string, string | string[] | undefined>, name: string): string | undefined {
    const value = query[name];
    if (Array.isArray(value)) return value[0];
    return value;
}

function parseSourceId(rawSourceId: string): DbBrowserSourceId {
    const sourceId = decodeURIComponent(rawSourceId);
    if (sourceId === PROCESS_DB_SOURCE.id) {
        return sourceId;
    }
    throw notFound(`DB browser source "${sourceId}"`);
}

function resolveSource(sourceId: DbBrowserSourceId, _req: http.IncomingMessage, store: ProcessStore, _dataDir: string): ResolvedDbSource {
    if (sourceId === 'process-db') {
        if (!(store instanceof SqliteProcessStore)) {
            throw new APIError(501, 'Database browser source "process-db" is only available with the SQLite store backend.', 'NOT_IMPLEMENTED');
        }
        return { metadata: PROCESS_DB_SOURCE, db: store.getDatabase() };
    }
    throw notFound(`DB browser source "${sourceId}"`);
}

function assertWritable(source: ResolvedDbSource, capability: keyof Pick<DbBrowserSourceCapabilities, 'updateRows' | 'deleteRows' | 'bulkDeleteRows'>): void {
    if (!source.metadata.capabilities[capability]) {
        throw forbidden(`DB browser source "${source.metadata.id}" is read-only.`);
    }
}

async function parseObjectBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    let body: unknown;
    try {
        body = await parseBody(req);
    } catch {
        throw badRequest('Invalid JSON body');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw badRequest('Invalid JSON body: expected an object');
    }
    return body as Record<string, unknown>;
}

function getTableName(match: RegExpMatchArray, index: number): string {
    const tableName = decodeURIComponent(match[index]);
    if (!isValidDbIdentifier(tableName)) {
        throw badRequest(`Invalid table name: ${tableName}`);
    }
    return tableName;
}

function withResolvedSource(
    req: http.IncomingMessage,
    store: ProcessStore,
    dataDir: string,
    rawSourceId: string,
    callback: (source: ResolvedDbSource) => void,
): void {
    const sourceId = parseSourceId(rawSourceId);
    const resolved = resolveSource(sourceId, req, store, dataDir);
    try {
        callback(resolved);
    } finally {
        resolved.close?.();
    }
}

export function registerDbBrowserRoutes(routes: Route[], store: ProcessStore, dataDir: string): void {
    routes.push({
        method: 'GET',
        pattern: '/api/db-browser/sources',
        handler: async (_req, res) => {
            sendJSON(res, 200, { sources: SOURCES });
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/db-browser\/([^/]+)\/tables$/,
        handler: async (req, res, match) => {
            try {
                withResolvedSource(req, store, dataDir, match![1], (source) => {
                    if (source.missing) {
                        sendJSON(res, 200, { source: source.metadata, tables: [] });
                        return;
                    }
                    sendJSON(res, 200, { source: source.metadata, tables: listTables(source.db!) });
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'GET',
        pattern: /^\/api\/db-browser\/([^/]+)\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)$/,
        handler: async (req, res, match) => {
            try {
                const tableName = getTableName(match!, 2);
                withResolvedSource(req, store, dataDir, match![1], (source) => {
                    if (source.missing) {
                        throw notFound(`Database for source "${source.metadata.id}"`);
                    }
                    sendJSON(res, 200, getTableData(source.db!, tableName, req.url));
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'PUT',
        pattern: /^\/api\/db-browser\/([^/]+)\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows$/,
        handler: async (req, res, match) => {
            try {
                const tableName = getTableName(match!, 2);
                const body = await parseObjectBody(req);
                const { pkColumns, updates } = body;
                if (!pkColumns || typeof pkColumns !== 'object' || Array.isArray(pkColumns) || Object.keys(pkColumns).length === 0) {
                    throw badRequest('Missing or invalid pkColumns: must be a non-empty object');
                }
                if (!updates || typeof updates !== 'object' || Array.isArray(updates) || Object.keys(updates).length === 0) {
                    throw badRequest('Missing or invalid updates: must be a non-empty object');
                }

                withResolvedSource(req, store, dataDir, match![1], (source) => {
                    assertWritable(source, 'updateRows');
                    const result = updateRow(source.db!, tableName, pkColumns as Record<string, unknown>, updates as Record<string, unknown>);
                    if (!result) {
                        sendJSON(res, 404, { error: 'Row not found' });
                        return;
                    }
                    sendJSON(res, 200, result);
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/db-browser\/([^/]+)\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows$/,
        handler: async (req, res, match) => {
            try {
                const tableName = getTableName(match!, 2);
                const body = await parseObjectBody(req);
                const { pkColumns } = body;
                if (!pkColumns || typeof pkColumns !== 'object' || Array.isArray(pkColumns) || Object.keys(pkColumns).length === 0) {
                    throw badRequest('Missing or invalid pkColumns: must be a non-empty object');
                }

                withResolvedSource(req, store, dataDir, match![1], (source) => {
                    assertWritable(source, 'deleteRows');
                    const deleted = deleteRow(source.db!, tableName, pkColumns as Record<string, unknown>);
                    if (deleted === 0) {
                        sendJSON(res, 404, { error: 'Row not found' });
                        return;
                    }
                    sendJSON(res, 200, { deleted });
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });

    routes.push({
        method: 'POST',
        pattern: /^\/api\/db-browser\/([^/]+)\/tables\/([a-zA-Z_][a-zA-Z0-9_]*)\/rows\/delete-bulk$/,
        handler: async (req, res, match) => {
            try {
                const tableName = getTableName(match!, 2);
                const body = await parseObjectBody(req);
                const { rows } = body;
                if (!Array.isArray(rows) || rows.length === 0) {
                    throw badRequest('Missing or invalid rows: must be a non-empty array');
                }
                if (rows.length > 1000) {
                    throw badRequest(`Too many rows: ${rows.length} exceeds maximum of 1000`);
                }

                withResolvedSource(req, store, dataDir, match![1], (source) => {
                    assertWritable(source, 'bulkDeleteRows');
                    sendJSON(res, 200, deleteRowsBulk(source.db!, tableName, rows as Record<string, unknown>[]));
                });
            } catch (err) {
                handleAPIError(res, err);
            }
        },
    });
}
