/**
 * useGitAutoRefresh — re-run the Git tab's full refresh on a fixed cadence.
 *
 * While the tab is active (displayed) and the browser page is visible, this
 * calls the caller's existing `refreshAll` every `GIT_AUTO_REFRESH_INTERVAL_MS`.
 * It adds no data-loading path of its own: every tick goes through the same
 * `refreshAll` a manual Refresh click uses, so it only re-reads local git state
 * (never fetch/pull/push/rebase) and relies on `refreshAll`'s in-progress guard
 * to avoid overlapping a manual, websocket, or earlier timed refresh.
 *
 * The interval is (re)started when the tab becomes visible and cleared on
 * unmount, on `workspaceId` change, and whenever the tab or page is hidden.
 */

import { useEffect, useRef, useState } from 'react';

/** Timed Git tab refresh cadence: exactly five minutes. */
export const GIT_AUTO_REFRESH_INTERVAL_MS = 5 * 60_000;

export interface UseGitAutoRefreshOptions {
    workspaceId: string;
    /** The tab's existing full refresh (see `useRepoGitData`). */
    refreshAll: () => void;
    /** Whether the tab is currently displayed. Defaults to true. */
    active?: boolean;
}

function isPageVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export function useGitAutoRefresh({ workspaceId, refreshAll, active = true }: UseGitAutoRefreshOptions): void {
    // Read through a ref so a new `refreshAll` identity doesn't restart the clock.
    const refreshAllRef = useRef(refreshAll);
    refreshAllRef.current = refreshAll;

    const [pageVisible, setPageVisible] = useState(isPageVisible);
    useEffect(() => {
        if (typeof document === 'undefined') return;
        const onChange = () => setPageVisible(isPageVisible());
        document.addEventListener('visibilitychange', onChange);
        return () => document.removeEventListener('visibilitychange', onChange);
    }, []);

    const enabled = active && pageVisible;
    useEffect(() => {
        if (!enabled) return;
        const handle = setInterval(() => refreshAllRef.current(), GIT_AUTO_REFRESH_INTERVAL_MS);
        return () => clearInterval(handle);
    }, [workspaceId, enabled]);
}
