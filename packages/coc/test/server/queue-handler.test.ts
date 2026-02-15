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
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '../../src/server/types';
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

describe('Queue Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-handler-test-'));
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
            expect(body.task.type).toBe('custom');
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

        it('should enqueue ai-clarification type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'Explain this code' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('ai-clarification');
        });

        it('should enqueue follow-prompt type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/path/to/prompt.md' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('follow-prompt');
        });

        it('should enqueue code-review type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'code-review',
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('code-review');
        });

        it('should enqueue resolve-comments type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'resolve-comments',
                payload: { documentUri: 'file:///test.md', commentIds: ['c1'], promptTemplate: '' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.type).toBe('resolve-comments');
        });
    });

    // ========================================================================
    // Auto-generated display name
    // ========================================================================

    describe('Auto-generated display name', () => {
        it('should auto-generate name from ai-clarification prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                payload: { prompt: 'Explain how authentication works' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Explain how authentication works');
        });

        it('should truncate long prompts in auto-generated name', async () => {
            const srv = await startServer();

            const longPrompt = 'A'.repeat(100);
            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                payload: { prompt: longPrompt },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName.length).toBeLessThanOrEqual(60);
            expect(body.task.displayName).toContain('...');
        });

        it('should auto-generate name from follow-prompt file path', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'follow-prompt',
                payload: { promptFilePath: '/home/user/prompts/review-code.md' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Follow Prompt: review-code.md');
        });

        it('should auto-generate name from code-review diff type', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'code-review',
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Code Review: staged');
        });

        it('should auto-generate name from code-review with commit SHA', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'code-review',
                payload: { diffType: 'commit', commitSha: 'abc1234567890', rulesFolder: '.github/cr-rules' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Code Review: commit (abc1234)');
        });

        it('should auto-generate name from custom task data.prompt', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                payload: { data: { prompt: 'Analyze performance metrics' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('Analyze performance metrics');
        });

        it('should fallback to type label with timestamp when no content', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                payload: { data: {} },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toMatch(/^Task @ \d{2}:\d{2}$/);
        });

        it('should use explicit displayName when provided', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'custom',
                displayName: 'My custom name',
                payload: { data: { prompt: 'This should be ignored for name' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('My custom name');
        });

        it('should ignore empty string displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                displayName: '',
                payload: { prompt: 'What does this function do?' },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.displayName).toBe('What does this function do?');
        });

        it('should ignore whitespace-only displayName and auto-generate', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, {
                type: 'ai-clarification',
                displayName: '   ',
                payload: { prompt: 'Summarize this module' },
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
    });

    // ========================================================================
    // Task config
    // ========================================================================

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
                type: 'ai-clarification',
                payload: { prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.config.model).toBe('claude-sonnet-4-5');
        });

        it('should preserve workingDirectory in ai-clarification payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'test', workingDirectory: '/my/project' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/my/project');
        });

        it('should preserve workingDirectory in follow-prompt payload', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'follow-prompt',
                payload: { promptFilePath: '/path/to/prompt.md', workingDirectory: '/workspace/root' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBe('/workspace/root');
        });

        it('should preserve both model and workingDirectory together', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/queue`, makeTask({
                type: 'ai-clarification',
                payload: { prompt: 'analyze code', workingDirectory: '/my/repo' },
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
                type: 'ai-clarification',
                payload: { prompt: 'test' },
            }));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.payload.workingDirectory).toBeUndefined();
        });
    });

    // ========================================================================
    // Multiple operations lifecycle
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
});
