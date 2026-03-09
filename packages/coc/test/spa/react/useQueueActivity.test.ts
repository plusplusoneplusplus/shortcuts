/**
 * Tests for useQueueActivity hook — folderMap aggregation,
 * repoQueueMap preference logic, and extractTaskPath with WS-shaped items.
 *
 * Since the hook depends on React context (useQueue, useApp), we test the
 * pure computation logic extracted from the hook source.
 */

import { describe, it, expect } from 'vitest';
import type { QueueActivityMap, QueueFolderActivityMap } from '../../../src/server/spa/client/react/hooks/useQueueActivity';

/**
 * Replicates the folderMap computation logic from useQueueActivity.
 */
function computeFolderMap(fileMap: QueueActivityMap): QueueFolderActivityMap {
    const folderMap: QueueFolderActivityMap = {};
    for (const [rel, count] of Object.entries(fileMap)) {
        const parts = rel.split('/');
        for (let i = 1; i < parts.length; i++) {
            const prefix = parts.slice(0, i).join('/');
            folderMap[prefix] = (folderMap[prefix] || 0) + count;
        }
    }
    return folderMap;
}

describe('useQueueActivity — folderMap aggregation', () => {
    it('returns empty folderMap for empty fileMap', () => {
        expect(computeFolderMap({})).toEqual({});
    });

    it('returns empty folderMap for root-level files (no folder prefix)', () => {
        expect(computeFolderMap({ 'task.md': 1 })).toEqual({});
    });

    it('aggregates single nested file to its ancestor folders', () => {
        const folderMap = computeFolderMap({ 'a/b/c.md': 1 });
        expect(folderMap).toEqual({ 'a': 1, 'a/b': 1 });
    });

    it('aggregates multiple files under the same parent folder', () => {
        const folderMap = computeFolderMap({
            'a/b/x.md': 1,
            'a/c/y.md': 1,
        });
        expect(folderMap['a']).toBe(2);
        expect(folderMap['a/b']).toBe(1);
        expect(folderMap['a/c']).toBe(1);
    });

    it('handles counts greater than 1', () => {
        const folderMap = computeFolderMap({ 'a/b/file.md': 3 });
        expect(folderMap['a']).toBe(3);
        expect(folderMap['a/b']).toBe(3);
    });

    it('handles deeply nested paths', () => {
        const folderMap = computeFolderMap({ 'a/b/c/d/e.md': 1 });
        expect(folderMap).toEqual({
            'a': 1,
            'a/b': 1,
            'a/b/c': 1,
            'a/b/c/d': 1,
        });
    });

    it('correctly sums across files in different subtrees', () => {
        const folderMap = computeFolderMap({
            'feature1/task-a.md': 1,
            'feature1/sub/task-b.md': 2,
            'feature2/task-c.md': 1,
        });
        expect(folderMap['feature1']).toBe(3); // 1 + 2
        expect(folderMap['feature1/sub']).toBe(2);
        expect(folderMap['feature2']).toBe(1);
    });
});

// ── repoQueueMap preference logic ──────────────────────────────────────

/**
 * Replicates the activeItems selection logic from useQueueActivity.
 * When repoQueueMap has an entry for the given wsId, its queued/running
 * arrays are preferred over the top-level arrays.
 */
function resolveActiveItems(
    queueState: {
        queued?: any[];
        running?: any[];
        repoQueueMap?: Record<string, { queued?: any[]; running?: any[] }>;
    },
    wsId: string,
): any[] {
    const repoEntry = queueState.repoQueueMap?.[wsId];
    const queued = repoEntry?.queued ?? queueState.queued ?? [];
    const running = repoEntry?.running ?? queueState.running ?? [];
    return [...queued, ...running];
}

