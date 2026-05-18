/**
 * API Route Aggregator
 *
 * Thin router that delegates to focused route modules under routes/.
 * Each module owns one HTTP concern (workspaces, git, processes, filesystem).
 *
 * Mirrors the `queue-handler.ts` pattern: shared state is created here
 * and passed to each `registerXxxRoutes(routes, ctx)` call.
 *
 * Exports shared utilities (`sendJSON`, `sendError`, `parseBody`, etc.)
 * consumed by other handler modules throughout the server layer.
 */

import * as http from 'http';
import * as url from 'url';
import * as path from 'path';
import * as childProcess from 'child_process';
import * as fs from 'fs';
import type { ProcessStore, ProcessFilter, AIProcessStatus, AIProcessType, TurnSource } from '@plusplusoneplusplus/forge';
import { GitOpsStore, SqliteProcessStore, initializeDatabase, execGit } from '@plusplusoneplusplus/forge';
import Database from 'better-sqlite3';
import type { Attachment, CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { Route } from '../types';
import { registerSkillRoutes } from '../skills/skill-handler';
import { registerGlobalSkillRoutes } from '../skills/global-skill-handler';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { getServerLogger } from '../logging/server-logger';
import { registerApiWorkspaceRoutes } from '../routes/api-workspace-routes';
import { registerApiGitRoutes } from '../routes/api-git-routes';
import { registerApiProcessRoutes } from '../routes/api-process-routes';
import { registerApiFsRoutes } from '../routes/api-fs-routes';
import { registerCommitChatRoutes } from '../routes/api-commit-chat-routes';
import { registerPrChatRoutes } from '../routes/api-pr-chat-routes';
import { registerNoteChatBindingRoutes } from '../notes/note-chat-bindings-handler';
import type { ApiRouteContext } from '../routes/api-shared';
import { GIT_MAX_BUFFER } from '../routes/api-shared';

/**
 * Bridge interface for executing follow-up messages on existing AI sessions.
 * The full implementation lives in `packages/coc` (queue-executor-bridge.ts)
 * and will be moved in a later commit.
 */
export interface QueueExecutorBridge {
    executeFollowUp(processId: string, message: string, attachments?: Attachment[], mode?: string, deliveryMode?: string, images?: string[], selectedSkillNames?: string[], model?: string, turnSource?: TurnSource): Promise<void>;
    isSessionAlive(processId: string): Promise<boolean>;
    /** Enqueue a task through the scheduler. When present, follow-ups are routed through the queue. */
    enqueue?(input: CreateTaskInput): Promise<string>;
    /** Find a task by its processId. Used for steering (running tasks) and follow-up routing. */
    findTaskByProcessId?(processId: string): { id: string; type: string; status: string } | undefined;
    /** Look up a queue task by its task ID. Used to synthesize process records for pre-execution tasks. */
    getTask?(taskId: string): import('@plusplusoneplusplus/forge').QueuedTask | undefined;
    /** Cancel a running process by aborting its live AI session. */
    cancelProcess?(processId: string): Promise<void>;
    /** Steer a running process by injecting an immediate message into its SDK session. */
    steerProcess?(processId: string, message: string): Promise<boolean>;
    /** Update the displayName of a queue task associated with a process. */
    updateTaskDisplayName?(processId: string, displayName: string): boolean;
    /** Subscribe to queue change events (e.g. task completed/failed) for task monitoring. */
    on?(event: 'queueChange', listener: (event: Record<string, unknown>) => void): void;
    /** Unsubscribe from queue change events. */
    off?(event: 'queueChange', listener: (event: Record<string, unknown>) => void): void;
    /** Answer a pending ask-user question. Returns true if the question was found and answered. */
    answerAskUserQuestion?(processId: string, questionId: string, answer: string | string[] | boolean): Promise<boolean>;
    /** Skip a pending ask-user question. Returns true if the question was found and skipped. */
    skipAskUserQuestion?(processId: string, questionId: string): Promise<boolean>;
    /** Resolve a pending ask-user question batch. Returns true if every answer was accepted. */
    answerAskUserQuestions?(processId: string, batchId: string, answers: Array<{ questionId: string; answer?: string | string[] | boolean; skipped?: boolean }>): Promise<boolean>;
}

// ============================================================================
// Response Helpers
// ============================================================================

import { sendJson, sendError } from '../shared/router';

/**
 * Write a JSON response with the correct Content-Type header.
 * @deprecated Use `sendJson(res, data, statusCode)` from `./shared/router` instead.
 */
export function sendJSON(res: http.ServerResponse, statusCode: number, data: unknown): void {
    sendJson(res, data, statusCode);
}

export { sendError };

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

/** Valid exclude field values for the `exclude` query parameter. */
const VALID_EXCLUDE_FIELDS: Set<string> = new Set(['conversation', 'toolCalls']);

/** Valid AIProcessStatus values for validation. */
const VALID_STATUSES: Set<string> = new Set(['queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled']);

/**
 * Extract filter parameters from URL query string into a typed ProcessFilter.
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

    if (typeof query.until === 'string' && query.until) {
        const date = new Date(query.until);
        if (!isNaN(date.getTime())) {
            filter.until = date;
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
 */
export function stripExcludedFields(process: any, exclude?: string[]): any {
    if (!exclude || exclude.length === 0) return process;

    if (exclude.includes('conversation')) {
        const { conversationTurns, fullPrompt, result, structuredResult, ...lightweight } = process;
        return lightweight;
    }

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
// Route Registration (thin aggregator)
// ============================================================================

/**
 * Register all API routes on the given route table.
 * Mutates the `routes` array in-place.
 */
export function registerApiRoutes(routes: Route[], store: ProcessStore, bridge?: QueueExecutorBridge, dataDir?: string, getWsServer?: () => ProcessWebSocketServer | undefined, db?: Database.Database, loopsEnabled?: boolean, excalidrawEnabled?: boolean): void {
    // Wrap routes.push to automatically log API mutations (POST/PATCH/DELETE).
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
        const gitOpsStore = new GitOpsStore({ dataDir: dataDir ?? undefined });
        gitOpsStore.markStaleRunningJobs().catch(() => {});

        let resolvedDb: Database.Database;
        if (db) {
            resolvedDb = db;
        } else if (store instanceof SqliteProcessStore) {
            resolvedDb = store.getDatabase();
        } else {
            resolvedDb = new Database(':memory:');
            initializeDatabase(resolvedDb);
        }

        const ctx: ApiRouteContext = { routes, store, bridge, dataDir, getWsServer, gitOpsStore, db: resolvedDb, loopsEnabled, excalidrawEnabled };

        registerApiWorkspaceRoutes(ctx);
        registerApiGitRoutes(ctx);
        registerApiFsRoutes(routes, { dataDir: dataDir ?? undefined });
        registerApiProcessRoutes(ctx);
        registerCommitChatRoutes(ctx);
        registerPrChatRoutes(ctx);
        registerNoteChatBindingRoutes(ctx);

        // Register global skill routes first so /skills/all is matched
        // before the catch-all /skills/:name pattern in repo skill routes
        if (dataDir) {
            registerGlobalSkillRoutes(routes, store, dataDir);
        }
        registerSkillRoutes(routes, store, dataDir);
    } finally {
        (routes as any).push = _origPush;
    }
}

// ============================================================================
// Utility helpers (exported for use by other modules)
// ============================================================================

/** Run a git command synchronously in the given directory. */
export function execGitSync(args: string, cwd: string): string {
    const cmd = process.platform === 'win32'
        ? `git ${args.replace(/\^/g, '^^')}`
        : `git ${args}`;
    return childProcess.execSync(cmd, { cwd, encoding: 'utf-8', timeout: 5000, maxBuffer: GIT_MAX_BUFFER }).trim();
}

/** Run a git command synchronously using an args array (WSL-aware via forge execGit). */
export function execGitArgsSync(args: string[], cwd: string): string {
    return execGit(args, cwd, { timeout: 5000, maxBuffer: GIT_MAX_BUFFER }).trim();
}

/** Read a file's content from a specific commit, falling back to the first parent for deleted files. */
export function readGitFileAtCommit(hash: string, filePath: string, cwd: string): { content: string; resolvedRef: string } {
    const refsToTry = [`${hash}:${filePath}`, `${hash}^:${filePath}`];
    let lastError: unknown;

    for (const resolvedRef of refsToTry) {
        try {
            const content = execGit(['show', resolvedRef], cwd, { timeout: 5000, maxBuffer: GIT_MAX_BUFFER });
            return { content, resolvedRef };
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Failed to read git file content');
}

/**
 * @deprecated Use `detectRemoteUrl` imported from `@plusplusoneplusplus/forge`.
 */
export { detectRemoteUrl, normalizeRemoteUrl } from '@plusplusoneplusplus/forge';

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
