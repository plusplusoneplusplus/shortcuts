import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../src/sqlite-schema';
import { SqliteQueueStore } from '../src/sqlite-queue-store';
import type { QueuedTask, PauseReason, PauseMarker } from '../src/queue/types';

let db: Database.Database;
let store: SqliteQueueStore;

function makeTask(id: string, overrides?: Partial<QueuedTask>): QueuedTask {
    return {
        id,
        repoId: 'repo-1',
        type: 'ai',
        priority: 'normal',
        status: 'queued',
        createdAt: Date.now(),
        payload: { prompt: 'hello' },
        config: { timeout: 30_000 },
        ...overrides,
    };
}

beforeEach(() => {
    db = new Database(':memory:');
    initializeDatabase(db);
    store = new SqliteQueueStore(db);
});

afterEach(() => {
    db.close();
});

// ============================================================================
// Schema
// ============================================================================

describe('Schema', () => {
    it('creates queue_tasks and queue_repo_state tables', () => {
        const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .all() as { name: string }[];
        const names = tables.map((t) => t.name);
        expect(names).toContain('queue_tasks');
        expect(names).toContain('queue_repo_state');
    });

    it('creates indexes on queue_tasks', () => {
        const indexes = db
            .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='queue_tasks'")
            .all() as { name: string }[];
        const names = indexes.map((i) => i.name);
        expect(names).toContain('idx_queue_tasks_repo_id');
        expect(names).toContain('idx_queue_tasks_status');
    });
});

// ============================================================================
// upsertQueueTask
// ============================================================================

describe('upsertQueueTask', () => {
    it('inserts and round-trips all fields', () => {
        const task = makeTask('t1', {
            repoId: 'repo-a',
            folderPath: '/src',
            priority: 'high',
            status: 'running',
            startedAt: 1000,
            completedAt: 2000,
            displayName: 'My Task',
            processId: 'proc-1',
            error: 'some error',
            retryCount: 3,
            concurrencyMode: 'exclusive',
            frozen: true,
            admitted: true,
            payload: { key: 'value', nested: { a: 1 } },
            config: { timeout: 60_000 },
            result: { output: 'done' },
        });

        // ============================================================================
        // upsertQueueItem
        // ============================================================================

        describe('upsertQueueItem', () => {
            it('persists pause markers with durationHours and queue order', () => {
                const first = makeTask('t1', { displayName: 'first' });
                const second = makeTask('t2', { displayName: 'second' });
                const marker: PauseMarker = {
                    kind: 'pause-marker',
                    id: 'pause-1',
                    createdAt: 1234,
                    durationHours: 2,
                };

                store.upsertQueueTask(first, 0);
                store.upsertQueueItem(marker, 'repo-1', 1);
                store.upsertQueueTask(second, 2);

                const items = store.getQueueItems('repo-1', ['queued']);
                expect(items.map(item => item.id)).toEqual(['t1', 'pause-1', 't2']);
                expect(items[1]).toEqual({
                    kind: 'pause-marker',
                    id: 'pause-1',
                    repoId: 'repo-1',
                    createdAt: 1234,
                    durationHours: 2,
                });
                expect(store.getQueueTasks('repo-1', ['queued']).map(task => task.id)).toEqual(['t1', 't2']);
            });

            it('round-trips indefinite pause markers without durationHours', () => {
                const marker: PauseMarker = {
                    kind: 'pause-marker',
                    id: 'pause-indefinite',
                    createdAt: 5678,
                };

                store.upsertQueueItem(marker, 'repo-1', 0);

                const [item] = store.getQueueItems('repo-1', ['queued']);
                expect(item).toEqual({
                    kind: 'pause-marker',
                    id: 'pause-indefinite',
                    repoId: 'repo-1',
                    createdAt: 5678,
                });
            });
        });

        store.upsertQueueTask(task);
        const tasks = store.getQueueTasks('repo-a');

        expect(tasks).toHaveLength(1);
        const t = tasks[0];
        expect(t.id).toBe('t1');
        expect(t.repoId).toBe('repo-a');
        expect(t.folderPath).toBe('/src');
        expect(t.type).toBe('ai');
        expect(t.priority).toBe('high');
        expect(t.status).toBe('running');
        expect(t.startedAt).toBe(1000);
        expect(t.completedAt).toBe(2000);
        expect(t.displayName).toBe('My Task');
        expect(t.processId).toBe('proc-1');
        expect(t.error).toBe('some error');
        expect(t.retryCount).toBe(3);
        expect(t.concurrencyMode).toBe('exclusive');
        expect(t.frozen).toBe(true);
        expect(t.admitted).toBe(true);
        expect(t.payload).toEqual({ key: 'value', nested: { a: 1 } });
        expect(t.config).toEqual({ timeout: 60_000 });
        expect(t.result).toEqual({ output: 'done' });
    });

    it('replaces existing row on upsert (same id)', () => {
        store.upsertQueueTask(makeTask('t1', { status: 'queued' }));
        store.upsertQueueTask(makeTask('t1', { status: 'running' }));

        const tasks = store.getQueueTasks('repo-1');
        expect(tasks).toHaveLength(1);
        expect(tasks[0].status).toBe('running');
    });
});

