/**
 * SqliteQueuePersistence Tests
 *
 * Covers: incremental change handling (no debounce), restore with restart
 * policies, pause state persistence, repo path tracking, dispose/cleanup,
 * and integration with createQueueInfrastructure.
 *
 * Uses real RepoQueueRegistry and TaskQueueManager (pure in-memory)
 * with an in-memory better-sqlite3 database.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
    RepoQueueRegistry,
    TaskQueueManager,
    SqliteQueueStore,
    SqliteProcessStore,
    initializeDatabase,
} from '@plusplusoneplusplus/forge';
import type { QueuedTask, QueueChangeEvent } from '@plusplusoneplusplus/forge';

// SDK mock — needed because MultiRepoQueueRouter → CLITaskExecutor → getCopilotSDKService
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { MultiRepoQueueRouter } from '../../src/server/queue/multi-repo-queue-router';
import { SqliteQueuePersistence } from '../../src/server/queue/sqlite-queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

let db: Database.Database;
let store: SqliteQueueStore;
let registry: RepoQueueRegistry;
let bridge: MultiRepoQueueRouter;
let persistence: SqliteQueuePersistence;

function createBridgeAndDb() {
    db = new Database(':memory:');
    initializeDatabase(db);
    store = new SqliteQueueStore(db);

    registry = new RepoQueueRegistry({
        maxQueueSize: 0,
        keepHistory: true,
        maxHistorySize: 100,
    });
    const mockStore = createMockProcessStore();
    bridge = new MultiRepoQueueRouter(registry, mockStore, { autoStart: false });
    return { db, store, registry, bridge };
}

/** Create a minimal queued task. */
function makeTask(id: string, opts: Partial<QueuedTask> = {}): QueuedTask {
    return {
        id,
        type: 'custom',
        priority: 'normal',
        status: 'queued',
        createdAt: Date.now(),
        payload: {},
        config: {},
        ...opts,
    };
}

