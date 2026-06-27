/**
 * Tests for useUnseenChat — tracks unseen completed tasks in the activity tab.
 *
 * The hook now uses server-side persistence via seenStateApi.
 * Tests mock the API layer and verify optimistic local state updates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUnseenChat, getTaskCompletedAtIso } from '../../../../src/server/spa/client/react/features/chat/hooks/useUnseenChat';
import * as seenStateApi from '../../../../src/server/spa/client/react/hooks/preferences/seenStateApi';

// Mock the API module
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/seenStateApi', () => ({
    fetchSeenMap: vi.fn(),
    patchSeenState: vi.fn(),
    deleteSeenEntry: vi.fn(),
    fetchUnseenCount: vi.fn(),
}));

const mockFetchSeenMap = vi.mocked(seenStateApi.fetchSeenMap);
const mockPatchSeenState = vi.mocked(seenStateApi.patchSeenState);
const mockDeleteSeenEntry = vi.mocked(seenStateApi.deleteSeenEntry);

function makeTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'completed',
        completedAt: `2026-03-09T00:00:00Z-${id}`,
        displayName: `Task ${id}`,
    }));
}

/** Creates ProcessHistoryItem-style tasks with endTime (ms epoch) instead of completedAt. */
function makeHistoryTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'completed',
        endTime: 1741478400000 + ids.indexOf(id) * 1000, // distinct ms epochs
        displayName: `Task ${id}`,
    }));
}

