/**
 * useGitAutoRefresh — the Git tab's five-minute timed refresh.
 *
 * Covers the timer lifecycle only: one `refreshAll` call per interval while the
 * tab is active and the page is visible, and no calls after unmount, after a
 * workspace switch restarts the clock, or while the tab/page is hidden.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
    useGitAutoRefresh,
    GIT_AUTO_REFRESH_INTERVAL_MS,
} from '../../../../src/server/spa/client/react/features/git/repoGitTab/useGitAutoRefresh';

let visibility: DocumentVisibilityState = 'visible';

function setPageVisibility(state: DocumentVisibilityState) {
    visibility = state;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('useGitAutoRefresh', () => {
    it('refreshes exactly every five minutes', () => {
        expect(GIT_AUTO_REFRESH_INTERVAL_MS).toBe(300_000);
        const refreshAll = vi.fn();
        renderHook(() => useGitAutoRefresh({ workspaceId: 'ws-a', refreshAll }));

        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS - 1); });
        expect(refreshAll).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(1); });
        expect(refreshAll).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 2); });
        expect(refreshAll).toHaveBeenCalledTimes(3);
        // Called with no arguments, exactly like the manual Refresh path.
        expect(refreshAll).toHaveBeenLastCalledWith();
    });

    it('stops after unmount', () => {
        const refreshAll = vi.fn();
        const { unmount } = renderHook(() => useGitAutoRefresh({ workspaceId: 'ws-a', refreshAll }));
        unmount();
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 3); });
        expect(refreshAll).not.toHaveBeenCalled();
    });

    it('drops the old workspace timer on a workspace switch', () => {
        const oldRefresh = vi.fn();
        const newRefresh = vi.fn();
        const { rerender } = renderHook(
            ({ ws, refreshAll }) => useGitAutoRefresh({ workspaceId: ws, refreshAll }),
            { initialProps: { ws: 'ws-a', refreshAll: oldRefresh } },
        );
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS - 1000); });
        rerender({ ws: 'ws-b', refreshAll: newRefresh });

        // The old schedule would have fired here; the new one restarted at the switch.
        act(() => { vi.advanceTimersByTime(1000); });
        expect(oldRefresh).not.toHaveBeenCalled();
        expect(newRefresh).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS - 1000); });
        expect(newRefresh).toHaveBeenCalledTimes(1);
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 2); });
        expect(oldRefresh).not.toHaveBeenCalled();
    });

    it('does not restart the clock when only the refreshAll identity changes', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            ({ refreshAll }) => useGitAutoRefresh({ workspaceId: 'ws-a', refreshAll }),
            { initialProps: { refreshAll: first } },
        );
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS - 1000); });
        rerender({ refreshAll: second });
        act(() => { vi.advanceTimersByTime(1000); });
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('pauses while the tab is hidden and restarts the clock when shown again', () => {
        const refreshAll = vi.fn();
        const { rerender } = renderHook(
            ({ active }) => useGitAutoRefresh({ workspaceId: 'ws-a', refreshAll, active }),
            { initialProps: { active: false } },
        );
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 2); });
        expect(refreshAll).not.toHaveBeenCalled();

        rerender({ active: true });
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS); });
        expect(refreshAll).toHaveBeenCalledTimes(1);

        rerender({ active: false });
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 2); });
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });

    it('pauses while the browser page is hidden', () => {
        const refreshAll = vi.fn();
        renderHook(() => useGitAutoRefresh({ workspaceId: 'ws-a', refreshAll }));

        setPageVisibility('hidden');
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS * 2); });
        expect(refreshAll).not.toHaveBeenCalled();

        setPageVisibility('visible');
        act(() => { vi.advanceTimersByTime(GIT_AUTO_REFRESH_INTERVAL_MS); });
        expect(refreshAll).toHaveBeenCalledTimes(1);
    });
});
