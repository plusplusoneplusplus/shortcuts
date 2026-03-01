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
import type { ProcessStore, ProcessFilter, AIProcess, AIProcessStatus, AIProcessType, WorkspaceInfo, ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
import { deserializeProcess, GitRangeService, BranchService } from '@plusplusoneplusplus/pipeline-core';
import type { Attachment } from '@plusplusoneplusplus/pipeline-core';
import type { Route } from './types';
import { handleProcessStream } from './sse-handler';
import { handleAPIError, invalidJSON, missingFields, notFound, badRequest, internalError, APIError } from './errors';
import { saveImagesToTempFiles, cleanupTempDir, isImageDataUrl } from './image-utils';

/**
 * Bridge interface for executing follow-up messages on existing AI sessions.
 * The full implementation lives in `packages/coc` (queue-executor-bridge.ts)
 * and will be moved in a later commit.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[]): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
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
 * Register all API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerApiRoutes(routes: Route[], store: ProcessStore, bridge?: QueueExecutorBridge): void {
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
                return handleAPIError(res, invalidJSON());
            }

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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            try {
                const branch = execGitSync('rev-parse --abbrev-ref HEAD', ws.rootPath);
                const status = execGitSync('status --porcelain', ws.rootPath);
                const dirty = status.trim().length > 0;
                const remoteUrl = detectRemoteUrl(ws.rootPath);

                // Ahead/behind counts relative to the upstream tracking branch
                let ahead = 0;
                let behind = 0;
                try {
                    const counts = execGitSync('rev-list --left-right --count HEAD...@{u}', ws.rootPath);
                    const parts = counts.trim().split(/\s+/);
                    if (parts.length === 2) {
                        ahead = parseInt(parts[0], 10) || 0;
                        behind = parseInt(parts[1], 10) || 0;
                    }
                } catch {
                    // No upstream tracking branch — leave both at 0
                }

                // Update workspace remoteUrl if it changed (or wasn't set)
                if (remoteUrl && remoteUrl !== ws.remoteUrl) {
                    await store.updateWorkspace(ws.id, { remoteUrl });
                }

                sendJSON(res, 200, { branch, dirty, ahead, behind, isGitRepo: true, remoteUrl: remoteUrl || null });
            } catch {
                sendJSON(res, 200, { branch: null, dirty: false, isGitRepo: false, remoteUrl: null });
            }
        },
    });

    // GET /api/workspaces/:id/git/commits — List commits with pagination
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const parsed = url.parse(req.url || '/', true);
            const limit = Math.min(Math.max(parseInt(String(parsed.query.limit || '50'), 10) || 50, 1), 200);
            const skip = Math.max(parseInt(String(parsed.query.skip || '0'), 10) || 0, 0);

            try {
                const format = '%H%n%h%n%s%n%an%n%aI%n%P';
                const raw = execGitSync(
                    `log --format="${format}" --skip=${skip} --max-count=${limit} -z`,
                    ws.rootPath
                );

                const commits: Array<{
                    hash: string; shortHash: string; subject: string;
                    author: string; date: string; parentHashes: string[];
                }> = [];

                if (raw.trim()) {
                    const entries = raw.split('\0').filter(Boolean);
                    for (const entry of entries) {
                        const lines = entry.split('\n');
                        if (lines.length >= 5) {
                            commits.push({
                                hash: lines[0],
                                shortHash: lines[1],
                                subject: lines[2],
                                author: lines[3],
                                date: lines[4],
                                parentHashes: lines[5] ? lines[5].split(' ').filter(Boolean) : [],
                            });
                        }
                    }
                }

                // Determine unpushed count
                let unpushedCount = 0;
                try {
                    const counts = execGitSync('rev-list --left-right --count HEAD...@{u}', ws.rootPath);
                    const parts = counts.trim().split(/\s+/);
                    if (parts.length === 2) {
                        unpushedCount = parseInt(parts[0], 10) || 0;
                    }
                } catch {
                    // No upstream tracking branch
                }

                sendJSON(res, 200, { commits, unpushedCount });
            } catch {
                sendJSON(res, 200, { commits: [], unpushedCount: 0 });
            }
        },
    });

    // GET /api/workspaces/:id/git/commits/:hash/files — Files changed in a commit
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/commits\/([a-f0-9]{4,40})\/files$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const hash = match![2];
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
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
                sendJSON(res, 200, { files });
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
            const id = decodeURIComponent(match![1]);
            const hash = match![2];
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            try {
                const diff = execGitSync(`show --format="" --patch ${hash}`, ws.rootPath);
                sendJSON(res, 200, { diff });
            } catch (err: any) {
                return handleAPIError(res, badRequest('Failed to get commit diff: ' + (err.message || 'unknown error')));
            }
        },
    });

    // GET /api/workspaces/:id/git/branch-range — Detect feature branch commit range
    routes.push({
        method: 'GET',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branch-range$/,
        handler: async (_req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            try {
                const rangeService = getGitRangeService();
                const range = rangeService.detectCommitRange(ws.rootPath);
                if (!range) {
                    return sendJSON(res, 200, { onDefaultBranch: true });
                }
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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const filePath = decodeURIComponent(match![2]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            if (!body.name) {
                return handleAPIError(res, missingFields(['name']));
            }

            const result = await branchService.switchBranch(ws.rootPath, body.name, { force: body.force ?? false });
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/branches/rename — Rename a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/branches\/rename$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

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
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const setUpstream = body.setUpstream === true;
            const result = await branchService.push(ws.rootPath, setUpstream);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/pull — Pull from remote
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/pull$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const rebase = body.rebase === true;
            const result = await branchService.pull(ws.rootPath, rebase);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/fetch — Fetch from remote(s)
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/fetch$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const remote: string | undefined = typeof body.remote === 'string' ? body.remote : undefined;
            const result = await branchService.fetch(ws.rootPath, remote);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/merge — Merge a branch
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/merge$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            if (!body.branch || typeof body.branch !== 'string') {
                return handleAPIError(res, missingFields(['branch']));
            }

            const result = await branchService.mergeBranch(ws.rootPath, body.branch);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash — Stash changes
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            let body: any = {};
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

            const message: string | undefined = typeof body.message === 'string' ? body.message : undefined;
            const result = await branchService.stashChanges(ws.rootPath, message);
            sendJSON(res, 200, result);
        },
    });

    // POST /api/workspaces/:id/git/stash/pop — Pop stash
    routes.push({
        method: 'POST',
        pattern: /^\/api\/workspaces\/([^/]+)\/git\/stash\/pop$/,
        handler: async (req, res, match) => {
            const id = decodeURIComponent(match![1]);
            const workspaces = await store.getWorkspaces();
            const ws = workspaces.find(w => w.id === id);
            if (!ws) {
                return handleAPIError(res, notFound('Workspace'));
            }

            const result = await branchService.popStash(ws.rootPath);
            sendJSON(res, 200, result);
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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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

            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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
            let body: any;
            try {
                body = await parseBody(req);
            } catch {
                return handleAPIError(res, invalidJSON());
            }

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

            // Validate the process has an SDK session to follow up on
            if (!process.sdkSessionId) {
                return handleAPIError(res, new APIError(409, 'Process has no SDK session — follow-up not supported', 'CONFLICT'));
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

            await store.updateProcess(id, {
                conversationTurns: updatedTurns,
                status: 'running',
            });

            // Delegate AI execution to the queue executor bridge (fire-and-forget)
            bridge.executeFollowUp(id, body.content, attachments).catch(() => {
                // Error handling is done inside executeFollowUp
            }).finally(() => {
                if (imageTempDir) { cleanupTempDir(imageTempDir); }
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

/** Run a git command synchronously in the given directory. */
export function execGitSync(args: string, cwd: string): string {
    return childProcess.execSync(`git ${args}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
}

/**
 * Detect the primary git remote URL for a workspace directory.
 * Returns undefined if not a git repo or no remotes configured.
 */
export function detectRemoteUrl(cwd: string): string | undefined {
    try {
        return execGitSync('remote get-url origin', cwd) || undefined;
    } catch {
        // No origin remote — try first available remote
        try {
            const remotes = execGitSync('remote', cwd);
            const firstRemote = remotes.split('\n').filter(Boolean)[0];
            if (firstRemote) {
                return execGitSync(`remote get-url ${firstRemote}`, cwd) || undefined;
            }
        } catch { /* not a git repo or no remotes */ }
        return undefined;
    }
}

/**
 * Normalize a git remote URL for comparison.
 * Converts SSH, HTTPS, and git:// URLs to a canonical form:
 *   `github.com/user/repo` (no protocol, no .git suffix, no trailing slash)
 *
 * Examples:
 *   git@github.com:user/repo.git     → github.com/user/repo
 *   https://github.com/user/repo.git → github.com/user/repo
 *   ssh://git@github.com/user/repo   → github.com/user/repo
 *   git://github.com/user/repo.git/  → github.com/user/repo
 */
export function normalizeRemoteUrl(rawUrl: string): string {
    let url = rawUrl.trim();

    // SSH shorthand: git@host:user/repo.git → host/user/repo.git
    const sshMatch = url.match(/^[\w.-]+@([\w.-]+):(.+)$/);
    if (sshMatch) {
        url = sshMatch[1] + '/' + sshMatch[2];
    } else {
        // Strip protocol (https://, ssh://, git://, http://)
        url = url.replace(/^(?:https?|ssh|git):\/\//, '');
        // Strip userinfo (user@, git@)
        url = url.replace(/^[^@]+@/, '');
    }

    // Strip trailing .git
    url = url.replace(/\.git\/?$/, '');
    // Strip trailing slash
    url = url.replace(/\/+$/, '');

    return url;
}

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
