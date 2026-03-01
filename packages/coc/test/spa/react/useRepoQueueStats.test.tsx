/**
 * Tests for useRepoQueueStats hook.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
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
        expect(result.current).toEqual({ running: 0, queued: 0, chatRunning: 0, chatQueued: 0, chatPending: 0 });
    });

    it('returns non-chat counts for running/queued and chat counts separately', () => {
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
        expect(hookResult).toEqual({ running: 1, queued: 1, chatRunning: 1, chatQueued: 0, chatPending: 1 });
    });

    it('excludes chat tasks from running/queued counts', () => {
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
        expect(hookResult).toEqual({ running: 1, queued: 1, chatRunning: 1, chatQueued: 2, chatPending: 3 });
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
        expect(hookResult).toEqual({ running: 0, queued: 0, chatRunning: 0, chatQueued: 0, chatPending: 0 });
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
        expect(hookResult).toEqual({ running: 0, queued: 0, chatRunning: 0, chatQueued: 0, chatPending: 0 });
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
        expect(hookResult).toEqual({ running: 1, queued: 1, chatRunning: 0, chatQueued: 0, chatPending: 0 });
    });

    it('computes chatPending as chatRunning + chatQueued (excludes history)', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-history');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-history',
                    queue: {
                        queued: [{ id: 'q1', type: 'chat' }],
                        running: [{ id: 'r1', type: 'chat' }],
                        history: [
                            { id: 'h1', type: 'chat' },
                            { id: 'h2', type: 'chat' },
                            { id: 'h3', type: 'run-pipeline' },
                        ],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 0, queued: 0, chatRunning: 1, chatQueued: 1, chatPending: 2 });
    });

    it('returns chatPending 0 when no chat tasks exist in any array', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-nochat');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-nochat',
                    queue: {
                        queued: [{ id: 'q1', type: 'run-pipeline' }],
                        running: [{ id: 'r1', type: 'follow-prompt' }],
                        history: [{ id: 'h1', type: 'run-pipeline' }],
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 1, queued: 1, chatRunning: 0, chatQueued: 0, chatPending: 0 });
    });
});
