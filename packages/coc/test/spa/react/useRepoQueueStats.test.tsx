import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { useRepoQueueJobs, useRepoQueueStats } from '../../../src/server/spa/client/react/queue/hooks/useRepoQueueStats';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { workspaceReadSource } from '../../../src/server/spa/client/react/api/workspaceReads';

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>{children}</QueueProvider>
        </AppProvider>
    );
}

describe('useRepoQueueStats', () => {
    it('shares exact eligible rows/counts for every job type and the selected group only', () => {
        const { result, rerender } = renderHook(({ id }) => ({
            jobs: useRepoQueueJobs(id),
            stats: useRepoQueueStats(id),
            dispatch: useQueue().dispatch,
        }), { wrapper: Wrap, initialProps: { id: 'group-alpha' } });
        const types = ['chat', 'run-workflow', 'run-script', 'pr-classification', 'dream-run', 'unknown'];
        const jobs = types.map((type, i) => ({ id: `job-${i}`, type, payload: { processId: type === 'chat' ? undefined : 'not-a-followup' } }));
        act(() => {
            result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'group-alpha', queue: {
                running: [...jobs, { id: 'followup-r', type: 'chat', payload: { processId: 'parent' } }],
                queued: [...jobs, { id: 'followup-q', type: 'chat', payload: { processId: 'parent' } }],
            } });
            result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'member-beta', queue: {
                running: [{ id: 'member-job', type: 'chat' }], queued: [],
            } });
            result.current.dispatch({ type: 'SET_HISTORY', history: [{ id: 'completed-job', type: 'chat' }] });
        });
        expect(result.current.jobs).toEqual({ running: jobs, queued: jobs });
        expect(result.current.stats).toEqual({ running: jobs.length, queued: jobs.length });
        rerender({ id: 'member-beta' });
        expect(result.current.jobs.running.map(job => job.id)).toEqual(['member-job']);
        expect(result.current.stats).toEqual({ running: 1, queued: 0 });
        rerender({ id: 'missing-workspace' });
        expect(result.current.jobs).toEqual({ running: [], queued: [] });
    });

    it('rejects mismatched/untagged remote snapshots after server changes and preserves count parity', () => {
        const local = new CocClient({ baseUrl: '' });
        const remoteA = new CocClient({ baseUrl: 'http://127.0.0.1:4101' });
        const remoteB = new CocClient({ baseUrl: 'http://127.0.0.1:4102' });
        const { result, rerender } = renderHook(({ client }) => ({
            jobs: useRepoQueueJobs('ws-collision', client),
            stats: useRepoQueueStats('ws-collision', client),
            dispatch: useQueue().dispatch,
        }), { wrapper: Wrap, initialProps: { client: local } });
        const queue = { running: [{ id: 'active', type: 'chat' }], queued: [] };
        act(() => result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'ws-collision', queue }));
        expect(result.current.stats.running).toBe(1);
        rerender({ client: remoteA });
        expect(result.current.jobs.running).toEqual([]);
        expect(result.current.stats.running).toBe(0);
        act(() => result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'ws-collision', queue, source: workspaceReadSource(remoteA) }));
        expect(result.current.jobs.running).toEqual(queue.running);
        expect(result.current.stats.running).toBe(1);
        rerender({ client: remoteB });
        expect(result.current.jobs.running).toEqual([]);
        expect(result.current.stats.running).toBe(0);
        rerender({ client: local });
        expect(result.current.stats.running).toBe(0);
    });

    it('does not borrow the local snapshot when a concrete remote route is unresolved', () => {
        const client = new CocClient({ baseUrl: '' });
        const { result } = renderHook(() => ({
            jobs: useRepoQueueJobs('ws-alpha', client, 'remote:server-a:ws-alpha'),
            dispatch: useQueue().dispatch,
        }), { wrapper: Wrap });
        act(() => result.current.dispatch({ type: 'REPO_QUEUE_UPDATED', repoId: 'ws-alpha', queue: {
            running: [{ id: 'local-only', type: 'chat' }], queued: [],
        } }));
        expect(result.current.jobs).toEqual({ running: [], queued: [] });
    });

    it('returns zeros when no queue data exists for workspace', () => {
        const { result } = renderHook(() => useRepoQueueStats('nonexistent'), { wrapper: Wrap });
        expect(result.current).toEqual({ running: 0, queued: 0 });
    });

    it('counts all visible tasks (including chat) in running/queued', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-test');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-test',
                    queue: {
                        queued: [{ id: 'q1', type: 'run-workflow' }],
                        running: [{ id: 'r1', type: 'chat' }, { id: 'r2', type: 'chat' }],
                        stats: { queued: 1, running: 2, total: 3, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 2, queued: 1 });
    });

    it('includes chat tasks in running/queued counts', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-mixed');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-mixed',
                    queue: {
                        queued: [
                            { id: 'q1', type: 'run-workflow' },
                            { id: 'q2', type: 'chat' },
                            { id: 'q3', type: 'chat' },
                        ],
                        running: [
                            { id: 'r1', type: 'chat' },
                            { id: 'r2', type: 'run-workflow' },
                        ],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 2, queued: 3 });
    });

    it('returns all zeros when only empty arrays are provided', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-empty');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-empty',
                    queue: {
                        queued: [],
                        running: [],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 0, queued: 0 });
    });

    it('returns zeros for different workspace id', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-other');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-different',
                    queue: {
                        queued: [{ id: 'q1', type: 'run-workflow' }],
                        running: [{ id: 'r1', type: 'chat' }],
                        stats: { queued: 1, running: 1, total: 2, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 0, queued: 0 });
    });

    it('counts tasks without type as non-chat', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-notype');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-notype',
                    queue: {
                        queued: [{ id: 'q1' }],
                        running: [{ id: 'r1' }],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 1, queued: 1 });
    });

    it('excludes chat follow-up tasks from running/queued badge counts', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-followup');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-followup',
                    queue: {
                        queued: [{ id: 'q1', type: 'run-workflow' }],
                        running: [
                            { id: 'r1', type: 'chat' },
                            { id: 'r2', type: 'chat', payload: { processId: 'parent-1' } },
                            { id: 'r3', type: 'chat' },
                        ],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 2, queued: 1 });
    });

    it('excludes chat follow-up from queued badge count', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-followup-q');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-followup-q',
                    queue: {
                        queued: [
                            { id: 'q1', type: 'chat', payload: { processId: 'parent-q' } },
                            { id: 'q2', type: 'run-workflow' },
                        ],
                        running: [],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 0, queued: 1 });
    });

    it('re-activated parent chat task is counted in running badge', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-reactivated');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-reactivated',
                    queue: {
                        queued: [],
                        running: [
                            { id: 'parent-chat', type: 'chat' },
                            { id: 'followup-1', type: 'chat', payload: { processId: 'parent-chat' } },
                        ],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult!.running).toBe(1);
    });
});
