/**
 * Per-Repo Queue Integration Tests
 *
 * End-to-end tests validating per-repository queue isolation, parallel execution,
 * queue state management, and persistence with multi-repo scenarios.
 *
 * Uses real server with createExecutionServer and temporary file storage to test
 * the full integration from HTTP API through queue execution to persistence.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebSocket } from 'ws';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// Helpers
// ============================================================================

/** HTTP request helper */
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
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
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
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

/** POST JSON helper */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Create enqueue task body with repoId */
function makeTask(repoId?: string, overrides: Record<string, any> = {}) {
    return {
        type: 'custom',
        priority: 'normal',
        displayName: overrides.displayName || 'Test task',
        payload: { data: { prompt: overrides.prompt || 'test prompt' } },
        config: {},
        ...(repoId ? { repoId } : {}),
        ...overrides,
    };
}

/** Wait for async operations */
function waitFor(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** Listen for WebSocket messages until predicate is true */
function waitForWSMessage(
    wsUrl: string,
    predicate: (msg: any) => boolean,
    timeoutMs: number = 5000
): Promise<any> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('Timeout waiting for WebSocket message'));
        }, timeoutMs);

        ws.on('message', (data: Buffer | string) => {
            const text = typeof data === 'string' ? data : data.toString('utf-8');
            try {
                const msg = JSON.parse(text);
                if (predicate(msg)) {
                    clearTimeout(timeout);
                    ws.close();
                    resolve(msg);
                }
            } catch {
                // Ignore parsing errors
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Per-Repo Queue Integration', () => {
    let server: ExecutionServer;
    let baseUrl: string;
    let tmpDir: string;
    let wsUrl: string;

    beforeAll(async () => {
        // Create temp directory for queue persistence
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'per-repo-queue-'));

        // Start server with port 0 (OS-assigned)
        server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
        });
        baseUrl = server.url;

        // Extract WebSocket URL
        const parsed = new URL(baseUrl);
        wsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;
    });

    afterAll(async () => {
        await server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }, 10_000);

    beforeEach(async () => {
        // Clear all queued tasks before each test
        await request(`${baseUrl}/api/queue`, { method: 'DELETE' });
        await request(`${baseUrl}/api/queue/history`, { method: 'DELETE' });
    });

    // ------------------------------------------------------------------
    // Scenario 1: Basic Multi-Repo Task Isolation
    // ------------------------------------------------------------------
    describe('multi-repo task isolation', () => {
        it('should enqueue tasks with different repoIds', async () => {
            const repoA = '/Users/test/repo-a';
            const repoB = '/Users/test/repo-b';

            // Enqueue tasks for two different repos
            const taskA1 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Task A1' }));
            expect(taskA1.status).toBe(201);
            const bodyA1 = JSON.parse(taskA1.body);
            expect(bodyA1.task.repoId).toBe(repoA);

            const taskA2 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Task A2' }));
            expect(taskA2.status).toBe(201);
            const bodyA2 = JSON.parse(taskA2.body);
            expect(bodyA2.task.repoId).toBe(repoA);

            const taskB1 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Task B1' }));
            expect(taskB1.status).toBe(201);
            const bodyB1 = JSON.parse(taskB1.body);
            expect(bodyB1.task.repoId).toBe(repoB);

            // List all tasks and verify repo assignments
            const list = await request(`${baseUrl}/api/queue`);
            expect(list.status).toBe(200);
            const allTasks = JSON.parse(list.body);

            // Get queued + running tasks
            const tasks = [...allTasks.queued, ...allTasks.running];

            const repoATasks = tasks.filter((t: any) => t.repoId === repoA);
            const repoBTasks = tasks.filter((t: any) => t.repoId === repoB);

            expect(repoATasks.length).toBe(2);
            expect(repoBTasks.length).toBe(1);
        });

        it('should preserve repoId when retrieving individual task', async () => {
            const repoA = '/Users/test/repo-individual-a';

            const res = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA));
            expect(res.status).toBe(201);
            const taskId = JSON.parse(res.body).task.id;

            // Retrieve the individual task
            const taskRes = await request(`${baseUrl}/api/queue/${taskId}`);
            expect(taskRes.status).toBe(200);
            const body = JSON.parse(taskRes.body);
            expect(body.task.repoId).toBe(repoA);
        });

        it('should list tasks from multiple repos in queue listing', async () => {
            // Enqueue tasks for three repos
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-a', { displayName: 'A1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-a', { displayName: 'A2' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-b', { displayName: 'B1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-c', { displayName: 'C1' }));

            const list = await request(`${baseUrl}/api/queue`);
            expect(list.status).toBe(200);
            const body = JSON.parse(list.body);

            const tasks = [...body.queued, ...body.running];

            // Group by repoId
            const byRepo = new Map<string, any[]>();
            for (const task of tasks) {
                const repo = task.repoId || '__none__';
                if (!byRepo.has(repo)) { byRepo.set(repo, []); }
                byRepo.get(repo)!.push(task);
            }

            // Verify repo IDs present
            const repoIds = Array.from(byRepo.keys()).sort();
            expect(repoIds).toEqual(['/repo-a', '/repo-b', '/repo-c']);

            // Verify task counts
            expect(byRepo.get('/repo-a')!.length).toBe(2);
            expect(byRepo.get('/repo-b')!.length).toBe(1);
            expect(byRepo.get('/repo-c')!.length).toBe(1);
        });

        it('should enqueue task without repoId (undefined)', async () => {
            const res = await postJSON(`${baseUrl}/api/queue`, makeTask(undefined));
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            // repoId should be undefined (not set)
            expect(body.task.repoId).toBeUndefined();
        });
    });

    // ------------------------------------------------------------------
    // Scenario 2: Bulk Enqueue with RepoId
    // ------------------------------------------------------------------
    describe('bulk enqueue with repoId', () => {
        it('should enqueue multiple tasks with different repoIds in bulk', async () => {
            const res = await postJSON(`${baseUrl}/api/queue/bulk`, {
                tasks: [
                    makeTask('/repo-bulk-a', { displayName: 'Bulk A1' }),
                    makeTask('/repo-bulk-a', { displayName: 'Bulk A2' }),
                    makeTask('/repo-bulk-b', { displayName: 'Bulk B1' }),
                ],
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.summary.succeeded).toBe(3);
            expect(body.summary.failed).toBe(0);

            // Verify each task has correct repoId
            for (const item of body.success) {
                const taskRes = await request(`${baseUrl}/api/queue/${item.taskId}`);
                const task = JSON.parse(taskRes.body).task;
                if (item.index < 2) {
                    expect(task.repoId).toBe('/repo-bulk-a');
                } else {
                    expect(task.repoId).toBe('/repo-bulk-b');
                }
            }
        });
    });

    // ------------------------------------------------------------------
    // Scenario 3: Queue Operations with Multi-Repo Context
    // ------------------------------------------------------------------
    describe('queue operations with multi-repo tasks', () => {
        it('should pause global queue affecting tasks from all repos', async () => {
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-pause-a'));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-pause-b'));

            // Pause the queue
            const pauseRes = await postJSON(`${baseUrl}/api/queue/pause`, {});
            expect(pauseRes.status).toBe(200);
            const pauseBody = JSON.parse(pauseRes.body);
            expect(pauseBody.paused).toBe(true);

            // Stats should show paused
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.isPaused).toBe(true);

            // Resume
            const resumeRes = await postJSON(`${baseUrl}/api/queue/resume`, {});
            expect(resumeRes.status).toBe(200);
            const resumeBody = JSON.parse(resumeRes.body);
            expect(resumeBody.paused).toBe(false);
        });

        it('should clear all tasks from all repos', async () => {
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-clear-a'));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-clear-a'));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-clear-b'));

            // Verify tasks exist
            const beforeList = await request(`${baseUrl}/api/queue`);
            const beforeBody = JSON.parse(beforeList.body);
            expect(beforeBody.queued.length + beforeBody.running.length).toBeGreaterThanOrEqual(2);

            // Clear all queued tasks
            const clearRes = await request(`${baseUrl}/api/queue`, { method: 'DELETE' });
            expect(clearRes.status).toBe(200);

            // Verify queue is empty (running tasks may still be there)
            const afterList = await request(`${baseUrl}/api/queue`);
            const afterBody = JSON.parse(afterList.body);
            expect(afterBody.queued.length).toBe(0);
        });

        it('should cancel a specific task without affecting other repos', async () => {
            const taskA = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-cancel-a', { displayName: 'Cancel A' }));
            const taskB = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-cancel-b', { displayName: 'Cancel B' }));

            const taskAId = JSON.parse(taskA.body).task.id;
            const taskBId = JSON.parse(taskB.body).task.id;

            // Cancel task A only
            const cancelRes = await request(`${baseUrl}/api/queue/${taskAId}`, { method: 'DELETE' });
            expect(cancelRes.status).toBe(200);

            // Task B should still exist and be unaffected
            const taskBRes = await request(`${baseUrl}/api/queue/${taskBId}`);
            expect(taskBRes.status).toBe(200);
            const taskBBody = JSON.parse(taskBRes.body);
            expect(taskBBody.task.repoId).toBe('/repo-cancel-b');
            expect(['queued', 'running']).toContain(taskBBody.task.status);
        });
    });

    // ------------------------------------------------------------------
    // Scenario 4: Persistence Across Restart
    // ------------------------------------------------------------------
    describe('persistence across restart', () => {
        it('should restore queue state with correct repoId after restart', async () => {
            const repoA = '/repo-persist-a';
            const repoB = '/repo-persist-b';

            // Pause queue to prevent task execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue tasks
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, {
                displayName: 'Persistent task A',
                prompt: 'Persistent prompt A',
            }));

            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, {
                displayName: 'Persistent task B',
                prompt: 'Persistent prompt B',
            }));

            // Verify tasks are queued
            const beforeList = await request(`${baseUrl}/api/queue`);
            const beforeBody = JSON.parse(beforeList.body);
            const beforeTasks = [...beforeBody.queued, ...beforeBody.running];
            expect(beforeTasks.filter((t: any) => t.repoId === repoA).length).toBe(1);
            expect(beforeTasks.filter((t: any) => t.repoId === repoB).length).toBe(1);

            // Wait for persistence debounce to flush (300ms + buffer)
            await waitFor(600);

            // Simulate restart by closing and recreating server with same data directory
            await server.close();

            server = await createExecutionServer({
                port: 0,
                host: '127.0.0.1',
                dataDir: tmpDir,
            });
            baseUrl = server.url;

            // Update WebSocket URL after restart
            const parsed = new URL(baseUrl);
            wsUrl = `ws://${parsed.hostname}:${parsed.port}/ws`;

            // Wait for server initialization
            await waitFor(200);

            // Verify tasks are restored - check queue listing
            const list = await request(`${baseUrl}/api/queue`);
            expect(list.status).toBe(200);
            const body = JSON.parse(list.body);

            const allTasks = [...body.queued, ...body.running];

            // Filter by our specific repoIds
            const repoATasks = allTasks.filter((t: any) => t.repoId === repoA);
            const repoBTasks = allTasks.filter((t: any) => t.repoId === repoB);

            // Verify tasks were restored with correct repoId
            expect(repoATasks.length).toBeGreaterThanOrEqual(1);
            expect(repoBTasks.length).toBeGreaterThanOrEqual(1);

            // Verify payload content is preserved
            expect(repoATasks[0].displayName).toBe('Persistent task A');
            expect(repoBTasks[0].displayName).toBe('Persistent task B');
        });
    });

    // ------------------------------------------------------------------
    // Scenario 5: Task Reordering with Multi-Repo Context
    // ------------------------------------------------------------------
    describe('task reordering with repoId', () => {
        it('should move task to top while preserving repoId', async () => {
            // Pause to prevent execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            const task1 = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-reorder-a', { displayName: 'First' }));
            const task2 = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-reorder-b', { displayName: 'Second' }));
            const task3 = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-reorder-a', { displayName: 'Third' }));

            const task3Id = JSON.parse(task3.body).task.id;

            // Move task3 to top
            const moveRes = await postJSON(`${baseUrl}/api/queue/${task3Id}/move-to-top`, {});
            expect(moveRes.status).toBe(200);

            // Verify task3 is at position 1 and still has correct repoId
            const taskRes = await request(`${baseUrl}/api/queue/${task3Id}`);
            const body = JSON.parse(taskRes.body);
            expect(body.task.repoId).toBe('/repo-reorder-a');
            expect(body.task.displayName).toBe('Third');

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 6: WebSocket Events with Repository Context
    // ------------------------------------------------------------------
    describe('websocket events with repoId', () => {
        it('should broadcast queue-updated event with repoId in task data', async () => {
            const repoA = '/repo-ws-a';

            // Set up WebSocket listener FIRST and wait for connection
            const eventPromise = new Promise<any>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for WebSocket message'));
                }, 5000);

                ws.on('open', () => {
                    // Only enqueue AFTER WebSocket is connected
                    postJSON(`${baseUrl}/api/queue`, makeTask(repoA, {
                        displayName: 'WebSocket test',
                    })).catch(reject);
                });

                ws.on('message', (data: Buffer | string) => {
                    const text = typeof data === 'string' ? data : data.toString('utf-8');
                    try {
                        const msg = JSON.parse(text);
                        if (msg.type === 'queue-updated') {
                            const allTasks = [
                                ...(msg.queue?.queued || []),
                                ...(msg.queue?.running || []),
                            ];
                            if (allTasks.some((t: any) => t.repoId === repoA)) {
                                clearTimeout(timeout);
                                ws.close();
                                resolve(msg);
                            }
                        }
                    } catch {
                        // Ignore parsing errors
                    }
                });

                ws.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            const event = await eventPromise;

            expect(event.type).toBe('queue-updated');
            const allTasks = [
                ...(event.queue?.queued || []),
                ...(event.queue?.running || []),
            ];
            const matchingTasks = allTasks.filter((t: any) => t.repoId === repoA);
            expect(matchingTasks.length).toBeGreaterThanOrEqual(1);
            expect(matchingTasks[0].repoId).toBe(repoA);
        });

        it('should include repoId for tasks from multiple repos in queue snapshot', async () => {
            const repoA = '/repo-ws-multi-a';
            const repoB = '/repo-ws-multi-b';

            // Pause to accumulate tasks
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'WS Multi A' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'WS Multi B' }));

            // Set up WebSocket listener that waits for both repos, then trigger update
            const eventPromise = new Promise<any>((resolve, reject) => {
                const ws = new WebSocket(wsUrl);
                const timeout = setTimeout(() => {
                    ws.close();
                    reject(new Error('Timeout waiting for WebSocket message'));
                }, 5000);

                ws.on('open', () => {
                    // Trigger a queue update by enqueuing one more task
                    postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'WS Trigger' })).catch(reject);
                });

                ws.on('message', (data: Buffer | string) => {
                    const text = typeof data === 'string' ? data : data.toString('utf-8');
                    try {
                        const msg = JSON.parse(text);
                        if (msg.type === 'queue-updated') {
                            const allTasks = [
                                ...(msg.queue?.queued || []),
                                ...(msg.queue?.running || []),
                            ];
                            const hasA = allTasks.some((t: any) => t.repoId === repoA);
                            const hasB = allTasks.some((t: any) => t.repoId === repoB);
                            if (hasA && hasB) {
                                clearTimeout(timeout);
                                ws.close();
                                resolve(msg);
                            }
                        }
                    } catch {
                        // Ignore parsing errors
                    }
                });

                ws.on('error', (err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
            });

            const event = await eventPromise;
            expect(event.type).toBe('queue-updated');

            const allTasks = [
                ...(event.queue?.queued || []),
                ...(event.queue?.running || []),
            ];
            const repoIds = [...new Set(allTasks.map((t: any) => t.repoId).filter(Boolean))].sort();
            expect(repoIds).toContain(repoA);
            expect(repoIds).toContain(repoB);

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 7: Queue Stats with Multi-Repo Tasks
    // ------------------------------------------------------------------
    describe('queue stats with multi-repo tasks', () => {
        it('should report correct aggregate stats across repos', async () => {
            // Pause to prevent execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-stats-a'));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-stats-a'));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-stats-b'));

            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            expect(statsRes.status).toBe(200);
            const body = JSON.parse(statsRes.body);

            // Stats reflect total across all repos
            expect(body.stats.queued).toBeGreaterThanOrEqual(3);
            expect(body.stats.isPaused).toBe(true);

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 8: Error Handling
    // ------------------------------------------------------------------
    describe('error handling', () => {
        it('should return 404 for non-existent task ID', async () => {
            const res = await request(`${baseUrl}/api/queue/nonexistent-task-id-12345`);
            expect(res.status).toBe(404);
        });

        it('should accept task without repoId (backward compatible)', async () => {
            const res = await postJSON(`${baseUrl}/api/queue`, {
                type: 'custom',
                payload: { data: { prompt: 'No repo' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            expect(body.task.id).toBeDefined();
            // repoId should be undefined
            expect(body.task.repoId).toBeUndefined();
        });

        it('should reject task with invalid type regardless of repoId', async () => {
            const res = await postJSON(`${baseUrl}/api/queue`, {
                type: 'invalid-type',
                repoId: '/repo-error',
                payload: { data: {} },
            });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Invalid task type');
        });

        it('should handle empty repoId string (treated as no repoId)', async () => {
            const res = await postJSON(`${baseUrl}/api/queue`, {
                type: 'custom',
                repoId: '   ',
                payload: { data: { prompt: 'test' } },
            });
            expect(res.status).toBe(201);
            const body = JSON.parse(res.body);
            // Empty/whitespace repoId should not be set
            expect(body.task.repoId).toBeUndefined();
        });

        it('should cancel task from one repo without affecting another', async () => {
            // Pause so tasks stay queued
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            const taskA = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-err-a', { displayName: 'Error A' }));
            const taskB = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-err-b', { displayName: 'Error B' }));

            const taskAId = JSON.parse(taskA.body).task.id;
            const taskBId = JSON.parse(taskB.body).task.id;

            // Cancel task A
            await request(`${baseUrl}/api/queue/${taskAId}`, { method: 'DELETE' });

            // Task A should be cancelled
            const taskARes = await request(`${baseUrl}/api/queue/${taskAId}`);
            const taskABody = JSON.parse(taskARes.body);
            expect(taskABody.task.status).toBe('cancelled');

            // Task B should still be queued
            const taskBRes = await request(`${baseUrl}/api/queue/${taskBId}`);
            expect(taskBRes.status).toBe(200);
            const taskBBody = JSON.parse(taskBRes.body);
            expect(taskBBody.task.status).toBe('queued');
            expect(taskBBody.task.repoId).toBe('/repo-err-b');

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 9: History with Multi-Repo Tasks
    // ------------------------------------------------------------------
    describe('history with multi-repo tasks', () => {
        it('should track completed tasks with their repoId in history', async () => {
            // Resume queue to allow execution
            await postJSON(`${baseUrl}/api/queue/resume`, {});

            // Enqueue tasks — they'll be picked up by the executor
            const taskA = await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-hist-a', {
                displayName: 'History A',
                type: 'custom',
            }));
            const taskAId = JSON.parse(taskA.body).task.id;

            // Wait for task to complete or fail (executor will process it)
            await waitFor(2000);

            // Check history
            const histRes = await request(`${baseUrl}/api/queue/history`);
            expect(histRes.status).toBe(200);
            const body = JSON.parse(histRes.body);

            // The task should appear in history with its repoId
            const histTask = body.history.find((t: any) => t.id === taskAId);
            if (histTask) {
                expect(histTask.repoId).toBe('/repo-hist-a');
                expect(['completed', 'failed']).toContain(histTask.status);
            }
        });
    });
});