describe('useQueueActivity — repoQueueMap preference', () => {
    const itemA = { id: 'a' };
    const itemB = { id: 'b' };
    const itemC = { id: 'c' };
    const itemD = { id: 'd' };

    it('falls back to top-level arrays when repoQueueMap has no entry for wsId', () => {
        const items = resolveActiveItems(
            { queued: [itemA], running: [itemB], repoQueueMap: {} },
            'ws-1',
        );
        expect(items).toEqual([itemA, itemB]);
    });

    it('prefers repoQueueMap entry over top-level arrays', () => {
        const items = resolveActiveItems(
            {
                queued: [itemA],
                running: [itemB],
                repoQueueMap: {
                    'ws-1': { queued: [itemC], running: [itemD] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemC, itemD]);
    });

    it('returns repo items even when top-level arrays are empty', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [itemA], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemA]);
    });

    it('returns empty when both repo entry and top-level are empty', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([]);
    });

    it('falls back to top-level when repoQueueMap is undefined', () => {
        const items = resolveActiveItems(
            { queued: [itemA], running: [] },
            'ws-1',
        );
        expect(items).toEqual([itemA]);
    });

    it('returns empty when everything is undefined/empty', () => {
        const items = resolveActiveItems({}, 'ws-1');
        expect(items).toEqual([]);
    });

    it('does not mix repo and top-level data for the same wsId', () => {
        // When a repo entry exists, top-level arrays should be completely ignored
        const items = resolveActiveItems(
            {
                queued: [itemA, itemB],
                running: [itemC],
                repoQueueMap: {
                    'ws-1': { queued: [itemD], running: [] },
                },
            },
            'ws-1',
        );
        expect(items).toEqual([itemD]);
        expect(items).not.toContainEqual(itemA);
        expect(items).not.toContainEqual(itemB);
        expect(items).not.toContainEqual(itemC);
    });

    it('selects correct repo entry when multiple repos exist', () => {
        const items = resolveActiveItems(
            {
                queued: [],
                running: [],
                repoQueueMap: {
                    'ws-1': { queued: [itemA], running: [] },
                    'ws-2': { queued: [itemB], running: [itemC] },
                },
            },
            'ws-2',
        );
        expect(items).toEqual([itemB, itemC]);
    });
});

// ── extractTaskPath logic (replicated from hook source) ────────────────

function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function extractTaskPath(
    item: any,
    wsRootPath: string,
    tasksFolder: string,
): string | null {
    const payload = item?.payload;
    if (!payload) return null;

    const candidates: string[] = [];

    if (typeof payload.planFilePath === 'string') {
        candidates.push(payload.planFilePath);
    }
    if (payload.data && typeof payload.data.originalTaskPath === 'string') {
        candidates.push(payload.data.originalTaskPath);
    }
    if (typeof payload.filePath === 'string') {
        candidates.push(payload.filePath);
    }

    const normalizedFolder = normalizePath(tasksFolder);
    const isAbsolute = normalizedFolder.startsWith('/') || /^[A-Za-z]:/.test(normalizedFolder);
    if (!wsRootPath && !isAbsolute) return null;
    const prefix = isAbsolute
        ? normalizedFolder + '/'
        : normalizePath(wsRootPath) + '/' + normalizedFolder + '/';

    for (const raw of candidates) {
        const norm = normalizePath(raw);
        if (prefix && norm.startsWith(prefix)) {
            const rel = norm.slice(prefix.length);
            if (rel) return rel;
        }
    }

    return null;
}

