/**
 * MultiRepoQueuePersistence Tests
 *
 * Covers: restore across multiple repos, version migration, running→failed
 * conversion, pause state, save/delete, auto-save debounce, dispose flush.
 *
 * Uses real RepoQueueRegistry and TaskQueueManager (pure in-memory).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    RepoQueueRegistry,
    TaskQueueManager,
} from '@plusplusoneplusplus/pipeline-core';
import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';

// SDK mock — needed because createQueueExecutorBridge → CLITaskExecutor → getCopilotSDKService
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { computeRepoId, getRepoQueueFilePath } from '../../src/server/queue-persistence';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

import { MultiRepoQueueExecutorBridge } from '../../src/server/multi-repo-executor-bridge';
import { MultiRepoQueuePersistence } from '../../src/server/multi-repo-queue-persistence';

/** Derive a filesystem-safe workspace ID from a test root path. */
function wsId(rootPath: string): string {
    return rootPath.replace(/^\/+/, '').replace(/\//g, '-');
}

// ============================================================================
// Helpers
// ============================================================================

let dataDir: string;
let registry: RepoQueueRegistry;
let bridge: MultiRepoQueueExecutorBridge;
let persistence: MultiRepoQueuePersistence;

function createBridge(): { registry: RepoQueueRegistry; bridge: MultiRepoQueueExecutorBridge } {
    const reg = new RepoQueueRegistry();
    const store = createMockProcessStore();
    const br = new MultiRepoQueueExecutorBridge(reg, store, { autoStart: false });
    return { registry: reg, bridge: br };
}

/** Create a v3 repo state file. */
function makeRepoState(
    rootPath: string,
    pending: unknown[] = [],
    history: unknown[] = [],
    isPaused = false,
    version = 3,
) {
    return {
        version,
        savedAt: new Date().toISOString(),
        repoRootPath: rootPath,
        repoId: wsId(rootPath),
        pending,
        history,
        isPaused,
    };
}

/** Create a minimal queued task object. */
function makeTask(id: string, status: string, workingDirectory?: string) {
    return {
        id,
        type: 'custom' as const,
        priority: 'normal' as const,
        status,
        createdAt: Date.now(),
        payload: workingDirectory ? { workingDirectory } : {},
        config: {},
    };
}

/** Write a repo state file to the queues directory. */
function writeRepoFile(rootPath: string, state: unknown): void {
    const queuesDir = path.join(dataDir, 'queues');
    if (!fs.existsSync(queuesDir)) {
        fs.mkdirSync(queuesDir, { recursive: true });
    }
    const id = wsId(rootPath);
    bridge.registerRepoId(id, rootPath);
    const filePath = getRepoQueueFilePath(dataDir, id);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/** Advance timers past the 300ms debounce window. */
async function flushDebounce(): Promise<void> {
    await vi.advanceTimersByTimeAsync(400);
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
    vi.useFakeTimers();
    sdkMocks.resetAll();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-repo-persist-test-'));
    const created = createBridge();
    registry = created.registry;
    bridge = created.bridge;
});

afterEach(() => {
    if (persistence) {
        persistence.dispose();
    }
    bridge.dispose();
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe('MultiRepoQueuePersistence', () => {

    // --------------------------------------------------------------------
    // Constructor
    // --------------------------------------------------------------------

    describe('constructor', () => {
        it('accepts bridge and dataDir', () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            expect(persistence).toBeDefined();
        });
    });

    // --------------------------------------------------------------------
    // restore()
    // --------------------------------------------------------------------

    describe('restore', () => {
        it('creates queues directory if missing', () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();
            expect(fs.existsSync(path.join(dataDir, 'queues'))).toBe(true);
        });

        it('restores per-repo queues from multiple files', () => {
            const repoA = '/repo/a';
            const repoB = '/repo/b';

            writeRepoFile(repoA, makeRepoState(repoA, [
                makeTask('t1', 'queued', repoA),
            ]));
            writeRepoFile(repoB, makeRepoState(repoB, [
                makeTask('t2', 'queued', repoB),
                makeTask('t3', 'queued', repoB),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            // Each repo should have its own queue manager via the registry
            const qmA = registry.getQueueForRepo(repoA);
            const qmB = registry.getQueueForRepo(repoB);

            // Repo A should have 1 queued task
            expect(qmA.getQueued()).toHaveLength(1);
            // Repo B should have 2 queued tasks
            expect(qmB.getQueued()).toHaveLength(2);
        });

        it('skips unknown versions with a warning', () => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            writeRepoFile('/repo/future', makeRepoState('/repo/future', [
                makeTask('t1', 'queued'),
            ], [], false, 99));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            // Should not have created any queue
            expect(registry.hasRepo('/repo/future')).toBe(false);

            // Should have logged a warning
            expect(stderrSpy).toHaveBeenCalledWith(
                expect.stringContaining('Unknown version 99')
            );

            stderrSpy.mockRestore();
        });

        it('migrates v2 state to v3 with isPaused defaulting to false', () => {
            const rootPath = '/repo/v2';
            const v2State = {
                version: 2,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId: computeRepoId(rootPath),
                pending: [makeTask('t1', 'queued', rootPath)],
                history: [],
                // no isPaused field (v2)
            };

            writeRepoFile(rootPath, v2State);

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            expect(qm.getQueued()).toHaveLength(1);
            expect(qm.isRepoPaused(computeRepoId(rootPath))).toBe(false);
        });

        it('marks running tasks as failed', () => {
            const rootPath = '/repo/running';

            writeRepoFile(rootPath, makeRepoState(rootPath, [
                makeTask('t1', 'running', rootPath),
                makeTask('t2', 'queued', rootPath),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);

            // Only the queued task should be in the queue
            expect(qm.getQueued()).toHaveLength(1);

            // The running task should appear in history as failed
            const history = qm.getHistory();
            const failedTask = history.find(t => t.id === 't1');
            expect(failedTask).toBeDefined();
            expect(failedTask!.status).toBe('failed');
            expect(failedTask!.error).toContain('Server restarted');
        });

        it('restores pause state', () => {
            const rootPath = '/repo/paused';
            const repoId = wsId(rootPath);

            writeRepoFile(rootPath, makeRepoState(rootPath, [], [], true));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            expect(qm.isRepoPaused(repoId)).toBe(true);
        });

        it('restores history entries', () => {
            const rootPath = '/repo/history';
            const historyTasks = [
                makeTask('h1', 'completed', rootPath),
                makeTask('h2', 'failed', rootPath),
            ];

            writeRepoFile(rootPath, makeRepoState(rootPath, [], historyTasks));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            const history = qm.getHistory();
            expect(history).toHaveLength(2);
        });

        it('handles corrupt files gracefully', () => {
            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });
            const filePath = path.join(queuesDir, `repo-${wsId('/repo/bad')}.json`);
            fs.writeFileSync(filePath, 'not valid json!!!', 'utf-8');

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            expect(stderrSpy).toHaveBeenCalledWith(
                expect.stringContaining('Corrupt file')
            );

            stderrSpy.mockRestore();
        });

        it('handles empty queues directory', () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            // Should not throw
            persistence.restore();
        });
    });

    // --------------------------------------------------------------------
    // save()
    // --------------------------------------------------------------------

    describe('save', () => {
        it('writes correct file path with correct JSON structure', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore(); // ensure queues dir exists

            const rootPath = '/repo/a';
            bridge.registerRepoId(wsId(rootPath), rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath);
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            await persistence.save(rootPath);

            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            expect(fs.existsSync(filePath)).toBe(true);

            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.version).toBe(3);
            expect(state.repoRootPath).toBe(rootPath);
            expect(state.repoId).toBe(wsId(rootPath));
            expect(state.pending).toHaveLength(1);
            expect(state.isPaused).toBe(false);
        });

        it('deletes file when queue is empty', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const rootPath = '/repo/empty';

            // First, write a file
            writeRepoFile(rootPath, makeRepoState(rootPath, [makeTask('t1', 'queued')]));
            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            expect(fs.existsSync(filePath)).toBe(true);

            // Create the bridge so it exists
            bridge.getOrCreateBridge(rootPath);

            // Save with empty queue (bridge was just created, no tasks)
            await persistence.save(rootPath);

            // File should be deleted
            expect(fs.existsSync(filePath)).toBe(false);
        });

        it('limits history to MAX_PERSISTED_HISTORY entries', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const rootPath = '/repo/big-history';
            bridge.registerRepoId(wsId(rootPath), rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath);

            // Add 150 history entries
            const historyTasks = Array.from({ length: 150 }, (_, i) =>
                makeTask(`h${i}`, 'completed', rootPath) as QueuedTask
            );
            qm.restoreHistory(historyTasks);

            // Need at least one pending task so the file isn't deleted
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            await persistence.save(rootPath);

            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.history.length).toBeLessThanOrEqual(100);
        });

        it('saves isPaused state correctly', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const rootPath = '/repo/paused-save';
            const repoId = wsId(rootPath);
            bridge.registerRepoId(repoId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath);

            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });
            qm.pauseRepo(repoId);

            await persistence.save(rootPath);

            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.isPaused).toBe(true);
        });
    });

    // --------------------------------------------------------------------
    // Auto-save via change events
    // --------------------------------------------------------------------

    describe('auto-save on change event', () => {
        it('saves after debounce when change event fires', async () => {
            const rootPath = '/repo/autosave';
            writeRepoFile(rootPath, makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);

            // Enqueue another task — this triggers a change event
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            // File should not be written yet (debounce)
            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            // The on-disk file still has the old data (1 pending)

            // Advance past debounce
            await flushDebounce();

            // Now the file should be updated with 2 pending tasks
            const afterState = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(afterState.pending.length).toBeGreaterThanOrEqual(2);
        });

        it('debounces multiple changes into a single save', async () => {
            const rootPath = '/repo/debounce';
            writeRepoFile(rootPath, makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            const saveSpy = vi.spyOn(persistence, 'save');
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);

            // Trigger multiple changes rapidly
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });
            vi.advanceTimersByTime(100);
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });
            vi.advanceTimersByTime(100);
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            // Advance past the final debounce
            await flushDebounce();

            // save should only be called once from the debounce (not 3 times)
            // (it may be called additionally during restore subscription setup,
            //  but the debounced call should only fire once)
            const debouncedCalls = saveSpy.mock.calls.filter(call => call[0] === rootPath);
            expect(debouncedCalls.length).toBe(1);
        });
    });

    // --------------------------------------------------------------------
    // dispose()
    // --------------------------------------------------------------------

    describe('dispose', () => {
        it('flushes pending debounced saves', async () => {
            const rootPath = '/repo/dispose-flush';
            writeRepoFile(rootPath, makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);

            // Enqueue — triggers debounce timer
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            // Don't advance timers — dispose should flush
            persistence.dispose();
            await vi.advanceTimersByTimeAsync(0);

            // Verify the file was written
            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.pending.length).toBeGreaterThanOrEqual(2);

            // Prevent double-dispose in afterEach
            persistence = undefined as any;
        });

        it('removes change listeners so no further saves are scheduled', async () => {
            const rootPath = '/repo/dispose-unsub';
            writeRepoFile(rootPath, makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const saveSpy = vi.spyOn(persistence, 'save');

            // Dispose removes listeners
            persistence.dispose();
            saveSpy.mockClear();

            // Trigger a change on the queue manager — should NOT trigger save
            const qm = registry.getQueueForRepo(rootPath);
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            await flushDebounce();

            // save should not have been called after dispose
            expect(saveSpy).not.toHaveBeenCalled();

            persistence = undefined as any;
        });
    });

    // --------------------------------------------------------------------
    // Round-trip
    // --------------------------------------------------------------------

    describe('round-trip', () => {
        it('save then restore preserves queue state across instances', async () => {
            const rootPath = '/repo/roundtrip';

            // First instance: create tasks and save
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            bridge.registerRepoId(wsId(rootPath), rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm1 = registry.getQueueForRepo(rootPath);
            qm1.enqueue({ type: 'custom', priority: 'normal', payload: { data: 'test' }, config: {} });

            await persistence.save(rootPath);
            persistence.dispose();
            bridge.dispose();
            persistence = undefined as any;

            // Second instance: restore and verify
            const created2 = createBridge();
            const bridge2 = created2.bridge;
            const registry2 = created2.registry;

            const persistence2 = new MultiRepoQueuePersistence(bridge2, dataDir);
            persistence2.restore();

            const qm2 = registry2.getQueueForRepo(rootPath);
            expect(qm2.getQueued()).toHaveLength(1);

            persistence2.dispose();
            bridge2.dispose();
        });
    });

    // --------------------------------------------------------------------
    // G1: Pause state preserved for empty queues
    // --------------------------------------------------------------------

    describe('G1: paused-but-empty repo file preservation', () => {
        it('keeps file when repo is paused but queue is otherwise empty', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const rootPath = '/g1/paused-empty';
            const repoId = wsId(rootPath);
            bridge.registerRepoId(repoId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath);

            // Pause the repo, leave queue empty
            qm.pauseRepo(repoId);

            await persistence.save(rootPath);

            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            expect(fs.existsSync(filePath)).toBe(true);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.isPaused).toBe(true);
        });

        it('deletes file when repo is neither paused nor has tasks', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const rootPath = '/g1/empty-not-paused';
            bridge.getOrCreateBridge(rootPath);

            // Write a file first
            writeRepoFile(rootPath, makeRepoState(rootPath, [makeTask('t1', 'queued', rootPath)]));

            await persistence.save(rootPath);

            // File should be deleted (empty queue + not paused)
            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            expect(fs.existsSync(filePath)).toBe(false);
        });
    });

    // --------------------------------------------------------------------
    // G2: RestartPolicy
    // --------------------------------------------------------------------

    describe('G2: RestartPolicy', () => {
        it("default (fail) marks running tasks as failed", () => {
            writeRepoFile('/g2/fail', makeRepoState('/g2/fail', [
                makeTask('t1', 'running', '/g2/fail'),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            const qm = registry.getQueueForRepo('/g2/fail');
            expect(qm.getQueued()).toHaveLength(0);
            expect(qm.getHistory().some(t => t.id === 't1' && t.status === 'failed')).toBe(true);
        });

        it("restartPolicy 'requeue' re-enqueues running tasks at high priority", () => {
            writeRepoFile('/g2/requeue', makeRepoState('/g2/requeue', [
                makeTask('t1', 'running', '/g2/requeue'),
            ]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir, { restartPolicy: 'requeue' });
            persistence.restore();

            const qm = registry.getQueueForRepo('/g2/requeue');
            const queued = qm.getQueued();
            expect(queued).toHaveLength(1);
            expect(queued[0].priority).toBe('high');
        });

        it("restartPolicy 'requeue-if-retriable' requeues when retries remain", () => {
            const task = { ...makeTask('t1', 'running', '/g2/retriable'), retryCount: 0, config: { retryAttempts: 2 } };
            writeRepoFile('/g2/retriable', makeRepoState('/g2/retriable', [task]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir, { restartPolicy: 'requeue-if-retriable' });
            persistence.restore();

            const qm = registry.getQueueForRepo('/g2/retriable');
            expect(qm.getQueued()).toHaveLength(1);
        });

        it("restartPolicy 'requeue-if-retriable' fails task when no retries remain", () => {
            const task = { ...makeTask('t1', 'running', '/g2/no-retries'), retryCount: 2, config: { retryAttempts: 2 } };
            writeRepoFile('/g2/no-retries', makeRepoState('/g2/no-retries', [task]));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir, { restartPolicy: 'requeue-if-retriable' });
            persistence.restore();

            const qm = registry.getQueueForRepo('/g2/no-retries');
            expect(qm.getQueued()).toHaveLength(0);
            expect(qm.getHistory().some(t => t.id === 't1' && t.status === 'failed')).toBe(true);
        });
    });

    // --------------------------------------------------------------------
    // G3: Migration of legacy queue.json
    // --------------------------------------------------------------------

    describe('G3: migrate legacy queue.json on restore', () => {
        function makeLegacyV1State(tasks: Array<{ id: string; status: string; workingDirectory?: string }>) {
            return {
                version: 1,
                savedAt: new Date().toISOString(),
                pending: tasks.filter(t => t.status === 'queued' || t.status === 'running').map(t => ({
                    id: t.id, type: 'custom', priority: 'normal', status: t.status,
                    createdAt: Date.now(), payload: { workingDirectory: t.workingDirectory }, config: {},
                })),
                history: tasks.filter(t => t.status === 'completed').map(t => ({
                    id: t.id, type: 'custom', priority: 'normal', status: t.status,
                    createdAt: Date.now(), completedAt: Date.now(), payload: { workingDirectory: t.workingDirectory }, config: {},
                })),
            };
        }

        it('migrates legacy queue.json to per-repo files on restore', () => {
            const v1State = makeLegacyV1State([
                { id: 't1', status: 'queued', workingDirectory: '/legacy/repo' },
            ]);
            fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify(v1State));

            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            // Legacy file should be renamed
            expect(fs.existsSync(path.join(dataDir, 'queue.json.migrated'))).toBe(true);
            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(false);

            // Per-repo file should exist and have the task
            const qm = registry.getQueueForRepo('/legacy/repo');
            expect(qm.getQueued()).toHaveLength(1);
        });

        it('skips migration if no legacy file exists', () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir);
            persistence.restore();

            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(false);
            expect(fs.existsSync(path.join(dataDir, 'queue.json.migrated'))).toBe(false);
        });
    });

    // --------------------------------------------------------------------
    // G6: Configurable history cap
    // --------------------------------------------------------------------

    describe('G6: maxPersistedHistory option', () => {
        it('truncates history to configured limit on save', async () => {
            persistence = new MultiRepoQueuePersistence(bridge, dataDir, { maxPersistedHistory: 5 });
            persistence.restore();

            const rootPath = '/g6/history-cap';
            bridge.registerRepoId(wsId(rootPath), rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath);

            // Add 10 history entries
            const histTasks = Array.from({ length: 10 }, (_, i) =>
                makeTask(`h${i}`, 'completed', rootPath) as QueuedTask
            );
            qm.restoreHistory(histTasks);

            // Need at least one pending task so file is written
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {} });

            await persistence.save(rootPath);

            const filePath = getRepoQueueFilePath(dataDir, wsId(rootPath));
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.history.length).toBeLessThanOrEqual(5);
        });
    });
});
