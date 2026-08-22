/**
 * Tests for the Git tab's shared transient toast.
 *
 * Every git action reports through one toast surface. The reason this is a hook
 * rather than a bare `setState` + per-call-site `setTimeout` is that a newer
 * message must cancel the older message's dismissal timer — otherwise a toast
 * disappears early because a timer armed for a message that is no longer
 * showing fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useTransientToast, DEFAULT_TOAST_MS,
} from '../../../../src/server/spa/client/react/features/git/repoGitTab/useTransientToast';

describe('useTransientToast', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('starts with no toast', () => {
        const { result } = renderHook(() => useTransientToast());
        expect(result.current.toast).toBeNull();
    });

    it('shows a message and auto-dismisses after the default delay', () => {
        const { result } = renderHook(() => useTransientToast());
        act(() => result.current.showToast('Reorder started'));
        expect(result.current.toast).toBe('Reorder started');

        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_MS - 1); });
        expect(result.current.toast).toBe('Reorder started');

        act(() => { vi.advanceTimersByTime(1); });
        expect(result.current.toast).toBeNull();
    });

    it('honours a caller-supplied duration', () => {
        const { result } = renderHook(() => useTransientToast());
        act(() => result.current.showToast('Auto-pull skipped', 5000));
        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_MS); });
        expect(result.current.toast).toBe('Auto-pull skipped');
        act(() => { vi.advanceTimersByTime(2000); });
        expect(result.current.toast).toBeNull();
    });

    it('does not let the previous message\'s timer dismiss a newer one', () => {
        const { result } = renderHook(() => useTransientToast());
        act(() => result.current.showToast('first'));
        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_MS - 100); });
        act(() => result.current.showToast('second'));

        // The first message's timer would have fired here.
        act(() => { vi.advanceTimersByTime(200); });
        expect(result.current.toast).toBe('second');

        act(() => { vi.advanceTimersByTime(DEFAULT_TOAST_MS); });
        expect(result.current.toast).toBeNull();
    });

    it('dismisses immediately on clearToast', () => {
        const { result } = renderHook(() => useTransientToast());
        act(() => result.current.showToast('Cherry-picked'));
        act(() => result.current.clearToast());
        expect(result.current.toast).toBeNull();
    });

    it('clears its pending timer on unmount', () => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
        const { result, unmount } = renderHook(() => useTransientToast());
        act(() => result.current.showToast('Skill enqueued'));
        unmount();
        expect(clearSpy).toHaveBeenCalled();
        clearSpy.mockRestore();
    });
});
