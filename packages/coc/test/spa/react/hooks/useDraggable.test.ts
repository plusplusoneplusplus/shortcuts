/**
 * Tests for useDraggable hook.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createRef } from 'react';
import { useDraggable } from '../../../../src/server/spa/client/react/hooks/useDraggable';

function makeContainerRef(width = 0, height = 0) {
    const ref = createRef<HTMLElement | null>() as React.MutableRefObject<HTMLElement | null>;
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({
        width,
        height,
        top: 0,
        left: 0,
        right: width,
        bottom: height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
    ref.current = el;
    return ref;
}

describe('useDraggable', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns the initial position', () => {
        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );
        expect(result.current.position).toEqual({ top: 100, left: 200 });
    });

    it('syncs position when initialPosition changes', () => {
        const ref = makeContainerRef();
        let pos = { top: 100, left: 200 };
        const { result, rerender } = renderHook(() =>
            useDraggable(pos, ref)
        );
        expect(result.current.position).toEqual({ top: 100, left: 200 });

        pos = { top: 300, left: 400 };
        rerender();
        expect(result.current.position).toEqual({ top: 300, left: 400 });
    });

    it('isDraggingRef starts as false', () => {
        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );
        expect(result.current.isDraggingRef.current).toBe(false);
    });

    it('handleMouseDown sets isDraggingRef to true', () => {
        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 210,
                clientY: 110,
            } as unknown as React.MouseEvent);
        });

        expect(result.current.isDraggingRef.current).toBe(true);
    });

    it('mousemove updates position while dragging', () => {
        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        // Start drag from (200, 100) on screen
        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 200,
                clientY: 100,
            } as unknown as React.MouseEvent);
        });

        // Move +50 right and +30 down
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 130 }));
        });

        expect(result.current.position).toEqual({ top: 130, left: 250 });
    });

    it('mouseup clears isDraggingRef', () => {
        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 200,
                clientY: 100,
            } as unknown as React.MouseEvent);
        });
        expect(result.current.isDraggingRef.current).toBe(true);

        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });
        expect(result.current.isDraggingRef.current).toBe(false);
    });

    it('position is clamped to viewport edges during drag', () => {
        // Set up a viewport
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 200,
                clientY: 100,
            } as unknown as React.MouseEvent);
        });

        // Move far beyond viewport bounds
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 5000, clientY: 5000 }));
        });

        // With pw=0, ph=0: left = 1024 - 0 - 8 = 1016, top = 768 - 0 - 8 = 760
        expect(result.current.position.left).toBeLessThanOrEqual(1024 - 8);
        expect(result.current.position.top).toBeLessThanOrEqual(768 - 8);
    });

    it('position is clamped to left/top edges (margin) during drag', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

        const ref = makeContainerRef();
        const { result } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 200,
                clientY: 100,
            } as unknown as React.MouseEvent);
        });

        // Move far to the top-left
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: -5000, clientY: -5000 }));
        });

        expect(result.current.position.left).toBeGreaterThanOrEqual(8);
        expect(result.current.position.top).toBeGreaterThanOrEqual(8);
    });

    it('clamps initial position when container has non-zero dimensions', () => {
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

        // Popup is 300x200; initial position overflows right/bottom
        const ref = makeContainerRef(300, 200);
        const { result } = renderHook(() =>
            useDraggable({ top: 700, left: 900 }, ref)
        );

        // Should be clamped: left = 1024 - 300 - 8 = 716, top = 768 - 200 - 8 = 560
        expect(result.current.position.left).toBe(1024 - 300 - 8);
        expect(result.current.position.top).toBe(768 - 200 - 8);
    });

    it('cleans up event listeners on unmount during drag', () => {
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const ref = makeContainerRef();
        const { result, unmount } = renderHook(() =>
            useDraggable({ top: 100, left: 200 }, ref)
        );

        act(() => {
            result.current.handleMouseDown({
                preventDefault: vi.fn(),
                clientX: 200,
                clientY: 100,
            } as unknown as React.MouseEvent);
        });

        unmount();

        const removedEvents = removeEventListenerSpy.mock.calls.map(c => c[0]);
        expect(removedEvents).toContain('mousemove');
        expect(removedEvents).toContain('mouseup');
    });
});
