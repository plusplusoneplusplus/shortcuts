/**
 * GitOpsStore Tests
 *
 * All tests use a temp directory cleaned up in afterEach.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { GitOpsStore, GitOpJob } from '../src/index';

function makeJob(overrides?: Partial<GitOpJob>): GitOpJob {
    return {
        id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        workspaceId: 'ws-test',
        op: 'pull',
        status: 'running',
        startedAt: new Date().toISOString(),
        pid: process.pid,
        ...overrides,
    };
}

describe('GitOpsStore', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-ops-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    // --- Basic CRUD ---

    it('should return undefined for getById on empty store', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const result = await store.getById('ws-1', 'nonexistent');
        expect(result).toBeUndefined();
    });

    it('should return undefined for getLatest on empty store', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const result = await store.getLatest('ws-1');
        expect(result).toBeUndefined();
    });

    it('should create and retrieve a job by ID', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const job = makeJob({ id: 'j1', workspaceId: 'ws-1' });
        await store.create(job);

        const retrieved = await store.getById('ws-1', 'j1');
        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe('j1');
        expect(retrieved!.op).toBe('pull');
        expect(retrieved!.status).toBe('running');
    });

    it('should update a job', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const job = makeJob({ id: 'j2', workspaceId: 'ws-1' });
        await store.create(job);

        const updated = await store.update('ws-1', 'j2', {
            status: 'success',
            finishedAt: new Date().toISOString(),
        });
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('success');
        expect(updated!.finishedAt).toBeDefined();

        const retrieved = await store.getById('ws-1', 'j2');
        expect(retrieved!.status).toBe('success');
    });

    it('should return undefined when updating nonexistent job', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const result = await store.update('ws-1', 'nonexistent', { status: 'success' });
        expect(result).toBeUndefined();
    });

    // --- getLatest ---

    it('should return the most recent job for a workspace', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        await store.create(makeJob({ id: 'j1', workspaceId: 'ws-1', op: 'pull' }));
        await store.create(makeJob({ id: 'j2', workspaceId: 'ws-1', op: 'fetch' }));
        await store.create(makeJob({ id: 'j3', workspaceId: 'ws-1', op: 'pull' }));

        const latest = await store.getLatest('ws-1');
        expect(latest!.id).toBe('j3');
    });

    it('should filter getLatest by op type', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        await store.create(makeJob({ id: 'j1', workspaceId: 'ws-1', op: 'pull' }));
        await store.create(makeJob({ id: 'j2', workspaceId: 'ws-1', op: 'fetch' }));

        const latestPull = await store.getLatest('ws-1', 'pull');
        expect(latestPull!.id).toBe('j1');

        const latestFetch = await store.getLatest('ws-1', 'fetch');
        expect(latestFetch!.id).toBe('j2');
    });

    // --- getRunning ---

    it('should return only running jobs', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        await store.create(makeJob({ id: 'j1', workspaceId: 'ws-1', status: 'running' }));
        await store.create(makeJob({ id: 'j2', workspaceId: 'ws-1', status: 'success' }));
        await store.create(makeJob({ id: 'j3', workspaceId: 'ws-1', status: 'running', op: 'fetch' }));

        const running = await store.getRunning('ws-1');
        expect(running).toHaveLength(2);

        const runningPull = await store.getRunning('ws-1', 'pull');
        expect(runningPull).toHaveLength(1);
        expect(runningPull[0].id).toBe('j1');
    });

    // --- Workspace isolation ---

    it('should isolate jobs per workspace', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        await store.create(makeJob({ id: 'j1', workspaceId: 'ws-A' }));
        await store.create(makeJob({ id: 'j2', workspaceId: 'ws-B' }));

        expect(await store.getById('ws-A', 'j1')).toBeDefined();
        expect(await store.getById('ws-A', 'j2')).toBeUndefined();
        expect(await store.getById('ws-B', 'j2')).toBeDefined();
        expect(await store.getById('ws-B', 'j1')).toBeUndefined();
    });

    // --- Retention pruning ---

    it('should prune old jobs beyond maxJobsPerWorkspace', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir, maxJobsPerWorkspace: 3 });
        for (let i = 0; i < 5; i++) {
            await store.create(makeJob({ id: `j${i}`, workspaceId: 'ws-1', status: 'success' }));
        }

        // Should only have the 3 most recent
        const latest = await store.getLatest('ws-1');
        expect(latest!.id).toBe('j4');

        // j0 and j1 should be pruned
        expect(await store.getById('ws-1', 'j0')).toBeUndefined();
        expect(await store.getById('ws-1', 'j1')).toBeUndefined();
        // j2, j3, j4 should remain
        expect(await store.getById('ws-1', 'j2')).toBeDefined();
        expect(await store.getById('ws-1', 'j3')).toBeDefined();
        expect(await store.getById('ws-1', 'j4')).toBeDefined();
    });

    it('should preserve running jobs during pruning', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir, maxJobsPerWorkspace: 2 });
        await store.create(makeJob({ id: 'j-running', workspaceId: 'ws-1', status: 'running' }));
        await store.create(makeJob({ id: 'j-old', workspaceId: 'ws-1', status: 'success' }));
        await store.create(makeJob({ id: 'j-new', workspaceId: 'ws-1', status: 'success' }));

        // Running job should be preserved even though we're at max
        expect(await store.getById('ws-1', 'j-running')).toBeDefined();
        expect(await store.getById('ws-1', 'j-new')).toBeDefined();
        // Old terminal job should be pruned
        expect(await store.getById('ws-1', 'j-old')).toBeUndefined();
    });

    // --- markStaleRunningJobs ---

    it('should mark running jobs as interrupted on startup sweep', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        await store.create(makeJob({ id: 'j1', workspaceId: 'ws-1', status: 'running' }));
        await store.create(makeJob({ id: 'j2', workspaceId: 'ws-1', status: 'success' }));
        await store.create(makeJob({ id: 'j3', workspaceId: 'ws-2', status: 'running' }));

        const count = await store.markStaleRunningJobs();
        expect(count).toBe(2);

        const j1 = await store.getById('ws-1', 'j1');
        expect(j1!.status).toBe('interrupted');
        expect(j1!.finishedAt).toBeDefined();
        expect(j1!.error).toContain('Server restarted');

        const j2 = await store.getById('ws-1', 'j2');
        expect(j2!.status).toBe('success'); // unchanged

        const j3 = await store.getById('ws-2', 'j3');
        expect(j3!.status).toBe('interrupted');
    });

    it('markStaleRunningJobs returns 0 on empty store', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        const count = await store.markStaleRunningJobs();
        expect(count).toBe(0);
    });

    // --- Concurrent writes ---

    it('should handle concurrent writes safely via write queue', async () => {
        const store = new GitOpsStore({ dataDir: tmpDir });
        // Fire off many creates concurrently
        const promises = Array.from({ length: 20 }, (_, i) =>
            store.create(makeJob({ id: `concurrent-${i}`, workspaceId: 'ws-1', status: 'success' }))
        );
        await Promise.all(promises);

        // All should be persisted (up to maxJobs=10)
        const latest = await store.getLatest('ws-1');
        expect(latest).toBeDefined();

        // Verify file is valid JSON
        const filePath = path.join(tmpDir, 'git-ops', 'ws-1.json');
        const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(10); // default maxJobs
    });

    // --- Persistence across instances ---

    it('should persist data across store instances', async () => {
        const store1 = new GitOpsStore({ dataDir: tmpDir });
        await store1.create(makeJob({ id: 'persist-test', workspaceId: 'ws-1', status: 'success' }));

        const store2 = new GitOpsStore({ dataDir: tmpDir });
        const job = await store2.getById('ws-1', 'persist-test');
        expect(job).toBeDefined();
        expect(job!.id).toBe('persist-test');
    });
});