describe('useUnseenChat', () => {
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

    it('loads seen map from server on mount', async () => {
        const serverMap = { a: '2026-03-09T00:00:00Z-a' };
        mockFetchSeenMap.mockResolvedValue(serverMap);

        const history = makeTasks('a', 'b');
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenProcessIds.has('a')).toBe(false);
            expect(result.current.unseenProcessIds.has('b')).toBe(true);
        });
        expect(mockFetchSeenMap).toHaveBeenCalledWith('ws1');
    });

    it('seeds all tasks as seen on first visit (empty server map)', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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
            ({ h }) => useUnseenChat('ws1', h, null),
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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for initialization + seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Simulate re-completion (new timestamp makes it unseen)
        const reCompleted = [{ ...history[0], completedAt: '2026-03-10T00:00:00Z' }];
        const { result: result2 } = renderHook(() => useUnseenChat('ws1', reCompleted, null));

        // Since this is a new hook instance, we need the server to return the old map
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: result3 } = renderHook(() => useUnseenChat('ws1', reCompleted, null));

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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(mockPatchSeenState).toHaveBeenCalled();
        });
        mockPatchSeenState.mockClear();

        // Make it unseen by changing completedAt
        // Actually, let's just test markSeen directly after rerender with new task
        const history2 = [...history, ...makeTasks('b')];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', history2, null));

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
            ({ sel }) => useUnseenChat('ws1', history, sel),
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
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });

        const { result, rerender } = renderHook(
            ({ h }) => useUnseenChat('ws1', h, null),
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
        const { result } = renderHook(() => useUnseenChat('ws1', [], null));

        await waitFor(() => {
            expect(mockFetchSeenMap).toHaveBeenCalled();
        });

        expect(result.current.unseenCount).toBe(0);
        expect(result.current.unseenProcessIds.size).toBe(0);
    });

    it('skips tasks without completedAt', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = [{ id: 'x', status: 'running' }];
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        await waitFor(() => {
            expect(mockFetchSeenMap).toHaveBeenCalled();
        });

        expect(result.current.unseenCount).toBe(0);
    });

    it('marks all tasks as seen when markAllSeen is called', async () => {
        const history = makeTasks('a', 'b', 'c');
        mockFetchSeenMap.mockResolvedValue({});
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        // Make some unseen by simulating new completions
        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', newHistory, null));

        await waitFor(() => {
            expect(r2.current.unseenCount).toBe(3);
        });

        act(() => {
            r2.current.markAllSeen();
        });

        expect(r2.current.unseenCount).toBe(0);
    });

    it('marks a seen task as unseen when markUnseen is called', async () => {
        const history = makeTasks('a', 'b');
        mockFetchSeenMap.mockResolvedValue({
            a: history[0].completedAt,
            b: history[1].completedAt,
        });

        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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

        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for seeding
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        mockDeleteSeenEntry.mockClear();

        // markUnseen on already-unseen should not call API after unseeding via recompletion
        // Actually, after seeding all are seen. Let's test with a truly unseen task
        const history2 = [...history, ...makeTasks('b')];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', history2, null));

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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for seeding, then change completedAt to make them unseen
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', newHistory, null));

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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        // Wait for seeding, then make unseen
        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = history.map(t => ({ ...t, completedAt: t.completedAt + '-v2' }));
        mockFetchSeenMap.mockResolvedValue(Object.fromEntries(history.map(t => [t.id, t.completedAt])));
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', newHistory, null));

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
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

        await waitFor(() => {
            expect(result.current.unseenCount).toBe(0);
        });

        const newHistory = [{ ...history[0], completedAt: history[0].completedAt + '-v2' }];
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });
        const { result: r2 } = renderHook(() => useUnseenChat('ws1', newHistory, null));

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
            ({ h, sel }) => useUnseenChat('ws1', h, sel),
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
            ({ sel }) => useUnseenChat('ws1', history, sel),
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

            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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

            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(false);
                expect(result.current.unseenProcessIds.has('b')).toBe(false);
            });
        });
    });

    it('handles server error gracefully', async () => {
        mockFetchSeenMap.mockRejectedValue(new Error('Server unavailable'));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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

            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(false);
                expect(result.current.unseenProcessIds.has('b')).toBe(true);
            });
        });

        it('seeds endTime tasks on first visit', async () => {
            mockFetchSeenMap.mockResolvedValue({});
            const history = makeHistoryTasks('a', 'b');
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenCount).toBe(0);
            });
            expect(mockPatchSeenState).toHaveBeenCalled();
        });

        it('auto-marks selected endTime task as seen', async () => {
            const history = makeHistoryTasks('a', 'b');
            const isoA = new Date(history[0].endTime).toISOString();
            mockFetchSeenMap.mockResolvedValue({ a: isoA });

            const { result, rerender } = renderHook(
                ({ sel }) => useUnseenChat('ws1', history, sel),
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
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(true);
            });

            act(() => {
                result.current.markSeen('a');
            });

            expect(result.current.unseenProcessIds.has('a')).toBe(false);
        });

        it('markAllSeen works with endTime tasks', async () => {
            const history = makeHistoryTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({ a: 'old' });
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

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

    // AC-02 (count half): the mark fns report whether the seen-state actually
    // changed so RepoChatTab can gate the workspace-scoped count refetch and
    // avoid re-firing it on a warm reopen of an already-seen conversation.
    describe('mark fns return whether seen-state changed', () => {
        it('markSeen returns true on a real transition and false on a no-op', async () => {
            const history = makeTasks('a');
            // Server reports an older seenAt → 'a' is currently unseen.
            mockFetchSeenMap.mockResolvedValue({ a: 'old-value' });
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(true);
            });

            let first: boolean | undefined;
            act(() => { first = result.current.markSeen('a'); });
            expect(first).toBe(true);

            // Reopening the now-seen task is a no-op → no count refetch upstream.
            let second: boolean | undefined;
            act(() => { second = result.current.markSeen('a'); });
            expect(second).toBe(false);
        });

        it('markSeen returns false for a task without a completion timestamp', async () => {
            mockFetchSeenMap.mockResolvedValue({ other: '2026-01-01T00:00:00Z' });
            const history = [{ id: 'r', status: 'running' }];
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(mockFetchSeenMap).toHaveBeenCalled();
            });

            let changed: boolean | undefined;
            act(() => { changed = result.current.markSeen('r'); });
            expect(changed).toBe(false);
        });

        it('markAllSeen returns true when something changed, then false when already all seen', async () => {
            const history = makeTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({ a: 'old' }); // 'a' unseen, 'b' unseen (absent)
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenCount).toBeGreaterThan(0);
            });

            let first: boolean | undefined;
            act(() => { first = result.current.markAllSeen(); });
            expect(first).toBe(true);

            let second: boolean | undefined;
            act(() => { second = result.current.markAllSeen(); });
            expect(second).toBe(false);
        });

        it('markTasksSeen returns false for an empty list and true when it changes state', async () => {
            const history = makeTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({ a: 'old' });
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenProcessIds.has('a')).toBe(true);
            });

            let empty: boolean | undefined;
            act(() => { empty = result.current.markTasksSeen([]); });
            expect(empty).toBe(false);

            let changed: boolean | undefined;
            act(() => { changed = result.current.markTasksSeen([history[0]]); });
            expect(changed).toBe(true);

            let again: boolean | undefined;
            act(() => { again = result.current.markTasksSeen([history[0]]); });
            expect(again).toBe(false);
        });

        it('markUnseen returns true when an entry is removed and false otherwise', async () => {
            const history = makeTasks('a', 'b');
            mockFetchSeenMap.mockResolvedValue({
                a: history[0].completedAt,
                b: history[1].completedAt,
            });
            const { result } = renderHook(() => useUnseenChat('ws1', history, null));

            await waitFor(() => {
                expect(result.current.unseenCount).toBe(0);
            });

            let removed: boolean | undefined;
            act(() => { removed = result.current.markUnseen('a'); });
            expect(removed).toBe(true);

            let again: boolean | undefined;
            act(() => { again = result.current.markUnseen('a'); });
            expect(again).toBe(false);
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
