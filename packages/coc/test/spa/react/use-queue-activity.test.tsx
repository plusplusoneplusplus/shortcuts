/**
 * Tests for the useQueueActivity hook rendered inside QueueProvider + AppProvider.
 * Tests the hook itself with real context (unlike useQueueActivity.test.ts which
 * only tests extracted pure computation logic).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { useQueueActivity } from '../../../src/server/spa/client/react/hooks/useQueueActivity';

/**
 * Wrapper that provides both AppProvider and QueueProvider, then seeds
 * workspace and queue data via dispatched actions.
 */
function createWrapper(opts: {
    workspaces?: any[];
    queued?: any[];
    running?: any[];
    repoQueueMap?: Record<string, { queued?: any[]; running?: any[] }>;
}) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <AppProvider>
                <QueueProvider>
                    <Seeder {...opts}>{children}</Seeder>
                </QueueProvider>
            </AppProvider>
        );
    };
}

function Seeder({
    children,
    workspaces,
    queued,
    running,
    repoQueueMap,
}: {
    children: ReactNode;
    workspaces?: any[];
    queued?: any[];
    running?: any[];
    repoQueueMap?: Record<string, { queued?: any[]; running?: any[] }>;
}) {
    const { dispatch: appDispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();

    useEffect(() => {
        if (workspaces) {
            appDispatch({ type: 'WORKSPACES_LOADED', workspaces });
        }
        if (queued || running) {
            queueDispatch({ type: 'QUEUE_UPDATED', queue: { queued: queued || [], running: running || [], stats: {} } });
        }
        if (repoQueueMap) {
            for (const [repoId, data] of Object.entries(repoQueueMap)) {
                queueDispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId,
                    queue: { queued: data.queued || [], running: data.running || [], history: [], stats: {} },
                });
            }
        }
    }, []);

    return <>{children}</>;
}

describe('useQueueActivity — hook with context', () => {
    const TASKS_FOLDER = '/data/repos/abc/tasks';

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns empty fileMap and folderMap when queue is empty', () => {
        const wrapper = createWrapper({ workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }] });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({});
        expect(result.current.folderMap).toEqual({});
    });

    it('maps planFilePath to relative task path', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [{
                id: 'q1',
                payload: { planFilePath: '/data/repos/abc/tasks/feature1/task.plan.md' },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({ 'feature1/task.plan.md': 1 });
    });

    it('maps data.originalTaskPath to relative task path', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [{
                id: 'q1',
                payload: { data: { originalTaskPath: '/data/repos/abc/tasks/feature2/impl.md' } },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({ 'feature2/impl.md': 1 });
    });

    it('maps filePath to relative task path', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            running: [{
                id: 'r1',
                payload: { filePath: '/data/repos/abc/tasks/bug/fix.md' },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({ 'bug/fix.md': 1 });
    });

    it('ignores items with no matching workspace prefix', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [{
                id: 'q1',
                payload: { filePath: '/data/repos/def/tasks/task.md' },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({});
    });

    it('normalises Windows backslash paths', () => {
        const winFolder = 'C:\\Users\\dev\\.coc\\repos\\abc\\tasks';
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: 'C:\\Users\\dev\\project' }],
            queued: [{
                id: 'q1',
                payload: { planFilePath: 'C:\\Users\\dev\\.coc\\repos\\abc\\tasks\\feature\\task.md' },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', winFolder), { wrapper });
        expect(result.current.fileMap).toEqual({ 'feature/task.md': 1 });
    });

    it('counts multiple items for the same file path', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [
                { id: 'q1', payload: { planFilePath: '/data/repos/abc/tasks/feature/task.md' } },
                { id: 'q2', payload: { filePath: '/data/repos/abc/tasks/feature/task.md' } },
            ],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap['feature/task.md']).toBe(2);
    });

    it('builds folderMap with ancestor folder counts', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [{
                id: 'q1',
                payload: { planFilePath: '/data/repos/abc/tasks/a/b/task.md' },
            }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.folderMap).toEqual({ 'a': 1, 'a/b': 1 });
    });

    it('combines queued and running items', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws1', rootPath: '/home/user/project' }],
            queued: [{ id: 'q1', payload: { planFilePath: '/data/repos/abc/tasks/a/task1.md' } }],
            running: [{ id: 'r1', payload: { planFilePath: '/data/repos/abc/tasks/a/task2.md' } }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap['a/task1.md']).toBe(1);
        expect(result.current.fileMap['a/task2.md']).toBe(1);
        expect(result.current.folderMap['a']).toBe(2);
    });

    it('returns empty maps when workspace is not found', () => {
        const wrapper = createWrapper({
            workspaces: [{ id: 'ws-other', rootPath: '/other' }],
            queued: [{ id: 'q1', payload: { planFilePath: '/data/repos/abc/tasks/task.md' } }],
        });
        const { result } = renderHook(() => useQueueActivity('ws1', TASKS_FOLDER), { wrapper });
        expect(result.current.fileMap).toEqual({});
        expect(result.current.folderMap).toEqual({});
    });
});
