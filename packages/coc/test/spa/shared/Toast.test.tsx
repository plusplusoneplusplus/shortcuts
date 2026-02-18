import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from '../../../src/server/spa/client/react/shared/Toast';

describe('useToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('addToast appends a toast to toasts', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('Hello');
        });

        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe('Hello');
    });

    it('addToast uses info type by default', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('Test');
        });

        expect(result.current.toasts[0].type).toBe('info');
    });

    it('addToast accepts custom type', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('Error!', 'error');
        });

        expect(result.current.toasts[0].type).toBe('error');
    });

    it('removeToast removes the correct toast by id', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('First');
            result.current.addToast('Second');
        });

        const firstId = result.current.toasts[0].id;

        act(() => {
            result.current.removeToast(firstId);
        });

        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe('Second');
    });

    it('auto-dismiss: after 3s, toast is removed', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('Temporary');
        });

        expect(result.current.toasts).toHaveLength(1);

        act(() => {
            vi.advanceTimersByTime(3000);
        });

        expect(result.current.toasts).toHaveLength(0);
    });

    it('multiple toasts can be added', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.addToast('One');
            result.current.addToast('Two');
            result.current.addToast('Three');
        });

        expect(result.current.toasts).toHaveLength(3);
    });
});
