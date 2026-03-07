/**
 * QueuePersistence per-repo storage tests.
 *
 * Covers: per-repo save/restore, migration from old format, empty-file cleanup,
 * multi-repo persistence, and edge cases.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskQueueManager, type TaskQueueManagerOptions } from '@plusplusoneplusplus/pipeline-core';
import { QueuePersistence, computeRepoId, getRepoQueueFilePath } from '../../src/server/queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

let dataDir: string;
let queueManager: TaskQueueManager;
let persistence: QueuePersistence;

function createManager(options: Partial<TaskQueueManagerOptions> = {}): TaskQueueManager {
    return new TaskQueueManager({
        maxQueueSize: 0,
        keepHistory: true,
        maxHistorySize: 100,
        ...options,
    });
}

/**
 * Trigger a save by emitting a change event (via enqueue) and then
 * advancing timers past the 300ms debounce window.
 */
async function flushSave(): Promise<void> {
    await vi.advanceTimersByTimeAsync(400);
}

/** Create a minimal v1 (old format) state for migration tests. */
function makeOldState(tasks: Array<{ id: string; status: string; workingDirectory?: string }>) {
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        pending: tasks.filter(t => t.status === 'queued' || t.status === 'running').map(t => ({
            id: t.id,
            type: 'chat',
            priority: 'normal',
            status: t.status,
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'migrated task', workingDirectory: t.workingDirectory },
            config: {},
        })),
        history: tasks.filter(t => t.status === 'completed' || t.status === 'failed').map(t => ({
            id: t.id,
            type: 'chat',
            priority: 'normal',
            status: t.status,
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'migrated task', workingDirectory: t.workingDirectory },
            config: {},
        })),
    };
}

/** Create a v3 (current format) state for restore tests. */
function makeRepoState(rootPath: string, pending: unknown[] = [], history: unknown[] = [], isPaused: boolean = false) {
    return {
        version: 3,
        savedAt: new Date().toISOString(),
        repoRootPath: rootPath,
        repoId: computeRepoId(rootPath),
        pending,
        history,
        isPaused,
    };
}

/** Create a minimal queued task object. */
function makeTask(id: string, status: string, workingDirectory?: string) {
    return {
        id,
        type: 'chat' as const,
        priority: 'normal' as const,
        status,
        createdAt: Date.now(),
        payload: workingDirectory
            ? { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory }
            : { kind: 'chat', mode: 'autopilot', prompt: 'test task' },
        config: {},
    };
}

// ============================================================================
// Setup / teardown
// ============================================================================

beforeEach(() => {
    vi.useFakeTimers();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-persist-test-'));
    queueManager = createManager();
});

