/**
 * Tests for useUnseenActivity — tracks unseen completed tasks in the activity tab.
 *
 * The hook now uses server-side persistence via seenStateApi.
 * Tests mock the API layer and verify optimistic local state updates.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useUnseenActivity, getTaskCompletedAtIso } from '../../../../src/server/spa/client/react/hooks/useUnseenActivity';
import * as seenStateApi from '../../../../src/server/spa/client/react/hooks/seenStateApi';

// Mock the API module
vi.mock('../../../../src/server/spa/client/react/hooks/seenStateApi', () => ({
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

    it('loads seen map from server on mount', async () => {
        const serverMap = { a: '2026-03-09T00:00:00Z-a' };
        mockFetchSeenMap.mockResolvedValue(serverMap);

        const history = makeTasks('a', 'b');
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
        mockFetchSeenMap.mockResolvedValue({ a: history[0].completedAt });

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

        expect(result.current.unseenCount).toBe(0);
        expect(result.current.unseenProcessIds.size).toBe(0);
    });

    it('skips tasks without completedAt', async () => {
        mockFetchSeenMap.mockResolvedValue({});
        const history = [{ id: 'x', status: 'running' }];
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        await waitFor(() => {
            expect(mockFetchSeenMap).toHaveBeenCalled();
        });

        expect(result.current.unseenCount).toBe(0);
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

    it('handles server error gracefully', async () => {
        mockFetchSeenMap.mockRejectedValue(new Error('Server unavailable'));
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

        it('auto-marks selected endTime task as seen', async () => {
            const history = makeHistoryTasks('a', 'b');
            const isoA = new Date(history[0].endTime).toISOString();
            mockFetchSeenMap.mockResolvedValue({ a: isoA });

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

    it('auto-marks selected task as seen even when not completed', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const running = makeRunningTasks('a');
        const { result, rerender } = renderHook(
            ({ sel, r }) => useUnseenActivity('ws1', [], sel, [], r),
            { initialProps: { sel: null as string | null, r: running } },
        );

        expect(result.current.unseenTaskIds.has('a')).toBe(true);

        rerender({ sel: 'a', r: running });
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
    });

    it('deduplicates items across queued, running, and history', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        // Same item appears in both running and history
        const running = [{ id: 'a', status: 'running', displayName: 'Task a' }];
        const history = [{ id: 'a', status: 'completed', completedAt: '2026-01-01T00:00:00Z', displayName: 'Task a' }];

        const { result } = renderHook(() =>
            useUnseenActivity('ws1', history, null, [], running),
        );

        // Should only count once (queued takes priority in merge order: q, r, h)
        expect(result.current.unseenCount).toBe(1);
    });

    it('migrates old localStorage format (bare completedAt) to snapshot format', () => {
        // Old format stored just the completedAt string
        const history = makeTasks('a');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: history[0].completedAt,
        }));

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        // After migration, the old completedAt becomes "completed|completedAt"
        // which matches the current snapshot for a completed item
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
    });
});

describe('useUnseenActivity — chat-specific logic', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('suppresses badge for single active chat being viewed', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const running = [makeChatTask('chat1', 'running')];

        const { result } = renderHook(() =>
            useUnseenActivity('ws1', [], 'chat1', [], running, { isViewingChats: true }),
        );

        // unseenTaskIds still contains chat1 (for dot indicators)
        // but unseenCount is 0 because user is viewing the only active chat
        expect(result.current.unseenCount).toBe(0);
    });

    it('suppresses badge when single active chat changes state while being viewed', () => {
        // User is viewing chat1 in running state (already auto-marked seen)
        const runSnapshot = getItemSnapshot({ status: 'running' });
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ chat1: runSnapshot }));

        const { result, rerender } = renderHook(
            ({ h, r }) => useUnseenActivity('ws1', h, 'chat1', [], r, { isViewingChats: true }),
            { initialProps: { h: [] as any[], r: [makeChatTask('chat1', 'running')] } },
        );

        expect(result.current.unseenCount).toBe(0);

        // Chat completes while user is still viewing it — state change detected
        // but single-chat suppression keeps badge at 0
        rerender({
            h: [makeChatTask('chat1', 'completed', '2026-01-01T00:00:00Z')],
            r: [],
        });
        expect(result.current.unseenCount).toBe(0);
    });

    it('shows badge for multiple active chats with unviewed changes', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const running = [
            makeChatTask('chat1', 'running'),
            makeChatTask('chat2', 'running'),
        ];

        // Viewing chat1 — it gets auto-marked seen.
        // chat2 is unseen. With 2 active chats, no single-chat suppression.
        const { result } = renderHook(() =>
            useUnseenActivity('ws1', [], 'chat1', [], running, { isViewingChats: true }),
        );

        // chat1 is auto-marked seen, chat2 remains unseen → badge = 1
        expect(result.current.unseenCount).toBe(1);
    });

    it('does not suppress badge when isViewingChats is false', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const running = [makeChatTask('chat1', 'running')];

        // Not viewing chats tab, no task selected — chat1 is unseen
        const { result } = renderHook(() =>
            useUnseenActivity('ws1', [], null, [], running, { isViewingChats: false }),
        );

        expect(result.current.unseenCount).toBe(1);
    });

    it('does not suppress when viewing a different task than the active chat', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const running = [makeChatTask('chat1', 'running')];
        const queued = makeQueuedTasks('task1');

        // Viewing task1 (auto-marked), but chat1 is the unseen active chat
        const { result } = renderHook(() =>
            useUnseenActivity('ws1', [], 'task1', queued, running, { isViewingChats: true }),
        );

        // task1 is auto-marked seen, chat1 is still unseen → badge = 1
        expect(result.current.unseenCount).toBe(1);
    });
});

describe('computeUnseenCount', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('counts unseen items across all arrays', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const queued = makeQueuedTasks('a');
        const running = makeRunningTasks('b');
        const history = makeTasks('c');

        expect(computeUnseenCount('ws1', history, queued, running)).toBe(3);
    });

    it('returns 0 when all items are seen', () => {
        const history = makeTasks('a');
        const snapshot = getItemSnapshot(history[0]);
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: snapshot }));

        expect(computeUnseenCount('ws1', history)).toBe(0);
    });

    it('detects state change in pure helper', () => {
        // Mark 'a' as seen in "queued" state
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: 'queued|' }));
        // Now it's running
        const running = makeRunningTasks('a');

        expect(computeUnseenCount('ws1', [], [], running)).toBe(1);
    });

    it('migrates old format and counts correctly', () => {
        const history = makeTasks('a', 'b');
        // Old format: bare completedAt values
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: history[0].completedAt,
        }));

        // 'a' should be migrated to "completed|..." and match → 0 unseen
        // 'b' has no entry → 1 unseen
        expect(computeUnseenCount('ws1', history)).toBe(1);
    });
});