/** Derive a filesystem-safe repo ID (mirrors test convention). */
function repoId(rootPath: string): string {
    return rootPath.replace(/^\/+/, '').replace(/\//g, '-');
}

beforeEach(() => {
    createBridgeAndDb();
});

afterEach(() => {
    persistence?.dispose();
    db?.close();
});

// ============================================================================
// Constructor & Subscription
// ============================================================================

describe('SqliteQueuePersistence', () => {
    describe('constructor', () => {
        it('creates the queue_repo_paths table', () => {
            persistence = new SqliteQueuePersistence(bridge, db);
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='queue_repo_paths'"
            ).all();
            expect(tables).toHaveLength(1);
        });

        it('subscribes to bridge queueChange events', () => {
            persistence = new SqliteQueuePersistence(bridge, db);
            const rootPath = '/repo/alpha';
            const id = repoId(rootPath);
            bridge.registerRepoId(id, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            // Enqueue a task — should trigger persistence via bridge event
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: id });
            const tasks = store.getQueueTasks(id);
            expect(tasks).toHaveLength(1);
        });
    });

    // ========================================================================
    // handleChange — incremental writes (no debounce)
    // ========================================================================

    describe('handleChange', () => {
        let rootPath: string;
        let rId: string;
        let qm: TaskQueueManager;

        beforeEach(() => {
            rootPath = '/repo/change-test';
            rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            qm = registry.getQueueForRepo(rootPath)!;
        });

        it('persists added tasks immediately (no debounce)', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId,
            });
            const rows = store.getQueueTasks(rId);
            expect(rows).toHaveLength(1);
            expect(rows[0].id).toBe(taskId);
        });

        it('two rapid adds produce two immediate writes', () => {
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            qm.enqueue({ type: 'custom', priority: 'low', payload: {}, config: {}, repoId: rId });
            const rows = store.getQueueTasks(rId);
            expect(rows).toHaveLength(2);
        });

        it('handles removed event', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId,
            });
            expect(store.getQueueTasks(rId)).toHaveLength(1);
            qm.removeTask(taskId);
            expect(store.getQueueTasks(rId)).toHaveLength(0);
        });

        it('handles updated event', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {},
                displayName: 'original', repoId: rId,
            });
            qm.updateTask(taskId, { displayName: 'updated' });
            const rows = store.getQueueTasks(rId);
            expect(rows[0].displayName).toBe('updated');
        });

        it('handles cleared event', () => {
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            expect(store.getQueueTasks(rId)).toHaveLength(2);
            qm.clear();
            expect(store.getQueueTasks(rId)).toHaveLength(0);
        });

        it('handles frozen event', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId,
            });
            qm.freezeTask(taskId);
            const rows = store.getQueueTasks(rId);
            expect(rows[0].frozen).toBe(true);
        });

        it('handles unfrozen event', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId,
            });
            qm.freezeTask(taskId);
            qm.unfreezeTask(taskId);
            const rows = store.getQueueTasks(rId);
            expect(rows[0].frozen).toBeFalsy();
        });

        it('handles admitted event', () => {
            const taskId = qm.enqueue({
                type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId,
            });
            qm.admitTask(taskId);
            const rows = store.getQueueTasks(rId);
            expect(rows[0].admitted).toBe(true);
        });

        it('handles repo-paused event', () => {
            qm.pauseRepo(rId, { taskId: 't1', displayName: 'fail', failedAt: '2024-01-01' });
            const state = store.getQueueRepoState(rId);
            expect(state).toBeDefined();
            expect(state!.isPaused).toBe(true);
            expect(state!.pauseReason).toEqual({ taskId: 't1', displayName: 'fail', failedAt: '2024-01-01' });
        });

        it('handles repo-resumed event', () => {
            qm.pauseRepo(rId);
            qm.resumeRepo(rId);
            const state = store.getQueueRepoState(rId);
            expect(state).toBeDefined();
            expect(state!.isPaused).toBe(false);
        });

        it('persists queue and autopilot timed pause state', () => {
            const queueUntil = Date.now() + 60_000;
            const autopilotUntil = Date.now() + 120_000;

            qm.pause(queueUntil);
            qm.pauseAutopilot(autopilotUntil);

            const state = store.getQueueRepoState(rId);
            expect(state).toBeDefined();
            expect(state!.queuePaused).toBe(true);
            expect(state!.queuePausedUntil).toBe(queueUntil);
            expect(state!.autopilotPaused).toBe(true);
            expect(state!.autopilotPausedUntil).toBe(autopilotUntil);
        });

        it('handles reordered event — upserts all queued tasks', () => {
            const id1 = qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            const id2 = qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            qm.moveToTop(id2);
            const rows = store.getQueueTasks(rId);
            expect(rows).toHaveLength(2);
            // Both tasks should still be present after reorder
            const ids = rows.map(r => r.id).sort();
            expect(ids).toEqual([id1, id2].sort());
        });

        it('tracks repo path mapping in queue_repo_paths table', () => {
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            const row = db.prepare('SELECT * FROM queue_repo_paths WHERE repo_id = ?').get(rId) as any;
            expect(row).toBeDefined();
            // root_path should be the resolved version of rootPath
            expect(row.root_path).toBeTruthy();
        });
    });

    // ========================================================================
    // restore()
    // ========================================================================

    describe('restore', () => {
        it('restores queued tasks from SQLite', () => {
            const rootPath = '/repo/restore-queued';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            // Create persistence first (creates queue_repo_paths table), then seed
            persistence = new SqliteQueuePersistence(bridge, db);

            store.upsertQueueTask(makeTask('t1', { repoId: rId, status: 'queued' }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            expect(qm).toBeDefined();
            expect(qm!.getQueued()).toHaveLength(1);
        });

        it('restores multiple repos', () => {
            persistence = new SqliteQueuePersistence(bridge, db);

            const roots = ['/repo/a', '/repo/b'];
            for (const root of roots) {
                const rid = repoId(root);
                bridge.registerRepoId(rid, root);
                store.upsertQueueTask(makeTask(`task-${rid}`, { repoId: rid, status: 'queued' }));
                db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rid, root);
            }

            persistence.restore();

            for (const root of roots) {
                const qm = registry.getQueueForRepo(root);
                expect(qm).toBeDefined();
                expect(qm!.getQueued()).toHaveLength(1);
            }
        });

        it('restores paused repo state', () => {
            const rootPath = '/repo/paused';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db);

            store.setQueueRepoState(rId, true, { taskId: 'x', displayName: 'failed', failedAt: '2024-01-01' });
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            expect(qm).toBeDefined();
            expect(qm!.isRepoPaused(rId)).toBe(true);
            expect(qm!.getPauseReason(rId)).toEqual({ taskId: 'x', displayName: 'failed', failedAt: '2024-01-01' });
        });

        it('restores queue and autopilot timed pause state', () => {
            const rootPath = '/repo/timed-pause';
            const rId = repoId(rootPath);
            const queueUntil = Date.now() + 60_000;
            const autopilotUntil = Date.now() + 120_000;
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db);
            store.setQueueControlState(rId, {
                queuePaused: true,
                queuePausedUntil: queueUntil,
                autopilotPaused: true,
                autopilotPausedUntil: autopilotUntil,
            });
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath);
            expect(qm.getStats().isPaused).toBe(true);
            expect(qm.getStats().pausedUntil).toBe(queueUntil);
            expect(qm.getStats().isAutopilotPaused).toBe(true);
            expect(qm.getStats().autopilotPausedUntil).toBe(autopilotUntil);
        });

        it('with running tasks + fail policy — removes from DB', () => {
            const rootPath = '/repo/fail-policy';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db, { restartPolicy: 'fail' });

            store.upsertQueueTask(makeTask('run1', { repoId: rId, status: 'running', startedAt: Date.now() }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath)!;
            expect(qm.getQueued()).toHaveLength(0);
            // History is no longer restored into in-memory — served from process store
            expect(qm.getHistory()).toHaveLength(0);

            // Task should be removed from SQLite
            expect(store.getQueueTasks(rId, ['running'])).toHaveLength(0);
        });

        it('with running tasks + requeue policy — re-enqueues at high priority', () => {
            const rootPath = '/repo/requeue-policy';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db, { restartPolicy: 'requeue' });

            store.upsertQueueTask(makeTask('run1', { repoId: rId, status: 'running', startedAt: Date.now() }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath)!;
            expect(qm.getQueued()).toHaveLength(1);
            expect(qm.getQueued()[0].priority).toBe('high');

            // Task should be updated in SQLite to queued
            const dbTasks = store.getQueueTasks(rId, ['queued']);
            expect(dbTasks).toHaveLength(1);
            expect(dbTasks[0].priority).toBe('high');
        });

        it('with running tasks + requeue-if-retriable — requeues when retries remain', () => {
            const rootPath = '/repo/retriable';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db, { restartPolicy: 'requeue-if-retriable' });

            store.upsertQueueTask(makeTask('run1', {
                repoId: rId, status: 'running', startedAt: Date.now(),
                retryCount: 0, config: { retryAttempts: 3 },
            }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath)!;
            expect(qm.getQueued()).toHaveLength(1);
            expect(qm.getQueued()[0].priority).toBe('high');
        });

        it('with running tasks + requeue-if-retriable — removes when no retries remain', () => {
            const rootPath = '/repo/no-retries';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db, { restartPolicy: 'requeue-if-retriable' });

            store.upsertQueueTask(makeTask('run1', {
                repoId: rId, status: 'running', startedAt: Date.now(),
                retryCount: 3, config: { retryAttempts: 3 },
            }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath)!;
            expect(qm.getQueued()).toHaveLength(0);
            // Task is removed from DB, not restored to in-memory history
            expect(qm.getHistory()).toHaveLength(0);
            expect(store.getQueueTasks(rId, ['running'])).toHaveLength(0);
        });

        it('default restart policy is requeue-if-retriable', () => {
            const rootPath = '/repo/default-policy';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db); // no explicit policy

            // retriable task (retryCount < retryAttempts)
            store.upsertQueueTask(makeTask('run1', {
                repoId: rId, status: 'running', startedAt: Date.now(),
                retryCount: 0, config: { retryAttempts: 1 },
            }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            const qm = registry.getQueueForRepo(rootPath)!;
            expect(qm.getQueued()).toHaveLength(1); // should be requeued
        });

        it('skips repos without a stored root path', () => {
            const rId = 'orphan-repo-id';
            persistence = new SqliteQueuePersistence(bridge, db);

            store.upsertQueueTask(makeTask('t1', { repoId: rId, status: 'queued' }));
            // No entry in queue_repo_paths

            persistence.restore();

            // Task should not be restored (no rootPath mapping)
            expect(store.getQueueTasks(rId, ['queued'])).toHaveLength(1); // still in DB
        });

        it('logs a warning for tasks without a root path mapping', () => {
            const rId = 'unmapped-repo-id';
            persistence = new SqliteQueuePersistence(bridge, db);

            store.upsertQueueTask(makeTask('t1', { repoId: rId, status: 'queued' }));
            store.upsertQueueTask(makeTask('t2', { repoId: rId, status: 'queued' }));
            // No entry in queue_repo_paths

            const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

            persistence.restore();

            const warningCalls = stderrSpy.mock.calls.filter(
                ([msg]) => typeof msg === 'string' && msg.includes('Warning') && msg.includes(rId)
            );
            expect(warningCalls).toHaveLength(1);
            expect(warningCalls[0][0]).toContain('2 task(s)');
            stderrSpy.mockRestore();
        });

        it('cleans up terminal tasks from SQLite on restore', () => {
            const rootPath = '/repo/with-history';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);

            persistence = new SqliteQueuePersistence(bridge, db);

            // Seed completed tasks — should be cleaned up from SQLite
            store.upsertQueueTask(makeTask('done1', { repoId: rId, status: 'completed', completedAt: Date.now() }));
            store.upsertQueueTask(makeTask('fail1', { repoId: rId, status: 'failed', error: 'oops' }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            // Terminal tasks are cleaned up from SQLite, not restored to in-memory history
            expect(store.getQueueTasks(rId, ['completed', 'failed'])).toHaveLength(0);
        });

        it('registers repo IDs with the bridge during restore', () => {
            // Create fresh bridge without pre-registered IDs
            const freshStore = createMockProcessStore();
            const freshRegistry = new RepoQueueRegistry({ maxQueueSize: 0, keepHistory: true, maxHistorySize: 100 });
            const freshBridge = new MultiRepoQueueRouter(freshRegistry, freshStore, { autoStart: false });

            persistence = new SqliteQueuePersistence(freshBridge, db);

            const rootPath = '/repo/register-test';
            const rId = repoId(rootPath);
            store.upsertQueueTask(makeTask('t1', { repoId: rId, status: 'queued' }));
            db.prepare('INSERT OR REPLACE INTO queue_repo_paths (repo_id, root_path) VALUES (?, ?)').run(rId, rootPath);

            persistence.restore();

            // The bridge should now know about the repoId mapping
            expect(freshBridge.getRepoIdForPath(rootPath)).toBe(rId);
            persistence.dispose();
            registry = freshRegistry;
            bridge = freshBridge;
        });
    });

    // ========================================================================
    // dispose()
    // ========================================================================

    describe('dispose', () => {
        it('unsubscribes all change listeners', () => {
            const rootPath = '/repo/dispose-test';
            const rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            // First enqueue persists
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            expect(store.getQueueTasks(rId)).toHaveLength(1);

            // Dispose
            persistence.dispose();

            // Clear DB to verify no further writes
            store.clearQueueTasks(rId);

            // Further enqueue should NOT persist (listener removed)
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            expect(store.getQueueTasks(rId)).toHaveLength(0);
        });

        it('removes bridge-level listener', () => {
            persistence = new SqliteQueuePersistence(bridge, db);
            persistence.dispose();

            // After dispose, a new repo should not trigger persistence
            const rootPath = '/repo/post-dispose';
            const rId = repoId(rootPath);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;
            qm.enqueue({ type: 'custom', priority: 'normal', payload: {}, config: {}, repoId: rId });
            expect(store.getQueueTasks(rId)).toHaveLength(0);
        });
    });

    // ========================================================================
    // Round-trip: enqueue → persist → new persistence → restore
    // ========================================================================

    describe('round-trip', () => {
        it('save then restore preserves queue state', () => {
            const rootPath = '/repo/roundtrip';
            const rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            // Enqueue tasks
            const id1 = qm.enqueue({ type: 'custom', priority: 'normal', payload: { msg: 'hello' }, config: {}, repoId: rId, displayName: 'Task 1' });
            const id2 = qm.enqueue({ type: 'custom', priority: 'high', payload: { msg: 'world' }, config: {}, repoId: rId, displayName: 'Task 2' });

            // Pause repo
            qm.pauseRepo(rId);

            persistence.dispose();

            // Create new persistence + bridge to simulate restart
            const freshMockStore = createMockProcessStore();
            const freshRegistry = new RepoQueueRegistry({ maxQueueSize: 0, keepHistory: true, maxHistorySize: 100 });
            const freshBridge = new MultiRepoQueueRouter(freshRegistry, freshMockStore, { autoStart: false });

            const freshPersistence = new SqliteQueuePersistence(freshBridge, db);
            freshPersistence.restore();

            const freshQm = freshRegistry.getQueueForRepo(rootPath);
            expect(freshQm).toBeDefined();
            expect(freshQm!.getQueued()).toHaveLength(2);
            expect(freshQm!.isRepoPaused(rId)).toBe(true);

            const names = freshQm!.getQueued().map(t => t.displayName).sort();
            expect(names).toEqual(['Task 1', 'Task 2']);

            freshPersistence.dispose();
            // Reassign for afterEach cleanup
            registry = freshRegistry;
            bridge = freshBridge;
        });

        it('tasks without explicit repoId survive enqueue → persist → restore', () => {
            const rootPath = '/repo/no-explicit-repoid';
            const rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            // Enqueue WITHOUT repoId — mimics the bug scenario
            qm.enqueue({ type: 'custom', priority: 'normal', payload: { msg: 'no-repo-id' }, config: {}, displayName: 'Orphan Task' });

            // Verify the task was persisted with enriched repoId (safety net in handleChange)
            const rows = store.getQueueTasks(rId);
            expect(rows).toHaveLength(1);
            expect(rows[0].repoId).toBe(rId);
            expect(rows[0].displayName).toBe('Orphan Task');

            persistence.dispose();

            // Simulate restart
            const freshMockStore = createMockProcessStore();
            const freshRegistry = new RepoQueueRegistry({ maxQueueSize: 0, keepHistory: true, maxHistorySize: 100 });
            const freshBridge = new MultiRepoQueueRouter(freshRegistry, freshMockStore, { autoStart: false });

            const freshPersistence = new SqliteQueuePersistence(freshBridge, db);
            freshPersistence.restore();

            const freshQm = freshRegistry.getQueueForRepo(rootPath);
            expect(freshQm).toBeDefined();
            expect(freshQm!.getQueued()).toHaveLength(1);
            expect(freshQm!.getQueued()[0].displayName).toBe('Orphan Task');

            freshPersistence.dispose();
            registry = freshRegistry;
            bridge = freshBridge;
        });
    });

    // ========================================================================
    // Paused-but-empty repos
    // ========================================================================

    describe('paused-but-empty repos', () => {
        it('preserves pause state even when queue is empty', () => {
            const rootPath = '/repo/paused-empty';
            const rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            // Pause the repo (no tasks)
            qm.pauseRepo(rId);
            persistence.dispose();

            // Simulate restart
            const freshMockStore = createMockProcessStore();
            const freshRegistry = new RepoQueueRegistry({ maxQueueSize: 0, keepHistory: true, maxHistorySize: 100 });
            const freshBridge = new MultiRepoQueueRouter(freshRegistry, freshMockStore, { autoStart: false });

            const freshPersistence = new SqliteQueuePersistence(freshBridge, db);
            freshPersistence.restore();

            const freshQm = freshRegistry.getQueueForRepo(rootPath);
            expect(freshQm).toBeDefined();
            expect(freshQm!.isRepoPaused(rId)).toBe(true);

            freshPersistence.dispose();
            registry = freshRegistry;
            bridge = freshBridge;
        });
    });

    // ========================================================================
    // Images stay inline
    // ========================================================================

    describe('image handling', () => {
        it('preserves image data inline in payload JSON', () => {
            const rootPath = '/repo/images';
            const rId = repoId(rootPath);
            persistence = new SqliteQueuePersistence(bridge, db);
            bridge.registerRepoId(rId, rootPath);
            bridge.getOrCreateBridge(rootPath);
            const qm = registry.getQueueForRepo(rootPath)!;

            const base64Image = 'data:image/png;base64,iVBORw0KGgoAAAANS';
            qm.enqueue({
                type: 'custom', priority: 'normal',
                payload: { images: [base64Image], prompt: 'describe' },
                config: {}, repoId: rId,
            });

            const rows = store.getQueueTasks(rId);
            expect(rows).toHaveLength(1);
            expect((rows[0].payload as any).images).toEqual([base64Image]);
        });
    });
});

