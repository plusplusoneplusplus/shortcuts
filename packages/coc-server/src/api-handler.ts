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
import * as path from 'path';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import type { ProcessStore, ProcessFilter, AIProcess, AIProcessStatus, AIProcessType, WorkspaceInfo, ConversationTurn, CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
import { deserializeProcess, GitRangeService, BranchService, WorkingTreeService, loadDefaultMcpConfig, detectRemoteUrl, GitOpsStore } from '@plusplusoneplusplus/pipeline-core';
import type { Attachment, GitOpJob } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import { handleProcessStream, emitMessageQueued } from './sse-handler';
import { handleAPIError, missingFields, notFound, badRequest, internalError, conflict, APIError } from './errors';
import { saveImagesToTempFiles, cleanupTempDir, isImageDataUrl } from './image-utils';
import { gitCache } from './git-cache';
import { registerSkillRoutes } from './skill-handler';
import { registerGlobalSkillRoutes } from './global-skill-handler';
import type { ProcessWebSocketServer } from './websocket';
import { getServerLogger } from './server-logger';
import { resolveWorkspaceOrFail, parseBodyOrReject } from './shared/handler-utils';

/**
 * Bridge interface for executing follow-up messages on existing AI sessions.
 * The full implementation lives in `packages/coc` (queue-executor-bridge.ts)
 * and will be moved in a later commit.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    /** Enqueue a task through the scheduler. When present, follow-ups are routed through the queue. */
    enqueue?(input: CreateTaskInput): Promise<string>;
    /** Find a task by its processId. Used to locate the parent chat task for follow-up re-activation. */
    findTaskByProcessId?(processId: string): { id: string; type: string; status: string } | undefined;
    /** Requeue an existing task for a follow-up message (reuses the parent task instead of creating a ghost child). */
    requeueForFollowUp?(taskId: string, prompt: string, attachments?: Attachment[], imageTempDir?: string, mode?: string, deliveryMode?: string): Promise<void>;
    /** Cancel a running process by aborting its live AI session. */
    cancelProcess?(processId: string): Promise<void>;
}

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
                const raw = Buffer.concat(chunks).toString('utf-8').trim();
                if (!raw) { resolve({}); return; }
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

/** Valid exclude field values for the `exclude` query parameter. */
const VALID_EXCLUDE_FIELDS: Set<string> = new Set(['conversation', 'toolCalls']);

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

    if (typeof query.parentProcessId === 'string' && query.parentProcessId) {
        filter.parentProcessId = query.parentProcessId;
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

    if (typeof query.exclude === 'string' && query.exclude) {
        const excludeFields = query.exclude
            .split(',')
            .map(s => s.trim())
            .filter(s => VALID_EXCLUDE_FIELDS.has(s));
        if (excludeFields.length > 0) {
            filter.exclude = excludeFields;
        }
    }

    return filter;
}

/**
 * Strip heavy fields from a process for lightweight list responses.
 * When `exclude` contains 'conversation', removes conversationTurns, fullPrompt,
 * result, and structuredResult to reduce payload size (~100KB → ~5KB per process).
 */
