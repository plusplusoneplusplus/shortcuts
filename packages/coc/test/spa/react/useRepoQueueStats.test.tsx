/**
 * Tests for useRepoQueueStats hook.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { useRepoQueueStats } from '../../../src/server/spa/client/react/hooks/useRepoQueueStats';

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>{children}</QueueProvider>
        </AppProvider>
    );
}

describe('useRepoQueueStats', () => {
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
                        queued: [{ id: 'q1', type: 'run-pipeline' }],
                        running: [{ id: 'r1', type: 'follow-prompt' }, { id: 'r2', type: 'chat' }],
                        stats: { queued: 1, running: 2, completed: 0, failed: 0, cancelled: 0, total: 3, isPaused: false, isDraining: false },
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
                            { id: 'q1', type: 'run-pipeline' },
                            { id: 'q2', type: 'chat' },
                            { id: 'q3', type: 'chat' },
                        ],
                        running: [
                            { id: 'r1', type: 'chat' },
                            { id: 'r2', type: 'code-review' },
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
                        queued: [{ id: 'q1', type: 'run-pipeline' }],
                        running: [{ id: 'r1', type: 'chat' }],
                        stats: { queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0, total: 2, isPaused: false, isDraining: false },
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
                        queued: [{ id: 'q1', type: 'run-pipeline' }],
                        running: [
                            { id: 'r1', type: 'chat' },
                            { id: 'r2', type: 'chat', payload: { processId: 'parent-1' } },
                            { id: 'r3', type: 'follow-prompt' },
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
                            { id: 'q2', type: 'run-pipeline' },
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
                        history: [
                            { id: 'h1', type: 'follow-prompt' },
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