// ============================================================================
// Integration: createQueueInfrastructure selects SqliteQueuePersistence
// ============================================================================

describe('createQueueInfrastructure integration', () => {
    it('uses SqliteQueuePersistence when store is SqliteProcessStore', async () => {
        const { createQueueInfrastructure } = await import('../../src/server/infrastructure/queue-infrastructure');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qi-sqlite-test-'));
        const dbPath = path.join(tmpDir, 'test.db');
        const sqliteStore = new SqliteProcessStore({ dbPath });

        try {
            const infra = createQueueInfrastructure(
                sqliteStore,
                tmpDir,
                { queue: { autoStart: false } },
                30000,
                undefined,
                undefined,
                () => ({ broadcast: () => {} }) as any,
            );

            expect(infra.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
            infra.queuePersistence.dispose();
        } finally {
            sqliteStore.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('creates in-memory DB when store is not SqliteProcessStore', async () => {
        const { createQueueInfrastructure } = await import('../../src/server/infrastructure/queue-infrastructure');
        const { SqliteQueuePersistence } = await import('../../src/server/queue/sqlite-queue-persistence');
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qi-file-test-'));
        const mockStore = createMockProcessStore();

        try {
            const infra = createQueueInfrastructure(
                mockStore,
                tmpDir,
                { queue: { autoStart: false } },
                30000,
                undefined,
                undefined,
                () => ({ broadcast: () => {} }) as any,
            );

            expect(infra.queuePersistence).toBeInstanceOf(SqliteQueuePersistence);
            infra.queuePersistence.dispose();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
