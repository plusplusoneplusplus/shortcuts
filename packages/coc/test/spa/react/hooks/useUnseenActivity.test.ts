/**
 * Tests for useUnseenActivity — tracks unseen completed tasks in the activity tab.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUnseenActivity } from '../../../../src/server/spa/client/react/hooks/useUnseenActivity';

function makeTasks(...ids: string[]) {
    return ids.map(id => ({
        id,
        status: 'completed',
        completedAt: `2026-03-09T00:00:00Z-${id}`,
        displayName: `Task ${id}`,
    }));
}

describe('useUnseenActivity', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
    });

    it('seeds all existing history as seen on first visit', () => {
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
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: history[0].completedAt }));
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
        expect(stored['a']).toBe(history[0].completedAt);
    });

    it('loads previously persisted seen state', () => {
        const history = makeTasks('a', 'b');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: history[0].completedAt }));

        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenTaskIds.has('a')).toBe(false);
        expect(result.current.unseenTaskIds.has('b')).toBe(true);
    });

    it('uses separate storage per workspace', () => {
        const history = makeTasks('a');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({ a: history[0].completedAt }));

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

    it('skips tasks without completedAt', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = [{ id: 'x', status: 'running' }];
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));
        expect(result.current.unseenCount).toBe(0);
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

    it('markAllSeen persists to localStorage', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a', 'b');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markAllSeen();
        });

        const stored = JSON.parse(localStorage.getItem('coc-unseen-ws1')!);
        expect(stored['a']).toBe(history[0].completedAt);
        expect(stored['b']).toBe(history[1].completedAt);
    });

    it('preserves seen state when history starts empty then loads (page refresh)', () => {
        // Simulate: user marked all read → page refresh → history starts as []
        const history = makeTasks('a', 'b');
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({
            a: history[0].completedAt,
            b: history[1].completedAt,
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
        expect(stored['b']).toBe(history[1].completedAt);
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
        expect(stored['a']).toBe(history[0].completedAt);
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

    it('markTasksSeen is a no-op for tasks without completedAt', () => {
        localStorage.setItem('coc-unseen-ws1', JSON.stringify({}));
        const history = makeTasks('a');
        const { result } = renderHook(() => useUnseenActivity('ws1', history, null));

        act(() => {
            result.current.markTasksSeen([{ id: 'a' }]); // no completedAt
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
});
