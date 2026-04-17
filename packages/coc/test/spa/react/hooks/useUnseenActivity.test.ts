/**
 * Tests for useUnseenActivity — tracks state-change-based unseen activity.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnseenActivity, computeUnseenCount, getItemSnapshot } from '../../../../src/server/spa/client/react/hooks/useUnseenActivity';

function makeTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'completed',
        completedAt: `2026-03-09T00:00:00Z-${id}`,
        displayName: `Task ${id}`,
    }));
}

function makeQueuedTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'queued',
        displayName: `Task ${id}`,
    }));
}

function makeRunningTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'running',
        displayName: `Task ${id}`,
    }));
}

function makeChatTask(id: string, status: string, completedAt?: string) {
    return {
        id,
        type: 'chat',
        status,
        completedAt,
        displayName: `Chat ${id}`,
    };
}

describe('getItemSnapshot', () => {
    it('returns status|completedAt for completed items', () => {
        expect(getItemSnapshot({ status: 'completed', completedAt: '2026-01-01T00:00:00Z' }))
            .toBe('completed|2026-01-01T00:00:00Z');
    });

    it('returns status| for non-terminal items', () => {
        expect(getItemSnapshot({ status: 'queued' })).toBe('queued|');
        expect(getItemSnapshot({ status: 'running' })).toBe('running|');
    });

    it('returns unknown| for items without status', () => {
        expect(getItemSnapshot({})).toBe('unknown|');
    });
});

describe('useUnseenActivity', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        localStorage.clear();
        mockFetchSeenMap.mockResolvedValue({});
        mockPatchSeenState.mockResolvedValue({});
        mockDeleteSeenEntry.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        localStorage.clear();
    });

    it('seeds all existing items as seen on first visit', () => {
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenProcessIds.has('a')).toBe(false);
            expect(result.current.unseenProcessIds.has('b')).toBe(true);
        });
        expect(mockFetchSeenMap).toHaveBeenCalledWith('ws1');
    });

    it('seeds all tasks as seen on first visit (empty server map)', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Should have called patchSeenState to seed all tasks
        await waitFor(() => {
            expect(mockPatchSeenState).toHaveBeenCalled();
        });
    });

    it('marks a new task as unseen when it appears after initial load', async () => {
        const history = makeTasks('a', 'b');
        // Server has both seen
        mockFetchSeenMap.mockResolvedValue({
            a: history[0].completedAt,
            b: history[1].completedAt,
        });

        const { result, rerender } = renderHook(
            ({ h }) => useUnseenActivity('ws1', h, null),
            { initialProps: { h: history } },
        );

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // New task appears
        const updated = [...history, ...makeTasks('c')];
        rerender({ h: updated });
        expect(result.current.unseenProcessIds.has('c')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
    });

    it('marks task as seen when markSeen is called', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for initialization + seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Simulate re-completion (new timestamp makes it unseen)
        const reCompleted = [{ ...history[0], completedAt: '2026-03-10T00:00:00Z' }];
        const { result: result2 } = renderHook(() => useUnseenActivity('ws1', reCompleted, null));

        // Since this is a new hook instance, we need the server to return the old map
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: result3 } = renderHook(() => useUnseenActivity('ws1', reCompleted, null));

        await waitFor(() => {
            expect(result3.current.unseenProcessIds.has('a')).toBe(true);
        });

        act(() => {
            result3.current.markSeen('a');
        });

        expect(result3.current.unseenProcessIds.has('a')).toBe(false);
    });

    it('markSeen calls patchSeenState API (debounced)', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = makeTasks('a');

        // Pre-set server state to make 'a' unseen
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(mockPatchSeenState).toHaveBeenCalled();
        });
        mockPatchSeenState.mockClear();

        // Make it unseen by changing completedAt
        // Actually, let's just test markSeen directly after rerender with new task
        const history2 = [...history, ...makeTasks('b')];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', history2, null));

        await waitFor(() => {
            expect(r2.current.unseenProcessIds.has('b')).toBe(true);
        });

        act(() => {
            r2.current.markSeen('b');
        });

        // Advance debounce timer
        act(() => {
            vi.advanceTimersByTime(200);
        });

        expect(mockPatchSeenState).toHaveBeenCalledWith('ws1', expect.arrayContaining([
            expect.objectContaining({ processId: 'b' }),
        ]));
    });

    it('auto-marks selected task as seen', async () => {
        const history = makeTasks('a', 'b');
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });

        const { result, rerender } = renderHook(
            ({ sel }) => useUnseenActivity('ws1', history, sel),
            { initialProps: { sel: null as string | null } },
        );

        await waitFor(() => {
            expect(result.current.unseenProcessIds.has('b')).toBe(true);
        });

        // Select task 'b' → auto-marks as seen
        rerender({ sel: 'b' });

        await waitFor(() => {
            expect(result.current.unseenProcessIds.has('b')).toBe(false);
        });
    });

    it('detects re-completion as unseen (different completedAt)', async () => {
        const history = makeTasks('a');
        const snapshot = getItemSnapshot(history[0]);
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: snapshot }));
        const { result, rerender } = renderHook(
            ({ h }) => useUnseenActivity('ws1', h, null),
            { initialProps: { h: history } },
        );

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Task 'a' completes again with different timestamp
        const reCompleted = [{ ...history[0], completedAt: '2026-03-09T01:00:00Z-new' }];
        rerender({ h: reCompleted });
        expect(result.current.unseenProcessIds.has('a')).toBe(true);
    });

    it('returns empty set for empty history', async () => {
        const { result } = renderHook(() => useUnseenActivity('ws1', [], null));

        await waitFor(() => {
            expect(mockFetchSeenMap).toHaveBeenCalled();
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBe(getItemSnapshot(history[0]));
    });

    it('loads previously persisted seen state', () => {
        const history = makeTasks('a', 'b');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: getItemSnapshot(history[0]),
        }));

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenTaskIds.has('b')).toBe(true);
    });

    it('uses separate storage per workspace', () => {
        const history = makeTasks('a');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: getItemSnapshot(history[0]),
        }));

        const { result: r1 } = renderHook(() => useUnseenActivity('ws1', history, null));
        const { result: r2 } = renderHook(() => useUnseenActivity('ws2', history, null));

        // ws1 has prior state, 'a' is seen
        expect(r1.current.unseenTaskIds.has('a')).toBe(false);
        // ws2 has no prior state, first visit seeds all as seen
        expect(r2.current.unseenTaskIds.has('a')).toBe(false);
    });

    it('returns empty set for empty history', () => {
        const { result } = renderHook(() => useUnseenActivity('ws1', [], null));
        expect(result.current.unseenCount).toBe(0);
        expect(result.current.unseenProcessIds.size).toBe(0);
    });

    it('tracks queued items as unseen when they appear', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const queued = makeQueuedTasks('x');
        const { result } = renderHook(() =>
            useUnseenActivity('ws1', [], null, queued, []),
        );
        expect(result.current.unseenTaskIds.has('x')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
    });

    it('detects state change from queued to running', () => {
        const queued = makeQueuedTasks('a');
        const snapshot = getItemSnapshot(queued[0]);
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: snapshot }));

        const { result, rerender } = renderHook(
            ({ q, r }) => useUnseenActivity('ws1', [], null, q, r),
            { initialProps: { q: queued, r: [] as any[] } },
        );

        // Initially seen (snapshot matches)
        expect(result.current.unseenTaskIds.has('a')).toBe(false);

        // Task moves to running
        const running = makeRunningTasks('a');
        rerender({ q: [], r: running });
        expect(result.current.unseenTaskIds.has('a')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
    });

    it('detects state change from running to completed', () => {
        const running = makeRunningTasks('a');
        const snapshot = getItemSnapshot(running[0]);
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: snapshot }));

        const { result, rerender } = renderHook(
            ({ r, h }) => useUnseenActivity('ws1', h, null, [], r),
            { initialProps: { r: running, h: [] as any[] } },
        );

        expect(result.current.unseenTaskIds.has('a')).toBe(false);

        // Task completes
        const history = makeTasks('a');
        rerender({ r: [], h: history });
        expect(result.current.unseenTaskIds.has('a')).toBe(true);
    });

    it('marks all tasks as seen when markAllSeen is called', async () => {
        const history = makeTasks('a', 'b', 'c');
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Make some unseen by simulating new completions
        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', newHistory, null));

    it('markAllSeen covers queued and running items too', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const queued = makeQueuedTasks('a');
        const running = makeRunningTasks('b');
        const history = makeTasks('c');

        const { result } = renderHook(() =>
            useUnseenActivity('ws1', history, null, queued, running),
        );

        expect(result.current.unseenCount).toBe(3);

        act(() => {
            result.current.markAllSeen();
        });

        expect(result.current.unseenCount).toBe(0);
    });

    it('markAllSeen persists to localStorage', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markAllSeen();
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBe(getItemSnapshot(history[0]));
        expect(stored['b']).toBe(getItemSnapshot(history[1]));
    });

    it('marks a seen task as unseen when markUnseen is called', async () => {
        const history = makeTasks('a', 'b');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: getItemSnapshot(history[0]),
            b: getItemSnapshot(history[1]),
        }));

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        act(() => {
            result.current.markUnseen('a');
        });

        expect(result.current.unseenProcessIds.has('a')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
        expect(result.current.unseenProcessIds.has('b')).toBe(false);
    });

    it('markUnseen calls deleteSeenEntry API', async () => {
        const history = makeTasks('a');
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        act(() => {
            result.current.markUnseen('a');
        });

        expect(mockDeleteSeenEntry).toHaveBeenCalledWith('ws1', 'a');
    });

    it('markUnseen is a no-op for a task not in seen map', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        mockDeleteSeenEntry.mockClear();

        // markUnseen on already-unseen should not call API after unseeding via recompletion
        // Actually, after seeding all are seen. Let's test with a truly unseen task
        const history2 = [...history, ...makeTasks('b')];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', history2, null));

        await waitFor(() => {
            expect(r2.current.unseenProcessIds.has('b')).toBe(true);
        });

        act(() => {
            r2.current.markUnseen('b'); // 'b' is already unseen (not in seen map)
        });

        expect(mockDeleteSeenEntry).not.toHaveBeenCalled();
    });

    it('markTasksSeen marks only the provided tasks as seen', async () => {
        const history = makeTasks('a', 'b', 'c');
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for seeding, then change completedAt to make them unseen
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', newHistory, null));

        await waitFor(() => {
            expect(r2.current.unseenCount).toBe(3);
        });

        act(() => {
            r2.current.markTasksSeen([newHistory[0], newHistory[1]]);
        });

        expect(r2.current.unseenProcessIds.has('a')).toBe(false);
        expect(r2.current.unseenProcessIds.has('b')).toBe(false);
        expect(r2.current.unseenProcessIds.has('c')).toBe(true);
        expect(r2.current.unseenCount).toBe(1);
    });

    it('markTasksSeen is a no-op when given an empty list', async () => {
        const history = makeTasks('a', 'b');
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Wait for seeding, then make unseen
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', newHistory, null));

        await waitFor(() => {
            expect(r2.current.unseenCount).toBe(2);
        });

        act(() => {
            r2.current.markTasksSeen([]);
        });

        expect(r2.current.unseenCount).toBe(2);
    });

    it('markTasksSeen ignores tasks without completedAt', async () => {
        const history = makeTasks('a');
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = [{ ...history[0], completedAt: history[0].completedAt + '-v2' }];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenActivity('ws1', newHistory, null));

        await waitFor(() => {
            expect(r2.current.unseenProcessIds.has('a')).toBe(true);
        });

        mockPatchSeenState.mockClear();
        act(() => {
            r2.current.markTasksSeen([{ id: 'a' }]); // no completedAt
        });

        // Should remain unseen since completedAt is missing
        expect(r2.current.unseenProcessIds.has('a')).toBe(true);
    });

    it('does NOT auto-mark when task completes while selected (running → history)', async () => {
        // Start with task selected but not in history (it's running).
        // Use non-empty seen map so first-visit seeding doesn't fire.
        mockFetchSeenMap.mockResolvedValue({ other: '2026-01-01T00:00:00Z' });
        const { result, rerender } = renderHook(
            ({ h, sel }) => useUnseenActivity('ws1', h, sel),
            { initialProps: { h: [] as any[], sel: 'a' } },
        );
        await waitFor(() => expect(result.current.unseenCount).toBe(0));

        // Task completes — appears in history while still selected
        const completed = makeTasks('a');
        rerender({ h: completed, sel: 'a' });

        // Should remain unseen (not auto-marked)
        expect(result.current.unseenProcessIds.has('a')).toBe(true);
    });

    it('auto-marks when user navigates to an already-completed task', async () => {
        const history = makeTasks('a', 'b');
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result, rerender } = renderHook(
            ({ sel }) => useUnseenActivity('ws1', history, sel),
            { initialProps: { sel: null as string | null } },
        );
        await waitFor(() => expect(result.current.unseenProcessIds.has('b')).toBe(true));

        // User clicks task 'b' → selectedTaskId changes → auto-mark fires
        rerender({ sel: 'b' });
        await waitFor(() => expect(result.current.unseenProcessIds.has('b')).toBe(false));
    });

    describe('localStorage migration', () => {
        it('migrates localStorage data to server on first load', async () => {
            const history = makeTasks('a', 'b');
            const localData = { a: history[0].completedAt };
            localStorage.setItem('coc-unseen-ws1', JSON.stringify(localData));
            mockFetchSeenMap.mockResolvedValue({});

            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                // 'a' should be seen (migrated from localStorage)
                expect(result.current.unseenProcessIds.has('a')).toBe(false);
            });

            // Should have called patchSeenState with the migrated entries
            expect(mockPatchSeenState).toHaveBeenCalledWith('ws1', expect.arrayContaining([
                { processId: 'a', seenAt: history[0].completedAt },
            ]));

            // localStorage key should be removed after migration
            expect(localStorage.getItem('coc-unseen-ws1')).toBeNull();
        });

        it('merges localStorage with existing server data', async () => {
            const history = makeTasks('a', 'b');
            const localData = { b: history[1].completedAt };
            localStorage.setItem('coc-unseen-ws1', JSON.stringify(localData));
            mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });

            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(false);
                expect(result.current.unseenProcessIds.has('b')).toBe(false);
            });
        });
    });

    it('markUnseen persists to localStorage', () => {
        const history = makeTasks('a', 'b');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenCount).toBe(0);

        act(() => {
            result.current.markUnseen('a');
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBeUndefined();
        expect(stored['b']).toBe(getItemSnapshot(history[1]));
    });

    it('markUnseen is a no-op for a task not in seen map', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        // Should still render without crashing — starts with empty map
        await waitFor(() => {
            // After error, seeding should make all seen
            expect(result.current.unseenCount).toBe(0);
        });
    });

    describe('endTime (ProcessHistoryItem) support', () => {
        it('treats tasks with endTime as completed', async () => {
            const history = makeHistoryTasks('a', 'b');
            const isoA = new Date(history[0].endTime).toISOString();
            mockFetchSeenMap.mockResolvedValue({ a: isoA });

            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(false);
                expect(result.current.unseenProcessIds.has('b')).toBe(true);
            });
        });

        it('seeds endTime tasks on first visit', async () => {
            mockFetchSeenMap.mockResolvedValue({});
            const history = makeHistoryTasks('a', 'b');
            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenCount).toBe(0);
            });
            expect(mockPatchSeenState).toHaveBeenCalled();
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBe(getItemSnapshot(history[0]));
        expect(stored['b']).toBeUndefined();
        expect(stored['c']).toBeUndefined();
    });

            const { result, rerender } = renderHook(
                ({ sel }) => useUnseenActivity('ws1', history, sel),
                { initialProps: { sel: null as string | null } },
            );

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('b')).toBe(true);
            });

            rerender({ sel: 'b' });

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('b')).toBe(false);
            });
        });

        it('markSeen works with endTime tasks', async () => {
            const history = makeHistoryTasks('a');
            const isoA = new Date(history[0].endTime).toISOString();
            // Make 'a' unseen by returning a different seenAt
            mockFetchSeenMap.mockResolvedValue({ a: 'old-value' });
            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

    it('markTasksSeen is a no-op for tasks without status', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markTasksSeen([{ id: 'a' }]); // no status
        });

        it('markAllSeen works with endTime tasks', async () => {
            const history = makeHistoryTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({ a: 'old' });
            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenCount).toBeGreaterThan(0);
            });

            act(() => {
                result.current.markAllSeen();
            });

            expect(result.current.unseenCount).toBe(0);
        });

        it('markTasksSeen works with endTime tasks', async () => {
            const history = makeHistoryTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({ a: 'old' });
            const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(true);
            });

            act(() => {
                result.current.markTasksSeen([history[0]]);
            });

            expect(result.current.unseenProcessIds.has('a')).toBe(false);
            expect(result.current.unseenProcessIds.has('b')).toBe(true);
        });
    });
});

describe('getTaskCompletedAtIso', () => {
    it('returns completedAt when present', () => {
        expect(getTaskCompletedAtIso({ completedAt: '2026-01-01T00:00:00Z' }))
            .toBe('2026-01-01T00:00:00Z');
    });

    it('converts endTime (ms epoch) to ISO string', () => {
        const ms = 1741478400000;
        expect(getTaskCompletedAtIso({ endTime: ms }))
            .toBe(new Date(ms).toISOString());
    });

    it('prefers completedAt over endTime', () => {
        expect(getTaskCompletedAtIso({ completedAt: 'preferred', endTime: 1741478400000 }))
            .toBe('preferred');
    });

    it('returns undefined when neither field is present', () => {
        expect(getTaskCompletedAtIso({})).toBeUndefined();
        expect(getTaskCompletedAtIso({ status: 'running' })).toBeUndefined();
    });

    it('returns undefined for falsy completedAt and endTime', () => {
        expect(getTaskCompletedAtIso({ completedAt: '', endTime: 0 })).toBeUndefined();
    });
});
