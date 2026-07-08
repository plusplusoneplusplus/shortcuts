import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContainerWidth } from '../../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth';

// Helper: create a mock ref with a fake element
function createMockRef(clientWidth: number) {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, writable: true, configurable: true });
    return { current: el };
}

// Mock ResizeObserver
let resizeCallback: ResizeObserverCallback | null = null;
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();

class MockResizeObserver {
    constructor(cb: ResizeObserverCallback) {
        resizeCallback = cb;
    }
    observe = mockObserve;
    disconnect = mockDisconnect;
    unobserve = vi.fn();
}

describe('useContainerWidth', () => {
    let originalRO: typeof ResizeObserver;

    beforeEach(() => {
        originalRO = globalThis.ResizeObserver;
        globalThis.ResizeObserver = MockResizeObserver as any;
        resizeCallback = null;
        mockObserve.mockClear();
        mockDisconnect.mockClear();
        vi.useFakeTimers();
    });

    afterEach(() => {
        globalThis.ResizeObserver = originalRO;
        vi.useRealTimers();
    });

    it('returns wide tier for width >= 700px', () => {
        const ref = createMockRef(800);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current).toMatchObject({
            width: 800,
            tier: 'wide',
            isWide: true,
            isMedium: false,
            isNarrow: false,
        });
    });

    it('returns wide tier at exact boundary 700px', () => {
        const ref = createMockRef(700);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current.tier).toBe('wide');
        expect(result.current.isWide).toBe(true);
    });

    it('returns medium tier for width 500-699px', () => {
        const ref = createMockRef(600);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current).toMatchObject({
            width: 600,
            tier: 'medium',
            isWide: false,
            isMedium: true,
            isNarrow: false,
        });
    });

    it('returns medium tier at exact boundary 500px', () => {
        const ref = createMockRef(500);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current.tier).toBe('medium');
        expect(result.current.isMedium).toBe(true);
    });

    it('returns narrow tier for width < 500px', () => {
        const ref = createMockRef(400);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current).toMatchObject({
            width: 400,
            tier: 'narrow',
            isWide: false,
            isMedium: false,
            isNarrow: true,
        });
    });

    it('returns narrow tier at 0 width', () => {
        const ref = createMockRef(0);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current.tier).toBe('narrow');
        expect(result.current.width).toBe(0);
    });

    it('returns width 0 for null ref', () => {
        const ref = { current: null };
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current.width).toBe(0);
        expect(result.current.tier).toBe('narrow');
    });

    it('sets up ResizeObserver on mount', () => {
        const ref = createMockRef(800);
        renderHook(() => useContainerWidth(ref));
        expect(mockObserve).toHaveBeenCalledWith(ref.current);
    });

    it('disconnects ResizeObserver on unmount', () => {
        const ref = createMockRef(800);
        const { unmount } = renderHook(() => useContainerWidth(ref));
        unmount();
        expect(mockDisconnect).toHaveBeenCalled();
    });

    it('updates state when ResizeObserver fires after throttle', () => {
        const ref = createMockRef(800);
        const { result } = renderHook(() => useContainerWidth(ref, 50));

        expect(result.current.tier).toBe('wide');

        // Simulate resize to narrow
        Object.defineProperty(ref.current!, 'clientWidth', { value: 400, writable: true, configurable: true });

        // Fire ResizeObserver callback
        act(() => {
            resizeCallback?.([] as any, {} as any);
        });

        // Not updated yet — throttled
        expect(result.current.tier).toBe('wide');

        // Advance timer past throttle
        act(() => {
            vi.advanceTimersByTime(50);
        });

        // Now use rAF
        act(() => {
            vi.advanceTimersByTime(16);
        });

        expect(result.current.tier).toBe('narrow');
        expect(result.current.width).toBe(400);
    });

    it('does not re-render when width is unchanged', () => {
        const ref = createMockRef(800);
        const { result } = renderHook(() => useContainerWidth(ref, 50));

        const initial = result.current;

        act(() => {
            resizeCallback?.([] as any, {} as any);
        });

        act(() => {
            vi.advanceTimersByTime(50);
            vi.advanceTimersByTime(16);
        });

        // Same width → same object reference
        expect(result.current).toBe(initial);
    });

    describe('custom thresholds', () => {
        it('applies a raised wideThreshold (composer toolbar: 820px)', () => {
            const ref = createMockRef(800);
            const { result } = renderHook(() => useContainerWidth(ref, { wideThreshold: 820 }));
            // 800px is wide with default thresholds but medium with 820.
            expect(result.current.tier).toBe('medium');
            expect(result.current.isWide).toBe(false);
        });

        it('is wide at exactly the custom wideThreshold', () => {
            const ref = createMockRef(820);
            const { result } = renderHook(() => useContainerWidth(ref, { wideThreshold: 820 }));
            expect(result.current.tier).toBe('wide');
        });

        it('applies a custom mediumThreshold', () => {
            const ref = createMockRef(450);
            const { result } = renderHook(() => useContainerWidth(ref, { mediumThreshold: 400 }));
            expect(result.current.tier).toBe('medium');
        });

        it('accepts throttleMs via the options object', () => {
            const ref = createMockRef(800);
            const { result } = renderHook(() => useContainerWidth(ref, { throttleMs: 50 }));

            Object.defineProperty(ref.current!, 'clientWidth', { value: 400, writable: true, configurable: true });
            act(() => {
                resizeCallback?.([] as any, {} as any);
            });
            expect(result.current.tier).toBe('wide');
            act(() => {
                vi.advanceTimersByTime(50);
                vi.advanceTimersByTime(16);
            });
            expect(result.current.tier).toBe('narrow');
        });
    });

    it('handles missing ResizeObserver gracefully', () => {
        // @ts-expect-error testing missing API
        delete globalThis.ResizeObserver;
        const ref = createMockRef(600);
        const { result } = renderHook(() => useContainerWidth(ref));
        expect(result.current.width).toBe(600);
        expect(result.current.tier).toBe('medium');
    });
});