describe('extractTaskPath — with WS broadcast-shaped items', () => {
    const wsRoot = '/home/user/project';
    const tasksFolder = '/data/repos/abc/tasks';

    it('returns null when item has no payload', () => {
        expect(extractTaskPath({ id: '1' }, wsRoot, tasksFolder)).toBeNull();
        expect(extractTaskPath({ id: '2', payload: undefined }, wsRoot, tasksFolder)).toBeNull();
    });

    it('extracts path from payload.planFilePath (WS shape)', () => {
        const item = {
            id: '1',
            payload: {
                planFilePath: '/data/repos/abc/tasks/queue-refresh/fix.md',
            },
        };
        expect(extractTaskPath(item, wsRoot, tasksFolder)).toBe('queue-refresh/fix.md');
    });

    it('extracts path from payload.data.originalTaskPath (WS shape)', () => {
        const item = {
            id: '2',
            payload: {
                data: {
                    originalTaskPath: '/data/repos/abc/tasks/feat/plan.md',
                },
            },
        };
        expect(extractTaskPath(item, wsRoot, tasksFolder)).toBe('feat/plan.md');
    });

    it('extracts path from payload.filePath (WS shape)', () => {
        const item = {
            id: '3',
            payload: {
                filePath: '/data/repos/abc/tasks/bugfix/issue.md',
            },
        };
        expect(extractTaskPath(item, wsRoot, tasksFolder)).toBe('bugfix/issue.md');
    });

    it('prefers planFilePath over data.originalTaskPath and filePath', () => {
        const item = {
            id: '4',
            payload: {
                planFilePath: '/data/repos/abc/tasks/a/plan.md',
                filePath: '/data/repos/abc/tasks/b/other.md',
                data: {
                    originalTaskPath: '/data/repos/abc/tasks/c/orig.md',
                },
            },
        };
        expect(extractTaskPath(item, wsRoot, tasksFolder)).toBe('a/plan.md');
    });

    it('handles Windows-style backslash paths', () => {
        const winTasksFolder = 'C:\\Users\\dev\\.coc\\repos\\abc\\tasks';
        const item = {
            id: '5',
            payload: {
                planFilePath: 'C:\\Users\\dev\\.coc\\repos\\abc\\tasks\\feat\\spec.md',
            },
        };
        expect(extractTaskPath(item, 'C:\\Users\\dev\\project', winTasksFolder)).toBe('feat/spec.md');
    });

    it('returns null when payload fields are empty objects or wrong types', () => {
        expect(extractTaskPath({ id: '6', payload: {} }, wsRoot, tasksFolder)).toBeNull();
        expect(extractTaskPath({ id: '7', payload: { planFilePath: 123 } }, wsRoot, tasksFolder)).toBeNull();
        expect(extractTaskPath({ id: '8', payload: { data: {} } }, wsRoot, tasksFolder)).toBeNull();
    });

    it('returns null when path does not match workspace tasks folder', () => {
        const item = {
            id: '9',
            payload: {
                planFilePath: '/data/repos/def/tasks/x/y.md',
            },
        };
        expect(extractTaskPath(item, wsRoot, tasksFolder)).toBeNull();
    });

    it('works with minimal WS broadcast payload (only path fields, no large content)', () => {
        // Simulates the exact shape mapQueued now produces
        const wsItem = {
            id: 'task-1',
            repoId: 'repo-1',
            type: 'pipeline',
            priority: 1,
            status: 'queued',
            displayName: 'Test Task',
            createdAt: '2025-01-01T00:00:00Z',
            workingDirectory: '/home/user/project',
            payload: {
                planFilePath: '/data/repos/abc/tasks/feature/impl.md',
                filePath: undefined,
                workingDirectory: '/home/user/project',
                data: undefined,
            },
        };
        expect(extractTaskPath(wsItem, wsRoot, tasksFolder)).toBe('feature/impl.md');
    });
});

// ── mapQueued payload passthrough ──────────────────────────────────────

/**
 * Replicates the mapQueued function from server/index.ts to verify
 * that payload path fields are preserved in WS broadcasts.
 */
function mapQueued(t: any) {
    return {
        id: t.id, repoId: t.repoId, type: t.type, priority: t.priority,
        status: t.status, displayName: t.displayName, createdAt: t.createdAt,
        workingDirectory: (t.payload as any)?.workingDirectory,
        payload: {
            kind: (t.payload as any)?.kind,
            mode: (t.payload as any)?.mode,
            prompt: (t.payload as any)?.prompt,
            planFilePath: (t.payload as any)?.planFilePath,
            filePath: (t.payload as any)?.filePath,
            workingDirectory: (t.payload as any)?.workingDirectory,
            data: (t.payload as any)?.data ? {
                originalTaskPath: (t.payload as any)?.data?.originalTaskPath,
            } : undefined,
        },
    };
}

