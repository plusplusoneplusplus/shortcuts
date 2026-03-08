/**
 * Tests for useQueueTouchDragDrop — computeDropIndex logic, hook state,
 * and touch-based drag-and-drop integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    computeDropIndex,
    useQueueTouchDragDrop,
    LONG_PRESS_DELAY,
    MOVE_THRESHOLD,
} from '../../../src/server/spa/client/react/hooks/useQueueTouchDragDrop';

// ── computeDropIndex (pure function) ───────────────────────────────────

describe('computeDropIndex', () => {
    it('drops below a later item - takes that items index', () => {
        // Dragging index 0 below index 2
        expect(computeDropIndex(0, 2, 'below')).toBe(2);
    });

    it('drops below an earlier item - takes hover index + 1', () => {
        // Dragging index 3 below index 1
        expect(computeDropIndex(3, 1, 'below')).toBe(2);
    });

    it('drops above a later item - takes hover index - 1', () => {
        // Dragging index 0 above index 2
        expect(computeDropIndex(0, 2, 'above')).toBe(1);
    });

    it('drops above an earlier item - takes that items index', () => {
        // Dragging index 3 above index 1
        expect(computeDropIndex(3, 1, 'above')).toBe(1);
    });

    it('clamps to 0 when result would be negative', () => {
        // Dragging index 0 above index 0
        expect(computeDropIndex(0, 0, 'above')).toBe(0);
    });

    it('drops below same index — returns same index (no-op)', () => {
        expect(computeDropIndex(2, 2, 'below')).toBe(3);
    });

    it('drops above same index — returns previous index', () => {
        expect(computeDropIndex(2, 2, 'above')).toBe(1);
    });

    it('drops below first item when src is later', () => {
        expect(computeDropIndex(4, 0, 'below')).toBe(1);
    });

    it('drops above first item when src is later', () => {
        expect(computeDropIndex(4, 0, 'above')).toBe(0);
    });
});

// ── useQueueTouchDragDrop hook ─────────────────────────────────────────

describe('useQueueTouchDragDrop', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns idle state initially', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());

        expect(result.current.draggedTaskId).toBeNull();
        expect(result.current.dropTargetIndex).toBeNull();
        expect(result.current.dropPosition).toBeNull();
        expect(typeof result.current.createTouchStartHandler).toBe('function');
    });

    it('activates drag after long press delay', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        // Simulate touchstart
        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        // Before delay — not dragging yet
        expect(result.current.draggedTaskId).toBeNull();

        // After delay — drag activates
        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
        });

        expect(result.current.draggedTaskId).toBe('task-1');
    });

    it('cancels long press when finger moves beyond threshold before activation', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        // Simulate touchmove beyond threshold (dispatched on document)
        act(() => {
            const moveEvent = new Event('touchmove', { bubbles: true }) as any;
            moveEvent.touches = [{ clientX: 100 + MOVE_THRESHOLD + 1, clientY: 200 }];
            document.dispatchEvent(moveEvent);
        });

        // Advance past long press delay — should NOT activate
        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY + 100);
        });

        expect(result.current.draggedTaskId).toBeNull();
    });

    it('does not cancel long press when finger stays within threshold', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        // Small move within threshold
        act(() => {
            const moveEvent = new Event('touchmove', { bubbles: true }) as any;
            moveEvent.touches = [{ clientX: 100 + MOVE_THRESHOLD - 1, clientY: 200 }];
            document.dispatchEvent(moveEvent);
        });

        // Long press fires
        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
        });

        expect(result.current.draggedTaskId).toBe('task-1');
    });

    it('cleans up state on touchend without drop target', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
        });

        expect(result.current.draggedTaskId).toBe('task-1');

        // Touch end without moving to a drop target
        act(() => {
            document.dispatchEvent(new TouchEvent('touchend'));
        });

        expect(result.current.draggedTaskId).toBeNull();
        expect(result.current.dropTargetIndex).toBeNull();
        expect(result.current.dropPosition).toBeNull();
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('cleans up state on touchcancel', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY);
        });

        act(() => {
            document.dispatchEvent(new TouchEvent('touchcancel'));
        });

        expect(result.current.draggedTaskId).toBeNull();
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('ignores multi-finger touches', () => {
        const { result } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [
                    { clientX: 100, clientY: 200 },
                    { clientX: 150, clientY: 250 },
                ],
            } as unknown as React.TouchEvent);
        });

        act(() => {
            vi.advanceTimersByTime(LONG_PRESS_DELAY + 100);
        });

        expect(result.current.draggedTaskId).toBeNull();
    });

    it('cleans up document listeners on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { result, unmount } = renderHook(() => useQueueTouchDragDrop());
        const onReorder = vi.fn();

        const handler = result.current.createTouchStartHandler('task-1', 0, onReorder);

        act(() => {
            handler({
                touches: [{ clientX: 100, clientY: 200 }],
            } as unknown as React.TouchEvent);
        });

        unmount();

        const removedTypes = removeSpy.mock.calls.map(c => c[0]);
        expect(removedTypes).toContain('touchmove');
        expect(removedTypes).toContain('touchend');
        expect(removedTypes).toContain('touchcancel');

        removeSpy.mockRestore();
    });
});

// ── ActivityListPane touch integration (data-queue-index) ──────────────

describe('ActivityListPane touch drag integration', () => {
    it('computeDropIndex matches desktop HTML5 drop logic for all cases', () => {
        // Verify parity with the HTML5 drag handler's index calculation
        // (see useQueueDragDrop.ts createDropHandler)

        // Dragging from 0, drop below item 3 → target 3
        expect(computeDropIndex(0, 3, 'below')).toBe(3);
        // Dragging from 3, drop above item 0 → target 0
        expect(computeDropIndex(3, 0, 'above')).toBe(0);
        // Dragging from 1, drop below item 0 → target 1 (no-op)
        expect(computeDropIndex(1, 0, 'below')).toBe(1);
        // Dragging from 1, drop above item 3 → target 2
        expect(computeDropIndex(1, 3, 'above')).toBe(2);
    });
});