export function stripExcludedFields(process: any, exclude?: string[]): any {
    if (!exclude || exclude.length === 0) return process;

    // Strip entire conversation data
    if (exclude.includes('conversation')) {
        const { conversationTurns, fullPrompt, result, structuredResult, ...lightweight } = process;
        return lightweight;
    }

    // Strip tool calls from conversation turns
    if (exclude.includes('toolCalls')) {
        if (process.conversationTurns) {
            const turnsWithoutTools = process.conversationTurns.map((turn: any) => {
                const { toolCalls, ...turnWithoutTools } = turn;
                return turnWithoutTools;
            });
            return { ...process, conversationTurns: turnsWithoutTools };
        }
    }

    return process;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Detect and persist the remote URL for a workspace if it has changed.
 * Returns the detected URL (or undefined if not a git repo / no remotes).
 */
async function syncRemoteUrl(ws: WorkspaceInfo, store: ProcessStore): Promise<string | undefined> {
    const remoteUrl = detectRemoteUrl(ws.rootPath);
    if (remoteUrl && remoteUrl !== ws.remoteUrl) {
        await store.updateWorkspace(ws.id, { remoteUrl });
    }
    return remoteUrl;
}

/**
 * Register all API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerApiRoutes(routes: Route[], store: ProcessStore, bridge?: QueueExecutorBridge, dataDir?: string, getWsServer?: () => ProcessWebSocketServer | undefined): void {
    // Wrap routes.push to automatically log API mutations (POST/PATCH/DELETE).
    // This is done once here so all 54 route registrations below get audit logging
    // without touching each handler individually.
    const MUTATION_METHODS = new Set(['POST', 'PATCH', 'DELETE']);
    const _origPush = routes.push.bind(routes);
    (routes as any).push = (...items: Route[]) => {
        for (const route of items) {
            const method = (route.method || 'GET').toUpperCase();
            if (MUTATION_METHODS.has(method)) {
                const orig = route.handler;
                _origPush({
                    ...route,
                    handler: async (req: http.IncomingMessage, res: http.ServerResponse, match?: RegExpMatchArray) => {
                        const pathname = url.parse(req.url || '/').pathname || '/';
                        const parts = pathname.split('/').filter(Boolean);
                        const resource = parts[1] || 'unknown';
                        const id = parts[2] ? decodeURIComponent(parts[2]) : undefined;
                        getServerLogger().info(
                            { method, resource, ...(id !== undefined ? { id } : {}) },
                            'API mutation'
                        );
                        return orig(req, res, match);
                    },
                });
            } else {
                _origPush(route);
            }
        }
        return routes.length;
    };

    try {

    // Git ops store — persists background git operation status for page-refresh recovery
    const gitOpsStore = new GitOpsStore({ dataDir: dataDir ?? undefined });
    // Mark any orphaned running jobs from a previous server session
    gitOpsStore.markStaleRunningJobs().catch(() => {});

    // POST /api/workspaces — Register a workspace
    routes.push({
        method: 'POST',
        pattern: '/api/workspaces',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.id || !body.name || !body.rootPath) {
                return handleAPIError(res, missingFields(['id', 'name', 'rootPath']));
            }

            // Auto-detect git remote URL if not explicitly provided
            let remoteUrl: string | undefined = body.remoteUrl;
            if (!remoteUrl) {
                remoteUrl = detectRemoteUrl(body.rootPath);
            }

            const workspace: WorkspaceInfo = {
                id: body.id,
                name: body.name,
                rootPath: body.rootPath,
                color: body.color,
                remoteUrl,
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

    // GET /api/workspaces/discover?path=<dir> — Scan a directory for git repos not yet registered
    routes.push({
        method: 'GET',
        pattern: '/api/workspaces/discover',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '', true);
            const dirPath = parsed.query['path'] as string | undefined;

            if (!dirPath) {
                return handleAPIError(res, badRequest('path query parameter is required'));
            }

            const resolvedPath = path.resolve(dirPath);

            if (!fs.existsSync(resolvedPath)) {
                return handleAPIError(res, badRequest('path does not exist'));
            }

            let stat: fs.Stats;
            try {
                stat = fs.statSync(resolvedPath);
            } catch {
                return handleAPIError(res, badRequest('path is not accessible'));
            }

            if (!stat.isDirectory()) {
                return handleAPIError(res, badRequest('path is not a directory'));
            }

            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(resolvedPath, { withFileTypes: true });
            } catch {
                return handleAPIError(res, badRequest('unable to read directory'));
            }

            const existingWorkspaces = await store.getWorkspaces();
            const registeredPaths = new Set(
                existingWorkspaces.map(ws => path.resolve(ws.rootPath))
            );

            const repos: Array<{ path: string; name: string }> = [];
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const childPath = path.join(resolvedPath, entry.name);
                if (!fs.existsSync(path.join(childPath, '.git'))) continue;
                if (registeredPaths.has(path.resolve(childPath))) continue;
                repos.push({ path: childPath, name: path.basename(childPath) });
            }

            sendJSON(res, 200, { repos });
        },
    });

    // DELETE /api/workspaces/:id — Remove a workspace
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const removed = await store.removeWorkspace(id);
            if (!removed) {
                return handleAPIError(res, notFound('Workspace'));
            }
            res.writeHead(204);
            res.end();
        },
    });

    // PATCH /api/workspaces/:id — Update workspace fields
    routes.push({
        method: 'PATCH',
        pattern: /^\/api\/workspaces\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const updates: Partial<Omit<WorkspaceInfo, 'id'>> = {};
            if (body.name !== undefined) { updates.name = body.name; }
            if (body.color !== undefined) { updates.color = body.color; }
            if (body.rootPath !== undefined) { updates.rootPath = body.rootPath; }
            if (body.remoteUrl !== undefined) { updates.remoteUrl = body.remoteUrl; }

            const updated = await store.updateWorkspace(id, updates);
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/git-info — Git branch and status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git-info$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const dirty = getBranchService().hasUncommittedChanges(ws.rootPath);
            const branchStatus = getBranchService().getBranchStatus(ws.rootPath, dirty);

            if (!branchStatus) {
                // Even when branch status is unavailable (e.g. no commits yet, detached HEAD
                // edge cases), still attempt to detect the remote URL so that the repo can
                // be grouped correctly in the sidebar.
                const remoteUrl = await syncRemoteUrl(ws, store);
                sendJSON(res, 200, { branch: null, dirty: false, isGitRepo: false, remoteUrl: remoteUrl || null });
                return;
            }

            const branch = getGitRangeService().getCurrentBranch(ws.rootPath);
            const remoteUrl = await syncRemoteUrl(ws, store);
            const ahead = branchStatus.ahead;
            const behind = branchStatus.behind;

            sendJSON(res, 200, { branch, dirty, ahead, behind, isGitRepo: true, remoteUrl: remoteUrl || null });
        },
    });

    // POST /api/git-info/batch — Fetch git-info for multiple workspaces in one round-trip
    routes.push({
        method: 'POST',
        pattern: '/api/git-info/batch',
        handler: async (req, res) => {
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            const { workspaceIds } = body;
            if (!Array.isArray(workspaceIds)) {
                return handleAPIError(res, missingFields(['workspaceIds']));
            }

            const workspaces = await store.getWorkspaces();
            const wsMap = new Map(workspaces.map(w => [w.id, w]));

            const CONCURRENCY = 4;
            const results: Record<string, any> = {};
            for (let i = 0; i < workspaceIds.length; i += CONCURRENCY) {
                const batch = workspaceIds.slice(i, i + CONCURRENCY);
                await Promise.all(batch.map(async (wsId: string) => {
                    const ws = wsMap.get(wsId);
                    if (!ws) { results[wsId] = null; return; }

                    try {
                        const dirty = getBranchService().hasUncommittedChanges(ws.rootPath);
                        const branchStatus = getBranchService().getBranchStatus(ws.rootPath, dirty);
                        if (!branchStatus) {
                            // Even when branch status is unavailable, still detect remoteUrl
                            // so Azure DevOps repos without commits still get grouped.
                            const remoteUrl = await syncRemoteUrl(ws, store);
                            results[wsId] = { branch: null, dirty: false, isGitRepo: false, remoteUrl: remoteUrl || null };
                            return;
                        }
                        const branch = getGitRangeService().getCurrentBranch(ws.rootPath);
                        const remoteUrl = await syncRemoteUrl(ws, store);
                        results[wsId] = {
                            branch, dirty,
                            ahead: branchStatus.ahead, behind: branchStatus.behind,
                            isGitRepo: true, remoteUrl: remoteUrl || null,
                        };
                    } catch {
                        results[wsId] = null;
                    }
                }));
            }

            sendJSON(res, 200, { results });
        },
    });

    // GET /api/workspaces/:id/mcp-config — Get available MCP servers and workspace-enabled list
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const { mcpServers } = loadDefaultMcpConfig();
            const availableServers = Object.entries(mcpServers).map(([name, config]) => ({
                name,
                type: config.type ?? 'stdio',
                ...('url' in config && config.url ? { url: config.url } : {}),
            }));
            const enabledMcpServers = ws.enabledMcpServers ?? null;
            sendJSON(res, 200, { availableServers, enabledMcpServers });
        },
    });

    // PUT /api/workspaces/:id/mcp-config — Save workspace-enabled MCP server list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/mcp-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Object.prototype.hasOwnProperty.call(body, 'enabledMcpServers')) {
                return handleAPIError(res, missingFields(['enabledMcpServers']));
            }
            if (body.enabledMcpServers !== null && !Array.isArray(body.enabledMcpServers)) {
                return handleAPIError(res, badRequest('`enabledMcpServers` must be an array of strings or null'));
            }
            if (Array.isArray(body.enabledMcpServers) && body.enabledMcpServers.some((e: any) => typeof e !== 'string')) {
                return handleAPIError(res, badRequest('`enabledMcpServers` items must be strings'));
            }
            const updated = await store.updateWorkspace(id, { enabledMcpServers: body.enabledMcpServers });
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/skills-config — Get workspace skill list and disabled skills
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills-config$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const disabledSkills: string[] = ws.disabledSkills ?? [];
            sendJSON(res, 200, { disabledSkills });
        },
    });

    // PUT /api/workspaces/:id/skills-config — Save workspace disabled skills list
    routes.push({
        method: 'PUT',
        pattern: /^\/api\/workspaces\/([^/]+)\/skills-config$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Object.prototype.hasOwnProperty.call(body, 'disabledSkills')) {
                return handleAPIError(res, missingFields(['disabledSkills']));
            }
            if (!Array.isArray(body.disabledSkills)) {
                return handleAPIError(res, badRequest('`disabledSkills` must be an array of strings'));
            }
            if (body.disabledSkills.some((e: any) => typeof e !== 'string')) {
                return handleAPIError(res, badRequest('`disabledSkills` items must be strings'));
            }
            const updated = await store.updateWorkspace(id, { disabledSkills: body.disabledSkills });
            if (!updated) {
                return handleAPIError(res, notFound('Workspace'));
            }
            sendJSON(res, 200, { workspace: updated });
        },
    });

    // GET /api/workspaces/:id/git/commits — List commits with pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const parsed = url.parse(req.url || '/', true);
            const limit = Math.min(Math.max(parseInt(String(parsed.query.limit || '50'), 10) || 50, 1), 200);
            const skip = Math.max(parseInt(String(parsed.query.skip || '0'), 10) || 0, 0);
            const refresh = parsed.query.refresh === 'true';

            if (refresh) {
                gitCache.invalidateMutable(id);
            }

            const cacheKey = `${id}:commits:${limit}:${skip}`;
            const cached = gitCache.get<{ commits: any[]; unpushedCount: number }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const raw = execGitSync(
                    `log --format="${format}" --skip=${skip} --max-count=${limit} -z`,
                    ws.rootPath
                );

                const commits: Array<{
                    hash: string; shortHash: string; subject: string;
                    author: string; authorEmail: string; date: string; parentHashes: string[];
                    body: string;
                }> = [];

                if (raw.trim()) {
                    const entries = raw.split('\0').filter(Boolean);
                    for (const entry of entries) {
                        const lines = entry.split('\n');
                        if (lines.length >= 6) {
                            commits.push({
                                hash: lines[0],
                                shortHash: lines[1],
                                subject: lines[2],
                                author: lines[3],
                                authorEmail: lines[4],
                                date: lines[5],
                                parentHashes: lines[6] ? lines[6].split(' ').filter(Boolean) : [],
                                body: lines.slice(7).join('\n').trim(),
                            });
                        }
                    }
                }

                // Determine unpushed count
                let unpushedCount = 0;
                const branchStatus = getBranchService().getBranchStatus(ws.rootPath, false);
                if (branchStatus) {
                    unpushedCount = branchStatus.ahead;
                }

                const result = { commits, unpushedCount };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch {
                sendJSON(res, 200, { commits: [], unpushedCount: 0 });
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash — Single commit details
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit:${hash}`;
            const cached = gitCache.get<Record<string, string>>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const format = '%H%n%h%n%s%n%an%n%ae%n%aI%n%P%n%b';
                const raw = execGitSync(`log -1 --format="${format}" ${hash}`, ws.rootPath);
                const lines = raw.trim().split('\n');
                if (lines.length < 6) {
                    return handleAPIError(res, notFound('Commit'));
                }
                const result = {
                    hash: lines[0],
                    shortHash: lines[1],
                    subject: lines[2],
                    author: lines[3],
                    authorEmail: lines[4],
                    date: lines[5],
                    parentHashes: lines[6] ? lines[6].split(' ').filter(Boolean) : [],
                    body: lines.slice(7).join('\n').trim(),
                };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch {
                return handleAPIError(res, notFound('Commit'));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files — Files changed in a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit-files:${hash}`;
            const cached = gitCache.get<{ files: any[] }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const raw = execGitSync(`diff-tree --no-commit-id -r --name-status ${hash}`, ws.rootPath);
                const files: Array<{ status: string; path: string }> = [];
                for (const line of raw.split('\n').filter(Boolean)) {
                    const [status, ...pathParts] = line.split('\t');
                    if (status && pathParts.length > 0) {
                        files.push({ status: status.charAt(0), path: pathParts.join('\t') });
                    }
                }
                const result = { files };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit files: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/diff — Full diff for a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];

            const cacheKey = `${id}:commit-diff:${hash}`;
            const cached = gitCache.get<{ diff: string }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const diff = execGitSync(`show --format="" --patch ${hash}`, ws.rootPath);
                const result = { diff };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files/*/diff — Per-file diff for a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];
            const filePath = decodeURIComponent(match![3]);

            const cacheKey = `${id}:commit-file-diff:${hash}:${filePath}`;
            const cached = gitCache.get<{ diff: string }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const diff = execGitSync(`show --format="" --patch -U99999 ${hash} -- ${filePath}`, ws.rootPath);
                const result = { diff };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit file diff: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files/*/content — Full file content for a commit file
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files\/(.+)\/content$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;
            const hash = match![2];
            const filePath = decodeURIComponent(match![3]);

            const cacheKey = `${id}:commit-file-content:${hash}:${filePath}`;
            const cached = gitCache.get<{
                path: string;
                fileName: string;
                lines: string[];
                totalLines: number;
                truncated: boolean;
                language: string;
                resolvedRef: string;
            }>(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const { content, resolvedRef } = readGitFileAtCommit(hash, filePath, ws.rootPath);
                if (Buffer.byteLength(content, 'utf-8') > 2 * 1024 * 1024) {
                    return handleAPIError(res, badRequest('Commit file is too large (max 2MB)'));
                }

                const allLines = content.split('\n');
                if (allLines.length > 0 && allLines[allLines.length - 1] === '') {
                    allLines.pop();
                }

                const ext = path.extname(filePath).toLowerCase();
                const result = {
                    path: filePath,
                    fileName: path.basename(filePath),
                    lines: allLines,
                    totalLines: allLines.length,
                    truncated: false,
                    language: ext.startsWith('.') ? ext.slice(1) : ext,
                    resolvedRef,
                };
                gitCache.set(cacheKey, result);
                sendJSON(res, 200, result);
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit file content: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range — Detect feature branch commit range
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const parsed = url.parse(req.url || '/', true);
            const refresh = parsed.query.refresh === 'true';

            if (refresh) {
                gitCache.invalidateMutable(id);
            }

            const cacheKey = `${id}:branch-range`;
            const cached = gitCache.get(cacheKey);
            if (cached) {
                return sendJSON(res, 200, cached);
            }

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    const result = { onDefaultBranch: true };
                    gitCache.set(cacheKey, result);
                    return sendJSON(res, 200, result);
                }
                gitCache.set(cacheKey, range);
                sendJSON(res, 200, range);
            } catch {
                sendJSON(res, 200, { onDefaultBranch: true });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/files — List changed files in branch range
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { files: [] });
                }
                sendJSON(res, 200, { files: range.files });
            } catch {
                sendJSON(res, 200, { files: [] });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/diff — Full range diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { diff: '' });
                }
                const diff = rangeService.getRangeDiff(ws.rootPath, range.baseRef, 'HEAD');
                sendJSON(res, 200, { diff });
            } catch {
                sendJSON(res, 200, { diff: '' });
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range/files/*/diff — Per-file diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range\/files\/(.+)\/diff$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match![2]);

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { diff: '', path: filePath });
                }
                const diff = rangeService.getFileDiff(ws.rootPath, range.baseRef, 'HEAD', filePath);
                sendJSON(res, 200, { diff, path: filePath });
            } catch {
                sendJSON(res, 200, { diff: '', path: filePath });
            }
        },
    });

    // ------------------------------------------------------------------
    // Branch management endpoints (via BranchService)
    // ------------------------------------------------------------------

    const branchService = new BranchService();

    // GET /api/workspaces/:id/git/branches — List branches with pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const parsed = url.parse(req.url!, true).query;
                const type = (parsed.type as string) || 'all';
                const limit = Math.min(parseInt(parsed.limit as string) || 100, 500);
                const offset = parseInt(parsed.offset as string) || 0;
                const searchPattern = (parsed.search as string) || undefined;
                const options = { limit, offset, searchPattern };

                let result: Record<string, unknown> = {};
                if (type === 'local') {
                    result = { local: branchService.getLocalBranchesPaginated(ws.rootPath, options) };
                } else if (type === 'remote') {
                    result = { remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options) };
                } else {
                    result = {
                        local: branchService.getLocalBranchesPaginated(ws.rootPath, options),
                        remote: branchService.getRemoteBranchesPaginated(ws.rootPath, options),
                    };
                }
                sendJSON(res, 200, result);
            } catch (err) {
                return handleAPIError(res, err);
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-status — Current branch status
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-status$/,
        handler: async (_req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            try {
                const uncommitted = branchService.hasUncommittedChanges(ws.rootPath);
                const status = branchService.getBranchStatus(ws.rootPath, uncommitted);
                sendJSON(res, 200, status);
            } catch (err) {
                return handleAPIError(res, err);
            }
        },
    });

    // POST /api/workspaces/:id/git/branches — Create a new branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.name) {
                return handleAPIError(res, missingFields(['name']));
            }

            const checkout = body.checkout ?? false;
            const result = await branchService.createBranch(ws.rootPath, body.name, checkout);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/branches/switch — Switch to a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/switch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.name) {
                return handleAPIError(res, missingFields(['name']));
            }

            const result = await branchService.switchBranch(ws.rootPath, body.name, { force: body.force ?? false });
            getWsServer?.()?.broadcastGitChanged(id, 'branch-switch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/branches/rename — Rename a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/rename$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.oldName || !body.newName) {
                return handleAPIError(res, missingFields(['oldName', 'newName']));
            }

            const result = await branchService.renameBranch(ws.rootPath, body.oldName, body.newName);
            sendJSON(res, 200, result);
        },
    });

    // DELETE /api/workspaces/:id/git/branches/:name — Delete a branch
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/(.+)$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const branchName = decodeURIComponent(match![2]);
            const parsed = url.parse(req.url!, true).query;
            const force = parsed.force === 'true';
            const result = await branchService.deleteBranch(ws.rootPath, branchName, force);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/push — Push to remote
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/push$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {}; // empty body is acceptable; setUpstream defaults to false
            }

            const setUpstream = body.setUpstream === true;
            const result = await branchService.push(ws.rootPath, setUpstream);
            getWsServer?.()?.broadcastGitChanged(id, 'push');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/pull — Pull from remote (async background job)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/pull$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            // Guard against concurrent pulls
            const running = await gitOpsStore.getRunning(id, 'pull');
            if (running.length > 0) {
                return handleAPIError(res, conflict('A pull operation is already running'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {}; // empty body is acceptable; rebase defaults to false
            }

            const rebase = body.rebase === true;
            const jobId = `pull-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const job: GitOpJob = {
                id: jobId,
                workspaceId: id,
                op: 'pull',
                status: 'running',
                startedAt: new Date().toISOString(),
                pid: process.pid,
            };
            await gitOpsStore.create(job);
            sendJSON(res, 202, { jobId });

            // Run pull in background — update store on completion
            branchService.pull(ws.rootPath, rebase).then(async (result) => {
                await gitOpsStore.update(id, jobId, {
                    status: result.success ? 'success' : 'failed',
                    finishedAt: new Date().toISOString(),
                    error: result.error,
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            }).catch(async (err) => {
                await gitOpsStore.update(id, jobId, {
                    status: 'failed',
                    finishedAt: new Date().toISOString(),
                    error: err instanceof Error ? err.message : 'Unknown error',
                });
                getWsServer?.()?.broadcastGitChanged(id, 'pull');
            });
        },
    });

    // GET /api/workspaces/:id/git/ops/latest — Most recent git op job (supports ?op=pull)
    routes.push({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/latest$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const parsed = url.parse(req.url || '', true);
            const opFilter = typeof parsed.query.op === 'string' ? parsed.query.op as any : undefined;
            const job = await gitOpsStore.getLatest(id, opFilter);
            if (!job) {
                return sendJSON(res, 200, null);
            }
            sendJSON(res, 200, job);
        },
    });

    // GET /api/workspaces/:id/git/ops/:jobId — Specific git op job by ID
    routes.push({
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/ops\/([^/]+)$/,
        handler: async (req, res, match) => {
            const wsId = decodeURIComponent(match![1]);
            const jobId = decodeURIComponent(match![2]);
            const job = await gitOpsStore.getById(wsId, jobId);
            if (!job) {
                return handleAPIError(res, notFound('Git operation'));
            }
            sendJSON(res, 200, job);
        },
    });

    // POST /api/workspaces/:id/git/fetch — Fetch from remote(s)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/fetch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                body = {}; // empty body is acceptable; remote defaults to undefined
            }

            const remote: string | undefined = typeof body.remote === 'string' ? body.remote : undefined;
            const result = await branchService.fetch(ws.rootPath, remote);
            getWsServer?.()?.broadcastGitChanged(id, 'fetch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/merge — Merge a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.branch || typeof body.branch !== 'string') {
                return handleAPIError(res, missingFields(['branch']));
            }

            const result = await branchService.mergeBranch(ws.rootPath, body.branch);
            getWsServer?.()?.broadcastGitChanged(id, 'merge');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash — Stash changes
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const message: string | undefined = typeof body.message === 'string' ? body.message : undefined;
            const result = await branchService.stashChanges(ws.rootPath, message);
            getWsServer?.()?.broadcastGitChanged(id, 'stash');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash/pop — Pop stash
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash\/pop$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const result = await branchService.popStash(ws.rootPath);
            getWsServer?.()?.broadcastGitChanged(id, 'stash-pop');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/reset — Reset HEAD to a commit
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/reset$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.hash || typeof body.hash !== 'string') {
                return handleAPIError(res, missingFields(['hash']));
            }

            const allowedModes = ['hard', 'soft', 'mixed'];
            const mode: string = typeof body.mode === 'string' && allowedModes.includes(body.mode)
                ? body.mode
                : 'hard';

            try {
                execGitSync(`reset --${mode} ${body.hash}`, ws.rootPath);
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'reset');
                sendJSON(res, 200, { success: true });
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to reset: ' + (err.message || 'unknown error')));
            }
        },
    });

    // POST /api/workspaces/:id/git/cherry-pick — Cherry-pick a commit onto the current branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/cherry-pick$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.hash || typeof body.hash !== 'string') {
                return handleAPIError(res, missingFields(['hash']));
            }

            const result = await branchService.cherryPick(ws.rootPath, body.hash);
            if (result.success) {
                gitCache.invalidateMutable(id);
                getWsServer?.()?.broadcastGitChanged(id, 'cherry-pick');
                return sendJSON(res, 200, { success: true });
            }
            if (result.conflicts) {
                return sendJSON(res, 409, { error: result.message, conflicts: true });
            }
            return handleAPIError(res, badRequest('Cherry-pick failed: ' + result.message));
        },
    });

    // ------------------------------------------------------------------
    // Working-tree endpoints (via WorkingTreeService)
    // ------------------------------------------------------------------

    // POST /api/workspaces/:id/git/amend — Amend the HEAD commit message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/amend$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
                return handleAPIError(res, missingFields(['title']));
            }

            const result = await branchService.amendCommitMessage(
                ws.rootPath,
                body.title,
                typeof body.body === 'string' ? body.body : undefined
            );
            if (!result.success) {
                return handleAPIError(res, badRequest(result.error || 'Failed to amend commit message'));
            }
            gitCache.invalidateMutable(id);
            getWsServer?.()?.broadcastGitChanged(id, 'amend');
            sendJSON(res, 200, { hash: result.hash });
        },
    });

    const workingTreeService = new WorkingTreeService();

    // GET /api/workspaces/:id/git/changes — All working-tree changes
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const changes = await workingTreeService.getAllChanges(ws.rootPath);
            sendJSON(res, 200, { changes });
        },
    });

    // POST /api/workspaces/:id/git/changes/stage — Stage a file
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.stageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'stage');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/unstage — Unstage a file
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.unstageFile(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/discard — Discard unstaged changes
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/discard$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.discardChanges(ws.rootPath, body.filePath);
            getWsServer?.()?.broadcastGitChanged(id, 'discard');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/stage-batch — Stage multiple files at once
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/stage-batch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.stageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'stage-batch');
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/changes/unstage-batch — Unstage multiple files at once
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/unstage-batch$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const id = ws.id;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (!Array.isArray(body.filePaths)) return handleAPIError(res, missingFields(['filePaths']));

            const result = await workingTreeService.unstageFiles(ws.rootPath, body.filePaths);
            getWsServer?.()?.broadcastGitChanged(id, 'unstage-batch');
            sendJSON(res, 200, result);
        },
    });

    // DELETE /api/workspaces/:id/git/changes/untracked — Delete an untracked file
    routes.push({
        method: 'DELETE',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/untracked$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;
            if (typeof body.filePath !== 'string') return handleAPIError(res, missingFields(['filePath']));

            const result = await workingTreeService.deleteUntrackedFile(ws.rootPath, body.filePath);
            sendJSON(res, 200, result);
        },
    });

    // GET /api/workspaces/:id/git/changes/files/*/diff — Per-file working-tree diff
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/changes\/files\/(.+)\/diff$/,
        handler: async (req, res, match) => {
            const ws = await resolveWorkspaceOrFail(store, match!, res);
            if (!ws) return;
            const filePath = decodeURIComponent(match![2]);

            const parsed = url.parse(req.url!, true).query;
            const stage = parsed.stage as string | undefined;
            const staged = stage === 'staged';

            try {
                const diff = await workingTreeService.getFileDiff(ws.rootPath, filePath, staged);
                sendJSON(res, 200, { diff, path: filePath });
            } catch {
                sendJSON(res, 200, { diff: '', path: filePath });
            }
        },
    });

    // ------------------------------------------------------------------
    // Filesystem browse endpoint
    // ------------------------------------------------------------------

    // GET /api/fs/browse — Browse directories for repo path selection
    routes.push({
        method: 'GET',
        pattern: '/api/fs/browse',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const rawPath = typeof parsed.query.path === 'string' && parsed.query.path
                ? parsed.query.path
                : os.homedir();
            const showHidden = parsed.query.showHidden === 'true';

            const resolved = path.resolve(rawPath.replace(/^~/, os.homedir()));

            const result = browseDirectory(resolved, showHidden);
            if (!result) {
                return handleAPIError(res, notFound('Directory'));
            }

            const payload: {
                path: string;
                parent: string | null;
                entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
                drives?: string[];
            } = { ...result };

            // Surface available Windows drives so the UI can switch volumes
            // (e.g., C:\ -> D:\) without manually typing a path.
            if (process.platform === 'win32') {
                payload.drives = listWindowsDrives();
            }

            sendJSON(res, 200, payload);
        },
    });

    // ------------------------------------------------------------------
    // Process endpoints
    // ------------------------------------------------------------------

    // GET /api/processes/summaries — Lightweight index-only process list (no file I/O per process)
    routes.push({
        method: 'GET',
        pattern: '/api/processes/summaries',
        handler: async (req, res) => {
            if (!store.getProcessSummaries) {
                // Fallback for stores that don't support summaries
                return handleAPIError(res, badRequest('Summaries not supported by this store'));
            }
            const filter = parseQueryParams(req.url || '/');
            const limit = filter.limit ?? 50;
            const offset = filter.offset ?? 0;
            const paginatedFilter: ProcessFilter = { ...filter, limit, offset };
            const { entries, total } = await store.getProcessSummaries(paginatedFilter);
            sendJSON(res, 200, { summaries: entries, total, limit, offset });
        },
    });

    // GET /api/processes — List processes with filtering + pagination
    // Supports ?sdkSessionId={id} to find a single process by SDK session ID
    routes.push({
        method: 'GET',
        pattern: '/api/processes',
        handler: async (req, res) => {
            const parsed = url.parse(req.url || '/', true);
            const sdkSessionId = typeof parsed.query.sdkSessionId === 'string' ? parsed.query.sdkSessionId : '';

            // Session ID lookup: find the first process matching the given sdkSessionId
            if (sdkSessionId) {
                const all = await store.getAllProcesses();
                const match = all.find(p => p.sdkSessionId === sdkSessionId);
                if (!match) {
                    return handleAPIError(res, notFound('Process with sdkSessionId: ' + sdkSessionId));
                }
                return sendJSON(res, 200, { process: match });
            }

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

            // Strip excluded fields for lightweight responses
            const responseProcesses = filter.exclude
                ? processes.map(p => stripExcludedFields(p, filter.exclude))
                : processes;

            sendJSON(res, 200, { processes: responseProcesses, total, limit, offset });
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
                return handleAPIError(res, badRequest('Query parameter "status" is required for bulk delete'));
            }

            const statuses = statusParam
                .split(',')
                .map(s => s.trim())
                .filter(s => VALID_STATUSES.has(s)) as AIProcessStatus[];

            if (statuses.length === 0) {
                return handleAPIError(res, badRequest('No valid status values provided'));
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
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.id || !body.promptPreview || !body.status || !body.startTime) {
                return handleAPIError(res, missingFields(['id', 'promptPreview', 'status', 'startTime']));
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

    // GET /api/processes/:id/output — Persisted conversation output
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/output$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const process = await store.getProcess(id);
            if (!process) {
                return handleAPIError(res, notFound('Process'));
            }
            const filePath = process.rawStdoutFilePath;
            if (!filePath) {
                return handleAPIError(res, notFound('Conversation output'));
            }
            try {
                await fs.promises.access(filePath);
                const content = await fs.promises.readFile(filePath, 'utf-8');
                sendJSON(res, 200, { content, format: 'markdown' });
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    return handleAPIError(res, notFound('Conversation output'));
                }
                return handleAPIError(res, internalError('Failed to read conversation output'));
            }
        },
    });

    // GET /api/processes/:id/children — Child processes for a pipeline run
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)\/children$/,
        handler: async (req, res, match) => {
            const parentId = decodeURIComponent(match![1]);

            // Build filter from query params (reuse parseQueryParams for status, exclude, etc.)
            const baseFilter = parseQueryParams(req.url || '/');
            const filter: ProcessFilter = {
                ...baseFilter,
                parentProcessId: parentId,
            };

            // Default: exclude conversation for lightweight payloads
            if (!filter.exclude) {
                filter.exclude = ['conversation'];
            }

            const children = await store.getAllProcesses(filter);
            const responseChildren = filter.exclude
                ? children.map(p => stripExcludedFields(p, filter.exclude))
                : children;

            sendJSON(res, 200, { children: responseChildren, total: children.length });
        },
    });

    // GET /api/processes/:id — Single process detail
    routes.push({
        method: 'GET',
        pattern: /^\/api\/processes\/([^/]+)$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const process = await store.getProcess(id);
            if (!process) {
                return handleAPIError(res, notFound('Process'));
            }
            const filter = parseQueryParams(req.url || '/');
            const result = filter.exclude ? stripExcludedFields(process, filter.exclude) : process;
            sendJSON(res, 200, { process: result });
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
                return handleAPIError(res, notFound('Process'));
            }

            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            const updates: Partial<AIProcess> = {};
            if (body.status !== undefined) { updates.status = body.status; }
            if (body.result !== undefined) { updates.result = body.result; }
            if (body.error !== undefined) { updates.error = body.error; }
            if (body.endTime !== undefined) { updates.endTime = new Date(body.endTime); }
            if (body.structuredResult !== undefined) { updates.structuredResult = body.structuredResult; }
            if (body.metadata !== undefined) { updates.metadata = body.metadata; }
            if (body.sdkSessionId !== undefined) { updates.sdkSessionId = body.sdkSessionId; }
            if (body.conversationTurns !== undefined) { updates.conversationTurns = body.conversationTurns; }

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
                return handleAPIError(res, notFound('Process'));
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
                return handleAPIError(res, notFound('Process'));
            }

            if (TERMINAL_STATUSES.has(existing.status)) {
                return handleAPIError(res, new APIError(409, `Process is already in terminal state: ${existing.status}`, 'CONFLICT'));
            }

            await store.updateProcess(id, {
                status: 'cancelled',
                endTime: new Date(),
            });

            // Signal the live AI session to abort (fire-and-forget, non-fatal)
            void bridge?.cancelProcess?.(id)?.catch(() => {});

            process.stderr.write(`[Process] cancel id=${id} prevStatus=${existing.status}\n`);

            const updated = await store.getProcess(id);
            sendJSON(res, 200, { process: updated });
        },
    });

    // POST /api/processes/:id/message — Send a follow-up message
    routes.push({
        method: 'POST',
        pattern: /^\/api\/processes\/([^/]+)\/message$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const process = await store.getProcess(id);
            if (!process) {
                return handleAPIError(res, notFound('Process'));
            }

            // Parse and validate body first so malformed requests get 400
            // regardless of session state
            const body = await parseBodyOrReject(req, res);
            if (body === null) return;

            if (!body.content || typeof body.content !== 'string') {
                return handleAPIError(res, missingFields(['content']));
            }

            // Validate and extract image data URLs for persistence (cap at 5)
            let validatedImages: string[] | undefined;
            if (Array.isArray(body.images) && body.images.length > 0) {
                const filtered = body.images
                    .filter((img: unknown): img is string => typeof img === 'string' && isImageDataUrl(img as string))
                    .slice(0, 5);
                if (filtered.length > 0) {
                    validatedImages = filtered;
                }
            }

            // Decode optional base64 images to temp files for SDK attachment
            let attachments: Attachment[] | undefined;
            let imageTempDir: string | undefined;
            if (Array.isArray(body.images) && body.images.length > 0) {
                const validImages = body.images
                    .filter((img: unknown) => typeof img === 'string')
                    .slice(0, 10);
                if (validImages.length > 0) {
                    const result = saveImagesToTempFiles(validImages);
                    imageTempDir = result.tempDir;
                    attachments = result.attachments.length > 0 ? result.attachments : undefined;
                }
            }

            // Check session liveness before forwarding the prompt
            if (bridge && !(await bridge.isSessionAlive(id))) {
                return handleAPIError(res, new APIError(410, 'The AI session has ended. Please start a new task.', 'SESSION_EXPIRED'));
            }

            if (!bridge) {
                return handleAPIError(res, new APIError(501, 'Follow-up execution not available', 'NOT_IMPLEMENTED'));
            }

            // Append user turn to conversationTurns
            const existingTurns = process.conversationTurns || [];
            const turnIndex = existingTurns.length;
            const userTurn: ConversationTurn = {
                role: 'user',
                content: body.content,
                timestamp: new Date(),
                turnIndex,
                timeline: [],
                images: validatedImages,
            };
            const updatedTurns = [...existingTurns, userTurn];

            // Validate optional mode override (ask | plan | autopilot)
            const VALID_MODES = ['ask', 'plan', 'autopilot'];
            const modeOverride: string | undefined = typeof body.mode === 'string' && VALID_MODES.includes(body.mode) ? body.mode : undefined;

            // Validate optional deliveryMode (immediate | enqueue), default to 'enqueue'
            const VALID_DELIVERY_MODES = ['immediate', 'enqueue'];
            if (body.deliveryMode !== undefined && body.deliveryMode !== null) {
                if (typeof body.deliveryMode !== 'string' || !VALID_DELIVERY_MODES.includes(body.deliveryMode)) {
                    return handleAPIError(res, badRequest(`Invalid deliveryMode: must be one of ${VALID_DELIVERY_MODES.join(', ')}`));
                }
            }
            const deliveryMode: 'immediate' | 'enqueue' = (body.deliveryMode === 'immediate') ? 'immediate' : 'enqueue';

            const processUpdate: Record<string, unknown> = {
                conversationTurns: updatedTurns,
                status: 'running',
            };
            await store.updateProcess(id, processUpdate);

            // Delegate AI execution to the queue executor bridge
            // Prefer enqueueing as a chat-followup task so the follow-up is visible
            // in the queue tab and respects scheduler policies (pause/resume, concurrency).
            // Fall back to direct execution when enqueue is not available.
            let messageContent = body.content as string;
            if (Array.isArray(body.skillNames) && body.skillNames.length > 0) {
                const validSkills = body.skillNames.filter((s: unknown): s is string => typeof s === 'string' && s.length > 0);
                if (validSkills.length > 0) {
                    const directives = validSkills.map((n: string) => `Use ${n} skill when available`).join('\n');
                    messageContent = `${directives}\n\n[Task]\n${messageContent}`;
                }
            }

            if (bridge.enqueue) {
                const snippet = messageContent.trim();
                const displayName = snippet.length > 60 ? snippet.substring(0, 57) + '...' : snippet;
                // Look up the original chat task so the follow-up can reuse it
                const parentTask = bridge.findTaskByProcessId?.(id);
                if (parentTask && parentTask.status === 'completed' && bridge.requeueForFollowUp) {
                    // Reuse the parent task: update its payload and requeue from history
                    await bridge.requeueForFollowUp(parentTask.id, messageContent, attachments, imageTempDir, modeOverride, deliveryMode);
                } else {
                    // Fallback: create a new task (no parent found or requeueForFollowUp unavailable)
                    await bridge.enqueue({
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            prompt: messageContent,
                            processId: id,
                            attachments,
                            imageTempDir,
                            workingDirectory: process.workingDirectory,
                            readonly: (process as any).payload?.readonly,
                            ...(modeOverride ? { mode: modeOverride } : {}),
                            deliveryMode,
                        },
                        config: {},
                        displayName,
                    });
                }
            } else {
                bridge.executeFollowUp(id, messageContent, attachments, modeOverride, deliveryMode).catch(() => {
                    // Error handling is done inside executeFollowUp
                }).finally(() => {
                    if (imageTempDir) { cleanupTempDir(imageTempDir); }
                });
            }

            // Emit message-queued SSE event so clients get real-time acknowledgment
            emitMessageQueued(store, id, {
                turnIndex,
                deliveryMode,
                queuePosition: deliveryMode === 'immediate' ? 0 : 1,
            });

            globalThis.process.stderr.write(`[Process] message id=${id} turnIndex=${turnIndex}\n`);

            sendJSON(res, 202, { processId: id, turnIndex });
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

    // Register global skill routes first so /skills/all is matched
    // before the catch-all /skills/:name pattern in repo skill routes
    if (dataDir) {
        registerGlobalSkillRoutes(routes, store, dataDir);
    }

    // Register repo skill management routes
    registerSkillRoutes(routes, store, dataDir);
    } finally {
        // Restore original push so that external callers are unaffected
        (routes as any).push = _origPush;
    }
}

// ============================================================================
// Utility helpers for workspace endpoints
// ============================================================================

let _gitRangeService: GitRangeService | undefined;
function getGitRangeService(): GitRangeService {
    if (!_gitRangeService) {
        _gitRangeService = new GitRangeService();
    }
    return _gitRangeService;
}

let _branchService: BranchService | undefined;
function getBranchService(): BranchService {
    if (!_branchService) {
        _branchService = new BranchService();
    }
    return _branchService;
}

/** Run a git command synchronously in the given directory. */
export function execGitSync(args: string, cwd: string): string {
    return childProcess.execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
}

/** Read a file's content from a specific commit, falling back to the first parent for deleted files. */
export function readGitFileAtCommit(hash: string, filePath: string, cwd: string): { content: string; resolvedRef: string } {
    const refsToTry = [`${hash}:${filePath}`, `${hash}^:${filePath}`];
    let lastError: unknown;

    for (const resolvedRef of refsToTry) {
        try {
            const content = childProcess.execFileSync('git', ['show', resolvedRef], {
                cwd,
                encoding: 'utf-8',
                timeout: 5000,
            });
            return { content, resolvedRef };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to read git file content');
}

/**
 * Detect the primary git remote URL for a workspace directory.
 * Returns undefined if not a git repo or no remotes configured.
 * @deprecated Use `detectRemoteUrl` imported from `@plusplusoneplusplus/pipeline-core`.
 *             Re-exported here for backward compatibility with existing callers.
 */
export { detectRemoteUrl, normalizeRemoteUrl } from '@plusplusoneplusplus/pipeline-core';

/** Discover pipeline packages in a directory. Each subdirectory with a pipeline.yaml is a package. */
export function discoverPipelines(pipelinesDir: string): Array<{ name: string; path: string }> {
    try {
        if (!fs.existsSync(pipelinesDir) || !fs.statSync(pipelinesDir).isDirectory()) {
            return [];
        }
        const entries = fs.readdirSync(pipelinesDir, { withFileTypes: true });
        const pipelines: Array<{ name: string; path: string }> = [];
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const yamlPath = path.join(pipelinesDir, entry.name, 'pipeline.yaml');
                if (fs.existsSync(yamlPath)) {
                    pipelines.push({ name: entry.name, path: path.join(pipelinesDir, entry.name) });
                }
            }
        }
        return pipelines;
    } catch {
        return [];
    }
}

/** Enumerate available Windows drive roots (e.g., C:\, D:\). */
function listWindowsDrives(): string[] {
    if (process.platform !== 'win32') {
        return [];
    }

    const drives: string[] = [];
    for (let code = 65; code <= 90; code++) {
        const drive = `${String.fromCharCode(code)}:\\`;
        if (fs.existsSync(drive)) {
            drives.push(drive);
        }
    }
    return drives;
}

/** Browse a directory and return its entries (directories only) for repo path selection. */
export function browseDirectory(dirPath: string, showHidden = false): {
    path: string;
    parent: string | null;
    entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }>;
} | null {
    try {
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
            return null;
        }

        const parentDir = path.dirname(dirPath);
        const parent = parentDir !== dirPath ? parentDir : null;

        const rawEntries = fs.readdirSync(dirPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'directory'; isGitRepo: boolean }> = [];

        for (const entry of rawEntries) {
            if (!entry.isDirectory()) continue;
            if (!showHidden && entry.name.startsWith('.')) continue;

            const fullPath = path.join(dirPath, entry.name);
            const isGitRepo = fs.existsSync(path.join(fullPath, '.git'));

            entries.push({ name: entry.name, type: 'directory', isGitRepo });
        }

        // Sort alphabetically
        entries.sort((a, b) => a.name.localeCompare(b.name));

        return { path: dirPath, parent, entries };
    } catch {
        return null;
    }
}