describe('mapQueued — payload passthrough', () => {
    it('includes payload.planFilePath in mapped output', () => {
        const task = {
            id: '1', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'My Task', createdAt: '2025-01-01',
            payload: {
                planFilePath: '/data/repos/abc/tasks/feat/plan.md',
                workingDirectory: '/workspace',
                prompt: 'This is a very long prompt that should NOT be broadcast',
            },
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.planFilePath).toBe('/data/repos/abc/tasks/feat/plan.md');
        expect(mapped.payload.workingDirectory).toBe('/workspace');
        // Prompt is now included for preview text in the WS broadcast
        expect(mapped.payload.prompt).toBe('This is a very long prompt that should NOT be broadcast');
    });

    it('includes payload.kind and payload.mode for chat tasks', () => {
        const task = {
            id: 'chat-1', repoId: 'r1', type: 'chat', priority: 1,
            status: 'running', displayName: 'Ask task', createdAt: '2025-01-01',
            payload: { kind: 'chat', mode: 'ask', prompt: 'hello', workingDirectory: '/ws' },
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.kind).toBe('chat');
        expect(mapped.payload.mode).toBe('ask');
        expect(mapped.payload.prompt).toBe('hello');
    });

    it('includes payload.filePath in mapped output', () => {
        const task = {
            id: '2', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'Task 2', createdAt: '2025-01-01',
            payload: { filePath: '/data/repos/abc/tasks/bugfix/fix.md' },
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.filePath).toBe('/data/repos/abc/tasks/bugfix/fix.md');
    });

    it('includes payload.data.originalTaskPath in mapped output', () => {
        const task = {
            id: '3', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'Task 3', createdAt: '2025-01-01',
            payload: {
                workingDirectory: '/workspace',
                data: {
                    originalTaskPath: '/data/repos/abc/tasks/refactor/plan.md',
                    someOtherLargeField: 'should not appear',
                },
            },
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.data?.originalTaskPath).toBe('/data/repos/abc/tasks/refactor/plan.md');
        // Only originalTaskPath should be hoisted, not other data fields
        expect((mapped.payload.data as any).someOtherLargeField).toBeUndefined();
    });

    it('handles task with no payload gracefully', () => {
        const task = {
            id: '4', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'Task 4', createdAt: '2025-01-01',
        };
        const mapped = mapQueued(task);
        expect(mapped.payload).toEqual({
            kind: undefined,
            mode: undefined,
            prompt: undefined,
            planFilePath: undefined,
            filePath: undefined,
            workingDirectory: undefined,
            data: undefined,
        });
        expect(mapped.workingDirectory).toBeUndefined();
    });

    it('handles task with empty payload', () => {
        const task = {
            id: '5', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'Task 5', createdAt: '2025-01-01',
            payload: {},
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.planFilePath).toBeUndefined();
        expect(mapped.payload.data).toBeUndefined();
    });

    it('does not include data when payload.data is absent', () => {
        const task = {
            id: '6', repoId: 'r1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'Task 6', createdAt: '2025-01-01',
            payload: { planFilePath: '/workspace/task.md' },
        };
        const mapped = mapQueued(task);
        expect(mapped.payload.data).toBeUndefined();
    });

    it('preserves all base fields from mapQueued', () => {
        const task = {
            id: 'abc', repoId: 'repo-1', type: 'pipeline', priority: 5,
            status: 'running', displayName: 'Full Task', createdAt: '2025-06-15T12:00:00Z',
            startedAt: '2025-06-15T12:01:00Z',
            payload: { workingDirectory: '/ws', planFilePath: '/data/repos/abc/tasks/x.md' },
        };
        const mapped = mapQueued(task);
        expect(mapped.id).toBe('abc');
        expect(mapped.repoId).toBe('repo-1');
        expect(mapped.type).toBe('pipeline');
        expect(mapped.priority).toBe(5);
        expect(mapped.status).toBe('running');
        expect(mapped.displayName).toBe('Full Task');
        expect(mapped.createdAt).toBe('2025-06-15T12:00:00Z');
        expect(mapped.workingDirectory).toBe('/ws');
    });

    it('end-to-end: extractTaskPath works with mapQueued output', () => {
        const fullTask = {
            id: 'e2e-1', repoId: 'repo-1', type: 'pipeline', priority: 1,
            status: 'queued', displayName: 'E2E Task', createdAt: '2025-01-01',
            payload: {
                planFilePath: '/data/repos/abc/tasks/queue-refresh/fix.md',
                workingDirectory: '/home/user/project',
                prompt: 'Run the fix',
            },
        };
        const wsItem = mapQueued(fullTask);
        const relPath = extractTaskPath(wsItem, '/home/user/project', '/data/repos/abc/tasks');
        expect(relPath).toBe('queue-refresh/fix.md');
    });
});