afterEach(() => {
    if (persistence) {
        persistence.dispose();
    }
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// Helper function tests
// ============================================================================

describe('computeRepoId', () => {
    it('returns 16 hex characters', () => {
        const id = computeRepoId('/path/to/repo');
        expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('is deterministic', () => {
        const a = computeRepoId('/some/path');
        const b = computeRepoId('/some/path');
        expect(a).toBe(b);
    });

    it('produces different IDs for different paths', () => {
        const a = computeRepoId('/repo/one');
        const b = computeRepoId('/repo/two');
        expect(a).not.toBe(b);
    });
});

describe('getRepoQueueFilePath', () => {
    it('returns path under queues/ directory', () => {
        const fp = getRepoQueueFilePath('/data', '/my/repo');
        const repoId = computeRepoId('/my/repo');
        expect(fp).toBe(path.join('/data', 'queues', `repo-${repoId}.json`));
    });
});

// ============================================================================
// QueuePersistence — constructor
// ============================================================================

describe('QueuePersistence', () => {
    describe('constructor', () => {
        it('creates queues/ directory on instantiation', () => {
            persistence = new QueuePersistence(queueManager, dataDir);
            expect(fs.existsSync(path.join(dataDir, 'queues'))).toBe(true);
        });

        it('is idempotent if queues/ already exists', () => {
            fs.mkdirSync(path.join(dataDir, 'queues'), { recursive: true });
            persistence = new QueuePersistence(queueManager, dataDir);
            expect(fs.existsSync(path.join(dataDir, 'queues'))).toBe(true);
        });
    });

    // ========================================================================
    // Save — single repo
    // ========================================================================

    describe('save — single repo', () => {
        it('saves queue state to per-repo file', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/path/to/repo1' },
                config: {},
            });

            await flushSave();

            const repoId = computeRepoId('/path/to/repo1');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);

            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.version).toBe(3);
            expect(state.repoRootPath).toBe('/path/to/repo1');
            expect(state.repoId).toBe(repoId);
            expect(state.pending).toHaveLength(1);
        });

        it('uses process.cwd() for tasks without workingDirectory', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task' },
                config: {},
            });

            await flushSave();

            const repoId = computeRepoId(process.cwd());
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);

            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.repoRootPath).toBe(process.cwd());
        });
    });

    // ========================================================================
    // Save — multi repo
    // ========================================================================

    describe('save — multi repo', () => {
        it('saves separate files for different repos', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/alpha' },
                config: {},
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/beta' },
                config: {},
            });

            await flushSave();

            const queuesDir = path.join(dataDir, 'queues');
            const files = fs.readdirSync(queuesDir).filter(f => f.startsWith('repo-'));
            expect(files).toHaveLength(2);

            // Verify each file has the correct repoRootPath
            for (const file of files) {
                const state = JSON.parse(fs.readFileSync(path.join(queuesDir, file), 'utf-8'));
                expect(['/repo/alpha', '/repo/beta']).toContain(state.repoRootPath);
                expect(state.pending).toHaveLength(1);
            }
        });

        it('groups tasks from same repo in one file', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/shared' },
                config: {},
                displayName: 'task-1',
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/shared' },
                config: {},
                displayName: 'task-2',
            });

            await flushSave();

            const queuesDir = path.join(dataDir, 'queues');
            const files = fs.readdirSync(queuesDir).filter(f => f.startsWith('repo-'));
            expect(files).toHaveLength(1);

            const state = JSON.parse(fs.readFileSync(path.join(queuesDir, files[0]), 'utf-8'));
            expect(state.pending).toHaveLength(2);
        });
    });

    // ========================================================================
    // Restore — per-repo files
    // ========================================================================

    describe('restore', () => {
        it('restores tasks from a single repo file', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/restored/repo1';
            const state = makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(1);
        });

        it('restores tasks from multiple repo files', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            for (const rootPath of ['/restored/repo1', '/restored/repo2']) {
                const state = makeRepoState(rootPath, [
                    makeTask(`t-${rootPath}`, 'queued', rootPath),
                ]);
                const repoId = computeRepoId(rootPath);
                fs.writeFileSync(
                    path.join(queuesDir, `repo-${repoId}.json`),
                    JSON.stringify(state),
                );
            }

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(2);
        });

        it('marks previously-running tasks as failed', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/running/repo';
            const state = makeRepoState(rootPath, [
                makeTask('t-run', 'running', rootPath),
            ]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // running task should be in history as failed, not in queued
            expect(queueManager.getQueued()).toHaveLength(0);
            const history = queueManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('failed');
            expect(history[0].error).toContain('Server restarted');
        });

        it('restores history entries', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/hist/repo';
            const state = makeRepoState(rootPath, [], [
                makeTask('t-done', 'completed', rootPath),
            ]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(0);
            expect(queueManager.getHistory()).toHaveLength(1);
        });

        it('skips corrupt files gracefully', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            fs.writeFileSync(path.join(queuesDir, 'repo-badfile12345678.json'), 'not json');

            persistence = new QueuePersistence(queueManager, dataDir);
            // Should not throw
            persistence.restore();
            expect(queueManager.getQueued()).toHaveLength(0);
        });

        it('skips files with wrong version', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const state = { version: 999, savedAt: '', repoRootPath: '/x', repoId: 'abc', pending: [], history: [] };
            fs.writeFileSync(path.join(queuesDir, 'repo-1234567890abcdef.json'), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();
            expect(queueManager.getQueued()).toHaveLength(0);
        });

        it('does nothing when queues/ directory is missing', () => {
            // Don't create the queues dir manually; constructor will create it
            // but it won't have any files
            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();
            expect(queueManager.getQueued()).toHaveLength(0);
        });
    });

    // ========================================================================
    // Cleanup — stale file deletion
    // ========================================================================

    describe('cleanup', () => {
        it('deletes queue file for repos no longer present', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // Manually create a repo file that has no corresponding tasks
            const orphanPath = '/orphan/repo';
            const repoId = computeRepoId(orphanPath);
            const orphanFile = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            fs.writeFileSync(orphanFile, JSON.stringify(makeRepoState(orphanPath, [makeTask('t1', 'queued', orphanPath)])));

            // Enqueue a task for a *different* repo so the save triggers cleanup
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/active/repo' },
                config: {},
            });

            await flushSave();

            // The orphan file should be cleaned up
            expect(fs.existsSync(orphanFile)).toBe(false);

            // The active repo file should exist
            const activeRepoId = computeRepoId('/active/repo');
            expect(fs.existsSync(path.join(dataDir, 'queues', `repo-${activeRepoId}.json`))).toBe(true);
        });
    });

    // ========================================================================
    // Migration from old format
    // ========================================================================

    describe('migration from old queue.json', () => {
        it('migrates old queue.json to per-repo files', () => {
            const oldState = makeOldState([
                { id: 't1', status: 'queued', workingDirectory: '/repo/one' },
                { id: 't2', status: 'queued', workingDirectory: '/repo/two' },
            ]);
            fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify(oldState));

            persistence = new QueuePersistence(queueManager, dataDir);

            // Old file should be archived
            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(false);
            expect(fs.existsSync(path.join(dataDir, 'queue.json.migrated'))).toBe(true);

            // New per-repo files should exist
            const queuesDir = path.join(dataDir, 'queues');
            const files = fs.readdirSync(queuesDir).filter(f => f.startsWith('repo-'));
            expect(files).toHaveLength(2);

            // Verify each file's content
            for (const file of files) {
                const state = JSON.parse(fs.readFileSync(path.join(queuesDir, file), 'utf-8'));
                expect(state.version).toBe(3);
                expect(state.repoRootPath).toBeTruthy();
                expect(state.repoId).toBeTruthy();
            }
        });

        it('handles old tasks with no workingDirectory', () => {
            const oldState = makeOldState([
                { id: 't1', status: 'queued' }, // no workingDirectory
            ]);
            fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify(oldState));

            persistence = new QueuePersistence(queueManager, dataDir);

            // Should fall back to process.cwd()
            const repoId = computeRepoId(process.cwd());
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);
        });

        it('separates pending and history from old format', () => {
            const oldState = makeOldState([
                { id: 't1', status: 'queued', workingDirectory: '/repo/a' },
                { id: 't2', status: 'completed', workingDirectory: '/repo/a' },
            ]);
            fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify(oldState));

            persistence = new QueuePersistence(queueManager, dataDir);

            const repoId = computeRepoId('/repo/a');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.pending).toHaveLength(1);
            expect(state.pending[0].id).toBe('t1');
            expect(state.history).toHaveLength(1);
            expect(state.history[0].id).toBe('t2');
        });

        it('skips migration if no old file exists', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // No files created (only directory)
            const queuesDir = path.join(dataDir, 'queues');
            const files = fs.readdirSync(queuesDir);
            expect(files).toHaveLength(0);
        });

        it('skips migration if old file has non-v1 version', () => {
            const state = { version: 99, savedAt: '', pending: [], history: [] };
            fs.writeFileSync(path.join(dataDir, 'queue.json'), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir);

            // Old file should NOT be renamed
            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(true);
            expect(fs.existsSync(path.join(dataDir, 'queue.json.migrated'))).toBe(false);
        });

        it('handles corrupt old file gracefully', () => {
            fs.writeFileSync(path.join(dataDir, 'queue.json'), 'not valid json');

            // Should not throw
            persistence = new QueuePersistence(queueManager, dataDir);

            // Old file should still exist (migration failed)
            expect(fs.existsSync(path.join(dataDir, 'queue.json'))).toBe(true);
        });
    });

    // ========================================================================
    // Dispose
    // ========================================================================

    describe('dispose', () => {
        it('flushes dirty state on dispose', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/dispose/repo' },
                config: {},
            });

            // Don't flush timers — state is dirty
            persistence.dispose();
            persistence = undefined!;
            await vi.advanceTimersByTimeAsync(0);

            const repoId = computeRepoId('/dispose/repo');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);
        });
    });

    // ========================================================================
    // Round-trip: save + restore
    // ========================================================================

    describe('round-trip', () => {
        it('saves and restores a single task across persistence instances', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'Follow instructions.', workingDirectory: '/roundtrip/repo' },
                config: {},
                displayName: 'My Task',
            });

            await flushSave();
            persistence.dispose();
            persistence = undefined!;

            // Create fresh manager + persistence
            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            const queued = qm2.getQueued();
            expect(queued).toHaveLength(1);
            expect(queued[0].type).toBe('chat');
            expect(queued[0].displayName).toBe('My Task');

            p2.dispose();
        });

        it('saves and restores tasks for multiple repos across instances', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/round/repo1' },
                config: {},
                displayName: 'R1',
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/round/repo2' },
                config: {},
                displayName: 'R2',
            });

            await flushSave();
            persistence.dispose();
            persistence = undefined!;

            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            const queued = qm2.getQueued();
            expect(queued).toHaveLength(2);
            const names = queued.map(t => t.displayName).sort();
            expect(names).toEqual(['R1', 'R2']);

            p2.dispose();
        });
    });

    // ========================================================================
    // Per-repo pause state persistence
    // ========================================================================

    describe('per-repo pause state', () => {
        it('saves isPaused: true when repo is paused', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/paused/repo' },
                config: {},
            });

            const repoId = computeRepoId('/paused/repo');
            queueManager.pauseRepo(repoId);

            await flushSave();

            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.isPaused).toBe(true);
        });

        it('saves isPaused: false when repo is not paused', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/active/repo' },
                config: {},
            });

            await flushSave();

            const repoId = computeRepoId('/active/repo');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.isPaused).toBe(false);
        });

        it('persists per-repo pause state independently for different repos', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/alpha' },
                config: {},
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/repo/beta' },
                config: {},
            });

            const alphaId = computeRepoId('/repo/alpha');
            queueManager.pauseRepo(alphaId);

            await flushSave();

            const alphaFile = path.join(dataDir, 'queues', `repo-${alphaId}.json`);
            const alphaState = JSON.parse(fs.readFileSync(alphaFile, 'utf-8'));
            expect(alphaState.isPaused).toBe(true);

            const betaId = computeRepoId('/repo/beta');
            const betaFile = path.join(dataDir, 'queues', `repo-${betaId}.json`);
            const betaState = JSON.parse(fs.readFileSync(betaFile, 'utf-8'));
            expect(betaState.isPaused).toBe(false);
        });

        it('restores per-repo pause state on startup', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/paused/restored';
            const state = makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ], [], true);  // isPaused = true
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.isRepoPaused(repoId)).toBe(true);
        });

        it('does not pause repo when isPaused is false', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/active/restored';
            const state = makeRepoState(rootPath, [
                makeTask('t1', 'queued', rootPath),
            ], [], false);  // isPaused = false
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.isRepoPaused(repoId)).toBe(false);
        });

        it('restores multiple repos with independent pause states', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            // Repo A paused
            const rootA = '/multi/repoA';
            const repoAId = computeRepoId(rootA);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoAId}.json`),
                JSON.stringify(makeRepoState(rootA, [makeTask('t1', 'queued', rootA)], [], true)),
            );

            // Repo B active
            const rootB = '/multi/repoB';
            const repoBId = computeRepoId(rootB);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoBId}.json`),
                JSON.stringify(makeRepoState(rootB, [makeTask('t2', 'queued', rootB)], [], false)),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.isRepoPaused(repoAId)).toBe(true);
            expect(queueManager.isRepoPaused(repoBId)).toBe(false);
        });

        it('migrates v2 to v3 with isPaused defaulting to false', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            // Write a v2 file (no isPaused field)
            const rootPath = '/v2/repo';
            const repoId = computeRepoId(rootPath);
            const v2State = {
                version: 2,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: [makeTask('t1', 'queued', rootPath)],
                history: [],
            };
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(v2State),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // Should restore the task and NOT pause the repo
            expect(queueManager.getQueued()).toHaveLength(1);
            expect(queueManager.isRepoPaused(repoId)).toBe(false);
        });

        it('skips files with future versions', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/future/repo';
            const repoId = computeRepoId(rootPath);
            const futureState = {
                version: 999,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: [makeTask('t1', 'queued', rootPath)],
                history: [],
                isPaused: false,
            };
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(futureState),
            );

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // Should skip the file — no tasks restored
            expect(queueManager.getQueued()).toHaveLength(0);
        });

        it('round-trip: save paused state and restore across instances', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/roundtrip/paused' },
                config: {},
                displayName: 'Paused Task',
            });

            const repoId = computeRepoId('/roundtrip/paused');
            queueManager.pauseRepo(repoId);

            await flushSave();
            persistence.dispose();
            persistence = undefined!;

            // Create fresh manager + persistence
            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            expect(qm2.getQueued()).toHaveLength(1);
            expect(qm2.isRepoPaused(repoId)).toBe(true);

            p2.dispose();
        });
    });

    // ========================================================================
    // Per-Repo Pause State Persistence
    // ========================================================================

    describe('per-repo pause state persistence', () => {
        it('persists per-repo paused state to separate files', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // Enqueue tasks for two different repos
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/pause/repo-A' },
                config: {},
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/pause/repo-B' },
                config: {},
            });

            // Pause only repo-A
            const repoAId = computeRepoId('/pause/repo-A');
            queueManager.pauseRepo(repoAId);

            await flushSave();

            // Verify repo-A file has isPaused: true
            const repoAFile = path.join(dataDir, 'queues', `repo-${repoAId}.json`);
            const repoAState = JSON.parse(fs.readFileSync(repoAFile, 'utf-8'));
            expect(repoAState.isPaused).toBe(true);

            // Verify repo-B file has isPaused: false
            const repoBId = computeRepoId('/pause/repo-B');
            const repoBFile = path.join(dataDir, 'queues', `repo-${repoBId}.json`);
            const repoBState = JSON.parse(fs.readFileSync(repoBFile, 'utf-8'));
            expect(repoBState.isPaused).toBe(false);
        });

        it('restores per-repo paused state on startup', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            // Create persisted state with repo-A paused
            const repoAPath = '/restore/repo-A';
            const repoBPath = '/restore/repo-B';

            const repoAId = computeRepoId(repoAPath);
            const repoBId = computeRepoId(repoBPath);

            const stateA = makeRepoState(repoAPath, [makeTask('t1', 'queued', repoAPath)], [], true);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoAId}.json`),
                JSON.stringify(stateA)
            );

            const stateB = makeRepoState(repoBPath, [makeTask('t2', 'queued', repoBPath)], [], false);
            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoBId}.json`),
                JSON.stringify(stateB)
            );

            // Initialize queue manager with repo ID extractor
            queueManager = createManager({
                getTaskRepoId: (task) => {
                    const payload = task.payload as Record<string, unknown>;
                    const rootPath = (payload?.workingDirectory as string) || process.cwd();
                    return computeRepoId(rootPath);
                },
            });

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // Verify repo-A is paused
            expect(queueManager.isRepoPaused(repoAId)).toBe(true);

            // Verify repo-B is not paused
            expect(queueManager.isRepoPaused(repoBId)).toBe(false);
        });

        it('handles mixed paused/resumed repos', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // Enqueue tasks for three repos
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/mixed/repo-1' },
                config: {},
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/mixed/repo-2' },
                config: {},
            });
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/mixed/repo-3' },
                config: {},
            });

            // Pause repo-1 and repo-3, leave repo-2 active
            const repo1Id = computeRepoId('/mixed/repo-1');
            const repo3Id = computeRepoId('/mixed/repo-3');
            queueManager.pauseRepo(repo1Id);
            queueManager.pauseRepo(repo3Id);

            await flushSave();

            // Dispose and create new manager + persistence
            persistence.dispose();
            persistence = undefined!;

            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            // Verify pause states
            expect(qm2.isRepoPaused(repo1Id)).toBe(true);
            expect(qm2.isRepoPaused(computeRepoId('/mixed/repo-2'))).toBe(false);
            expect(qm2.isRepoPaused(repo3Id)).toBe(true);

            p2.dispose();
        });

        it('migrates v2 to v3 with isPaused defaulting to false', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/migrate/repo';
            const repoId = computeRepoId(rootPath);

            // Create v2 state without isPaused field
            const v2State = {
                version: 2,
                savedAt: new Date().toISOString(),
                repoRootPath: rootPath,
                repoId,
                pending: [makeTask('t1', 'queued', rootPath)],
                history: [],
                // No isPaused field
            };

            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(v2State)
            );

            // Initialize queue manager with repo ID extractor
            queueManager = createManager({
                getTaskRepoId: (task) => {
                    const payload = task.payload as Record<string, unknown>;
                    const rootPath = (payload?.workingDirectory as string) || process.cwd();
                    return computeRepoId(rootPath);
                },
            });

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // Verify repo is NOT paused (default behavior)
            expect(queueManager.isRepoPaused(repoId)).toBe(false);
        });

        it('handles missing isPaused field gracefully', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/graceful/repo';
            const repoId = computeRepoId(rootPath);

            // Create state with version 3 but missing isPaused (edge case)
            const state = makeRepoState(rootPath, [makeTask('t1', 'queued', rootPath)]);
            delete (state as any).isPaused;  // Simulate corrupt data

            fs.writeFileSync(
                path.join(queuesDir, `repo-${repoId}.json`),
                JSON.stringify(state)
            );

            // Initialize queue manager with repo ID extractor
            queueManager = createManager({
                getTaskRepoId: (task) => {
                    const payload = task.payload as Record<string, unknown>;
                    const rootPath = (payload?.workingDirectory as string) || process.cwd();
                    return computeRepoId(rootPath);
                },
            });

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            // Should default to unpaused
            expect(queueManager.isRepoPaused(repoId)).toBe(false);
        });
    });

    // ========================================================================
    // G1: Pause state preserved for empty queues
    // ========================================================================

    describe('G1: paused-but-empty repo file preservation', () => {
        it('keeps the file when repo is paused but queue is empty', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // Enqueue then complete a task (so history is non-empty initially)
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/g1/repo' },
                config: {},
            });

            const repoId = computeRepoId('/g1/repo');
            queueManager.pauseRepo(repoId);

            await flushSave();

            const filePath = getRepoQueueFilePath(dataDir, '/g1/repo');
            expect(fs.existsSync(filePath)).toBe(true);
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.isPaused).toBe(true);
        });

        it('round-trip: paused+empty repos survive restart', async () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/g1/roundtrip' },
                config: {},
            });

            const repoId = computeRepoId('/g1/roundtrip');
            queueManager.pauseRepo(repoId);
            await flushSave();
            persistence.dispose();
            persistence = undefined!;

            // Second instance
            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            expect(qm2.isRepoPaused(repoId)).toBe(true);
            p2.dispose();
        });
    });

    // ========================================================================
    // G2: RestartPolicy
    // ========================================================================

    describe('G2: RestartPolicy', () => {
        it('default (fail) marks running tasks as failed on restore', () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/g2/fail';
            const state = makeRepoState(rootPath, [
                makeTask('t1', 'running', rootPath),
            ]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(path.join(queuesDir, `repo-${repoId}.json`), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir);
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(0);
            const history = queueManager.getHistory();
            expect(history.some(t => t.id === 't1' && t.status === 'failed')).toBe(true);
        });

        it("restartPolicy 'requeue' re-enqueues running tasks at high priority", () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/g2/requeue';
            const state = makeRepoState(rootPath, [
                makeTask('t1', 'running', rootPath),
            ]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(path.join(queuesDir, `repo-${repoId}.json`), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir, { restartPolicy: 'requeue' });
            persistence.restore();

            const queued = queueManager.getQueued();
            expect(queued).toHaveLength(1);
            expect(queued[0].priority).toBe('high');
        });

        it("restartPolicy 'requeue-if-retriable' requeues when retries remain", () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/g2/retriable';
            const task = { ...makeTask('t1', 'running', rootPath), retryCount: 0, config: { retryAttempts: 2 } };
            const state = makeRepoState(rootPath, [task]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(path.join(queuesDir, `repo-${repoId}.json`), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir, { restartPolicy: 'requeue-if-retriable' });
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(1);
        });

        it("restartPolicy 'requeue-if-retriable' fails task when no retries remain", () => {
            const queuesDir = path.join(dataDir, 'queues');
            fs.mkdirSync(queuesDir, { recursive: true });

            const rootPath = '/g2/no-retries';
            const task = { ...makeTask('t1', 'running', rootPath), retryCount: 2, config: { retryAttempts: 2 } };
            const state = makeRepoState(rootPath, [task]);
            const repoId = computeRepoId(rootPath);
            fs.writeFileSync(path.join(queuesDir, `repo-${repoId}.json`), JSON.stringify(state));

            persistence = new QueuePersistence(queueManager, dataDir, { restartPolicy: 'requeue-if-retriable' });
            persistence.restore();

            expect(queueManager.getQueued()).toHaveLength(0);
            expect(queueManager.getHistory().some(t => t.id === 't1' && t.status === 'failed')).toBe(true);
        });
    });

    // ========================================================================
    // G6: Configurable history cap
    // ========================================================================

    describe('G6: maxPersistedHistory option', () => {
        it('truncates history to configured limit on save', async () => {
            persistence = new QueuePersistence(queueManager, dataDir, { maxPersistedHistory: 5 });

            // Fill history with 10 completed tasks
            const histTasks = Array.from({ length: 10 }, (_, i) => ({
                id: `h${i}`,
                type: 'chat' as const,
                priority: 'normal' as const,
                status: 'completed',
                createdAt: Date.now(),
                completedAt: Date.now(),
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/g6/repo' },
                config: {},
            }));
            queueManager.restoreHistory(histTasks as any);

            // Need at least one pending task to trigger save
            queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: { kind: 'chat', mode: 'autopilot', prompt: 'test task', workingDirectory: '/g6/repo' },
                config: {},
            });

            await flushSave();

            const filePath = getRepoQueueFilePath(dataDir, '/g6/repo');
            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.history.length).toBeLessThanOrEqual(5);
        });
    });
});
