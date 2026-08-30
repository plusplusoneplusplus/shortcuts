/**
 * useGitAutoPullController — the per-repo auto-pull setting and its server status.
 *
 * Auto-pull runs entirely on the server: it ticks whether or not a dashboard tab
 * is open, and the schedule survives a reload because the server anchors it on a
 * persisted `lastRunAt`. This hook is therefore a *reader* — it owns no timer and
 * never initiates a pull.
 *
 * It does two things:
 *   1. Writes the interval, still through the per-repo preferences PATCH (the
 *      preference remains the single place the setting is stored).
 *   2. Reads `GET /api/workspaces/:id/git/auto-pull` for the live schedule
 *      (`nextRunAt`) and the last run's outcome, refreshing on a slow poll so a
 *      pull that happened in the background becomes visible without a reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitAutoPullStatusResponse } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import type { AutoPullSetting } from '../GitAutoPullControl';

/**
 * How often the client re-reads the server's auto-pull status. This polls a
 * cheap read endpoint only — it never triggers a pull, so it can be slow.
 */
export const AUTO_PULL_STATUS_POLL_MS = 30_000;

/** Delay before re-reading status after a preference write, so the server has re-armed. */
const STATUS_REFRESH_AFTER_WRITE_MS = 300;

export interface UseGitAutoPullControllerOptions {
    workspaceId: string;
}

export interface UseGitAutoPullControllerReturn {
    /** The persisted setting, or undefined until prefs have loaded. */
    autoPull: AutoPullSetting | undefined;
    /** Persist a new interval per repo and reflect it locally right away. */
    setAutoPull: (next: AutoPullSetting) => void;
    /** The server's schedule and last run, or undefined until first read. */
    autoPullStatus: GitAutoPullStatusResponse | undefined;
    /** Re-read the server status now (e.g. after a manual pull). */
    refreshStatus: () => void;
}

export function useGitAutoPullController({
    workspaceId,
}: UseGitAutoPullControllerOptions): UseGitAutoPullControllerReturn {
    // AC-07: prefs and the status read target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const [autoPull, setAutoPullState] = useState<AutoPullSetting | undefined>(undefined);
    const [autoPullStatus, setAutoPullStatus] = useState<GitAutoPullStatusResponse | undefined>(undefined);

    // Guards a late response from a previous workspace overwriting the current one.
    const workspaceRef = useRef(workspaceId);
    workspaceRef.current = workspaceId;

    const refreshStatus = useCallback(() => {
        const scope = workspaceId;
        cloneClient.git.getAutoPullStatus(workspaceId)
            .then(status => {
                if (workspaceRef.current === scope) setAutoPullStatus(status);
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Read the per-repo setting on mount / workspace change.
    useEffect(() => {
        setAutoPullState(undefined);
        const scope = workspaceId;
        cloneClient.preferences.getRepo(workspaceId)
            .then(prefs => {
                if (workspaceRef.current !== scope) return;
                if (prefs?.autoPull) setAutoPullState(prefs.autoPull);
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Read the server-owned schedule, then keep it fresh on a slow poll so a
    // background pull shows up without a reload.
    useEffect(() => {
        setAutoPullStatus(undefined);
        refreshStatus();
        const handle = setInterval(refreshStatus, AUTO_PULL_STATUS_POLL_MS);
        return () => clearInterval(handle);
    }, [refreshStatus]);

    // Persist an interval change per repo, then reflect it locally so the control
    // shows the new value immediately; the server re-arms its timer from the
    // preference change, so re-read the status once that has landed.
    const setAutoPull = useCallback((next: AutoPullSetting) => {
        setAutoPullState(next);
        cloneClient.preferences.patchRepo(workspaceId, { autoPull: next })
            .then(() => { setTimeout(refreshStatus, STATUS_REFRESH_AFTER_WRITE_MS); })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId, refreshStatus]);

    return { autoPull, setAutoPull, autoPullStatus, refreshStatus };
}
