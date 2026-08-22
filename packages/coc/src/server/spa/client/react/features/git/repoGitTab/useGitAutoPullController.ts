/**
 * useGitAutoPullController — the per-repo auto-pull timer and its reporting.
 *
 * Auto-pull is opt-in per repo and off by default. This hook owns the persisted
 * setting, the countdown reset signal, the tick behaviour, and the job polling
 * for an async auto-pull. Its failures deliberately do NOT go to the tab's
 * `actionError` banner: a background pull that skipped (dirty tree) or failed
 * (non-fast-forward) is informational, so it reports through the transient
 * toast and never demands attention.
 *
 * The pull poller is shared with `useGitOperationActions` rather than created
 * here, so a manual pull and an auto-pull can never poll concurrently.
 */

import { useCallback, useEffect, useState } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import type { AutoPullSetting } from '../GitAutoPullControl';
import { useAutoPullTimer } from '../hooks/useAutoPullTimer';
import { runAutoPullTick, buildAutoPullPollerCallbacks } from '../autoPullTick';
import type { UseGitOperationPollerReturn } from '../hooks/useGitOperationPoller';

/** Auto-pull toasts linger a little longer than success toasts — they're advisory. */
export const AUTO_PULL_TOAST_MS = 5000;

export interface UseGitAutoPullControllerOptions {
    workspaceId: string;
    /** Shared with the manual pull path so only one pull is ever in flight. */
    pullPoller: UseGitOperationPollerReturn;
    /** Whether a pull is already running (manual or auto). */
    pulling: boolean;
    setPulling: (value: boolean) => void;
    refreshAll: () => void;
    showToast: (message: string, durationMs?: number) => void;
}

export interface UseGitAutoPullControllerReturn {
    /** The persisted setting, or undefined until prefs have loaded. */
    autoPull: AutoPullSetting | undefined;
    /** Persist a new interval per repo and reflect it locally right away. */
    setAutoPull: (next: AutoPullSetting) => void;
    /** Restart the countdown — called after any manual or successful pull. */
    resetCountdown: () => void;
}

export function useGitAutoPullController({
    workspaceId, pullPoller, pulling, setPulling, refreshAll, showToast,
}: UseGitAutoPullControllerOptions): UseGitAutoPullControllerReturn {
    // AC-07: prefs and the pull itself target the selected clone's server.
    const cloneClient = useCocClient(workspaceId);

    const [autoPull, setAutoPullState] = useState<AutoPullSetting | undefined>(undefined);
    // Bumped to restart the auto-pull countdown (manual pull / successful auto-pull),
    // so the next tick is a full interval later rather than an immediate double-pull.
    const [resetSignal, setResetSignal] = useState(0);

    const resetCountdown = useCallback(() => setResetSignal(n => n + 1), []);

    // Read the per-repo setting on mount / workspace change.
    useEffect(() => {
        setAutoPullState(undefined);
        cloneClient.preferences.getRepo(workspaceId)
            .then(prefs => {
                if (prefs?.autoPull) setAutoPullState(prefs.autoPull);
            })
            .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [workspaceId]);

    // Persist an interval change per repo, then reflect it locally so the control
    // (and the timer) pick up the new value immediately.
    const setAutoPull = useCallback((next: AutoPullSetting) => {
        setAutoPullState(next);
        cloneClient.preferences.patchRepo(workspaceId, { autoPull: next }).catch(() => {});
    }, [workspaceId]);

    const showAutoPullToast = useCallback((message: string) => {
        showToast(message, AUTO_PULL_TOAST_MS);
    }, [showToast]);

    // Poll an auto-pull job: success refreshes + resets the countdown; a failed
    // job (non-fast-forward / conflict) shows a toast instead of the action banner.
    const startAutoPullPolling = useCallback((jobId: string) => {
        setPulling(true);
        pullPoller.start(jobId, buildAutoPullPollerCallbacks({
            setInFlight: setPulling,
            onSuccess: () => { resetCountdown(); refreshAll(); },
            onFailure: (message) => { showAutoPullToast(message); refreshAll(); },
        }));
    }, [pullPoller, refreshAll, resetCountdown, showAutoPullToast, setPulling]);

    // One timer tick: single-flight guard + dirty pre-check + the shared pull path.
    const handleAutoPull = useCallback(() => {
        void runAutoPullTick({
            isPullInFlight: () => pulling || pullPoller.isPolling(),
            getWorkingTreeChanges: () => cloneClient.git.getWorkingTreeChanges(workspaceId),
            pull: () => cloneClient.git.pull(workspaceId, { rebase: true, currentBranchOnly: true }),
            onJobStarted: startAutoPullPolling,
            onSyncSuccess: () => { resetCountdown(); refreshAll(); },
            onSkip: showAutoPullToast,
            setInFlight: setPulling,
        });
    }, [pulling, pullPoller, cloneClient, workspaceId, startAutoPullPolling, resetCountdown, refreshAll, showAutoPullToast, setPulling]);

    // Arm the recurring timer from the persisted per-repo setting. The hook owns
    // interval lifecycle (re-arm on interval/workspace/reset change, cleanup on
    // unmount); handleAutoPull decides what each tick does.
    useAutoPullTimer({
        workspaceId,
        enabled: !!autoPull?.enabled,
        intervalMinutes: autoPull?.intervalMinutes,
        onTick: handleAutoPull,
        resetSignal,
    });

    return { autoPull, setAutoPull, resetCountdown };
}
