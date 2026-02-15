/**
 * Process REST API Handler
 *
 * HTTP API routes for CRUD operations on AI processes and workspace registration.
 * Wires the FileProcessStore to REST endpoints consumed by VS Code extensions and CLI clients.
 *
 * No VS Code dependencies - uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import * as url from 'url';
import type { ProcessStore, ProcessFilter, AIProcess, AIProcessStatus, AIProcessType, WorkspaceInfo } from '@plusplusoneplusplus/pipeline-core';
import { deserializeProcess } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import { handleProcessStream } from './sse-handler';

// ============================================================================
// Response Helpers
// ============================================================================

/** Write a JSON response with the correct Content-Type header. */
export function sendJSON(res: http.ServerResponse, statusCode: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

/** Write a JSON error envelope `{ error: message }`. */
export function sendError(res: http.ServerResponse, statusCode: number, message: string): void {
    sendJSON(res, statusCode, { error: message });
}

// ============================================================================
// Request Helpers
// ============================================================================

/** Read and JSON-parse the request body. Rejects on invalid JSON with 400. */
export async function parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(JSON.parse(raw));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

/** Valid AIProcessStatus values for validation. */
const VALID_STATUSES: Set<string> = new Set(['queued', 'running', 'completed', 'failed', 'cancelled']);

/** Terminal statuses that cannot be cancelled. */
const TERMINAL_STATUSES: Set<string> = new Set(['completed', 'failed', 'cancelled']);

/**
 * Extract filter parameters from URL query string into a typed ProcessFilter.
 * - `status` is parsed as comma-separated AIProcessStatus values (invalid values ignored).
 * - `since` is parsed as an ISO date string.
 * - `limit` and `offset` are parsed as integers.
 */
export function parseQueryParams(reqUrl: string): ProcessFilter {
    const parsed = url.parse(reqUrl, true);
    const query = parsed.query;
    const filter: ProcessFilter = {};

    if (typeof query.workspace === 'string' && query.workspace) {
        filter.workspaceId = query.workspace;
    }

    if (typeof query.status === 'string' && query.status) {
        const statuses = query.status
            .split(',')
            .map(s => s.trim())
            .filter(s => VALID_STATUSES.has(s)) as AIProcessStatus[];
        if (statuses.length > 0) {
            filter.status = statuses;
        }
    }

    if (typeof query.type === 'string' && query.type) {
        filter.type = query.type as AIProcessType;
    }

    if (typeof query.since === 'string' && query.since) {
        const date = new Date(query.since);
        if (!isNaN(date.getTime())) {
            filter.since = date;
        }
    }

    if (typeof query.limit === 'string' && query.limit) {
        const limit = parseInt(query.limit, 10);
        if (!isNaN(limit) && limit > 0) {
            filter.limit = limit;
        }
    }

    if (typeof query.offset === 'string' && query.offset) {
        const offset = parseInt(query.offset, 10);
        if (!isNaN(offset) && offset >= 0) {
            filter.offset = offset;
        }
    }

    return filter;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register all API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerApiRoutes(routes: Route[], store: ProcessStore): void {
    // ------------------------------------------------------------------
    // Workspace endpoints
    // ------------------------------------------------------------------

    // POST /api/workspaces — Register a workspace
    routes.push({
        method: 'POST',
        pattern: '/api/workspaces',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body.id || !body.name || !body.rootPath) {
                return sendError(res, 400, 'Missing required fields: id, name, rootPath');
            }

            const workspace: WorkspaceInfo = {
                id: body.id,
                name: body.name,
                rootPath: body.rootPath,
                color: body.color,
            };

            await store.registerWorkspace(workspace);
            sendJSON(res, 201, workspace);
        },
    });

    // GET /api/workspaces — List all workspaces
    routes.push({
        method: 'GET',
        pattern: '/api/workspaces',
        handler: async (_req, res) => {
            const workspaces = await store.getWorkspaces();
            sendJSON(res, 200, { workspaces });
        },
    });

    // ------------------------------------------------------------------
    // Process endpoints
    // ------------------------------------------------------------------

    // GET /api/processes — List processes with filtering + pagination
    routes.push({
        method: 'GET',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const filter = parseQueryParams(req.url || '/');

            // Get total count (without pagination) for the response
            const countFilter: ProcessFilter = { ...filter };
            delete countFilter.limit;
            delete countFilter.offset;
            const allMatching = await store.getAllProcesses(countFilter);
            const total = allMatching.length;

            // Apply pagination defaults
            const limit = filter.limit ?? 50;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const processes = await store.getAllProcesses(paginatedFilter);

            sendJSON(res, 200, { processes, total, limit, offset });
        },
    });

    // DELETE /api/processes — Bulk-clear processes by status
    routes.push({
        method: 'DELETE',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const statusParam = parsed.query.status;

            if (typeof statusParam !== 'string' || !statusParam) {
                return sendError(res, 400, 'Query parameter "status" is required for bulk delete');
            }

            const statuses = statusParam
                .split(',')
                .map(s => s.trim())
                .filter(s => VALID_STATUSES.has(s)) as AIProcessStatus[];

            if (statuses.length === 0) {
                return sendError(res, 400, 'No valid status values provided');
            }

            const removed = await store.clearProcesses({ status: statuses });
            sendJSON(res, 200, { removed });
        },
    });

    // POST /api/processes — Create a new process
    routes.push({
        method: 'POST',
        pattern: '/api/processes',
        handler: async (req, res) => {
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            if (!body.id || !body.promptPreview || !body.status || !body.startTime) {
                return sendError(res, 400, 'Missing required fields: id, promptPreview, status, startTime');
            }

            // Hydrate date strings via deserializeProcess
            const process: AIProcess = deserializeProcess({
                id: body.id,
                type: body.type,
                promptPreview: body.promptPreview,
                fullPrompt: body.fullPrompt || '',
                status: body.status,
                startTime: body.startTime,
                endTime: body.endTime,
                error: body.error,
                result: body.result,
                resultFilePath: body.resultFilePath,
                rawStdoutFilePath: body.rawStdoutFilePath,
                metadata: body.metadata,
                groupMetadata: body.groupMetadata,
                structuredResult: body.structuredResult,
                parentProcessId: body.parentProcessId,
                sdkSessionId: body.sdkSessionId,
                backend: body.backend,
                workingDirectory: body.workingDirectory,
            });

            // Tag with workspaceId if provided
            if (body.workspaceId) {
                process.metadata = {
                    type: process.metadata?.type ?? process.type ?? 'unknown',
                    ...process.metadata,
                    workspaceId: body.workspaceId,
                };
            }

            await store.addProcess(process);
            sendJSON(res, 201, process);
        },
    });

    // GET /api/processes/:id/stream — SSE stream for real-time output
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/stream$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            return handleProcessStream(req, res, id, store);
        },
    });

    // GET /api/processes/:id — Single process detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const process = await store.getProcess(id);
            if (!process) {
                return sendError(res, 404, 'Process not found');
            }
            sendJSON(res, 200, { process });
        },
    });

    // PATCH /api/processes/:id — Partial update
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const existing = await store.getProcess(id);
            if (!existing) {
                return sendError(res, 404, 'Process not found');
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return sendError(res, 400, 'Invalid JSON');
            }

            const updates: Partial<AIProcess> = {};
            if (body.status !== undefined) { updates.status = body.status; }
            if (body.result !== undefined) { updates.result = body.result; }
            if (body.error !== undefined) { updates.error = body.error; }
            if (body.endTime !== undefined) { updates.endTime = new Date(body.endTime); }
            if (body.structuredResult !== undefined) { updates.structuredResult = body.structuredResult; }
            if (body.metadata !== undefined) { updates.metadata = body.metadata; }

            await store.updateProcess(id, updates);
            const updated = await store.getProcess(id);
            sendJSON(res, 200, { process: updated });
        },
    });

    // DELETE /api/processes/:id — Remove a single process
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const existing = await store.getProcess(id);
            if (!existing) {
                return sendError(res, 404, 'Process not found');
            }
            await store.removeProcess(id);
            res.writeHead(204);
            res.end();
        },
    });

    // POST /api/processes/:id/cancel — Cancel a running process
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/cancel$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const existing = await store.getProcess(id);
            if (!existing) {
                return sendError(res, 404, 'Process not found');
            }

            if (TERMINAL_STATUSES.has(existing.status)) {
                return sendError(res, 409, `Process is already in terminal state: ${existing.status}`);
            }

            await store.updateProcess(id, {
                status: 'cancelled',
                endTime: new Date(),
            });

            const updated = await store.getProcess(id);
            sendJSON(res, 200, { process: updated });
        },
    });

    // ------------------------------------------------------------------
    // Stats endpoint
    // ------------------------------------------------------------------

    // GET /api/stats — Aggregate statistics
    routes.push({
        method: 'GET',
        pattern: '/api/stats',
        handler: async (_req, res) => {
            const allProcesses = await store.getAllProcesses();
            const workspaces = await store.getWorkspaces();

            const byStatus: Record<string, number> = {
                queued: 0,
                running: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
            };
            const workspaceCounts: Record<string, number> = {};

            for (const proc of allProcesses) {
                byStatus[proc.status] = (byStatus[proc.status] || 0) + 1;
                const wsId = proc.metadata?.workspaceId || '';
                workspaceCounts[wsId] = (workspaceCounts[wsId] || 0) + 1;
            }

            const byWorkspace = workspaces.map(ws => ({
                workspaceId: ws.id,
                name: ws.name,
                count: workspaceCounts[ws.id] || 0,
            }));

            sendJSON(res, 200, {
                totalProcesses: allProcesses.length,
                byStatus,
                byWorkspace,
            });
        },
    });
}
