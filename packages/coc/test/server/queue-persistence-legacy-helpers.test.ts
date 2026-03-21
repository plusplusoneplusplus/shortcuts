/**
 * Tests for queue/queue-persistence — QueuePersistence restore/save and
 * getRepoQueueFilePath helper.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import {
    QueuePersistence,
    getRepoQueueFilePath,
    atomicWriteJson,
    PersistedQueueState,
    restoreRepoQueueState,
    CURRENT_VERSION,
} from '../../src/server/queue/queue-persistence';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'coc-queue-test-'));
}

function makeQueueManager(): TaskQueueManager {
    return new TaskQueueManager({ keepHistory: true });
}

function resolveWorkspaceId(rootPath: string): string {
    // Simple deterministic ID for tests: last segment of path
    return path.basename(rootPath).replace(/[^a-z0-9]/gi, '');
}

// ============================================================================
// getRepoQueueFilePath
// ============================================================================

describe('getRepoQueueFilePath', () => {
    it('returns expected path under repos directory', () => {
        const result = getRepoQueueFilePath('/data', 'abc123');
        expect(result.replace(/\\/g, '/')).toContain('/data/repos/abc123/queues.json');
    });

    it('is deterministic for same inputs', () => {
        const a = getRepoQueueFilePath('/my/data', 'ws1');
        const b = getRepoQueueFilePath('/my/data', 'ws1');
        expect(a).toBe(b);
    });
});

// ============================================================================
// atomicWriteJson
// ============================================================================

describe('atomicWriteJson', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('writes file atomically and creates parent directory', () => {
        const filePath = path.join(tmpDir, 'repos', 'test', 'queues.json');
        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/repo',
            repoId: 'test',
            pending: [],
            history: [],
            isPaused: false,
        };
        atomicWriteJson(filePath, state);
        expect(fs.existsSync(filePath)).toBe(true);
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        expect(parsed.version).toBe(3);
        expect(parsed.repoId).toBe('test');
    });
});

// ============================================================================
// QueuePersistence — restore
// ============================================================================

describe('QueuePersistence restore', () => {
    let tmpDir: string;

    beforeEach(() => { tmpDir = createTempDir(); });
    afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

    it('is a no-op when queues directory does not exist', () => {
        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        // Should not throw
        persistence.restore();
        expect(qm.getQueued()).toHaveLength(0);
        persistence.dispose();
    });

    it('restores queued tasks from a persisted file', () => {
        const repoId = 'repo1';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const filePath = path.join(repoDir, 'queues.json');

        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/some/repo',
            repoId,
            pending: [
                {
                    id: 'task-1',
                    type: 'chat',
                    status: 'queued',
                    priority: 'normal',
                    payload: {},
                    createdAt: Date.now(),
                    repoId,
                },
            ],
            history: [],
            isPaused: false,
        };
        fs.writeFileSync(filePath, JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        persistence.restore();

        expect(qm.getQueued()).toHaveLength(1);
        persistence.dispose();
    });

    it('marks previously-running tasks as failed (fail policy)', () => {
        const repoId = 'repo2';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const filePath = path.join(repoDir, 'queues.json');

        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/some/repo',
            repoId,
            pending: [
                {
                    id: 'task-running',
                    type: 'chat',
                    status: 'running',
                    priority: 'normal',
                    payload: {},
                    createdAt: Date.now(),
                    repoId,
                },
            ],
            history: [],
            isPaused: false,
        };
        fs.writeFileSync(filePath, JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, {
            restartPolicy: 'fail',
            resolveWorkspaceId,
        });
        persistence.restore();

        // Running task should not be re-enqueued
        expect(qm.getQueued()).toHaveLength(0);
        // Should be in history as failed
        const history = qm.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('failed');
        expect(history[0].error).toContain('Server restarted');
        persistence.dispose();
    });

    it('requeues previously-running tasks with requeue policy', () => {
        const repoId = 'repo3';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const filePath = path.join(repoDir, 'queues.json');

        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/some/repo',
            repoId,
            pending: [
                {
                    id: 'task-running',
                    type: 'chat',
                    status: 'running',
                    priority: 'normal',
                    payload: {},
                    createdAt: Date.now(),
                    repoId,
                },
            ],
            history: [],
            isPaused: false,
        };
        fs.writeFileSync(filePath, JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, {
            restartPolicy: 'requeue',
            resolveWorkspaceId,
        });
        persistence.restore();

        // Running task should be re-enqueued at high priority
        expect(qm.getQueued()).toHaveLength(1);
        expect(qm.getQueued()[0].priority).toBe('high');
        persistence.dispose();
    });

    it('skips corrupt queue files gracefully', () => {
        const repoDir = path.join(tmpDir, 'repos', 'corrupt');
        fs.mkdirSync(repoDir, { recursive: true });
        fs.writeFileSync(path.join(repoDir, 'queues.json'), '{ invalid json', 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        // Should not throw
        persistence.restore();
        expect(qm.getQueued()).toHaveLength(0);
        persistence.dispose();
    });

    it('skips files with unknown version', () => {
        const repoDir = path.join(tmpDir, 'repos', 'r');
        fs.mkdirSync(repoDir, { recursive: true });
        const state = { version: 99, savedAt: new Date().toISOString(), repoRootPath: '/r', repoId: 'r', pending: [], history: [], isPaused: false };
        fs.writeFileSync(path.join(repoDir, 'queues.json'), JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        persistence.restore();
        expect(qm.getQueued()).toHaveLength(0);
        persistence.dispose();
    });

    it('migrates v2 files to v3 (sets isPaused: false)', () => {
        const repoId = 'repo4';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const state = {
            version: 2,
            savedAt: new Date().toISOString(),
            repoRootPath: '/r',
            repoId,
            pending: [
                { id: 'task-v2', type: 'chat', status: 'queued', priority: 'normal', payload: {}, createdAt: Date.now(), repoId },
            ],
            history: [],
        };
        fs.writeFileSync(path.join(repoDir, 'queues.json'), JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        persistence.restore();
        expect(qm.getQueued()).toHaveLength(1);
        persistence.dispose();
    });

    it('restores history tasks', () => {
        const repoId = 'repo5';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/r',
            repoId,
            pending: [],
            history: [
                { id: 'hist-1', type: 'chat', status: 'completed', priority: 'normal', payload: {}, createdAt: Date.now() - 1000, repoId, completedAt: Date.now() },
            ],
            isPaused: false,
        };
        fs.writeFileSync(path.join(repoDir, 'queues.json'), JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        persistence.restore();
        expect(qm.getHistory()).toHaveLength(1);
        persistence.dispose();
    });

    it('restores paused repo state', () => {
        const repoId = 'repo6';
        const repoDir = path.join(tmpDir, 'repos', repoId);
        fs.mkdirSync(repoDir, { recursive: true });
        const state: PersistedQueueState = {
            version: 3,
            savedAt: new Date().toISOString(),
            repoRootPath: '/r',
            repoId,
            pending: [],
            history: [],
            isPaused: true,
        };
        fs.writeFileSync(path.join(repoDir, 'queues.json'), JSON.stringify(state), 'utf-8');

        const qm = makeQueueManager();
        const persistence = new QueuePersistence(qm, tmpDir, { resolveWorkspaceId });
        persistence.restore();
        expect(qm.isRepoPaused(repoId)).toBe(true);
        persistence.dispose();
    });
});

// ============================================================================
// restoreRepoQueueState — pure function tests
// ============================================================================

describe('restoreRepoQueueState', () => {
    function makeManager(): TaskQueueManager {
        return new TaskQueueManager({ keepHistory: true });
    }

    function makeState(overrides: Partial<PersistedQueueState> = {}): PersistedQueueState {
        return {
            version: CURRENT_VERSION,
            savedAt: new Date().toISOString(),
            repoRootPath: '/repo',
            repoId: 'repo1',
            pending: [],
            history: [],
            isPaused: false,
            ...overrides,
        };
    }

    it('requeues tasks with status queued', () => {
        const qm = makeManager();
        const state = makeState({
            pending: [
                { id: 't1', type: 'chat', status: 'queued', priority: 'normal', payload: {}, createdAt: 1, repoId: 'repo1' },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'fail');
        expect(result.restored).toBe(1);
        expect(result.historyCount).toBe(0);
        expect(qm.getQueued()).toHaveLength(1);
    });

    it('fails running tasks when policy is fail', () => {
        const qm = makeManager();
        const state = makeState({
            pending: [
                { id: 't1', type: 'chat', status: 'running', priority: 'normal', payload: {}, createdAt: 1, repoId: 'repo1' },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'fail');
        expect(result.restored).toBe(0);
        expect(result.historyCount).toBe(1);
        expect(qm.getQueued()).toHaveLength(0);
        expect(qm.getHistory()[0].status).toBe('failed');
        expect(qm.getHistory()[0].error).toContain('Server restarted');
    });

    it('requeues running tasks with high priority when policy is requeue', () => {
        const qm = makeManager();
        const state = makeState({
            pending: [
                { id: 't1', type: 'chat', status: 'running', priority: 'normal', payload: {}, createdAt: 1, repoId: 'repo1' },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'requeue');
        expect(result.restored).toBe(1);
        expect(qm.getQueued()[0].priority).toBe('high');
    });

    it('migrates v2 state to v3 (isPaused defaults to false)', () => {
        const qm = makeManager();
        const state = {
            version: 2,
            savedAt: new Date().toISOString(),
            repoRootPath: '/repo',
            repoId: 'repo1',
            pending: [
                { id: 't1', type: 'chat', status: 'queued', priority: 'normal', payload: {}, createdAt: 1, repoId: 'repo1' },
            ],
            history: [],
        } as unknown as PersistedQueueState;
        const result = restoreRepoQueueState(state, qm, 'fail');
        expect(result.restored).toBe(1);
        expect(qm.isRepoPaused('repo1')).toBe(false);
    });

    it('returns zeros for unknown version', () => {
        const qm = makeManager();
        const state = makeState({ version: 99 });
        const result = restoreRepoQueueState(state, qm, 'fail');
        expect(result.restored).toBe(0);
        expect(result.historyCount).toBe(0);
        expect(qm.getQueued()).toHaveLength(0);
    });

    it('restores history entries', () => {
        const qm = makeManager();
        const state = makeState({
            history: [
                { id: 'h1', type: 'chat', status: 'completed', priority: 'normal', payload: {}, createdAt: 1, repoId: 'repo1', completedAt: 2 },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'fail');
        expect(result.historyCount).toBe(1);
        expect(qm.getHistory()).toHaveLength(1);
    });

    it('restores pause state', () => {
        const qm = makeManager();
        const state = makeState({ isPaused: true, repoId: 'repo1' });
        restoreRepoQueueState(state, qm, 'fail');
        expect(qm.isRepoPaused('repo1')).toBe(true);
    });

    it('handles requeue-if-retriable policy correctly', () => {
        const qm = makeManager();
        // retryCount < retryAttempts → should requeue
        const state = makeState({
            pending: [
                {
                    id: 't1', type: 'chat', status: 'running', priority: 'normal', payload: {},
                    createdAt: 1, repoId: 'repo1',
                    retryCount: 1, config: { retryAttempts: 3 },
                },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'requeue-if-retriable');
        expect(result.restored).toBe(1);
        expect(qm.getQueued()[0].priority).toBe('high');
    });

    it('fails task with requeue-if-retriable when retry limit reached', () => {
        const qm = makeManager();
        // retryCount >= retryAttempts → should fail
        const state = makeState({
            pending: [
                {
                    id: 't1', type: 'chat', status: 'running', priority: 'normal', payload: {},
                    createdAt: 1, repoId: 'repo1',
                    retryCount: 3, config: { retryAttempts: 3 },
                },
            ],
        });
        const result = restoreRepoQueueState(state, qm, 'requeue-if-retriable');
        expect(result.restored).toBe(0);
        expect(qm.getHistory()[0].status).toBe('failed');
    });
});
