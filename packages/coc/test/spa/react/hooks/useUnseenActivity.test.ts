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
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('seeds all existing items as seen on first visit', () => {
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenCount).toBe(0);
        expect(result.current.unseenTaskIds.size).toBe(0);
    });

    it('marks a new task as unseen when it appears after initial load', () => {
        const history = makeTasks('a', 'b');
        const { result, rerender } = renderHook(
            ({ h }) => useUnseenActivity('ws1', h, null),
            { initialProps: { h: history } },
        );
        // Initial: all seen
        expect(result.current.unseenCount).toBe(0);

        // New task appears
        const updated = [...history, ...makeTasks('c')];
        rerender({ h: updated });
        expect(result.current.unseenTaskIds.has('c')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
    });

    it('marks task as seen when markSeen is called', () => {
        const history = makeTasks('a');
        // Set up prior state where 'a' was never seen
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        expect(result.current.unseenTaskIds.has('a')).toBe(true);

        act(() => {
            result.current.markSeen('a');
        });

        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenCount).toBe(0);
    });

    it('auto-marks selected task as seen', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b');
        const { result, rerender } = renderHook(
            ({ sel }) => useUnseenActivity('ws1', history, sel),
            { initialProps: { sel: null as string | null } },
        );

        expect(result.current.unseenTaskIds.has('a')).toBe(true);
        expect(result.current.unseenTaskIds.has('b')).toBe(true);

        // Select task 'a'
        rerender({ sel: 'a' });
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenTaskIds.has('b')).toBe(true);
    });

    it('detects re-completion as unseen (different completedAt)', () => {
        const history = makeTasks('a');
        const snapshot = getItemSnapshot(history[0]);
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: snapshot }));
        const { result, rerender } = renderHook(
            ({ h }) => useUnseenActivity('ws1', h, null),
            { initialProps: { h: history } },
        );

        expect(result.current.unseenCount).toBe(0);

        // Task 'a' completes again with different timestamp
        const reCompleted = [{ ...history[0], completedAt: '2026-03-09T01:00:00Z-new' }];
        rerender({ h: reCompleted });
        expect(result.current.unseenTaskIds.has('a')).toBe(true);
    });

    it('persists seen state to localStorage', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markSeen('a');
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
        expect(result.current.unseenTaskIds.size).toBe(0);
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

    it('marks all tasks as seen when markAllSeen is called', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        expect(result.current.unseenCount).toBe(3);

        act(() => {
            result.current.markAllSeen();
        });

        expect(result.current.unseenCount).toBe(0);
        expect(result.current.unseenTaskIds.size).toBe(0);
    });

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

    it('preserves seen state when history starts empty then loads (page refresh)', () => {
        // Simulate: user marked all read → page refresh → history starts as []
        const history = makeTasks('a', 'b');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: getItemSnapshot(history[0]),
            b: getItemSnapshot(history[1]),
        }));

        // Render with empty history (before API response)
        const { result, rerender } = renderHook(
            ({ h }) => useUnseenActivity('ws1', h, null),
            { initialProps: { h: [] as any[] } },
        );
        expect(result.current.unseenCount).toBe(0);

        // History loads from server
        rerender({ h: history });
        // Previously-seen tasks must stay seen
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenTaskIds.has('b')).toBe(false);
        expect(result.current.unseenCount).toBe(0);
    });

    it('markAllSeen is a no-op when all tasks are already seen', () => {
        const history = makeTasks('a', 'b');
        // First visit seeds all as seen
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenCount).toBe(0);

        act(() => {
            result.current.markAllSeen();
        });

        expect(result.current.unseenCount).toBe(0);
    });

    it('marks a seen task as unseen when markUnseen is called', () => {
        const history = makeTasks('a', 'b');
        // First visit seeds all as seen
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenCount).toBe(0);

        act(() => {
            result.current.markUnseen('a');
        });

        expect(result.current.unseenTaskIds.has('a')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
        expect(result.current.unseenTaskIds.has('b')).toBe(false);
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

        // 'a' is already unseen
        expect(result.current.unseenTaskIds.has('a')).toBe(true);

        act(() => {
            result.current.markUnseen('a');
        });

        // Still unseen, no error
        expect(result.current.unseenTaskIds.has('a')).toBe(true);
    });

    it('markTasksSeen marks only the provided tasks as seen', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        expect(result.current.unseenCount).toBe(3);

        // Mark only 'a' and 'b' as seen, leaving 'c' unseen
        act(() => {
            result.current.markTasksSeen([history[0], history[1]]);
        });

        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenTaskIds.has('b')).toBe(false);
        expect(result.current.unseenTaskIds.has('c')).toBe(true);
        expect(result.current.unseenCount).toBe(1);
    });

    it('markTasksSeen persists to localStorage', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b', 'c');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markTasksSeen([history[0]]);
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBe(getItemSnapshot(history[0]));
        expect(stored['b']).toBeUndefined();
        expect(stored['c']).toBeUndefined();
    });

    it('markTasksSeen is a no-op when given an empty list', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        expect(result.current.unseenCount).toBe(2);

        act(() => {
            result.current.markTasksSeen([]);
        });

        expect(result.current.unseenCount).toBe(2);
    });

    it('markTasksSeen is a no-op for tasks without status', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markTasksSeen([{ id: 'a' }]); // no status
        });

        expect(result.current.unseenTaskIds.has('a')).toBe(true);
    });

    it('dispatches coc-seen-updated custom event when markSeen is called', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const events: Event[] = [];
        const handler = (e: Event) => events.push(e);
        window.addEventListener('coc-seen-updated', handler);

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markSeen('a');
        });

        window.removeEventListener('coc-seen-updated', handler);
        expect(events.length).toBeGreaterThan(0);
    });

    it('dispatches coc-seen-updated when markAllSeen is called', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b');
        const events: Event[] = [];
        const handler = (e: Event) => events.push(e);
        window.addEventListener('coc-seen-updated', handler);

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markAllSeen();
        });

        window.removeEventListener('coc-seen-updated', handler);
        expect(events.length).toBeGreaterThan(0);
    });

    it('dispatches coc-seen-updated when markUnseen is called', () => {
        const history = makeTasks('a');
        const events: Event[] = [];
        const handler = (e: Event) => events.push(e);
        window.addEventListener('coc-seen-updated', handler);

        // Seed first visit (all seen), then mark unseen
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markUnseen('a');
        });

        window.removeEventListener('coc-seen-updated', handler);
        expect(events.length).toBeGreaterThan(0);
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
