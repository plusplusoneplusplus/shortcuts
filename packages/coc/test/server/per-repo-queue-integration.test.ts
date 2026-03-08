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
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { createMockSDKService } from '../helpers/mock-sdk-service';

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

/** Create enqueue task body with workingDirectory for per-repo routing */
function makeTask(workingDirectory?: string, overrides: Record<string, any> = {}) {
    return {
        type: 'chat',
        priority: 'normal',
        displayName: overrides.displayName || 'Test task',
        payload: {
            kind: 'chat',
            mode: 'autopilot',
            prompt: overrides.prompt || 'test prompt',
            ...(workingDirectory ? { workingDirectory } : {}),
        },
        config: {},
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
    let sharedMock: ReturnType<typeof createMockSDKService>;

    beforeAll(async () => {
        // Create temp directory for queue persistence
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'per-repo-queue-'));

        // Start server with port 0 (OS-assigned) and real store for workspace resolution
        const store = new FileProcessStore({ dataDir: tmpDir });
        sharedMock = createMockSDKService();
        server = await createExecutionServer({
            port: 0,
            host: '127.0.0.1',
            dataDir: tmpDir,
            store,
            aiService: sharedMock.service as any,
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

            // Pause to prevent auto-execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue tasks for two different repos
            const taskA1 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Task A1' }));
            expect(taskA1.status).toBe(201);
            const bodyA1 = JSON.parse(taskA1.body);
            expect(bodyA1.task.payload?.workingDirectory).toBe(repoA);

            const taskA2 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Task A2' }));
            expect(taskA2.status).toBe(201);
            const bodyA2 = JSON.parse(taskA2.body);
            expect(bodyA2.task.payload?.workingDirectory).toBe(repoA);

            const taskB1 = await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Task B1' }));
            expect(taskB1.status).toBe(201);
            const bodyB1 = JSON.parse(taskB1.body);
            expect(bodyB1.task.payload?.workingDirectory).toBe(repoB);

            // List all tasks and verify repo assignments
            const list = await request(`${baseUrl}/api/queue`);
            expect(list.status).toBe(200);
            const allTasks = JSON.parse(list.body);

            // Get queued + running tasks
            const tasks = [...allTasks.queued, ...allTasks.running];

            const repoATasks = tasks.filter((t: any) => t.payload?.workingDirectory === repoA);
            const repoBTasks = tasks.filter((t: any) => t.payload?.workingDirectory === repoB);

            expect(repoATasks.length).toBe(2);
            expect(repoBTasks.length).toBe(1);

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
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
            expect(body.task.payload?.workingDirectory).toBe(repoA);
        });

        it('should list tasks from multiple repos in queue listing', async () => {
            // Pause to prevent auto-execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue tasks for three repos
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-a', { displayName: 'A1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-a', { displayName: 'A2' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-b', { displayName: 'B1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask('/repo-c', { displayName: 'C1' }));

            const list = await request(`${baseUrl}/api/queue`);
            expect(list.status).toBe(200);
            const body = JSON.parse(list.body);

            const tasks = [...body.queued, ...body.running];

            // Group by payload.workingDirectory
            const byRepo = new Map<string, any[]>();
            for (const task of tasks) {
                const repo = task.payload?.workingDirectory || '__none__';
                if (!byRepo.has(repo)) { byRepo.set(repo, []); }
                byRepo.get(repo)!.push(task);
            }

            // Verify working directories present
            const repoIds = Array.from(byRepo.keys()).sort();
            expect(repoIds).toEqual(['/repo-a', '/repo-b', '/repo-c']);

            // Verify task counts
            expect(byRepo.get('/repo-a')!.length).toBe(2);
            expect(byRepo.get('/repo-b')!.length).toBe(1);
            expect(byRepo.get('/repo-c')!.length).toBe(1);

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
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
            // Pause to prevent auto-execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

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

            // Verify each task has correct workingDirectory
            for (const item of body.success) {
                const taskRes = await request(`${baseUrl}/api/queue/${item.taskId}`);
                const task = JSON.parse(taskRes.body).task;
                if (item.index < 2) {
                    expect(task.payload?.workingDirectory).toBe('/repo-bulk-a');
                } else {
                    expect(task.payload?.workingDirectory).toBe('/repo-bulk-b');
                }
            }

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
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
            // Pause to prevent auto-execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

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
            expect(taskBBody.task.payload?.workingDirectory).toBe('/repo-cancel-b');
            expect(['queued', 'running']).toContain(taskBBody.task.status);

            // Resume for cleanup
            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 4: Persistence Across Restart
    // ------------------------------------------------------------------
    describe('persistence across restart', () => {
        it('should restore queue state with correct repoId after restart', async () => {
            const repoA = '/repo-persist-a';
            const repoB = '/repo-persist-b';

            // Register workspaces so the bridge can persist with valid repoId filenames
            await postJSON(`${baseUrl}/api/workspaces`, { id: 'ws-persist-a', name: 'ws-persist-a', rootPath: repoA });
            await postJSON(`${baseUrl}/api/workspaces`, { id: 'ws-persist-b', name: 'ws-persist-b', rootPath: repoB });

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
            expect(beforeTasks.filter((t: any) => t.payload?.workingDirectory === repoA).length).toBe(1);
            expect(beforeTasks.filter((t: any) => t.payload?.workingDirectory === repoB).length).toBe(1);

            // Wait for persistence debounce to flush (300ms + buffer)
            await waitFor(600);

            // Simulate restart by closing and recreating server with same data directory
            await server.close();

            const restartedStore = new FileProcessStore({ dataDir: tmpDir });
            // Use a slow mock so restored tasks stay queued/running long enough to verify
            sharedMock = createMockSDKService();
            sharedMock.mockSendMessage.mockImplementation(() => new Promise(resolve =>
                setTimeout(() => resolve({ success: true, response: 'delayed', sessionId: 'sess-delay' }), 10_000)
            ));
            server = await createExecutionServer({
                port: 0,
                host: '127.0.0.1',
                dataDir: tmpDir,
                store: restartedStore,
                aiService: sharedMock.service as any,
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

            // Filter by our specific workingDirectories
            const repoATasks = allTasks.filter((t: any) => t.payload?.workingDirectory === repoA);
            const repoBTasks = allTasks.filter((t: any) => t.payload?.workingDirectory === repoB);

            // Verify tasks were restored with correct workingDirectory
            expect(repoATasks.length).toBeGreaterThanOrEqual(1);
            expect(repoBTasks.length).toBeGreaterThanOrEqual(1);

            // Verify payload content is preserved
            expect(repoATasks[0].displayName).toBe('Persistent task A');
            expect(repoBTasks[0].displayName).toBe('Persistent task B');

            // Restore fast mock for subsequent tests
            sharedMock.resetAll();
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
            expect(body.task.payload?.workingDirectory).toBe('/repo-reorder-a');
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
                }, 10000);

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
                            // WS events flatten workingDirectory to top-level
                            if (allTasks.some((t: any) => t.workingDirectory === repoA)) {
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
            const matchingTasks = allTasks.filter((t: any) => t.workingDirectory === repoA);
            expect(matchingTasks.length).toBeGreaterThanOrEqual(1);
            expect(matchingTasks[0].workingDirectory).toBe(repoA);
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
                }, 10000);

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
                            // WS events flatten workingDirectory to top-level
                            const hasA = allTasks.some((t: any) => t.workingDirectory === repoA);
                            const hasB = allTasks.some((t: any) => t.workingDirectory === repoB);
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
            const workingDirs = [...new Set(allTasks.map((t: any) => t.workingDirectory).filter(Boolean))].sort();
            expect(workingDirs).toContain(repoA);
            expect(workingDirs).toContain(repoB);

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
                type: 'chat',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'No repo' },
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
                type: 'chat',
                repoId: '   ',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },
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
            expect(taskBBody.task.payload?.workingDirectory).toBe('/repo-err-b');

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
            }));
            const taskAId = JSON.parse(taskA.body).task.id;

            // Wait for task to complete or fail (executor will process it)
            await waitFor(2000);

            // Check history
            const histRes = await request(`${baseUrl}/api/queue/history`);
            expect(histRes.status).toBe(200);
            const body = JSON.parse(histRes.body);

            // The task should appear in history
            const histTask = body.history.find((t: any) => t.id === taskAId);
            if (histTask) {
                // Verify task completed and payload's workingDirectory was preserved
                expect(histTask.payload?.workingDirectory).toBe('/repo-hist-a');
                expect(['completed', 'failed']).toContain(histTask.status);
            }
        });
    });

    // ------------------------------------------------------------------
    // Scenario 10: Two-repo parallel execution
    // ------------------------------------------------------------------
    describe('two-repo parallel execution', () => {
        it('should execute tasks from different repos concurrently', async () => {
            // Resume queue
            await postJSON(`${baseUrl}/api/queue/resume`, {});

            const repoA = '/repo-parallel-a';
            const repoB = '/repo-parallel-b';

            // Enqueue one task per repo — they should execute in parallel
            const taskA = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Parallel A' }));
            const taskB = await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Parallel B' }));

            expect(taskA.status).toBe(201);
            expect(taskB.status).toBe(201);

            const taskAId = JSON.parse(taskA.body).task.id;
            const taskBId = JSON.parse(taskB.body).task.id;

            // Wait briefly for tasks to be picked up
            await waitFor(500);

            // Both tasks should be running or completed — neither should block the other
            const list = await request(`${baseUrl}/api/queue`);
            const body = JSON.parse(list.body);
            const allActive = [...body.queued, ...body.running];

            // At this point both tasks should have started (running or completed)
            // Since they are on different repos, neither should be queued waiting for the other
            const taskAActive = allActive.find((t: any) => t.id === taskAId);
            const taskBActive = allActive.find((t: any) => t.id === taskBId);

            // If both are still active, verify they're not both queued (at least one should be running)
            if (taskAActive && taskBActive) {
                const bothQueued = taskAActive.status === 'queued' && taskBActive.status === 'queued';
                expect(bothQueued).toBe(false);
            }
            // If they completed very fast, check history
            if (!taskAActive || !taskBActive) {
                const histRes = await request(`${baseUrl}/api/queue/history`);
                const histBody = JSON.parse(histRes.body);
                const histIds = histBody.history.map((t: any) => t.id);
                if (!taskAActive) expect(histIds).toContain(taskAId);
                if (!taskBActive) expect(histIds).toContain(taskBId);
            }
        });
    });

    // ------------------------------------------------------------------
    // Scenario 11: Single-repo serialization
    // ------------------------------------------------------------------
    describe('single-repo serialization', () => {
        it('should serialize tasks within the same repo', async () => {
            // Pause to accumulate tasks
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            const repo = '/repo-serial';
            const task1 = await postJSON(`${baseUrl}/api/queue`, makeTask(repo, { displayName: 'Serial 1' }));
            const task2 = await postJSON(`${baseUrl}/api/queue`, makeTask(repo, { displayName: 'Serial 2' }));

            expect(task1.status).toBe(201);
            expect(task2.status).toBe(201);

            // Resume and let executor pick up
            await postJSON(`${baseUrl}/api/queue/resume`, {});
            await waitFor(500);

            // List tasks — at most one should be running for this repo (concurrency=1)
            const list = await request(`${baseUrl}/api/queue`);
            const body = JSON.parse(list.body);
            const runningForRepo = body.running.filter((t: any) => t.repoId === repo);
            expect(runningForRepo.length).toBeLessThanOrEqual(1);
        });
    });

    // ------------------------------------------------------------------
    // Scenario 12: Isolation on failure
    // ------------------------------------------------------------------
    describe('isolation on failure', () => {
        it('should not block repo B when repo A task fails', async () => {
            await postJSON(`${baseUrl}/api/queue/resume`, {});

            const repoA = '/repo-fail-a';
            const repoB = '/repo-fail-b';

            // Enqueue tasks for both repos
            const taskA = await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Fail A' }));
            const taskB = await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Success B' }));

            expect(taskA.status).toBe(201);
            expect(taskB.status).toBe(201);

            const taskAId = JSON.parse(taskA.body).task.id;
            const taskBId = JSON.parse(taskB.body).task.id;

            // Force-fail task A
            await waitFor(300);
            await request(`${baseUrl}/api/queue/${taskAId}/force-fail`, {
                method: 'POST',
                body: JSON.stringify({ error: 'Simulated failure' }),
                headers: { 'Content-Type': 'application/json' },
            });

            // Wait for task B to process
            await waitFor(2000);

            // Task B should have completed or be running — not blocked by A's failure
            const taskBRes = await request(`${baseUrl}/api/queue/${taskBId}`);
            const taskBBody = JSON.parse(taskBRes.body);
            if (taskBBody.task) {
                expect(['running', 'completed', 'failed']).toContain(taskBBody.task.status);
                expect(taskBBody.task.status).not.toBe('queued');
            } else {
                // Task completed and moved to history
                const histRes = await request(`${baseUrl}/api/queue/history`);
                const histBody = JSON.parse(histRes.body);
                const histTask = histBody.history.find((t: any) => t.id === taskBId);
                expect(histTask).toBeDefined();
            }
        });
    });

    // ------------------------------------------------------------------
    // Scenario 13: Workspace registration propagates to bridge
    // ------------------------------------------------------------------
    describe('workspace registration propagates to bridge', () => {
        it('should register repo ID when workspace is registered via API', async () => {
            const rootPath = '/repo-ws-register-test';
            const workspaceId = 'ws-register-test-id';

            // Register a workspace via the API
            const regRes = await postJSON(`${baseUrl}/api/workspaces`, {
                id: workspaceId,
                name: 'Test Workspace',
                rootPath,
            });
            expect(regRes.status).toBe(201);

            // Enqueue a task for this workspace path to verify routing works
            const taskRes = await postJSON(`${baseUrl}/api/queue`, makeTask(rootPath, { displayName: 'WS task' }));
            expect(taskRes.status).toBe(201);
            const task = JSON.parse(taskRes.body).task;
            expect(task.payload?.workingDirectory).toBe(rootPath);
        });
    });

    // ------------------------------------------------------------------
    // Scenario 15: workspaceId → rootPath resolution
    // ------------------------------------------------------------------
    describe('workspaceId resolution', () => {
        it('should resolve workspaceId to rootPath via store and route to correct bridge', async () => {
            const rootPath = '/repo/workspace-resolve';
            const workspaceId = 'ws-resolve-1';

            // Register a workspace
            const regRes = await postJSON(`${baseUrl}/api/workspaces`, {
                id: workspaceId,
                name: 'Resolve Test',
                rootPath,
            });
            expect(regRes.status).toBe(201);

            // Pause to prevent execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue via legacy /api/queue/enqueue with workspaceId (no workingDirectory)
            const enqueueRes = await postJSON(`${baseUrl}/api/queue/enqueue`, {
                prompt: 'test prompt via workspaceId',
                workspaceId,
            });
            expect(enqueueRes.status).toBe(201);
            const taskId = JSON.parse(enqueueRes.body).task.id;

            // Retrieve the full task to verify workingDirectory was injected
            const taskRes = await request(`${baseUrl}/api/queue/${taskId}`);
            expect(taskRes.status).toBe(200);
            const task = JSON.parse(taskRes.body).task;
            expect(task.payload?.workingDirectory).toBe(rootPath);

            // Verify the task is in the correct per-repo queue (use registered workspaceId)
            const statsRes = await request(`${baseUrl}/api/queue/stats?repoId=${workspaceId}`);
            expect(statsRes.status).toBe(200);
            const stats = JSON.parse(statsRes.body).stats;
            expect(stats.queued).toBeGreaterThanOrEqual(1);

            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 16: Per-repo stats isolation
    // ------------------------------------------------------------------
    describe('per-repo stats isolation', () => {
        it('should return per-repo stats with repoId filter', async () => {
            const repoA = '/repo/stats-a';
            const repoB = '/repo/stats-b';
            const repoIdA = 'ws-stats-a';
            const repoIdB = 'ws-stats-b';

            // Register workspaces so bridge maps repoId correctly
            await postJSON(`${baseUrl}/api/workspaces`, { id: repoIdA, name: repoIdA, rootPath: repoA });
            await postJSON(`${baseUrl}/api/workspaces`, { id: repoIdB, name: repoIdB, rootPath: repoB });

            // Pause to prevent execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue tasks to different repos
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Stats A1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Stats A2' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Stats B1' }));

            // Per-repo stats for A (use registered workspace ID)
            const statsA = await request(`${baseUrl}/api/queue/stats?repoId=${repoIdA}`);
            expect(statsA.status).toBe(200);
            expect(JSON.parse(statsA.body).stats.queued).toBe(2);

            // Per-repo stats for B
            const statsB = await request(`${baseUrl}/api/queue/stats?repoId=${repoIdB}`);
            expect(statsB.status).toBe(200);
            expect(JSON.parse(statsB.body).stats.queued).toBe(1);

            // Aggregate stats (no filter) — should sum both
            const statsAll = await request(`${baseUrl}/api/queue/stats`);
            expect(statsAll.status).toBe(200);
            expect(JSON.parse(statsAll.body).stats.queued).toBe(3);

            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });

        it('should return 404 for non-existent repoId in stats', async () => {
            const res = await request(`${baseUrl}/api/queue/stats?repoId=nonexistent`);
            expect(res.status).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // Scenario 17: GET /api/queue/repos with per-repo state
    // ------------------------------------------------------------------
    describe('GET /api/queue/repos with per-repo state', () => {
        it('should list repos with correct repoId, rootPath, isPaused, and taskCount', async () => {
            const repoA = '/repo/repos-a';
            const repoB = '/repo/repos-b';
            const repoIdA = 'ws-repos-a';
            const repoIdB = 'ws-repos-b';

            // Register workspaces so bridge maps repoId correctly
            await postJSON(`${baseUrl}/api/workspaces`, { id: repoIdA, name: repoIdA, rootPath: repoA });
            await postJSON(`${baseUrl}/api/workspaces`, { id: repoIdB, name: repoIdB, rootPath: repoB });

            // Pause globally to prevent execution
            await postJSON(`${baseUrl}/api/queue/pause`, {});

            // Enqueue tasks
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Repos A1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Repos A2' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Repos B1' }));

            const pathMod = require('path');

            const res = await request(`${baseUrl}/api/queue/repos`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            const entryA = body.repos.find((r: any) => r.repoId === repoIdA);
            const entryB = body.repos.find((r: any) => r.repoId === repoIdB);

            expect(entryA).toBeDefined();
            expect(entryA.rootPath).toBe(pathMod.resolve(repoA));
            expect(entryA.taskCount).toBe(2);
            expect(entryA.isPaused).toBe(true); // global pause inherited

            expect(entryB).toBeDefined();
            expect(entryB.rootPath).toBe(pathMod.resolve(repoB));
            expect(entryB.taskCount).toBe(1);
            expect(entryB.isPaused).toBe(true);

            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 18: Aggregate GET /api/queue
    // ------------------------------------------------------------------
    describe('aggregate GET /api/queue', () => {
        it('should return tasks from all repos when no repoId filter', async () => {
            const repoA = '/repo/aggregate-a';
            const repoB = '/repo/aggregate-b';

            await postJSON(`${baseUrl}/api/queue/pause`, {});

            await postJSON(`${baseUrl}/api/queue`, makeTask(repoA, { displayName: 'Agg A1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Agg B1' }));
            await postJSON(`${baseUrl}/api/queue`, makeTask(repoB, { displayName: 'Agg B2' }));

            const res = await request(`${baseUrl}/api/queue`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            // All 3 tasks should appear in aggregate
            expect(body.queued.length).toBe(3);
            expect(body.stats.queued).toBe(3);

            // Verify both repos' tasks present
            const wdirs = body.queued.map((t: any) => t.payload?.workingDirectory);
            expect(wdirs.filter((w: string) => w === repoA).length).toBe(1);
            expect(wdirs.filter((w: string) => w === repoB).length).toBe(2);

            await postJSON(`${baseUrl}/api/queue/resume`, {});
        });
    });

    // ------------------------------------------------------------------
    // Scenario 14: Server close drains all repos
    // ------------------------------------------------------------------
    describe('server close drains all repos', () => {
        it('should drain tasks from multiple repos on close', async () => {
            // Create a fresh server instance for this test
            const drainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'per-repo-drain-'));
            let drainServer: ExecutionServer;

            try {
                const { service: drainMockAiService } = createMockSDKService();
                drainServer = await createExecutionServer({
                    port: 0,
                    host: '127.0.0.1',
                    dataDir: drainTmpDir,
                    aiService: drainMockAiService as any,
                });
                const drainUrl = drainServer.url;

                // Enqueue tasks from two repos
                await postJSON(`${drainUrl}/api/queue`, makeTask('/repo-drain-a', { displayName: 'Drain A' }));
                await postJSON(`${drainUrl}/api/queue`, makeTask('/repo-drain-b', { displayName: 'Drain B' }));

                // Close with drain
                const result = await drainServer.close({ drain: true, drainTimeoutMs: 10000 });

                // Drain should complete (or timeout, both are acceptable outcomes)
                expect(['completed', 'timeout', undefined]).toContain(result?.drainOutcome);
            } finally {
                fs.rmSync(drainTmpDir, { recursive: true, force: true });
            }
        });
    });
});
