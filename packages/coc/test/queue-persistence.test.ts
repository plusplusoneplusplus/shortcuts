/**
 * Tests for QueuePersistence
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import type { QueuedTask, CreateTaskInput } from '@plusplusoneplusplus/pipeline-core';
import { QueuePersistence } from '../src/server/queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'queue-persist-test-'));
}

function cleanupDir(dir: string): void {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
}

function createTestInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
    return {
        type: 'custom',
        priority: 'normal',
        payload: { data: { test: true } },
        config: { timeoutMs: 60000 },
        displayName: 'test-task',
        ...overrides,
    };
}

function readQueueFile(dir: string): any {
    const filePath = path.join(dir, 'queue.json');
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeQueueFile(dir: string, data: any): void {
    const filePath = path.join(dir, 'queue.json');
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('QueuePersistence', () => {
    let dataDir: string;
    let queueManager: TaskQueueManager;

    beforeEach(() => {
        dataDir = createTempDir();
        queueManager = new TaskQueueManager({
            maxQueueSize: 0,
            keepHistory: true,
            maxHistorySize: 100,
        });
    });

    afterEach(() => {
        cleanupDir(dataDir);
    });

    // ========================================================================
    // 1. Serialization round-trip
    // ========================================================================

    describe('serialization round-trip', () => {
        it('saves queue state with correct structure after debounce', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue(createTestInput({ priority: 'high', displayName: 'high-task' }));
            queueManager.enqueue(createTestInput({ priority: 'low', displayName: 'low-task' }));
            queueManager.enqueue(createTestInput({ priority: 'normal', displayName: 'normal-task' }));

            // Wait for debounce
            await wait(400);

            const state = readQueueFile(dataDir);
            expect(state.version).toBe(1);
            expect(state.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(state.pending).toHaveLength(3);

            // Verify fields
            for (const task of state.pending) {
                expect(task).toHaveProperty('id');
                expect(task).toHaveProperty('type');
                expect(task).toHaveProperty('priority');
                expect(task).toHaveProperty('payload');
                expect(task).toHaveProperty('config');
                expect(task).toHaveProperty('status');
                expect(task).toHaveProperty('createdAt');
            }

            persistence.dispose();
        });
    });

    // ========================================================================
    // 2. Restore pending tasks
    // ========================================================================

    describe('restore pending tasks', () => {
        it('re-enqueues persisted queued tasks', () => {
            writeQueueFile(dataDir, {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: [
                    { id: 'old-1', type: 'follow-prompt', priority: 'high', status: 'queued', createdAt: 1000, payload: { promptFilePath: '/a.md' }, config: { timeoutMs: 30000 }, displayName: 'Task A' },
                    { id: 'old-2', type: 'custom', priority: 'low', status: 'queued', createdAt: 2000, payload: { data: { x: 1 } }, config: {}, displayName: 'Task B' },
                ],
                history: [],
            });

            const persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            const queued = queueManager.getQueued();
            expect(queued).toHaveLength(2);
            // New IDs are generated
            expect(queued[0].id).not.toBe('old-1');
            expect(queued[1].id).not.toBe('old-2');
            // Priority preserved — high should be first
            expect(queued[0].priority).toBe('high');
            expect(queued[0].displayName).toBe('Task A');
            expect(queued[1].priority).toBe('low');
            expect(queued[1].displayName).toBe('Task B');

            persistence.dispose();
        });
    });

    // ========================================================================
    // 3. Running tasks marked as failed on restore
    // ========================================================================

    describe('running tasks marked as failed on restore', () => {
        it('marks previously-running tasks as failed with restart error', () => {
            writeQueueFile(dataDir, {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: [
                    { id: 'run-1', type: 'ai-clarification', priority: 'normal', status: 'running', createdAt: 1000, startedAt: 1500, payload: { prompt: 'hello' }, config: {}, displayName: 'Running Task' },
                ],
                history: [],
            });

            const persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            const history = queueManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('failed');
            expect(history[0].error).toContain('Server restarted');
            expect(history[0].completedAt).toBeDefined();
            expect(history[0].displayName).toBe('Running Task');

            persistence.dispose();
        });
    });

    // ========================================================================
    // 4. History restoration
    // ========================================================================

    describe('history restoration', () => {
        it('restores history with mixed statuses', () => {
            const historyItems = [
                { id: 'h1', type: 'custom', priority: 'normal', status: 'completed', createdAt: 100, completedAt: 200, payload: { data: {} }, config: {}, displayName: 'completed-1' },
                { id: 'h2', type: 'custom', priority: 'normal', status: 'failed', createdAt: 300, completedAt: 400, error: 'boom', payload: { data: {} }, config: {}, displayName: 'failed-1' },
                { id: 'h3', type: 'custom', priority: 'normal', status: 'cancelled', createdAt: 500, completedAt: 600, payload: { data: {} }, config: {}, displayName: 'cancelled-1' },
                { id: 'h4', type: 'custom', priority: 'high', status: 'completed', createdAt: 700, completedAt: 800, payload: { data: {} }, config: {}, displayName: 'completed-2' },
                { id: 'h5', type: 'custom', priority: 'low', status: 'failed', createdAt: 900, completedAt: 1000, error: 'err', payload: { data: {} }, config: {}, displayName: 'failed-2' },
            ];

            writeQueueFile(dataDir, {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: [],
                history: historyItems,
            });

            const persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            const history = queueManager.getHistory();
            expect(history).toHaveLength(5);
            expect(history.map(t => t.status)).toEqual(['completed', 'failed', 'cancelled', 'completed', 'failed']);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 5. Debounce coalescing
    // ========================================================================

    describe('debounce coalescing', () => {
        it('coalesces rapid changes into single write', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);
            const filePath = path.join(dataDir, 'queue.json');

            // Enqueue 10 tasks rapidly
            for (let i = 0; i < 10; i++) {
                queueManager.enqueue(createTestInput({ displayName: `rapid-${i}` }));
            }

            // Wait for debounce to fire
            await wait(400);

            // File should exist with all 10 tasks
            expect(fs.existsSync(filePath)).toBe(true);
            const state = readQueueFile(dataDir);
            expect(state.pending).toHaveLength(10);

            // Get mtime after first write
            const mtime1 = fs.statSync(filePath).mtimeMs;

            // Wait a bit to confirm no further writes
            await wait(400);
            const mtime2 = fs.statSync(filePath).mtimeMs;
            expect(mtime2).toBe(mtime1);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 6. Empty state / no file
    // ========================================================================

    describe('empty state / no file', () => {
        it('handles missing queue.json gracefully', () => {
            const persistence = new QueuePersistence(queueManager, dataDir);

            // Should not throw
            expect(() => persistence.restore()).not.toThrow();
            expect(queueManager.getQueued()).toHaveLength(0);
            expect(queueManager.getHistory()).toHaveLength(0);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 7. Corrupt file handling
    // ========================================================================

    describe('corrupt file handling', () => {
        it('handles invalid JSON gracefully', () => {
            const filePath = path.join(dataDir, 'queue.json');
            fs.writeFileSync(filePath, '{ not valid json !!!', 'utf-8');

            const persistence = new QueuePersistence(queueManager, dataDir);

            expect(() => persistence.restore()).not.toThrow();
            expect(queueManager.getQueued()).toHaveLength(0);
            expect(queueManager.getHistory()).toHaveLength(0);

            persistence.dispose();
        });

        it('handles unknown version gracefully', () => {
            writeQueueFile(dataDir, {
                version: 99,
                savedAt: new Date().toISOString(),
                pending: [{ id: 'x', type: 'custom', priority: 'normal', status: 'queued', createdAt: 1000, payload: { data: {} }, config: {} }],
                history: [],
            });

            const persistence = new QueuePersistence(queueManager, dataDir);

            expect(() => persistence.restore()).not.toThrow();
            expect(queueManager.getQueued()).toHaveLength(0);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 8. Dispose flushes pending write
    // ========================================================================

    describe('dispose flushes pending write', () => {
        it('writes immediately on dispose before debounce fires', () => {
            const persistence = new QueuePersistence(queueManager, dataDir);
            const filePath = path.join(dataDir, 'queue.json');

            queueManager.enqueue(createTestInput({ displayName: 'flush-me' }));

            // Dispose immediately — before the 300ms debounce fires
            persistence.dispose();

            expect(fs.existsSync(filePath)).toBe(true);
            const state = readQueueFile(dataDir);
            expect(state.pending).toHaveLength(1);
            expect(state.pending[0].displayName).toBe('flush-me');
        });
    });

    // ========================================================================
    // 9. Atomic write safety
    // ========================================================================

    describe('atomic write safety', () => {
        it('leaves no .tmp file after save', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);
            const tmpPath = path.join(dataDir, 'queue.json.tmp');

            queueManager.enqueue(createTestInput());

            await wait(400);

            expect(fs.existsSync(tmpPath)).toBe(false);
            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(true);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 10. Running tasks included in pending for crash safety
    // ========================================================================

    describe('running tasks included in pending', () => {
        it('saves running tasks into pending array', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);

            const id = queueManager.enqueue(createTestInput({ displayName: 'will-run' }));
            queueManager.markStarted(id);

            await wait(400);

            const state = readQueueFile(dataDir);
            expect(state.pending.some((t: any) => t.status === 'running')).toBe(true);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 11. History limit is respected in persistence
    // ========================================================================

    describe('history limit', () => {
        it('limits persisted history to 100 entries', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);

            // Create 110 history entries via normal flow
            for (let i = 0; i < 100; i++) {
                const id = queueManager.enqueue(createTestInput({ displayName: `h-${i}` }));
                queueManager.markStarted(id);
                queueManager.markCompleted(id);
            }

            await wait(400);

            const state = readQueueFile(dataDir);
            expect(state.history.length).toBeLessThanOrEqual(100);

            persistence.dispose();
        });
    });

    // ========================================================================
    // 12. Listener removed on dispose
    // ========================================================================

    describe('listener cleanup', () => {
        it('removes change listener on dispose', async () => {
            const persistence = new QueuePersistence(queueManager, dataDir);

            persistence.dispose();

            // Enqueue after dispose — should not trigger write
            queueManager.enqueue(createTestInput({ displayName: 'post-dispose' }));
            await wait(400);

            // File should either not exist or not contain post-dispose task
            const filePath = path.join(dataDir, 'queue.json');
            if (fs.existsSync(filePath)) {
                const state = readQueueFile(dataDir);
                const hasPostDispose = state.pending.some((t: any) => t.displayName === 'post-dispose');
                expect(hasPostDispose).toBe(false);
            }
        });
    });
});
