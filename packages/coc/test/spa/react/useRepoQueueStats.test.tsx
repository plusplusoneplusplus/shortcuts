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
        expect(result.current).toEqual({ running: 0, queued: 0 });
    });

    it('returns stats from repoQueueMap when data exists', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-test');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-test',
                    queue: {
                        queued: [{ id: 'q1' }],
                        running: [{ id: 'r1' }, { id: 'r2' }],
                        stats: { queued: 1, running: 2, completed: 0, failed: 0, cancelled: 0, total: 3, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 2, queued: 1 });
    });

    it('falls back to array lengths when stats are missing', () => {
        let hookResult: ReturnType<typeof useRepoQueueStats> | null = null;

        function Inner() {
            const { dispatch } = useQueue();
            hookResult = useRepoQueueStats('ws-fallback');
            useEffect(() => {
                dispatch({
                    type: 'REPO_QUEUE_UPDATED',
                    repoId: 'ws-fallback',
                    queue: {
                        queued: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
                        running: [{ id: 'r1' }],
                        stats: {} as any,
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 1, queued: 3 });
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
                        queued: [{ id: 'q1' }],
                        running: [{ id: 'r1' }],
                        stats: { queued: 1, running: 1, completed: 0, failed: 0, cancelled: 0, total: 2, isPaused: false, isDraining: false },
                    },
                });
            }, [dispatch]);
            return null;
        }

        render(<Wrap><Inner /></Wrap>);
        expect(hookResult).toEqual({ running: 0, queued: 0 });
    });
});
