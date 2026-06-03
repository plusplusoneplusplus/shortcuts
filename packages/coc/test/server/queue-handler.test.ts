/**
 * Queue Handler Tests
 *
 * Comprehensive tests for the Queue REST API endpoints:
 * enqueue, list, get, cancel, reorder, pause/resume, clear,
 * stats, history, and WebSocket queue events.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { buildSummarizePrompt, registerQueueRoutes, serializeConversationForSummary } from '../../src/server/queue/queue-handler';
import { createRouter } from '../../src/server/shared/router';
import type { SummarizeConversation } from '../../src/server/queue/queue-handler';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import { FileProcessStore, SqliteProcessStore, SqliteQueueStore } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import type { CLIConfig } from '../../src/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/** POST JSON helper. */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Create a minimal task body for POST /api/queue. */
function makeTask(overrides: Record<string, any> = {}) {
    return {
        type: 'chat',
        priority: 'normal',
        displayName: 'Test task',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
        config: {},
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Queue Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let sqliteStoreRef: SqliteProcessStore | undefined;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-test-'));
    });

    afterEach(async () => {
        if (server) {
            // Close the SQLite DB before removing temp files (prevents EPERM on Windows)
            const store = server.store;
            await server.close();
            if ('close' in store && typeof (store as any).close === 'function') {
                (store as any).close();
            }
            server = undefined;
        }
        // Also close any standalone SqliteProcessStore that wasn't passed to the server
        if (sqliteStoreRef) {
            try { sqliteStoreRef.close(); } catch { /* already closed */ }
            sqliteStoreRef = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(fileConfig?: CLIConfig): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({
            port: 0,
            host: 'localhost',
            store,
            dataDir,
            fileConfig,
            configPath: fileConfig ? path.join(dataDir, 'config.yaml') : undefined,
        });
        return server;
    }

    async function startServerWith(store: SqliteProcessStore | FileProcessStore): Promise<ExecutionServer> {
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    /** Create a SqliteProcessStore and track it for cleanup. */
    function createSqliteStore(): SqliteProcessStore {
        const store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        sqliteStoreRef = store;
        return store;
    }

    /** Seed queue history entries into the SQLite DB so restore() picks them up. */
    function seedQueueHistory(store: SqliteProcessStore, repoId: string, repoRoot: string, entries: Partial<QueuedTask>[]): void {
        const db = store.getDatabase();
        const queueStore = new SqliteQueueStore(db);
        // Ensure the repo paths table exists so restore() can map repoId → rootPath
        db.exec(`CREATE TABLE IF NOT EXISTS queue_repo_paths (repo_id TEXT PRIMARY KEY, root_path TEXT NOT NULL)`);
        db.prepare(`INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)`).run(repoId, repoRoot);
        for (const entry of entries) {
            queueStore.upsertQueueTask(entry as QueuedTask);
        }
    }

    // ========================================================================
    // Enqueue
    // ========================================================================

    describe('POST /api/queue — Enqueue', () => {
        it('should enqueue a task and return it with an ID', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.id).toBeDefined();
            expect(body.task.type).toBe('chat');
            expect(body.task.priority).toBe('normal');
            expect(body.task.status).toBe('queued');
            expect(body.task.displayName).toBe('Test task');
        });

        it('should enqueue with high priority', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'high' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('high');
        });

        it('should enqueue with low priority', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'low' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('low');
        });

        it('should resolve config.effortTier to model and reasoningEffort before storing', async () => {
            const srv = await startServer({
                models: {
                    providers: {
                        copilot: {
                            effortTiers: {
                                high: { model: 'configured-high-model', reasoningEffort: 'xhigh' },
                            },
                        },
                    },
                },
            });

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: { effortTier: 'high' },
            }));

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('configured-high-model');
            expect(body.task.config.reasoningEffort).toBe('xhigh');
            expect(body.task.config.effortTier).toBeUndefined();
        });

        it('should preserve explicit model and reasoningEffort when effortTier is also supplied', async () => {
            const srv = await startServer({
                models: {
                    providers: {
                        copilot: {
                            effortTiers: {
                                high: { model: 'configured-high-model', reasoningEffort: 'xhigh' },
                            },
                        },
                    },
                },
            });

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: {
                    effortTier: 'high',
                    model: 'explicit-model',
                    reasoningEffort: 'low',
                },
            }));

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('explicit-model');
            expect(body.task.config.reasoningEffort).toBe('low');
            expect(body.task.config.effortTier).toBeUndefined();
        });

        it('should reject invalid config.effortTier values', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: { effortTier: 'ultra' },
            }));

            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid effortTier');
        });

        it('should default to normal priority for invalid values', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ priority: 'invalid' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.priority).toBe('normal');
        });

        it('should return 400 for missing type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, { displayName: 'No type' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('type');
        });

        it('should return 400 for invalid type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'invalid-type' }));
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid task type');
        });

        it('should return 400 for invalid JSON', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('should enqueue chat type with ask mode', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'Explain this code' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.mode).toBe('ask');
        });

        it('should enqueue chat type with autopilot mode', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'Follow this prompt' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.mode).toBe('autopilot');
        });

        it('should normalize legacy plan mode to ask when enqueueing chat type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'plan', prompt: 'Code review' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.mode).toBe('ask');
        });

        it('should enqueue chat type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { prompt: 'What does this repo do?' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
        });

        it('should enqueue chat type with readonly flag', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', prompt: 'Explain the architecture', readonly: true },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.readonly).toBe(true);
        });

        it('should auto-set payload.kind to chat for chat type without explicit kind', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Explain the architecture',
                workingDirectory: '/tmp/repo',
                displayName: 'Chat',
                payload: { readonly: true },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should auto-set payload.kind to chat for chat type without explicit kind', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Hello',
                workingDirectory: '/tmp/repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should not overwrite existing payload.kind for chat types', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', prompt: 'Test', readonly: true },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.kind).toBe('chat');
        });

        it('should promote top-level workingDirectory into payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workingDirectory: '/Users/dev/projects/my-repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/Users/dev/projects/my-repo');
        });

        it('should not overwrite payload.workingDirectory with top-level value', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workingDirectory: '/top-level/path',
                payload: { workingDirectory: '/payload/path', prompt: 'test' },
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/payload/path');
        });

        it('should promote top-level prompt into payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'What does this repo do?',
                workingDirectory: '/some/path',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('What does this repo do?');
        });

        it('should not overwrite payload.prompt with top-level value', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'top-level prompt',
                payload: { prompt: 'payload prompt' },
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('payload prompt');
        });

        it('should promote both prompt and workingDirectory into payload for chat tasks', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Explain the architecture',
                workingDirectory: '/Users/dev/repo',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('Explain the architecture');
            expect(body.task.payload.workingDirectory).toBe('/Users/dev/repo');
        });

        it('should trim whitespace from promoted prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: '  hello world  ',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('hello world');
        });

        it('should not promote empty or whitespace-only prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: '   ',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBeUndefined();
        });

        it('should promote top-level workspaceId into payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workspaceId: 'ws-abc-123',
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workspaceId).toBe('ws-abc-123');
        });

        it('should not overwrite payload.workspaceId with top-level value', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                workspaceId: 'top-level-id',
                payload: { workspaceId: 'payload-id', prompt: 'test' },
                displayName: 'Chat',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workspaceId).toBe('payload-id');
        });

        it('should promote top-level prompt for chat type with ask mode', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                prompt: 'Explain this function',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.prompt).toBe('Explain this function');
        });

        it('should enqueue chat type with resolve-comments tool', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'Resolve comments', tools: ['resolve-comments'], context: { resolveComments: { documentUri: 'file:///test.md', commentIds: ['c1'] } } },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('chat');
        });
    });

    describe('Removed queue task creation aliases', () => {
        it('should not register POST /api/queue/enqueue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/enqueue`, {
                prompt: 'what time is it',
                model: 'claude-haiku-4.5',
            });
            expect(res.status).toBe(404);
        });

        it('should not register POST /api/queue/tasks', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/tasks`, makeTask());
            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/queue/models — Model list', () => {
        it('should return available model IDs including claude-haiku-4.5', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/models`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.models)).toBe(true);
            expect(body.models).toContain('claude-haiku-4.5');
        });

        it('should resolve provider from the queue route context', async () => {
            const routes: any[] = [];
            let providerLookups = 0;
            registerQueueRoutes(routes, {} as any, undefined, undefined, {
                getDefaultProvider: () => {
                    providerLookups += 1;
                    return 'copilot';
                },
            });
            const bareServer = http.createServer(createRouter({ routes, spaHtml: '' }));
            await new Promise<void>((resolve) => bareServer.listen(0, 'localhost', resolve));
            const address = bareServer.address();
            const url = `http://localhost:${typeof address === 'object' && address ? address.port : 0}`;

            try {
                const res = await request(`${url}/api/queue/models`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.provider).toBe('copilot');
                expect(providerLookups).toBe(1);
            } finally {
                await new Promise<void>((resolve, reject) => {
                    bareServer.close((err) => err ? reject(err) : resolve());
                });
            }
        });
    });

    // ========================================================================
    // Auto-generated display name
    // ========================================================================

    describe('Auto-generated display name', () => {
        it('should auto-generate name from chat prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'Explain how authentication works' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Explain how authentication works');
        });

        it('should truncate long prompts in auto-generated name', async () => {
            const srv = await startServer();

            const longPrompt = 'A'.repeat(100);
            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: longPrompt },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName.length).toBeLessThanOrEqual(60);
            expect(body.task.displayName).toContain('...');
        });

        it('should auto-generate name from run-workflow path', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'run-workflow',
                payload: { workflowPath: '/home/user/workflows/review-code.yaml' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Run Workflow: review-code.yaml');
        });

        it('should auto-generate name from chat context files', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                payload: { kind: 'chat', mode: 'plan', context: { files: ['/path/to/auth.ts'] } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Chat: auth.ts');
        });

        it('should auto-generate name from chat prompt in payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'Analyze performance metrics' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Analyze performance metrics');
        });

        it('should fallback to type label with timestamp when no content', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'run-workflow',
                payload: {},
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toMatch(/^Run Workflow @ \d{2}:\d{2}$/);
        });

        it('should use explicit displayName when provided', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                displayName: 'My custom name',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'This should be ignored for name' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('My custom name');
        });

        it('should ignore empty string displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                displayName: '',
                payload: { kind: 'chat', mode: 'ask', prompt: 'What does this function do?' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('What does this function do?');
        });

        it('should ignore whitespace-only displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'chat',
                displayName: '   ',
                payload: { kind: 'chat', mode: 'ask', prompt: 'Summarize this module' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Summarize this module');
        });
    });

    // ========================================================================
    // List queue
    // ========================================================================

    describe('GET /api/queue — List', () => {
        it('should return empty queue initially', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
            expect(body.running).toEqual([]);
            expect(body.stats.queued).toBe(0);
            expect(body.stats.running).toBe(0);
        });

        it('should list enqueued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
            expect(body.stats.queued).toBe(2);
        });

        it('should order by priority (high first)', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Low', priority: 'low' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'High', priority: 'high' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Normal', priority: 'normal' }));

            const res = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(res.body);
            expect(body.queued[0].priority).toBe('high');
            expect(body.queued[1].priority).toBe('normal');
            expect(body.queued[2].priority).toBe('low');
        });

        it('should include folderPath in serialized task response', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({ folderPath: '/Users/test/my-project' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.folderPath).toBe('/Users/test/my-project');
        });

        it('should include folderPath when listing queued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'WithFolder', folderPath: '/repos/frontend' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'NoFolder' }));

            const res = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(res.body);
            const withFolder = body.queued.find((t: any) => t.displayName === 'WithFolder');
            const noFolder = body.queued.find((t: any) => t.displayName === 'NoFolder');
            expect(withFolder.folderPath).toBe('/repos/frontend');
            expect(noFolder.folderPath).toBeUndefined();
        });
    });

    // ========================================================================
    // List with repoId filtering
    // ========================================================================

    describe('GET /api/queue?repoId — Filter by repo', () => {
        it('should return all tasks when no repoId param is provided', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', repoId: 'repo-1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', repoId: 'repo-2' }));

            const res = await request(`${srv.url}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
        });

        it('should filter queued tasks by explicit repoId', async () => {
            const srv = await startServer();

            // Register workspaces so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-alpha', name: 'alpha', rootPath: '/repo/alpha' });
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-beta', name: 'beta', rootPath: '/repo/beta' });

            // Pause to prevent execution, then route tasks via workingDirectory
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const res = await request(`${srv.url}/api/queue?repoId=ws-alpha`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
        });

        it('should filter queued tasks by workspace ID alias', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-alpha',
                name: 'alpha',
                rootPath: '/repo/alpha',
            });

            // Pause to keep tasks in queued state for deterministic assertions
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

            const res = await request(`${srv.url}/api/queue?repoId=ws-alpha`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(1);
            expect(body.queued[0].displayName).toBe('A');
        });

        it('should return empty arrays for non-existent repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const res = await request(`${srv.url}/api/queue?repoId=nonexistent`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
            expect(body.running).toEqual([]);
        });

        it('should treat empty repoId parameter as aggregate queue scope', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Tasks with explicit workingDirectory go to their repo queue, not global
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
            // Task without workingDirectory lands in the global workspace queue
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Global' }));

            const res = await request(`${srv.url}/api/queue?repoId=`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued.map((t: any) => t.displayName).sort()).toEqual(['A', 'B', 'Global']);
        });

        it('should return per-repo stats when filtering by repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-alpha', name: 'alpha', rootPath: '/repo/alpha' });
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-beta', name: 'beta', rootPath: '/repo/beta' });

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const res = await request(`${srv.url}/api/queue?repoId=ws-alpha`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Filtered results
            expect(body.queued).toHaveLength(2);
            // Per-repo stats (not global)
            expect(body.stats.queued).toBe(2);
        });

        it('should preserve response structure with filtering', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('queued');
            expect(body).toHaveProperty('running');
            expect(body).toHaveProperty('stats');
            expect(Array.isArray(body.queued)).toBe(true);
            expect(Array.isArray(body.running)).toBe(true);
        });

        it('should exclude tasks without matching repoId', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Task with no workingDirectory (routes to cwd)
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'NoRepo' }));
            // Task with different workingDirectory
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Other', payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

            const repoIdAlpha = require('crypto').createHash('sha256').update(require('path').resolve('/repo/alpha')).digest('hex').substring(0, 16);
            const res = await request(`${srv.url}/api/queue?repoId=${repoIdAlpha}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toEqual([]);
        });
    });

    // ========================================================================
    // Get single task
    // ========================================================================

    describe('GET /api/queue/:id — Get task', () => {
        it('should return a single task by ID', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Find me' }));
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await request(`${srv.url}/api/queue/${taskId}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.task.id).toBe(taskId);
            expect(body.task.displayName).toBe('Find me');
        });

        it('should return 404 for nonexistent task', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/nonexistent-id`);
            expect(res.status).toBe(404);
            expect(JSON.parse(res.body).error).toBe('Task not found');
        });

        it('should return full task with config and payload (not summary)', async () => {
            const srv = await startServer();

            const fullPayload = {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'A detailed prompt that should not be truncated in the detail response',
                additionalContext: 'Extra context data',
            };
            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask({
                displayName: 'Detail check',
                payload: fullPayload,
                config: { model: 'test-model' },
            }));
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await request(`${srv.url}/api/queue/${taskId}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Detail endpoint must return full payload (not truncated summary)
            expect(body.task.payload.prompt).toBe(fullPayload.prompt);
            expect(body.task.payload.additionalContext).toBe('Extra context data');
            expect(body.task.config).toBeDefined();
            expect(body.task.config.model).toBe('test-model');

            // Verify list endpoint returns summary (reduced payload without config)
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            const listTask = listBody.queued.find((t: any) => t.id === taskId);
            expect(listTask).toBeDefined();
            // Summary omits config and additionalContext
            expect(listTask.config).toBeUndefined();
            expect(listTask.payload.additionalContext).toBeUndefined();
        });
    });

    // ========================================================================
    // Cancel task
    // ========================================================================

    describe('DELETE /api/queue/:id — Cancel task', () => {
        it('should cancel a queued task', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.cancelled).toBe(true);

            // Verify it's no longer in the queue
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued).toHaveLength(0);
        });

        it('should return 404 for nonexistent task', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/nonexistent`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Reorder tasks
    // ========================================================================

    describe('Reorder tasks', () => {
        it('should move a task to top', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const thirdId = JSON.parse(res3.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${thirdId}/move-to-top`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(thirdId);
        });

        it('should move a task up one position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const secondId = JSON.parse(res2.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${secondId}/move-up`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(secondId);
        });

        it('should move a task down one position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const firstId = JSON.parse(res1.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${firstId}/move-down`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).moved).toBe(true);

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[1].id).toBe(firstId);
        });

        it('should return 404 when moving nonexistent task to top', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/move-to-top`, {});
            expect(res.status).toBe(404);
        });

        it('should return 404 when moving first task up', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/move-up`, {});
            expect(res.status).toBe(404);
        });

        it('should return 404 when moving last task down', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/move-down`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Move to position
    // ========================================================================

    describe('Move to position', () => {
        it('should move a task to a specific position', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const firstId = JSON.parse(res1.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${firstId}/move-to/2`, {});
            expect(moveRes.status).toBe(200);
            const moveBody = JSON.parse(moveRes.body);
            expect(moveBody.moved).toBe(true);
            expect(moveBody.position).toBe(3); // 1-based: position 3 (0-based index 2)

            // Verify order
            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[2].id).toBe(firstId);
        });

        it('should move a task to position 0 (first)', async () => {
            const srv = await startServer();

            const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const res3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Third' }));
            const thirdId = JSON.parse(res3.body).task.id;

            const moveRes = await postJSON(`${srv.url}/api/queue/${thirdId}/move-to/0`, {});
            expect(moveRes.status).toBe(200);
            expect(JSON.parse(moveRes.body).position).toBe(1);

            const listRes = await request(`${srv.url}/api/queue`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued[0].id).toBe(thirdId);
        });

        it('should return 404 for unknown task', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/move-to/0`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Pause / Resume
    // ========================================================================

    describe('Pause / Resume', () => {
        it('should pause the queue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/pause`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(true);
            expect(body.stats.isPaused).toBe(true);
        });

        it('should pause the queue for a fixed duration', async () => {
            const srv = await startServer();
            const before = Date.now();

            const res = await postJSON(`${srv.url}/api/queue/pause`, { durationHours: 2 });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(true);
            expect(body.pausedUntil).toBeGreaterThanOrEqual(before + 2 * 60 * 60 * 1000);
            expect(body.stats.pausedUntil).toBe(body.pausedUntil);
        });

        it('should reject unsupported timed queue pause durations', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/pause`, { durationHours: 5 });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('durationHours must be one of');
        });

        it('should resume the queue', async () => {
            const srv = await startServer();

            // Pause first
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Then resume
            const res = await postJSON(`${srv.url}/api/queue/resume`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(false);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should reflect paused state in stats', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/pause`, {});

            const statsRes = await request(`${srv.url}/api/queue/stats`);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isPaused).toBe(true);
        });

        it('should pause a specific repo', async () => {
            const srv = await startServer();

            // Register workspace so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-myrepo', name: 'myrepo', rootPath: '/my/repo' });

            // Pause queue first to prevent auto-execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue task with workingDirectory to create the bridge
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/my/repo' },
            }));

            // Resume globally first, then pause specific repo
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const repoId = 'ws-myrepo';
            const res = await postJSON(`${srv.url}/api/queue/pause?repoId=${repoId}`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe(repoId);
            expect(body.paused).toBe(true);
            expect(body.stats.isPaused).toBe(true);
        });

        it('should resume a specific repo', async () => {
            const srv = await startServer();

            // Register workspace so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-myrepo', name: 'myrepo', rootPath: '/my/repo' });

            // Pause queue first to prevent auto-execution, then enqueue to create bridge
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/my/repo' },
            }));

            const repoId = 'ws-myrepo';

            // Resume globally, then pause+resume specific repo
            await postJSON(`${srv.url}/api/queue/resume`, {});
            await postJSON(`${srv.url}/api/queue/pause?repoId=${repoId}`, {});
            const res = await postJSON(`${srv.url}/api/queue/resume?repoId=${repoId}`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe(repoId);
            expect(body.paused).toBe(false);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should include isPaused in per-repo stats', async () => {
            const srv = await startServer();

            // Register workspace so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-testrepo', name: 'testrepo', rootPath: '/test/repo' });

            // Pause queue to prevent execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue to create bridge
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'test' }, workingDirectory: '/test/repo' },
            }));

            const repoId = 'ws-testrepo';
            // Stats should show isPaused from the per-repo manager
            const statsRes = await request(`${srv.url}/api/queue/stats?repoId=${repoId}`);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isPaused).toBe(true);
        });

        it('GET /api/queue/repos should list repos with pause states', async () => {
            const srv = await startServer();

            // Register workspaces so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-one', name: 'one', rootPath: '/repo/one' });
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-two', name: 'two', rootPath: '/repo/two' });

            // Pause queue to prevent auto-execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue tasks for different repos
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'a' }, workingDirectory: '/repo/one' },
            }));
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { data: { prompt: 'b' }, workingDirectory: '/repo/two' },
            }));

            const res = await request(`${srv.url}/api/queue/repos`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repos).toBeDefined();
            expect(body.repos.length).toBeGreaterThanOrEqual(2);

            const repoOne = body.repos.find((r: any) => r.repoId === 'ws-one');
            expect(repoOne).toBeDefined();
            // Both repos are paused because global pause was set
            expect(repoOne.isPaused).toBe(true);
            expect(repoOne.taskCount).toBeGreaterThanOrEqual(1);

            const repoTwo = body.repos.find((r: any) => r.repoId === 'ws-two');
            expect(repoTwo).toBeDefined();
            expect(repoTwo.isPaused).toBe(true);
        });

        it('pause per-repo returns 200 even when no task has been enqueued yet', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-no-queue', name: 'nq', rootPath: '/repo/no-queue' });

            const res = await postJSON(`${srv.url}/api/queue/pause?repoId=ws-no-queue`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(true);
            expect(body.stats.isPaused).toBe(true);
        });

        it('resume per-repo returns 200 even when no task has been enqueued yet', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-no-queue-r', name: 'nqr', rootPath: '/repo/no-queue-r' });

            // pause first so resume has something to clear
            await postJSON(`${srv.url}/api/queue/pause?repoId=ws-no-queue-r`, {});
            const res = await postJSON(`${srv.url}/api/queue/resume?repoId=ws-no-queue-r`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.paused).toBe(false);
            expect(body.stats.isPaused).toBe(false);
        });

        it('unknown repoId returns 404 for pause', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/pause?repoId=completely-unknown`, {});
            expect(res.status).toBe(404);
        });

        it('unknown repoId returns 404 for resume', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/resume?repoId=completely-unknown`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Pause Autopilot / Resume Autopilot
    // ========================================================================

    describe('Pause Autopilot / Resume Autopilot', () => {
        it('POST /api/queue/pause-autopilot should return isAutopilotPaused: true', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/pause-autopilot`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isAutopilotPaused).toBe(true);
            expect(body.stats).toBeDefined();
            expect(body.stats.isAutopilotPaused).toBe(true);
        });

        it('POST /api/queue/pause-autopilot should accept a fixed duration', async () => {
            const srv = await startServer();
            const before = Date.now();

            const res = await postJSON(`${srv.url}/api/queue/pause-autopilot`, { durationHours: 3 });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isAutopilotPaused).toBe(true);
            expect(body.autopilotPausedUntil).toBeGreaterThanOrEqual(before + 3 * 60 * 60 * 1000);
            expect(body.stats.autopilotPausedUntil).toBe(body.autopilotPausedUntil);
        });

        it('POST /api/queue/resume-autopilot should return isAutopilotPaused: false', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause-autopilot`, {});
            const res = await postJSON(`${srv.url}/api/queue/resume-autopilot`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isAutopilotPaused).toBe(false);
            expect(body.stats.isAutopilotPaused).toBe(false);
        });

        it('GET /api/queue/stats should reflect isAutopilotPaused after pause-autopilot', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause-autopilot`, {});
            const res = await request(`${srv.url}/api/queue/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.stats.isAutopilotPaused).toBe(true);
        });

        it('pause-autopilot on unknown repoId should return 404', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=no-such-repo`, {});
            expect(res.status).toBe(404);
        });

        it('resume-autopilot on unknown repoId should return 404', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/resume-autopilot?repoId=no-such-repo`, {});
            expect(res.status).toBe(404);
        });

        it('pause-autopilot per-repo should return repoId + stats', async () => {
            const srv = await startServer();
            // Pause globally to prevent auto-execution, then enqueue to create bridge
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'x', workingDirectory: '/test/repo-ap' },
            }));
            // Resolve the repoId from stats endpoint
            const statsRes = await request(`${srv.url}/api/queue/repos`);
            const repos = JSON.parse(statsRes.body).repos;
            const repoId = repos[0]?.repoId;
            expect(repoId).toBeDefined();

            const res = await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=${repoId}`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe(repoId);
            expect(body.isAutopilotPaused).toBe(true);
            expect(body.stats.isAutopilotPaused).toBe(true);
        });

        it('pause-autopilot for repo with zero queued tasks returns 200', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-empty-ap', name: 'empty', rootPath: '/repo/empty-ap' });

            const res = await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=ws-empty-ap`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.repoId).toBe('ws-empty-ap');
            expect(body.isAutopilotPaused).toBe(true);
            expect(body.stats.isAutopilotPaused).toBe(true);
        });

        it('resume-autopilot for repo with zero queued tasks returns 200', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-empty-ra', name: 'emptyra', rootPath: '/repo/empty-ra' });

            // pause first
            await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=ws-empty-ra`, {});
            const res = await postJSON(`${srv.url}/api/queue/resume-autopilot?repoId=ws-empty-ra`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isAutopilotPaused).toBe(false);
            expect(body.stats.isAutopilotPaused).toBe(false);
        });

        it('GET /api/queue/stats reflects isAutopilotPaused after pause-autopilot on empty repo', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-stats-empty', name: 'statsempty', rootPath: '/repo/stats-empty' });

            await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=ws-stats-empty`, {});

            // stats endpoint uses read-only lookup; manager was materialised above so it must find it
            const statsRes = await request(`${srv.url}/api/queue/stats?repoId=ws-stats-empty`);
            expect(statsRes.status).toBe(200);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isAutopilotPaused).toBe(true);
        });

        it('pause-autopilot then enqueue keeps task in queued state', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-pause-enq', name: 'pauseenq', rootPath: '/repo/pause-enq' });

            // Pause autopilot before any task is enqueued
            const pauseRes = await postJSON(`${srv.url}/api/queue/pause-autopilot?repoId=ws-pause-enq`, {});
            expect(pauseRes.status).toBe(200);

            // Enqueue a task for that repo
            const enqRes = await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'hello', workingDirectory: '/repo/pause-enq' },
            }));
            expect(enqRes.status).toBe(201);
            const task = JSON.parse(enqRes.body).task;
            expect(task.status).toBe('queued');

            // No running tasks for the repo
            const listRes = await request(`${srv.url}/api/queue?repoId=ws-pause-enq`);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.running).toHaveLength(0);
            expect(listBody.queued.length).toBeGreaterThanOrEqual(1);
        });

        it('GET /api/queue/:id guard — pause-autopilot and resume-autopilot should not match task ID route', async () => {
            const srv = await startServer();
            const res1 = await request(`${srv.url}/api/queue/pause-autopilot`);
            expect(res1.status).toBe(404);
            const res2 = await request(`${srv.url}/api/queue/resume-autopilot`);
            expect(res2.status).toBe(404);
        });
    });

    // ========================================================================
    // Clear queue
    // ========================================================================

    describe('DELETE /api/queue — Clear', () => {
        it('should clear all queued tasks', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 3' }));

            const res = await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.cleared).toBe(3);
            expect(body.stats.queued).toBe(0);
        });

        it('should return 0 when clearing empty queue', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).cleared).toBe(0);
        });
    });

    // ========================================================================
    // Stats
    // ========================================================================

    describe('GET /api/queue/stats — Stats', () => {
        it('should return correct queue statistics', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            const res = await request(`${srv.url}/api/queue/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.stats.queued).toBe(2);
            expect(body.stats.running).toBe(0);
            expect(body.stats.isPaused).toBe(false);
        });

        it('should return zeros when queue is empty', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.stats.queued).toBe(0);
            expect(body.stats.running).toBe(0);
            expect(body.stats.total).toBe(0);
        });
    });

    // ========================================================================
    // History
    // ========================================================================

    describe('Queue history', () => {
        it('should show cancelled tasks in history', async () => {
            const srv = await startServer();

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            // Cancel the task
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            // Check history
            const historyRes = await request(`${srv.url}/api/queue/history`);
            expect(historyRes.status).toBe(200);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].id).toBe(taskId);
            expect(body.history[0].status).toBe('cancelled');
        });

        it('should show cleared tasks in history', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task 2' }));

            // Clear the queue
            await request(`${srv.url}/api/queue`, { method: 'DELETE' });

            // Check history
            const historyRes = await request(`${srv.url}/api/queue/history`);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(2);
            body.history.forEach((t: any) => {
                expect(t.status).toBe('cancelled');
            });
        });

        it('should clear history', async () => {
            const srv = await startServer();

            // Create and cancel a task to populate history
            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;
            await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

            // Clear history
            const clearRes = await request(`${srv.url}/api/queue/history`, { method: 'DELETE' });
            expect(clearRes.status).toBe(200);

            // Verify history is empty
            const historyRes = await request(`${srv.url}/api/queue/history`);
            const body = JSON.parse(historyRes.body);
            expect(body.history).toHaveLength(0);
        });

        describe('DELETE /api/queue/history/:taskId — Delete single history entry', () => {
            it('should delete a cancelled task from history', async () => {
                const srv = await startServer();

                const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
                const taskId = JSON.parse(createRes.body).task.id;
                await request(`${srv.url}/api/queue/${taskId}`, { method: 'DELETE' });

                // Verify it's in history
                const historyBefore = JSON.parse((await request(`${srv.url}/api/queue/history`)).body);
                expect(historyBefore.history).toHaveLength(1);

                // Delete the history entry
                const deleteRes = await request(`${srv.url}/api/queue/history/${taskId}`, { method: 'DELETE' });
                expect(deleteRes.status).toBe(200);
                const deleteBody = JSON.parse(deleteRes.body);
                expect(deleteBody.deleted).toBe(true);
                expect(deleteBody.taskId).toBe(taskId);

                // Verify history is now empty
                const historyAfter = JSON.parse((await request(`${srv.url}/api/queue/history`)).body);
                expect(historyAfter.history).toHaveLength(0);
            });

            it('should only remove the targeted entry and leave others intact', async () => {
                const srv = await startServer();

                const res1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task A' }));
                const res2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task B' }));
                const idA = JSON.parse(res1.body).task.id;
                const idB = JSON.parse(res2.body).task.id;
                await request(`${srv.url}/api/queue/${idA}`, { method: 'DELETE' });
                await request(`${srv.url}/api/queue/${idB}`, { method: 'DELETE' });

                await request(`${srv.url}/api/queue/history/${idA}`, { method: 'DELETE' });

                const historyAfter = JSON.parse((await request(`${srv.url}/api/queue/history`)).body);
                expect(historyAfter.history).toHaveLength(1);
                expect(historyAfter.history[0].id).toBe(idB);
            });

            it('should return 404 for a non-existent task ID', async () => {
                const srv = await startServer();

                const deleteRes = await request(`${srv.url}/api/queue/history/no-such-task`, { method: 'DELETE' });
                expect(deleteRes.status).toBe(404);
                expect(JSON.parse(deleteRes.body).error).toContain('not found');
            });

            it('should return 409 when attempting to delete a running task', async () => {
                const srv = await startServer();

                // Enqueue but do not cancel (leaves it in 'queued' state, similar check)
                const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
                const taskId = JSON.parse(createRes.body).task.id;

                // Attempt to delete a queued (non-history) task via history endpoint
                const deleteRes = await request(`${srv.url}/api/queue/history/${taskId}`, { method: 'DELETE' });
                expect(deleteRes.status).toBe(409);
            });
        });

        describe('GET /api/queue/history?repoId — Filter history by repo', () => {
            it('should return all history when no repoId param is provided', async () => {
                const srv = await startServer();
                const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ repoId: 'repo-1' }));
                const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ repoId: 'repo-2' }));
                const id1 = JSON.parse(r1.body).task.id;
                const id2 = JSON.parse(r2.body).task.id;
                await request(`${srv.url}/api/queue/${id1}`, { method: 'DELETE' });
                await request(`${srv.url}/api/queue/${id2}`, { method: 'DELETE' });

                const res = await request(`${srv.url}/api/queue/history`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(2);
            });

            it('should filter history by per-repo queue routing', async () => {
                const srv = await startServer();
                // Register workspaces so bridge maps repoId → rootPath
                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-alpha', name: 'alpha', rootPath: '/repo/alpha' });
                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-beta', name: 'beta', rootPath: '/repo/beta' });

                await postJSON(`${srv.url}/api/queue/pause`, {});
                const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));
                const r3 = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                for (const r of [r1, r2, r3]) {
                    const id = JSON.parse(r.body).task.id;
                    await request(`${srv.url}/api/queue/${id}`, { method: 'DELETE' });
                }

                const res = await request(`${srv.url}/api/queue/history?repoId=ws-alpha`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(2);
            });

            it('should filter history by workspace ID alias', async () => {
                const srv = await startServer();

                await postJSON(`${srv.url}/api/workspaces`, {
                    id: 'ws-alpha',
                    name: 'alpha',
                    rootPath: '/repo/alpha',
                });

                await postJSON(`${srv.url}/api/queue/pause`, {});
                const alphaTask = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/alpha' } }));
                const betaTask = await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/repo/beta' } }));

                const alphaTaskId = JSON.parse(alphaTask.body).task.id;
                const betaTaskId = JSON.parse(betaTask.body).task.id;
                await request(`${srv.url}/api/queue/${alphaTaskId}`, { method: 'DELETE' });
                await request(`${srv.url}/api/queue/${betaTaskId}`, { method: 'DELETE' });

                const res = await request(`${srv.url}/api/queue/history?repoId=ws-alpha`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history).toHaveLength(1);
                expect(body.history[0].id).toBe(alphaTaskId);
            });

            it('should filter history via workingDirectory-based routing', async () => {
                const srv = await startServer();
                // Register workspace for the cwd so bridge maps repoId → rootPath
                const cwd = process.cwd();
                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-cwd', name: 'cwd', rootPath: cwd });

                // Enqueue a task with workingDirectory
                const r = await postJSON(`${srv.url}/api/queue`, makeTask({
                    payload: { data: { prompt: 'test' }, workingDirectory: cwd },
                }));
                const id = JSON.parse(r.body).task.id;
                await request(`${srv.url}/api/queue/${id}`, { method: 'DELETE' });

                const res = await request(`${srv.url}/api/queue/history?repoId=${encodeURIComponent('ws-cwd')}`);
                expect(res.status).toBe(200);
                const body = JSON.parse(res.body);
                expect(body.history.some((t: any) => t.id === id)).toBe(true);
            });
        });
    });

    // ========================================================================
    // Type filter
    // ========================================================================

    describe('GET /api/queue/history?type — Filter by type', () => {
        it('should return only chat-type tasks when type=chat', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 1', payload: { kind: 'chat', mode: 'autopilot', prompt: 'hello' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'run-workflow', displayName: 'Workflow 1', payload: { workflowPath: '/a.yaml' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 2', payload: { kind: 'chat', mode: 'autopilot', prompt: 'world' } }));

            // Cancel all to move to history
            const listRes = await request(`${srv.url}/api/queue`);
            const queued = JSON.parse(listRes.body).queued;
            for (const t of queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
            body.history.forEach((t: any) => expect(t.type).toBe('chat'));
        });

        it('should return only run-workflow tasks when type=run-workflow', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'run-workflow', displayName: 'WF 1', payload: { workflowPath: '/a.yaml' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 1', payload: { kind: 'chat', mode: 'autopilot', prompt: 'hi' } }));

            const listRes = await request(`${srv.url}/api/queue`);
            for (const t of JSON.parse(listRes.body).queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history?type=run-workflow`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(1);
            expect(body.history[0].type).toBe('run-workflow');
        });

        it('should return all types when no type param is provided (backward compat)', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat', payload: { kind: 'chat', mode: 'autopilot', prompt: 'hi' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'run-workflow', displayName: 'Workflow', payload: { workflowPath: '/a.yaml' } }));

            const listRes = await request(`${srv.url}/api/queue`);
            for (const t of JSON.parse(listRes.body).queued) {
                await request(`${srv.url}/api/queue/${t.id}`, { method: 'DELETE' });
            }

            const res = await request(`${srv.url}/api/queue/history`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.history).toHaveLength(2);
        });

        it('should return 400 for invalid type value', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue/history?type=invalid`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid type filter');
        });
    });

    describe('GET /api/queue?type — Filter queued/running by type', () => {
        it('should filter queued array by type while keeping stats unfiltered', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat', payload: { kind: 'chat', mode: 'autopilot', prompt: 'hi' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'run-workflow', displayName: 'Workflow', payload: { workflowPath: '/a.yaml' } }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ type: 'chat', displayName: 'Chat 2', payload: { kind: 'chat', mode: 'autopilot', prompt: 'hello' } }));

            const res = await request(`${srv.url}/api/queue?type=chat`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.queued).toHaveLength(2);
            body.queued.forEach((t: any) => expect(t.type).toBe('chat'));
            // Stats remain unfiltered — reflect true queue state
            expect(body.stats.queued).toBe(3);
        });

        it('should return 400 for invalid type value on queue endpoint', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue?type=bogus`);
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid type filter');
        });
    });

    describe('Task config', () => {
        it('should preserve execution config', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: {
                    model: 'gpt-4',
                    timeoutMs: 60000,
                    retryOnFailure: true,
                    retryAttempts: 3,
                    retryDelayMs: 5000,
                },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('gpt-4');
            expect(body.task.config.timeoutMs).toBe(60000);
            expect(body.task.config.retryOnFailure).toBe(true);
            expect(body.task.config.retryAttempts).toBe(3);
            expect(body.task.config.retryDelayMs).toBe(5000);
        });

        it('should default retryOnFailure to false', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask());
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.retryOnFailure).toBe(false);
        });
    });

    // ========================================================================
    // CWD and Model support
    // ========================================================================

    describe('CWD and Model support', () => {
        it('should preserve model in config', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('claude-sonnet-4-5');
        });

        it('should preserve workingDirectory in chat ask payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'test', workingDirectory: '/my/project' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/my/project');
        });

        it('should preserve workingDirectory in chat autopilot payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'Follow this prompt', workingDirectory: '/workspace/root' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/workspace/root');
        });

        it('should preserve both model and workingDirectory together', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'analyze code', workingDirectory: '/my/repo' },
                config: { model: 'gpt-4' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('gpt-4');
            expect(body.task.payload.workingDirectory).toBe('/my/repo');
        });

        it('should handle empty model (undefined in config)', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                config: {},
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBeUndefined();
        });

        it('should handle missing workingDirectory in payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'chat',
                payload: { kind: 'chat', mode: 'ask', prompt: 'test' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBeUndefined();
        });
    });

    // ========================================================================
    // Multiple operations lifecycle
    // ========================================================================

    // ========================================================================
    // Force-fail running tasks
    // ========================================================================

    describe('POST /api/queue/force-fail-running — Force-fail all', () => {
        it('should force-fail all running tasks', async () => {
            const srv = await startServer();

            // Pause queue to prevent auto-execution of tasks
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue tasks
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task A' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Task B' }));

            // Get task IDs
            let list = await request(`${srv.url}/api/queue`);
            const queued = JSON.parse(list.body).queued;
            expect(queued).toHaveLength(2);

            // Force-fail with custom error message
            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {
                error: 'Manually force-failed',
            });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            // Tasks are queued, not running, so none should be force-failed
            expect(body.forceFailed).toBe(0);
        });

        it('should return 0 when no running tasks', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).forceFailed).toBe(0);
        });

        it('should use default error message when not provided', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            expect(res.status).toBe(200);
            expect(JSON.parse(res.body).stats).toBeDefined();
        });
    });

    describe('POST /api/queue/:id/force-fail — Force-fail single', () => {
        it('should return 404 for non-existent task', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/nonexistent/force-fail`, {
                error: 'test',
            });
            expect(res.status).toBe(404);
        });

        it('should return 404 for queued (non-running) task', async () => {
            const srv = await startServer();

            // Pause to prevent execution
            await postJSON(`${srv.url}/api/queue/pause`, {});

            const createRes = await postJSON(`${srv.url}/api/queue`, makeTask());
            const taskId = JSON.parse(createRes.body).task.id;

            const res = await postJSON(`${srv.url}/api/queue/${taskId}/force-fail`, {
                error: 'test',
            });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Lifecycle
    // ========================================================================

    describe('Lifecycle', () => {
        it('should handle enqueue, reorder, cancel, clear lifecycle', async () => {
            const srv = await startServer();

            // Enqueue 3 tasks
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'A' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'B' }));
            const r3 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'C' }));
            const id1 = JSON.parse(r1.body).task.id;
            const id2 = JSON.parse(r2.body).task.id;
            const id3 = JSON.parse(r3.body).task.id;

            // Verify 3 in queue
            let list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(3);

            // Move C to top
            await postJSON(`${srv.url}/api/queue/${id3}/move-to-top`, {});
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued[0].id).toBe(id3);

            // Cancel B
            await request(`${srv.url}/api/queue/${id2}`, { method: 'DELETE' });
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(2);

            // Clear remaining
            await request(`${srv.url}/api/queue`, { method: 'DELETE' });
            list = await request(`${srv.url}/api/queue`);
            expect(JSON.parse(list.body).queued).toHaveLength(0);

            // History should have all 3
            const history = await request(`${srv.url}/api/queue/history`);
            expect(JSON.parse(history.body).history).toHaveLength(3);
        });

        it('should handle pause and resume with enqueue', async () => {
            const srv = await startServer();

            // Pause
            await postJSON(`${srv.url}/api/queue/pause`, {});

            // Enqueue while paused
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Paused task' }));

            // Verify task is queued and queue is paused
            const list = await request(`${srv.url}/api/queue`);
            const body = JSON.parse(list.body);
            expect(body.queued).toHaveLength(1);
            expect(body.stats.isPaused).toBe(true);

            // Resume
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const stats = await request(`${srv.url}/api/queue/stats`);
            expect(JSON.parse(stats.body).stats.isPaused).toBe(false);
        });
    });

    // ========================================================================
    // Request Logs
    // ========================================================================

    describe('Request logs', () => {
        let stderrSpy: ReturnType<typeof import('vitest').vi.spyOn>;

        beforeEach(async () => {
            const { vi } = await import('vitest');
            stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        });

        afterEach(() => {
            stderrSpy.mockRestore();
        });

        function stderrLines(): string[] {
            return stderrSpy.mock.calls
                .map(([msg]) => (typeof msg === 'string' ? msg : ''))
                .filter(Boolean);
        }

        it('should log [Queue] enqueue on POST /api/queue', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue`, makeTask());
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] enqueue task='))).toBe(true);
        });

        it('should log [Queue] bulk-enqueue on POST /api/queue/bulk', async () => {
            const srv = await startServer();
            const tasks = [makeTask({ displayName: 'A' }), makeTask({ displayName: 'B' })];
            await postJSON(`${srv.url}/api/queue/bulk`, { tasks });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] bulk-enqueue count=2'))).toBe(true);
        });

        it('should log [Queue] pause on POST /api/queue/pause', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] pause repoId=global'))).toBe(true);
        });

        it('should log [Queue] pause with repoId', async () => {
            const srv = await startServer();
            // Register workspace so bridge maps repoId → rootPath
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-pauselog', name: 'pauselog', rootPath: '/test/pause-log' });
            // Enqueue a task to create the bridge for this repo
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ payload: { data: { prompt: 'test' }, workingDirectory: '/test/pause-log' } }));
            const repoId = 'ws-pauselog';
            stderrSpy.mockClear();
            await request(`${srv.url}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.includes(`[Queue] pause repoId=${repoId}`))).toBe(true);
        });

        it('should log [Queue] resume on POST /api/queue/resume', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/resume`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] resume repoId=global'))).toBe(true);
        });

        it('should log [Queue] force-fail-running on POST /api/queue/force-fail-running', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/force-fail-running`, {});
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith('[Queue] force-fail-running count='))).toBe(true);
        });

        it('should log [Queue] move-to-top on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            // Enqueue two tasks to allow reordering
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id2 = JSON.parse(r2.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id2}/move-to-top`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-to-top task=${id2}`))).toBe(true);
        });

        it('should log [Queue] move-up on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id2 = JSON.parse(r2.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id2}/move-up`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-up task=${id2}`))).toBe(true);
        });

        it('should log [Queue] move-down on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            const r1 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'First' }));
            const r2 = await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'Second' }));
            const id1 = JSON.parse(r1.body).task.id;
            stderrSpy.mockClear();

            await request(`${srv.url}/api/queue/${id1}/move-down`, { method: 'POST' });
            const lines = stderrLines();
            expect(lines.some(l => l.startsWith(`[Queue] move-down task=${id1}`))).toBe(true);
        });
    });

    // ========================================================================
    // Pause Marker
    // ========================================================================

    describe('POST /api/queue/pause-marker — Insert Pause Marker', () => {
        it('returns 201 with markerId on success', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {}); // pause so tasks stay queued
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'T1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'T2' }));

            const res = await postJSON(`${srv.url}/api/queue/pause-marker`, { afterIndex: 1 });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.markerId).toBeDefined();
            expect(typeof body.markerId).toBe('string');
        });

        it('inserted marker appears in GET /api/queue queued list', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'T1' }));
            await postJSON(`${srv.url}/api/queue`, makeTask({ displayName: 'T2' }));

            const markerRes = await postJSON(`${srv.url}/api/queue/pause-marker`, { afterIndex: 1 });
            const { markerId } = JSON.parse(markerRes.body);

            const listRes = await request(`${srv.url}/api/queue`);
            const list = JSON.parse(listRes.body);
            const markerItem = list.queued.find((i: any) => i.kind === 'pause-marker');
            expect(markerItem).toBeDefined();
            expect(markerItem.id).toBe(markerId);
        });

        it('returns 400 when afterIndex is missing', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/pause-marker`, {});
            expect(res.status).toBe(400);
        });

        it('returns 400 when afterIndex is not a number', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/pause-marker`, { afterIndex: 'bad' });
            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/queue/pause-marker/:markerId — Remove Pause Marker', () => {
        it('removes marker and returns 200', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/queue/pause`, {});
            await postJSON(`${srv.url}/api/queue`, makeTask());

            const markerRes = await postJSON(`${srv.url}/api/queue/pause-marker`, { afterIndex: 1 });
            const { markerId } = JSON.parse(markerRes.body);

            const delRes = await request(`${srv.url}/api/queue/pause-marker/${markerId}`, { method: 'DELETE' });
            expect(delRes.status).toBe(200);

            // Marker should be gone from queue
            const listRes = await request(`${srv.url}/api/queue`);
            const list = JSON.parse(listRes.body);
            expect(list.queued.some((i: any) => i.kind === 'pause-marker')).toBe(false);
        });

        it('returns 404 for unknown markerId', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue/pause-marker/no-such-id`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Global Workspace Scoping
    // ========================================================================

    describe('Global workspace scoping', () => {
        it('task enqueued without workingDirectory lands in global workspace queue', async () => {
            const srv = await startServer();

            // Enqueue a task with no workingDirectory or workspaceId
            const res = await postJSON(`${srv.url}/api/queue`, makeTask());
            expect(res.status).toBe(201);

            // GET /api/queue (no repoId) should return it
            const listRes = await request(`${srv.url}/api/queue`);
            const list = JSON.parse(listRes.body);
            const allTasks = [...list.queued, ...list.running];
            expect(allTasks.length).toBeGreaterThanOrEqual(1);
        });

        it('GET /api/queue (no repoId) includes repo-specific tasks', async () => {
            const srv = await startServer();

            // Register a non-global workspace and enqueue a task to it
            const store = new FileProcessStore({ dataDir });
            const repoDir = path.join(dataDir, 'test-repo');
            fs.mkdirSync(repoDir, { recursive: true });
            await store.registerWorkspace({ id: 'repo-1', name: 'Test Repo', rootPath: repoDir });

            // Enqueue a task to the specific repo
            await postJSON(`${srv.url}/api/queue`, makeTask({
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'repo task', workingDirectory: repoDir },
            }));

            // Enqueue a global task (no workingDirectory)
            await postJSON(`${srv.url}/api/queue`, makeTask({
                displayName: 'Global task',
            }));

            // GET /api/queue (no repoId) aggregates all queues for the activity list.
            const listRes = await request(`${srv.url}/api/queue`);
            const list = JSON.parse(listRes.body);
            const allTasks = [...list.queued, ...list.running];
            const repoTasks = allTasks.filter((t: any) =>
                t.payload?.workingDirectory === repoDir
            );
            expect(repoTasks).toHaveLength(1);
        });
    });

    // ========================================================================
    // buildSummarizePrompt
    // ========================================================================

    describe('buildSummarizePrompt', () => {
        function makeConv(id: string, turns: Array<{ role: 'user' | 'assistant'; content: string }> = []): SummarizeConversation {
            return {
                id,
                status: 'completed',
                turns: turns.map((t, i) => ({ role: t.role, content: t.content, timestamp: new Date(), turnIndex: i, timeline: [] })),
            };
        }

        it('should include all conversations with 2 conversations', () => {
            const convs = [
                makeConv('proc1', [{ role: 'user', content: 'hello' }]),
                makeConv('proc2', [{ role: 'user', content: 'world' }]),
            ];
            const prompt = buildSummarizePrompt(convs);
            expect(prompt).toContain('═══ Conversation 1 ═══');
            expect(prompt).toContain('═══ Conversation 2 ═══');
            expect(prompt).toContain('hello');
            expect(prompt).toContain('world');
            expect(prompt).toContain('Summarize the following conversation logs');
        });

        it('should include all conversations with 5 conversations', () => {
            const convs = Array.from({ length: 5 }, (_, i) => makeConv(`proc${i}`, [{ role: 'user', content: `msg${i}` }]));
            const prompt = buildSummarizePrompt(convs);
            for (let i = 1; i <= 5; i++) {
                expect(prompt).toContain(`═══ Conversation ${i} ═══`);
            }
        });

        it('should not include user prompt section when userPrompt is undefined', () => {
            const prompt = buildSummarizePrompt([makeConv('proc1')]);
            expect(prompt).not.toContain('Additional focus');
        });

        it('should not include user prompt section when userPrompt is empty', () => {
            const prompt = buildSummarizePrompt([makeConv('proc1')], '');
            expect(prompt).not.toContain('Additional focus');
        });

        it('should not include user prompt section when userPrompt is whitespace', () => {
            const prompt = buildSummarizePrompt([makeConv('proc1')], '   ');
            expect(prompt).not.toContain('Additional focus');
        });

        it('should append user prompt section when userPrompt is provided', () => {
            const prompt = buildSummarizePrompt([makeConv('proc1')], 'Focus on action items');
            expect(prompt).toContain('Additional focus / question from the user:');
            expect(prompt).toContain('Focus on action items');
        });

        it('should inline conversation content in the prompt', () => {
            const conv = makeConv('proc1', [
                { role: 'user', content: 'What is X?' },
                { role: 'assistant', content: 'X is Y.' },
            ]);
            const prompt = buildSummarizePrompt([conv]);
            expect(prompt).toContain('What is X?');
            expect(prompt).toContain('X is Y.');
        });

        it('should delimit conversations with ═══ markers', () => {
            const convs = [
                makeConv('proc1', [{ role: 'user', content: 'a' }]),
                makeConv('proc2', [{ role: 'user', content: 'b' }]),
            ];
            const prompt = buildSummarizePrompt(convs);
            expect(prompt).toMatch(/═══ Conversation 1 ═══/);
            expect(prompt).toMatch(/═══ Conversation 2 ═══/);
            expect(prompt).not.toContain('Conversation files:');
        });
    });

    // ========================================================================
    // serializeConversationForSummary
    // ========================================================================

    describe('serializeConversationForSummary', () => {
        const baseTurn = (overrides: Partial<ConversationTurn>): ConversationTurn => ({
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
            turnIndex: 0,
            timeline: [],
            ...overrides,
        });

        it('should return just header with id and status for empty turns', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'completed', turns: [],
            });
            expect(result).toBe('## Process p1 [completed]');
        });

        it('should format a single user turn', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'running',
                turns: [baseTurn({ role: 'user', content: 'hello', turnIndex: 0 })],
            });
            expect(result).toContain('[User] (turn 0): hello');
        });

        it('should format a single assistant turn', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'running',
                turns: [baseTurn({ role: 'assistant', content: 'world', turnIndex: 0 })],
            });
            expect(result).toContain('[Assistant] (turn 0): world');
        });

        it('should truncate long assistant turns with suffix', () => {
            const longContent = 'x'.repeat(4000);
            const result = serializeConversationForSummary({
                id: 'p1', status: 'running',
                turns: [baseTurn({ role: 'assistant', content: longContent, turnIndex: 1 })],
            });
            expect(result).toContain('… (truncated)');
            expect(result).not.toContain('x'.repeat(4000));
        });

        it('should include title in header when present', () => {
            const result = serializeConversationForSummary({
                id: 'p1', title: 'My Chat', status: 'completed', turns: [],
            });
            expect(result).toBe('## Process p1 — My Chat [completed]');
        });

        it('should omit title from header when undefined', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'failed', turns: [],
            });
            expect(result).toBe('## Process p1 [failed]');
            expect(result).not.toContain('—');
        });

        it('should show status in header', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'cancelled', turns: [],
            });
            expect(result).toContain('[cancelled]');
        });

        it('should not render tool calls', () => {
            const result = serializeConversationForSummary({
                id: 'p1', status: 'completed',
                turns: [baseTurn({
                    role: 'assistant', content: 'I ran a tool',
                    turnIndex: 0, toolCalls: [{ name: 'read_file', input: '{}', output: 'data' } as any],
                })],
            });
            expect(result).not.toContain('read_file');
            expect(result).not.toContain('toolCalls');
            expect(result).toContain('[Assistant] (turn 0): I ran a tool');
        });

        it('should respect custom maxTurnLength', () => {
            const content = 'a'.repeat(100);
            const result = serializeConversationForSummary(
                { id: 'p1', status: 'completed', turns: [baseTurn({ role: 'assistant', content, turnIndex: 0 })] },
                50,
            );
            expect(result).toContain('… (truncated)');
            const turnLine = result.split('\n').find(l => l.startsWith('[Assistant]'))!;
            // 50 chars of content + '… (truncated)' suffix
            expect(turnLine).toContain('a'.repeat(50));
            expect(turnLine).not.toContain('a'.repeat(51));
        });
    });

    // ========================================================================
    // POST /api/queue/summarize
    // ========================================================================

    describe('POST /api/queue/summarize', () => {
        /** Seed a process into the store so store.getProcess() finds it. */
        async function seedProcess(store: FileProcessStore, id: string, workspaceId: string): Promise<void> {
            await store.registerWorkspace({ id: workspaceId, name: 'test', rootPath: '/test' });
            await store.addProcess({
                id,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test prompt',
                status: 'completed',
                startTime: new Date(),
                metadata: { type: 'clarification', workspaceId },
                conversationTurns: [
                    { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
                    { role: 'assistant', content: 'Hi there', timestamp: new Date(), turnIndex: 1, timeline: [] },
                ],
            });
        }

        it('should return 201 with taskId on success', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_id1', 'ws1');
            await seedProcess(store, 'queue_id2', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['id1', 'id2'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
            expect(typeof body.taskId).toBe('string');
            expect(body.taskId.length).toBeGreaterThan(0);
        });

        it('should return 400 when processIds is missing', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('processIds');
        });

        it('should accept a single processId (minimum boundary)', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_id1', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['id1'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
        });

        it('should return 400 when processIds exceeds 20 items', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: Array(21).fill('id'),
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('exceed 20');
        });

        it('should return 400 when workspaceId is missing', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['a', 'b'],
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('workspaceId');
        });

        it('should return 400 when a processId element is not a string', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['a', 123],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('non-empty string');
        });

        it('should return 400 when processIds is an empty array', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: [],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('at least 1');
        });

        it('should accept exactly 20 processIds (maximum boundary)', async () => {
            const store = new FileProcessStore({ dataDir });
            const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
            for (const id of ids) {
                await seedProcess(store, `queue_${id}`, 'ws1');
            }
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ids,
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();
        });

        it('should return 201 with only a taskId field on success', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_a', 'ws1');
            await seedProcess(store, 'queue_b', 'ws1');
            await seedProcess(store, 'queue_c', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['a', 'b', 'c'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(typeof body.taskId).toBe('string');
            expect(body.taskId.length).toBeGreaterThan(0);
        });

        it('should return 400 for invalid JSON body', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/queue/summarize`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('Invalid JSON');
        });

        it('should return 400 when processIds contains empty strings', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['a', ''],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('non-empty string');
        });

        it('should normalize bare task IDs by prepending queue_ prefix', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_abc123', 'ws1');
            await seedProcess(store, 'queue_def456', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['abc123', 'def456'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).toContain('queue_abc123');
            expect(detailBody.task.payload.prompt).toContain('queue_def456');
        });

        it('should preserve IDs that already have queue_ prefix', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_abc123', 'ws1');
            await seedProcess(store, 'queue_def456', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['queue_abc123', 'queue_def456'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).toContain('queue_abc123');
            expect(detailBody.task.payload.prompt).not.toContain('queue_queue_abc123');
        });

        it('should forward userPrompt into the enqueued task prompt', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_id1', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['id1'],
                workspaceId: 'ws1',
                userPrompt: 'Focus on action items only',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).toContain('Focus on action items only');
            expect(detailBody.task.payload.prompt).toContain('Additional focus / question from the user:');
        });

        it('should not include user prompt section when userPrompt is empty', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_id1', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['id1'],
                workspaceId: 'ws1',
                userPrompt: '',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).not.toContain('Additional focus');
        });

        it('should truncate userPrompt to 2000 characters', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_id1', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const longPrompt = 'x'.repeat(3000);
            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['id1'],
                workspaceId: 'ws1',
                userPrompt: longPrompt,
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).toContain('Additional focus');
            const afterMarker = detailBody.task.payload.prompt.split('Additional focus / question from the user:\n')[1];
            expect(afterMarker.length).toBeLessThanOrEqual(2000);
        });

        it('should return 404 when none of the processes are found', async () => {
            const store = new FileProcessStore({ dataDir });
            await store.registerWorkspace({ id: 'ws1', name: 'test', rootPath: '/test' });
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['nonexistent1', 'nonexistent2'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('None of the requested processes were found');
        });

        it('should proceed with partial results when some processes are missing', async () => {
            const store = new FileProcessStore({ dataDir });
            await seedProcess(store, 'queue_existing', 'ws1');
            const srv = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
            server = srv;

            const res = await postJSON(`${srv.url}/api/queue/summarize`, {
                processIds: ['existing', 'missing'],
                workspaceId: 'ws1',
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.taskId).toBeDefined();

            const detailRes = await request(`${srv.url}/api/queue/${body.taskId}`);
            const detailBody = JSON.parse(detailRes.body);
            expect(detailBody.task).toBeDefined();
            expect(detailBody.task.payload.prompt).toContain('queue_existing');
            expect(detailBody.task.payload.prompt).not.toContain('queue_missing');
        });
    });
});
