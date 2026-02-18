/**
 * Bulk Queue API Tests
 *
 * Comprehensive tests for POST /api/queue/bulk endpoint:
 * validation, limits, atomic fail-fast, success paths,
 * and regression for existing single-task POST /api/queue.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
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

/** Create a minimal task spec for bulk requests. */
function makeTaskSpec(overrides: Record<string, any> = {}) {
    return {
        type: 'custom',
        priority: 'normal',
        displayName: 'Test task',
        payload: { data: { prompt: 'test' } },
        config: {},
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/queue/bulk', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bulk-queue-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    // ========================================================================
    // Success Paths
    // ========================================================================

    describe('Success', () => {
        it('should enqueue multiple valid tasks and return 201', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ displayName: 'Task A' }),
                    makeTaskSpec({ displayName: 'Task B' }),
                ],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.summary.total).toBe(2);
            expect(body.summary.succeeded).toBe(2);
            expect(body.summary.failed).toBe(0);
            expect(body.success).toHaveLength(2);
            expect(body.failed).toHaveLength(0);

            // Verify indices
            expect(body.success[0].index).toBe(0);
            expect(body.success[1].index).toBe(1);

            // Verify task IDs are unique
            expect(body.success[0].taskId).toBeDefined();
            expect(body.success[1].taskId).toBeDefined();
            expect(body.success[0].taskId).not.toBe(body.success[1].taskId);
        });

        it('should enqueue a single task', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [makeTaskSpec()],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.summary.total).toBe(1);
            expect(body.summary.succeeded).toBe(1);
        });

        it('should enqueue tasks with different types', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ type: 'ai-clarification', payload: { prompt: 'Explain' } }),
                    makeTaskSpec({ type: 'follow-prompt', payload: { promptFilePath: '/path/to/prompt.md' } }),
                    makeTaskSpec({ type: 'custom', payload: { data: {} } }),
                ],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.summary.succeeded).toBe(3);
            expect(body.success[0].task.type).toBe('ai-clarification');
            expect(body.success[1].task.type).toBe('follow-prompt');
            expect(body.success[2].task.type).toBe('custom');
        });

        it('should enqueue tasks with different priorities', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ priority: 'high' }),
                    makeTaskSpec({ priority: 'normal' }),
                    makeTaskSpec({ priority: 'low' }),
                ],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.success[0].task.priority).toBe('high');
            expect(body.success[1].task.priority).toBe('normal');
            expect(body.success[2].task.priority).toBe('low');
        });

        it('should include serialized task in success response', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [makeTaskSpec({ displayName: 'Serialized Task' })],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            const task = body.success[0].task;
            expect(task.id).toBeDefined();
            expect(task.type).toBe('custom');
            expect(task.status).toBe('queued');
            expect(task.displayName).toBe('Serialized Task');
        });

        it('should make tasks visible in GET /api/queue', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ displayName: 'Bulk Task 1' }),
                    makeTaskSpec({ displayName: 'Bulk Task 2' }),
                ],
            });

            const listRes = await request(`${srv.url}/api/queue`);
            expect(listRes.status).toBe(200);
            const listBody = JSON.parse(listRes.body);
            expect(listBody.queued.length).toBeGreaterThanOrEqual(2);
        });
    });

    // ========================================================================
    // Validation Defaults
    // ========================================================================

    describe('Defaults', () => {
        it('should default priority to normal for invalid values', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [makeTaskSpec({ priority: 'invalid-priority' })],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.success[0].task.priority).toBe('normal');
        });

        it('should auto-generate displayName from prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [{
                    type: 'ai-clarification',
                    payload: { prompt: 'What is this code doing?' },
                }],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.success[0].task.displayName).toContain('What is this code doing?');
        });

        it('should default retryOnFailure to false', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [makeTaskSpec({ config: {} })],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.success[0].task.config.retryOnFailure).toBe(false);
        });

        it('should use provided config values', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [makeTaskSpec({
                    config: {
                        model: 'gpt-4',
                        timeoutMs: 60000,
                        retryOnFailure: true,
                        retryAttempts: 3,
                        retryDelayMs: 1000,
                    },
                })],
            });

            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            const config = body.success[0].task.config;
            expect(config.model).toBe('gpt-4');
            expect(config.timeoutMs).toBe(60000);
            expect(config.retryOnFailure).toBe(true);
            expect(config.retryAttempts).toBe(3);
            expect(config.retryDelayMs).toBe(1000);
        });
    });

    // ========================================================================
    // Request Validation Errors
    // ========================================================================

    describe('Request validation', () => {
        it('should return 400 for invalid JSON', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/queue/bulk`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });

            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid JSON');
        });

        it('should return 400 for missing tasks field', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {});
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('tasks');
        });

        it('should return 400 for non-array tasks field', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, { tasks: 'not-array' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('must be an array');
        });

        it('should return 400 for empty tasks array', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, { tasks: [] });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('cannot be empty');
        });

        it('should return 400 for tasks array exceeding 100 items', async () => {
            const srv = await startServer();

            const tasks = Array(101).fill(makeTaskSpec());
            const res = await postJSON(`${srv.url}/api/queue/bulk`, { tasks });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('exceed 100');
        });

        it('should accept exactly 100 tasks', async () => {
            const srv = await startServer();

            const tasks = Array(100).fill(null).map((_, i) =>
                makeTaskSpec({ displayName: `Task ${i}` })
            );
            const res = await postJSON(`${srv.url}/api/queue/bulk`, { tasks });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.summary.succeeded).toBe(100);
        });
    });

    // ========================================================================
    // Atomic Validation (Fail-Fast)
    // ========================================================================

    describe('Atomic validation', () => {
        it('should reject all tasks if one has missing type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ displayName: 'Valid task' }),
                    { payload: {} }, // Missing type
                ],
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.summary.succeeded).toBe(0);
            expect(body.summary.failed).toBe(1);
            expect(body.success).toHaveLength(0);
            expect(body.failed).toHaveLength(1);
            expect(body.failed[0].index).toBe(1);
            expect(body.failed[0].error).toContain('Missing required field: type');
        });

        it('should reject all tasks if one has invalid type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec(),
                    makeTaskSpec({ type: 'invalid-type' }),
                ],
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.summary.succeeded).toBe(0);
            expect(body.failed[0].index).toBe(1);
            expect(body.failed[0].error).toContain('Invalid task type: invalid-type');
        });

        it('should report all validation errors at once', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    { payload: {} },                         // Missing type
                    { type: 'invalid-type', payload: {} },   // Invalid type
                    makeTaskSpec(),                            // Valid — should not enqueue
                ],
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.summary.total).toBe(3);
            expect(body.summary.succeeded).toBe(0);
            expect(body.summary.failed).toBe(2);
            expect(body.failed).toHaveLength(2);
            expect(body.failed[0].index).toBe(0);
            expect(body.failed[1].index).toBe(1);
        });

        it('should not enqueue any tasks when validation fails', async () => {
            const srv = await startServer();

            // Get baseline queue count
            const beforeRes = await request(`${srv.url}/api/queue`);
            const beforeCount = JSON.parse(beforeRes.body).queued.length;

            // Attempt bulk with one invalid task
            await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [
                    makeTaskSpec({ displayName: 'Should NOT enqueue' }),
                    { type: 'invalid' },
                ],
            });

            // Verify no new tasks
            const afterRes = await request(`${srv.url}/api/queue`);
            const afterCount = JSON.parse(afterRes.body).queued.length;
            expect(afterCount).toBe(beforeCount);
        });

        it('should include taskSpec in failed items for debugging', async () => {
            const srv = await startServer();

            const badSpec = { type: 'invalid-type', payload: { debug: true } };
            const res = await postJSON(`${srv.url}/api/queue/bulk`, {
                tasks: [badSpec],
            });

            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.failed[0].taskSpec).toEqual(badSpec);
        });
    });

    // ========================================================================
    // Regression: Single-Task POST /api/queue Still Works
    // ========================================================================

    describe('Regression: single-task POST /api/queue', () => {
        it('should still enqueue a single task via POST /api/queue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTaskSpec({ displayName: 'Single' }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task).toBeDefined();
            expect(body.task.id).toBeDefined();
            expect(body.task.displayName).toBe('Single');
        });

        it('should reject invalid type via POST /api/queue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, { type: 'bad', payload: {} });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid task type');
        });

        it('should reject missing type via POST /api/queue', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, { payload: {} });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('type');
        });
    });
});
