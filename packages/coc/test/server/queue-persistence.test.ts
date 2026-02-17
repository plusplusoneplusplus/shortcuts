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
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { QueuePersistence, computeRepoId, getRepoQueueFilePath } from '../../src/server/queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

let dataDir: string;
let queueManager: TaskQueueManager;
let persistence: QueuePersistence;

function createManager(): TaskQueueManager {
    return new TaskQueueManager({
        maxQueueSize: 0,
        keepHistory: true,
        maxHistorySize: 100,
    });
}

/**
 * Trigger a save by emitting a change event (via enqueue) and then
 * advancing timers past the 300ms debounce window.
 */
function flushSave(): void {
    vi.advanceTimersByTime(400);
}

/** Create a minimal v1 (old format) state for migration tests. */
function makeOldState(tasks: Array<{ id: string; status: string; workingDirectory?: string }>) {
    return {
        version: 1,
        savedAt: new Date().toISOString(),
        pending: tasks.filter(t => t.status === 'queued' || t.status === 'running').map(t => ({
            id: t.id,
            type: 'custom',
            priority: 'normal',
            status: t.status,
            createdAt: Date.now(),
            payload: { workingDirectory: t.workingDirectory },
            config: {},
        })),
        history: tasks.filter(t => t.status === 'completed' || t.status === 'failed').map(t => ({
            id: t.id,
            type: 'custom',
            priority: 'normal',
            status: t.status,
            createdAt: Date.now(),
            payload: { workingDirectory: t.workingDirectory },
            config: {},
        })),
    };
}

/** Create a v2 (new format) state for restore tests. */
function makeRepoState(rootPath: string, pending: unknown[] = [], history: unknown[] = []) {
    return {
        version: 2,
        savedAt: new Date().toISOString(),
        repoRootPath: rootPath,
        repoId: computeRepoId(rootPath),
        pending,
        history,
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
        it('saves queue state to per-repo file', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/path/to/repo1' },
                config: {},
            });

            flushSave();

            const repoId = computeRepoId('/path/to/repo1');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);

            const state = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            expect(state.version).toBe(2);
            expect(state.repoRootPath).toBe('/path/to/repo1');
            expect(state.repoId).toBe(repoId);
            expect(state.pending).toHaveLength(1);
        });

        it('uses process.cwd() for tasks without workingDirectory', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: {},
                config: {},
            });

            flushSave();

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
        it('saves separate files for different repos', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/repo/alpha' },
                config: {},
            });
            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/repo/beta' },
                config: {},
            });

            flushSave();

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

        it('groups tasks from same repo in one file', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/repo/shared' },
                config: {},
                displayName: 'task-1',
            });
            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/repo/shared' },
                config: {},
                displayName: 'task-2',
            });

            flushSave();

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
        it('deletes queue file for repos no longer present', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            // Manually create a repo file that has no corresponding tasks
            const orphanPath = '/orphan/repo';
            const repoId = computeRepoId(orphanPath);
            const orphanFile = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            fs.writeFileSync(orphanFile, JSON.stringify(makeRepoState(orphanPath, [makeTask('t1', 'queued', orphanPath)])));

            // Enqueue a task for a *different* repo so the save triggers cleanup
            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/active/repo' },
                config: {},
            });

            flushSave();

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
                expect(state.version).toBe(2);
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
        it('flushes dirty state on dispose', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/dispose/repo' },
                config: {},
            });

            // Don't flush timers — state is dirty
            persistence.dispose();
            persistence = undefined!;

            const repoId = computeRepoId('/dispose/repo');
            const filePath = path.join(dataDir, 'queues', `repo-${repoId}.json`);
            expect(fs.existsSync(filePath)).toBe(true);
        });
    });

    // ========================================================================
    // Round-trip: save + restore
    // ========================================================================

    describe('round-trip', () => {
        it('saves and restores a single task across persistence instances', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'follow-prompt',
                priority: 'normal',
                payload: { workingDirectory: '/roundtrip/repo' },
                config: {},
                displayName: 'My Task',
            });

            flushSave();
            persistence.dispose();
            persistence = undefined!;

            // Create fresh manager + persistence
            const qm2 = createManager();
            const p2 = new QueuePersistence(qm2, dataDir);
            p2.restore();

            const queued = qm2.getQueued();
            expect(queued).toHaveLength(1);
            expect(queued[0].type).toBe('follow-prompt');
            expect(queued[0].displayName).toBe('My Task');

            p2.dispose();
        });

        it('saves and restores tasks for multiple repos across instances', () => {
            persistence = new QueuePersistence(queueManager, dataDir);

            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/round/repo1' },
                config: {},
                displayName: 'R1',
            });
            queueManager.enqueue({
                type: 'custom',
                priority: 'normal',
                payload: { workingDirectory: '/round/repo2' },
                config: {},
                displayName: 'R2',
            });

            flushSave();
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
});
