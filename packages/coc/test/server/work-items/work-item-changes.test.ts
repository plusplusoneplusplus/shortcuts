import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { Route } from '../../../src/server/types';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorkItemRoutes } from '../../../src/server/routes/work-item-routes';
import { registerWorkItemChangesRoutes } from '../../../src/server/routes/work-item-changes-routes';
import { createWorkItemStorageScopeResolver, FileWorkItemStore } from '../../../src/server/work-items/work-item-store';
import { clearWorkItemResponseCache } from '../../../src/server/work-items/work-item-response-cache';
import {
    executeWorkItem,
    handleWorkItemTaskComplete,
} from '../../../src/server/work-items/work-item-executor';
import type { WorkItem, WorkItemChange } from '../../../src/server/work-items/types';

let tmpDir: string;
let store: FileWorkItemStore;
let routeServer: http.Server | undefined;
let baseUrl: string;
let routeWorkspaces: any[] = [];

const processStore = {
    getWorkspaces: async () => routeWorkspaces,
    updateWorkspace: async (workspaceId: string, update: any) => {
        const workspace = routeWorkspaces.find(entry => entry.id === workspaceId);
        if (workspace) Object.assign(workspace, update);
    },
} as any;

function makeWorkItem(overrides: Partial<WorkItem> = {}): WorkItem {
    return {
        id: `wi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        repoId: 'test-repo',
        title: 'Test work item',
        description: 'A test description',
        status: 'created',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        source: 'manual',
        ...overrides,
    };
}

function makeChange(overrides: Partial<WorkItemChange> = {}): WorkItemChange {
    return {
        id: `chg-${Math.random().toString(36).slice(2, 10)}`,
        planVersion: 1,
        commits: [],
        startedAt: new Date().toISOString(),
        status: 'open',
        ...overrides,
    };
}

beforeEach(async () => {
    clearWorkItemResponseCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coc-wi-changes-'));
    routeWorkspaces = [];
    store = new FileWorkItemStore({ dataDir: tmpDir });
});

afterEach(async () => {
    if (routeServer?.listening) {
        await new Promise<void>(resolve => routeServer!.close(() => resolve()));
    }
    routeServer = undefined;
    clearWorkItemResponseCache();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeRouteServer(): http.Server {
    const routes: Route[] = [];
    registerWorkItemRoutes({ routes, workItemStore: store, processStore });
    registerWorkItemChangesRoutes({ routes, workItemStore: store, processStore });
    return http.createServer(createRouter({ routes, spaHtml: '' }));
}

async function startRouteServer(): Promise<void> {
    routeServer = makeRouteServer();
    await new Promise<void>((resolve, reject) => {
        routeServer!.on('error', reject);
        routeServer!.listen(0, '127.0.0.1', () => {
            const addr = routeServer!.address() as any;
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function request(method: string, urlPath: string, body?: unknown): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(urlPath, baseUrl);
        const opts: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method,
            headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        };
        const req = http.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf-8');
                let parsed: any = null;
                try { parsed = JSON.parse(raw); } catch { parsed = raw; }
                resolve({ status: res.statusCode!, body: parsed });
            });
        });
        req.on('error', reject);
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}

// ============================================================================
// FileWorkItemStore — change tracking methods
// ============================================================================

describe('FileWorkItemStore.addChange', () => {
    it('adds a change entry to a work item', async () => {
        const item = makeWorkItem({ id: 'wi-chg-add' });
        await store.addWorkItem(item);

        const change = makeChange({ id: 'chg-1', planVersion: 1, status: 'open' });
        await store.addChange('wi-chg-add', change);

        const retrieved = await store.getWorkItem('wi-chg-add', 'test-repo');
        expect(retrieved!.changes).toHaveLength(1);
        expect(retrieved!.changes![0].id).toBe('chg-1');
        expect(retrieved!.changes![0].planVersion).toBe(1);
        expect(retrieved!.changes![0].status).toBe('open');
    });

    it('appends multiple changes', async () => {
        const item = makeWorkItem({ id: 'wi-chg-multi' });
        await store.addWorkItem(item);

        await store.addChange('wi-chg-multi', makeChange({ id: 'chg-a' }));
        await store.addChange('wi-chg-multi', makeChange({ id: 'chg-b' }));
        await store.addChange('wi-chg-multi', makeChange({ id: 'chg-c' }));

        const retrieved = await store.getWorkItem('wi-chg-multi', 'test-repo');
        expect(retrieved!.changes).toHaveLength(3);
        expect(retrieved!.changes!.map(c => c.id)).toEqual(['chg-a', 'chg-b', 'chg-c']);
    });

    it('is a no-op for non-existent work item', async () => {
        await expect(
            store.addChange('nonexistent', makeChange({ id: 'chg-x' }))
        ).resolves.toBeUndefined();
    });

    it('updates updatedAt on the work item', async () => {
        const item = makeWorkItem({ id: 'wi-chg-ts', updatedAt: '2026-01-01T00:00:00.000Z' });
        await store.addWorkItem(item);

        await store.addChange('wi-chg-ts', makeChange({ id: 'chg-ts' }));

        const retrieved = await store.getWorkItem('wi-chg-ts', 'test-repo');
        expect(retrieved!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });
});

describe('FileWorkItemStore.updateChange', () => {
    it('updates a change by id', async () => {
        const item = makeWorkItem({ id: 'wi-chg-upd' });
        await store.addWorkItem(item);
        await store.addChange('wi-chg-upd', makeChange({ id: 'chg-upd', status: 'open' }));

        await store.updateChange('wi-chg-upd', 'chg-upd', {
            status: 'closed',
            completedAt: '2026-06-01T10:00:00.000Z',
            commits: [{ sha: 'abc1234', message: 'fix: something', author: 'Alice' }],
        });

        const retrieved = await store.getWorkItem('wi-chg-upd', 'test-repo');
        const change = retrieved!.changes!.find(c => c.id === 'chg-upd');
        expect(change).toBeDefined();
        expect(change!.status).toBe('closed');
        expect(change!.completedAt).toBe('2026-06-01T10:00:00.000Z');
        expect(change!.commits).toHaveLength(1);
        expect(change!.commits[0].sha).toBe('abc1234');
        expect(change!.commits[0].author).toBe('Alice');
    });

    it('does not affect other changes', async () => {
        const item = makeWorkItem({ id: 'wi-chg-other' });
        await store.addWorkItem(item);
        await store.addChange('wi-chg-other', makeChange({ id: 'chg-1' }));
        await store.addChange('wi-chg-other', makeChange({ id: 'chg-2' }));

        await store.updateChange('wi-chg-other', 'chg-1', { status: 'closed' });

        const retrieved = await store.getWorkItem('wi-chg-other', 'test-repo');
        expect(retrieved!.changes!.find(c => c.id === 'chg-2')!.status).toBe('open');
    });

    it('is a no-op for non-existent change id', async () => {
        const item = makeWorkItem({ id: 'wi-chg-noop' });
        await store.addWorkItem(item);
        await store.addChange('wi-chg-noop', makeChange({ id: 'chg-real' }));

        await expect(
            store.updateChange('wi-chg-noop', 'nonexistent-id', { status: 'closed' })
        ).resolves.toBeUndefined();

        const retrieved = await store.getWorkItem('wi-chg-noop', 'test-repo');
        expect(retrieved!.changes![0].status).toBe('open');
    });

    it('is a no-op for work item with no changes', async () => {
        const item = makeWorkItem({ id: 'wi-chg-empty' });
        await store.addWorkItem(item);

        await expect(
            store.updateChange('wi-chg-empty', 'any-id', { status: 'closed' })
        ).resolves.toBeUndefined();
    });
});

describe('FileWorkItemStore.getChanges', () => {
    it('returns all changes for a work item', async () => {
        const item = makeWorkItem({ id: 'wi-gc' });
        await store.addWorkItem(item);
        await store.addChange('wi-gc', makeChange({ id: 'chg-1', planVersion: 1 }));
        await store.addChange('wi-gc', makeChange({ id: 'chg-2', planVersion: 2 }));

        const changes = await store.getChanges('wi-gc');
        expect(changes).toHaveLength(2);
        expect(changes.map(c => c.id)).toEqual(['chg-1', 'chg-2']);
    });

    it('returns empty array for work item with no changes', async () => {
        const item = makeWorkItem({ id: 'wi-gc-empty' });
        await store.addWorkItem(item);

        const changes = await store.getChanges('wi-gc-empty');
        expect(changes).toEqual([]);
    });

    it('returns empty array for non-existent work item', async () => {
        const changes = await store.getChanges('nonexistent');
        expect(changes).toEqual([]);
    });
});

describe('Work Item Changes Routes', () => {
    const ORIGIN_ID = 'gh_plusplusoneplusplus_shortcuts';
    const OTHER_ORIGIN_ID = 'gh_plusplusoneplusplus_other';

    beforeEach(async () => {
        routeWorkspaces = [
            {
                id: 'clone-a',
                name: 'Clone A',
                rootPath: path.join(tmpDir, 'clone-a'),
                remoteUrl: 'https://github.com/plusplusoneplusplus/shortcuts.git',
            },
            {
                id: 'clone-b',
                name: 'Clone B',
                rootPath: path.join(tmpDir, 'clone-b'),
                remoteUrl: 'git@github.com:plusplusoneplusplus/shortcuts.git',
            },
            {
                id: 'other-clone',
                name: 'Other Clone',
                rootPath: path.join(tmpDir, 'other-clone'),
                remoteUrl: 'https://github.com/plusplusoneplusplus/other.git',
            },
        ];
        store = new FileWorkItemStore({
            dataDir: tmpDir,
            scopeResolver: createWorkItemStorageScopeResolver(processStore),
        });
        await startRouteServer();
    });

    it('lists, creates, and updates changes through the canonical origin shared by same-origin clones', async () => {
        const shared = await request('POST', '/api/workspaces/clone-a/work-items', {
            id: 'shared-change',
            title: 'Shared Change',
        });
        expect(shared.status).toBe(201);
        const other = await request('POST', '/api/workspaces/other-clone/work-items', {
            id: 'shared-change',
            title: 'Other Change',
        });
        expect(other.status).toBe(201);

        const created = await request('POST', `/api/origins/${ORIGIN_ID}/work-items/shared-change/changes`, {
            workspaceId: 'clone-b',
            planVersion: 3,
            taskId: 'task-shared',
            headBefore: 'abc123',
        });
        expect(created.status).toBe(201);
        expect(created.body.planVersion).toBe(3);
        expect(created.body.taskId).toBe('task-shared');

        const listed = await request('GET', `/api/origins/${ORIGIN_ID}/work-items/shared-change/changes`);
        expect(listed.status).toBe(200);
        expect(listed.body.map((change: WorkItemChange) => change.id)).toEqual([created.body.id]);

        const otherListed = await request('GET', `/api/origins/${OTHER_ORIGIN_ID}/work-items/shared-change/changes`);
        expect(otherListed.status).toBe(200);
        expect(otherListed.body).toEqual([]);

        const patched = await request(
            'PATCH',
            `/api/origins/${ORIGIN_ID}/work-items/shared-change/changes/${created.body.id}?workspaceId=clone-a`,
            {
                status: 'closed',
                completedAt: '2026-06-17T03:00:00.000Z',
                commits: [{ sha: 'def456', message: 'feat: done', author: 'Dev' }],
            },
        );
        expect(patched.status).toBe(200);
        expect(patched.body.status).toBe('closed');
        expect(patched.body.commits[0].sha).toBe('def456');

        const stored = await store.getChanges('shared-change', ORIGIN_ID);
        expect(stored[0].status).toBe('closed');
        expect(stored[0].commits[0].sha).toBe('def456');
    });

    it('rejects clone metadata that resolves to a different origin', async () => {
        const res = await request('GET', `/api/origins/${ORIGIN_ID}/work-items/shared-change/changes?workspaceId=other-clone`);

        expect(res.status).toBe(400);
        expect(res.body.error).toContain(`not '${ORIGIN_ID}'`);
    });

    it('does not expose the legacy workspace changes route', async () => {
        const created = await request('POST', '/api/workspaces/clone-a/work-items', {
            id: 'workspace-route-removed',
            title: 'Workspace route removed',
        });
        expect(created.status).toBe(201);

        const res = await request('GET', '/api/workspaces/clone-a/work-items/workspace-route-removed/changes');

        expect(res.status).toBe(404);
    });
});

// ============================================================================
// executeWorkItem — creates a Change entry
// ============================================================================

describe('executeWorkItem — change lifecycle', () => {
    it('creates an open Change entry when no open change exists', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-chg',
            status: 'readyToExecute',
            plan: { version: 2, content: 'Do stuff', updatedAt: '' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-exec-1');
        await executeWorkItem('wi-exec-chg', store, enqueue);

        const changes = await store.getChanges('wi-exec-chg');
        expect(changes).toHaveLength(1);
        expect(changes[0].status).toBe('open');
        expect(changes[0].taskId).toBe('task-exec-1');
        expect(changes[0].planVersion).toBe(2);
        expect(changes[0].commits).toEqual([]);
    });

    it('reuses an existing open Change that matches the plan version and has no taskId', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-reuse',
            status: 'readyToExecute',
            plan: { version: 3, content: 'Plan v3', updatedAt: '' },
        });
        await store.addWorkItem(item);

        // Pre-create an open change (simulating plan save)
        const preChange = makeChange({ id: 'pre-chg', planVersion: 3, status: 'open' });
        await store.addChange('wi-exec-reuse', preChange);

        const enqueue = vi.fn().mockResolvedValue('task-reuse-1');
        await executeWorkItem('wi-exec-reuse', store, enqueue);

        const changes = await store.getChanges('wi-exec-reuse');
        expect(changes).toHaveLength(1);
        expect(changes[0].id).toBe('pre-chg');
        expect(changes[0].taskId).toBe('task-reuse-1');
    });

    it('creates a new Change if existing open one already has a taskId', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-new',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Plan', updatedAt: '' },
        });
        await store.addWorkItem(item);

        // Pre-existing open change that already has a taskId
        await store.addChange('wi-exec-new', makeChange({
            id: 'occupied-chg',
            planVersion: 1,
            status: 'open',
            taskId: 'old-task',
        }));

        const enqueue = vi.fn().mockResolvedValue('task-new-1');
        await executeWorkItem('wi-exec-new', store, enqueue);

        const changes = await store.getChanges('wi-exec-new');
        expect(changes).toHaveLength(2);
        const newChange = changes.find(c => c.taskId === 'task-new-1');
        expect(newChange).toBeDefined();
        expect(newChange!.status).toBe('open');
    });

    it('stores headBefore on the Change when provided', async () => {
        const item = makeWorkItem({
            id: 'wi-exec-head',
            status: 'readyToExecute',
            plan: { version: 1, content: 'Plan', updatedAt: '' },
        });
        await store.addWorkItem(item);

        const enqueue = vi.fn().mockResolvedValue('task-head-1');
        await executeWorkItem('wi-exec-head', store, enqueue, { headBefore: 'abc1234def5678' });

        const changes = await store.getChanges('wi-exec-head');
        expect(changes[0].headBefore).toBe('abc1234def5678');
    });
});

// ============================================================================
// handleWorkItemTaskComplete — closes the Change
// ============================================================================

describe('handleWorkItemTaskComplete — closes Change', () => {
    it('closes the open Change on completion', async () => {
        const item = makeWorkItem({ id: 'wi-done-chg', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-done-chg', {
            taskId: 'task-c1',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });
        await store.addChange('wi-done-chg', makeChange({
            id: 'chg-c1',
            planVersion: 1,
            status: 'open',
            taskId: 'task-c1',
        }));

        await handleWorkItemTaskComplete('wi-done-chg', 'task-c1', { status: 'completed' }, store);

        const changes = await store.getChanges('wi-done-chg');
        const change = changes.find(c => c.id === 'chg-c1');
        expect(change!.status).toBe('closed');
        expect(change!.completedAt).toBeDefined();
    });

    it('closes the open Change on failure', async () => {
        const item = makeWorkItem({ id: 'wi-fail-chg', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-fail-chg', {
            taskId: 'task-f1',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });
        await store.addChange('wi-fail-chg', makeChange({
            id: 'chg-f1',
            planVersion: 1,
            status: 'open',
            taskId: 'task-f1',
        }));

        await handleWorkItemTaskComplete('wi-fail-chg', 'task-f1', {
            status: 'failed',
            error: 'timeout',
        }, store);

        const changes = await store.getChanges('wi-fail-chg');
        expect(changes[0].status).toBe('closed');
        expect(changes[0].completedAt).toBeDefined();
    });

    it('closes the open Change on cancellation', async () => {
        const item = makeWorkItem({ id: 'wi-cancel-chg', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-cancel-chg', {
            taskId: 'task-cancel1',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });
        await store.addChange('wi-cancel-chg', makeChange({
            id: 'chg-cancel1',
            planVersion: 1,
            status: 'open',
            taskId: 'task-cancel1',
        }));

        await handleWorkItemTaskComplete('wi-cancel-chg', 'task-cancel1', { status: 'cancelled' }, store);

        const changes = await store.getChanges('wi-cancel-chg');
        expect(changes[0].status).toBe('closed');
    });

    it('does not close a change with a different taskId', async () => {
        const item = makeWorkItem({ id: 'wi-nodiff-chg', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-nodiff-chg', {
            taskId: 'task-diff',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });
        await store.addChange('wi-nodiff-chg', makeChange({
            id: 'chg-other',
            planVersion: 1,
            status: 'open',
            taskId: 'task-other',
        }));

        await handleWorkItemTaskComplete('wi-nodiff-chg', 'task-diff', { status: 'completed' }, store);

        const changes = await store.getChanges('wi-nodiff-chg');
        expect(changes[0].status).toBe('open');
    });

    it('tolerates missing changes (no crash)', async () => {
        const item = makeWorkItem({ id: 'wi-nochange', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-nochange', {
            taskId: 'task-nc',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });

        await expect(
            handleWorkItemTaskComplete('wi-nochange', 'task-nc', { status: 'completed' }, store)
        ).resolves.toBeUndefined();
    });
});

// ============================================================================
// Change commit data
// ============================================================================

describe('change commits', () => {
    it('re-fetching after updateChange includes attached commits (regression: stale broadcast)', async () => {
        // This test reproduces the bug where a work item was fetched before
        // updateChange() wrote commits, causing the broadcast to send empty commits.
        const item = makeWorkItem({ id: 'wi-stale-broadcast', status: 'executing' });
        await store.addWorkItem(item);
        await store.addExecution('wi-stale-broadcast', {
            taskId: 'task-stale',
            startedAt: '2026-01-01T12:00:00.000Z',
            status: 'running',
        });
        await store.addChange('wi-stale-broadcast', makeChange({
            id: 'chg-stale',
            planVersion: 1,
            status: 'open',
            taskId: 'task-stale',
            headBefore: 'aaa111',
        }));

        // Step 1: handleWorkItemTaskComplete closes the change
        await handleWorkItemTaskComplete('wi-stale-broadcast', 'task-stale', { status: 'completed' }, store);

        // Step 2: Fetch work item (simulates what the old code did before the fix)
        const staleItem = await store.getWorkItem('wi-stale-broadcast');
        expect(staleItem).toBeDefined();
        const closedChange = staleItem!.changes!.find(c => c.id === 'chg-stale');
        expect(closedChange!.status).toBe('closed');
        // At this point, commits are empty — they haven't been attached yet
        expect(closedChange!.commits).toEqual([]);

        // Step 3: Attach commits (simulates collectWorkItemCommits result)
        const commits = [
            { sha: 'commit1', message: 'feat: implement feature', author: 'Dev', date: '2026-01-01T13:00:00Z' },
            { sha: 'commit2', message: 'test: add tests', author: 'Dev', date: '2026-01-01T13:05:00Z' },
        ];
        await store.updateChange('wi-stale-broadcast', 'chg-stale', { commits });

        // Step 4: staleItem still has empty commits (it's a stale snapshot)
        const staleChange = staleItem!.changes!.find(c => c.id === 'chg-stale');
        expect(staleChange!.commits).toEqual([]);

        // Step 5: Re-fetching after updateChange yields correct data
        const freshItem = await store.getWorkItem('wi-stale-broadcast');
        const freshChange = freshItem!.changes!.find(c => c.id === 'chg-stale');
        expect(freshChange!.commits).toHaveLength(2);
        expect(freshChange!.commits[0].sha).toBe('commit1');
        expect(freshChange!.commits[1].sha).toBe('commit2');
    });

    it('stores and retrieves commit data on a change', async () => {
        const item = makeWorkItem({ id: 'wi-commits' });
        await store.addWorkItem(item);
        await store.addChange('wi-commits', makeChange({ id: 'chg-commits', status: 'open' }));

        await store.updateChange('wi-commits', 'chg-commits', {
            commits: [
                { sha: 'abc1234', message: 'feat: add feature', author: 'Alice', date: '2026-01-01T10:00:00Z' },
                { sha: 'def5678', message: 'fix: bug fix', author: 'Bob' },
            ],
            status: 'closed',
            completedAt: new Date().toISOString(),
        });

        const changes = await store.getChanges('wi-commits');
        expect(changes[0].commits).toHaveLength(2);
        expect(changes[0].commits[0].sha).toBe('abc1234');
        expect(changes[0].commits[0].message).toBe('feat: add feature');
        expect(changes[0].commits[0].author).toBe('Alice');
        expect(changes[0].commits[1].sha).toBe('def5678');
    });
});
