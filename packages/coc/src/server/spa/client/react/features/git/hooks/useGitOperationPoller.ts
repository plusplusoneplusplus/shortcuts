/**
 * useGitOperationPoller — lifecycle-aware polling for asynchronous git operations.
 *
 * Several git actions (pull, rebase autosquash, drop commit, reorder) return a
 * `jobId` and complete asynchronously on the server. Callers poll `getOperation`
 * until the job leaves the `running` state. Doing this with a raw `setInterval`
 * inside each handler leaks intervals on unmount / repo switch and can update
 * state for a workspace the user already navigated away from.
 *
 * This hook owns the interval handle in a ref and clears it on unmount, on
 * workspace change, and on explicit `stop()`. It captures the workspace id and a
 * generation token for each `start()`, so a tick that resolves after the poll was
 * replaced/stopped — or after the mounted workspace changed — is dropped instead
 * of firing stale callbacks.
 *
 * The hook owns LIFECYCLE only. Domain semantics (which refresh to run, which
 * error banner to set, per-operation completion rules) stay in the per-call
 * callbacks supplied to `start()`.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { GitOpJob } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';

/** A polled job, or `null` when the server reports no such operation. */
export type PolledGitOperation = GitOpJob | null;

export interface GitOperationPollerCallbacks {
    /** Job reached a terminal, non-failed state (or a missing job, when no `onMissing`). */
    onSuccess?: () => void;
    /** Job reached the `failed` state. Receives the job's raw error string (may be undefined). */
    onFailure?: (error: string | undefined, job: GitOpJob) => void;
    /** `getOperation` resolved to null/undefined. Falls back to `onSuccess` when omitted. */
    onMissing?: () => void;
    /** A poll request threw. Polling always stops first; this only reports. */
    onError?: (err: unknown) => void;
    /**
     * Decide whether a fetched job is terminal. Returning `true` ends polling.
     * Default: a missing job or any status other than `running` is terminal.
     */
    isComplete?: (job: PolledGitOperation) => boolean;
}

export interface UseGitOperationPollerOptions {
    /** Polling interval in ms. Defaults to 3000. */
    intervalMs?: number;
}

export interface UseGitOperationPollerReturn {
    /** Begin polling `jobId`. Replaces any in-flight poll on the same instance. */
    start: (jobId: string, callbacks: GitOperationPollerCallbacks) => void;
    /** Stop the active poll, if any. */
    stop: () => void;
    /** Whether a poll is currently active. */
    isPolling: () => boolean;
    /** The job id currently being polled, or null. */
    activeJobId: () => string | null;
}

const DEFAULT_INTERVAL_MS = 3000;

/** Default terminality: missing job or any non-`running` status ends the poll. */
function defaultIsComplete(job: PolledGitOperation): boolean {
    return !job || job.status !== 'running';
}

/**
 * Manage one async git-operation poll with mount/workspace-aware cleanup.
 *
 * @param workspaceId  Workspace / repo scope. Polls route to this clone's server
 *                     and are dropped if the mounted workspace changes mid-flight.
 * @param options      Optional polling configuration (interval).
 */
export function useGitOperationPoller(
    workspaceId: string,
    options?: UseGitOperationPollerOptions,
): UseGitOperationPollerReturn {
    // Route getOperation to the workspace's clone server (AC-07).
    const cloneClient = useCocClient(workspaceId);
    const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;

    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const jobIdRef = useRef<string | null>(null);
    // Bumped on every start(), stop(), unmount, and workspace change. A tick whose
    // captured token no longer matches is stale and ignored.
    const generationRef = useRef(0);
    // Mirrors the mounted workspace so an in-flight tick can detect a repo switch.
    const workspaceRef = useRef(workspaceId);
    workspaceRef.current = workspaceId;

    const clearTimer = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const stop = useCallback(() => {
        clearTimer();
        jobIdRef.current = null;
        generationRef.current += 1;
    }, [clearTimer]);

    const start = useCallback((jobId: string, callbacks: GitOperationPollerCallbacks) => {
        clearTimer();
        const generation = ++generationRef.current;
        const startedWorkspace = workspaceRef.current;
        jobIdRef.current = jobId;
        const isComplete = callbacks.isComplete ?? defaultIsComplete;

        // A tick is stale if a newer start()/stop() ran, the hook unmounted, or the
        // mounted workspace changed while the getOperation request was in flight.
        const isStale = () =>
            generation !== generationRef.current || startedWorkspace !== workspaceRef.current;

        intervalRef.current = setInterval(async () => {
            let job: PolledGitOperation;
            try {
                job = await cloneClient.git.getOperation(startedWorkspace, jobId);
            } catch (err) {
                if (isStale()) return;
                stop();
                callbacks.onError?.(err);
                return;
            }
            if (isStale()) return;
            if (!isComplete(job)) return;
            stop();
            if (!job) {
                (callbacks.onMissing ?? callbacks.onSuccess)?.();
            } else if (job.status === 'failed') {
                callbacks.onFailure?.(job.error, job);
            } else {
                callbacks.onSuccess?.();
            }
        }, intervalMs);
    }, [cloneClient, clearTimer, stop, intervalMs]);

    const isPolling = useCallback(() => intervalRef.current !== null, []);
    const activeJobId = useCallback(() => jobIdRef.current, []);

    // Clear on unmount and whenever the mounted workspace changes.
    useEffect(() => {
        return () => {
            clearTimer();
            jobIdRef.current = null;
            generationRef.current += 1;
        };
    }, [workspaceId, clearTimer]);

    return { start, stop, isPolling, activeJobId };
}
