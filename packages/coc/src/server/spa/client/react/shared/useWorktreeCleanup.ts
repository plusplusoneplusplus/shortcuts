/**
 * useWorktreeCleanup — shared cleanup POST + per-worktree state (AC-06).
 *
 * Wraps `git.cleanupWorktree` for the selected clone (multi-repo aware via
 * `useCocClient`), tracking which worktree id is currently being cleaned and any
 * error text keyed by id. Reused by the run-visibility chip (Ralph session
 * detail) and the repo-scoped worktree list so both share identical
 * in-flight/error handling. `cleanup` resolves to the updated record on success
 * (so callers can flip the row/chip to `cleaned`) or `null` on failure/refusal
 * (e.g. a 409 for a dirty worktree), with the message left in `errors[id]`.
 */
import { useCallback, useState } from 'react';
import type { CleanupWorktreeResponse } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../repos/cloneRouting';
import { getSpaCocClientErrorMessage } from '../api/cocClient';

export interface WorktreeCleanupState {
    /** Id of the worktree whose cleanup is in flight, or `null` when idle. */
    cleaningId: string | null;
    /** Error text per worktree id from the most recent failed cleanup. */
    errors: Record<string, string>;
    /**
     * Clean up a worktree. Resolves to the updated record on success, or `null`
     * on failure/refusal (the message is stored in `errors[id]`, the record is
     * left intact server-side).
     */
    cleanup: (worktreeId: string) => Promise<CleanupWorktreeResponse | null>;
    /** Clear a stored error for a worktree id (e.g. before a retry). */
    clearError: (worktreeId: string) => void;
}

export function useWorktreeCleanup(workspaceId: string): WorktreeCleanupState {
    const cocClient = useCocClient(workspaceId);
    const [cleaningId, setCleaningId] = useState<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});

    const clearError = useCallback((worktreeId: string) => {
        setErrors(prev => {
            if (!(worktreeId in prev)) return prev;
            const next = { ...prev };
            delete next[worktreeId];
            return next;
        });
    }, []);

    const cleanup = useCallback(
        async (worktreeId: string): Promise<CleanupWorktreeResponse | null> => {
            setCleaningId(worktreeId);
            setErrors(prev => {
                if (!(worktreeId in prev)) return prev;
                const next = { ...prev };
                delete next[worktreeId];
                return next;
            });
            try {
                return await cocClient.git.cleanupWorktree(workspaceId, worktreeId);
            } catch (err) {
                const message = getSpaCocClientErrorMessage(err, 'Failed to clean up worktree');
                setErrors(prev => ({ ...prev, [worktreeId]: message }));
                return null;
            } finally {
                setCleaningId(null);
            }
        },
        [cocClient, workspaceId],
    );

    return { cleaningId, errors, cleanup, clearError };
}
