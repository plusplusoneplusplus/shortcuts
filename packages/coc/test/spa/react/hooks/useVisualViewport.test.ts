import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVisualViewport } from '../../../../src/server/spa/client/react/hooks/useVisualViewport';

describe('useVisualViewport', () => {
    let originalVisualViewport: VisualViewport | null;

    beforeEach(() => {
        originalVisualViewport = window.visualViewport;
    });

    afterEach(() => {
        Object.defineProperty(window, 'visualViewport', {
            value: originalVisualViewport,
            writable: true,
            configurable: true,
        });
    });

    it('returns 0 when visualViewport is not available', () => {
        Object.defineProperty(window, 'visualViewport', {
            value: null,
            writable: true,
            configurable: true,
        });
        const { result } = renderHook(() => useVisualViewport());
        expect(result.current).toBe(0);
    });

    it('returns 0 initially when keyboard is not open', () => {
        const listeners: Record<string, EventListener> = {};
        const mockVV = {
            height: window.innerHeight,
            addEventListener: (event: string, handler: EventListener) => { listeners[event] = handler; },
            removeEventListener: vi.fn(),
        };
        Object.defineProperty(window, 'visualViewport', {
            value: mockVV,
            writable: true,
            configurable: true,
        });

        const { result } = renderHook(() => useVisualViewport());
        expect(result.current).toBe(0);
    });

    it('returns keyboard height when viewport shrinks (keyboard opens)', () => {
        const listeners: Record<string, EventListener> = {};
        const mockVV = {
            height: window.innerHeight,
            addEventListener: (event: string, handler: EventListener) => { listeners[event] = handler; },
            removeEventListener: vi.fn(),
        };
        Object.defineProperty(window, 'visualViewport', {
            value: mockVV,
            writable: true,
            configurable: true,
        });

        const { result } = renderHook(() => useVisualViewport());

        act(() => {
            mockVV.height = window.innerHeight - 300;
            listeners['resize']?.({} as Event);
        });

        expect(result.current).toBe(300);
    });

    it('returns 0 when keyboard closes (viewport restores)', () => {
        const listeners: Record<string, EventListener> = {};
        const mockVV = {
            height: window.innerHeight - 300,
            addEventListener: (event: string, handler: EventListener) => { listeners[event] = handler; },
            removeEventListener: vi.fn(),
        };
        Object.defineProperty(window, 'visualViewport', {
            value: mockVV,
            writable: true,
            configurable: true,
        });

        const { result } = renderHook(() => useVisualViewport());

        act(() => {
            listeners['resize']?.({} as Event);
        });

        expect(result.current).toBe(300);

        act(() => {
            mockVV.height = window.innerHeight;
            listeners['resize']?.({} as Event);
        });

        expect(result.current).toBe(0);
    });

    it('removes event listener on unmount', () => {
        const removeEventListener = vi.fn();
        const mockVV = {
            height: window.innerHeight,
            addEventListener: vi.fn(),
            removeEventListener,
        };
        Object.defineProperty(window, 'visualViewport', {
            value: mockVV,
            writable: true,
            configurable: true,
        });

        const { unmount } = renderHook(() => useVisualViewport());
        unmount();

        expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
    });
});