// ============================================================================
// removeQueueTask
// ============================================================================

describe('removeQueueTask', () => {
    it('removes an existing task', () => {
        store.upsertQueueTask(makeTask('t1'));
        store.removeQueueTask('t1');
        expect(store.getQueueTasks('repo-1')).toHaveLength(0);
    });

    it('is a no-op for a non-existent id', () => {
        expect(() => store.removeQueueTask('nope')).not.toThrow();
    });
});

// ============================================================================
// getQueueTasks filtering
// ============================================================================

describe('getQueueTasks filtering', () => {
    beforeEach(() => {
        store.upsertQueueTask(makeTask('a1', { repoId: 'r1', status: 'queued' }));
        store.upsertQueueTask(makeTask('a2', { repoId: 'r1', status: 'running' }));
        store.upsertQueueTask(makeTask('a3', { repoId: 'r1', status: 'completed' }));
        store.upsertQueueTask(makeTask('b1', { repoId: 'r2', status: 'queued' }));
        store.upsertQueueTask(makeTask('b2', { repoId: 'r2', status: 'failed' }));
    });

    it('filters by repoId only', () => {
        const tasks = store.getQueueTasks('r1');
        expect(tasks).toHaveLength(3);
        expect(tasks.every((t) => t.repoId === 'r1')).toBe(true);
    });

    it('filters by statuses only', () => {
        const tasks = store.getQueueTasks(undefined, ['queued']);
        expect(tasks).toHaveLength(2);
        expect(tasks.every((t) => t.status === 'queued')).toBe(true);
    });

    it('filters by repoId and statuses combined', () => {
        const tasks = store.getQueueTasks('r1', ['queued', 'running']);
        expect(tasks).toHaveLength(2);
    });

    it('returns all tasks when no filters', () => {
        const tasks = store.getQueueTasks();
        expect(tasks).toHaveLength(5);
    });

    it('returns all tasks when statuses is an empty array', () => {
        const tasks = store.getQueueTasks(undefined, []);
        expect(tasks).toHaveLength(5);
    });
});

// ============================================================================
// clearQueueTasks
// ============================================================================

describe('clearQueueTasks', () => {
    beforeEach(() => {
        store.upsertQueueTask(makeTask('a1', { repoId: 'r1' }));
        store.upsertQueueTask(makeTask('a2', { repoId: 'r1' }));
        store.upsertQueueTask(makeTask('b1', { repoId: 'r2' }));
    });

    it('clears tasks scoped to a repo', () => {
        store.clearQueueTasks('r1');
        expect(store.getQueueTasks('r1')).toHaveLength(0);
        expect(store.getQueueTasks('r2')).toHaveLength(1);
    });

    it('clears all tasks when no repoId', () => {
        store.clearQueueTasks();
        expect(store.getQueueTasks()).toHaveLength(0);
    });
});

// ============================================================================
// getQueueRepoState
// ============================================================================

describe('getQueueRepoState', () => {
    it('returns undefined for unknown repo', () => {
        expect(store.getQueueRepoState('unknown')).toBeUndefined();
    });

    it('returns correct struct after setQueueRepoState', () => {
        const reason: PauseReason = { taskId: 't1', displayName: 'Task 1', failedAt: '2024-01-01' };
        store.setQueueRepoState('r1', true, reason);

        const state = store.getQueueRepoState('r1');
        expect(state).toBeDefined();
        expect(state!.isPaused).toBe(true);
        expect(state!.pauseReason).toEqual(reason);
    });
});

// ============================================================================
// setQueueRepoState
// ============================================================================

describe('setQueueRepoState', () => {
    it('stores paused state with a PauseReason', () => {
        const reason: PauseReason = { taskId: 't1', displayName: 'Test', failedAt: '2024-01-01' };
        store.setQueueRepoState('r1', true, reason);

        const state = store.getQueueRepoState('r1');
        expect(state!.isPaused).toBe(true);
        expect(state!.pauseReason).toEqual(reason);
    });

    it('stores unpaused state without a PauseReason', () => {
        store.setQueueRepoState('r1', false);

        const state = store.getQueueRepoState('r1');
        expect(state!.isPaused).toBe(false);
        expect(state!.pauseReason).toBeUndefined();
    });

    it('second call wins (upsert semantics)', () => {
        store.setQueueRepoState('r1', true, { taskId: 't1', displayName: 'First', failedAt: '2024-01-01' });
        store.setQueueRepoState('r1', false);

        const state = store.getQueueRepoState('r1');
        expect(state!.isPaused).toBe(false);
        expect(state!.pauseReason).toBeUndefined();
    });
});

// ============================================================================
// removeQueueRepoState
// ============================================================================

describe('removeQueueRepoState', () => {
    it('removes a repo state entry', () => {
        store.setQueueRepoState('r1', true);
        store.removeQueueRepoState('r1');
        expect(store.getQueueRepoState('r1')).toBeUndefined();
    });

    it('is a no-op for a non-existent repo', () => {
        expect(() => store.removeQueueRepoState('nope')).not.toThrow();
    });
});

// ============================================================================
// getAllQueueRepoStates
// ============================================================================

describe('getAllQueueRepoStates', () => {
    it('returns a Map with all repo states', () => {
        store.setQueueRepoState('r1', true, { taskId: 't1', displayName: 'A', failedAt: '2024-01-01' });
        store.setQueueRepoState('r2', false);

        const states = store.getAllQueueRepoStates();
        expect(states.size).toBe(2);

        expect(states.get('r1')!.isPaused).toBe(true);
        expect(states.get('r1')!.pauseReason).toEqual({ taskId: 't1', displayName: 'A', failedAt: '2024-01-01' });
        expect(states.get('r2')!.isPaused).toBe(false);
        expect(states.get('r2')!.pauseReason).toBeUndefined();
    });

    it('returns an empty Map when no states exist', () => {
        expect(store.getAllQueueRepoStates().size).toBe(0);
    });
});

// ============================================================================
// Null/undefined handling
// ============================================================================

describe('Null/undefined handling', () => {
    it('nullable fields default correctly', () => {
        const task = makeTask('t-null', {
            folderPath: undefined,
            startedAt: undefined,
            completedAt: undefined,
            displayName: undefined,
            processId: undefined,
            result: undefined,
            error: undefined,
            retryCount: undefined,
            concurrencyMode: undefined,
            frozen: undefined,
            admitted: undefined,
        });

        store.upsertQueueTask(task);
        const [t] = store.getQueueTasks('repo-1');

        expect(t.folderPath).toBeUndefined();
        expect(t.startedAt).toBeUndefined();
        expect(t.completedAt).toBeUndefined();
        expect(t.displayName).toBeUndefined();
        expect(t.processId).toBeUndefined();
        expect(t.result).toBeUndefined();
        expect(t.error).toBeUndefined();
        expect(t.retryCount).toBeUndefined();
        expect(t.concurrencyMode).toBeUndefined();
        expect(t.frozen).toBeUndefined();
        expect(t.admitted).toBeUndefined();
    });
});
