/**
 * usePrAutoMergeMutation — lightweight mutation hook for the auto-merge checkbox
 * in {@link ComposerPrChecksPopover}. Optimistically flips the checkbox, calls
 * the server route, and reverts on error.
 *
 * Routes through the workspace-scoped client ({@link getCocClientForWorkspace})
 * so remote-clone conversations target the right server (mirrors AC-06).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

export interface PrAutoMergeMutationContext {
    workspaceId?: string;
    originId?: string;
    prId?: string;
    currentEnabled: boolean;
}

export interface UsePrAutoMergeMutationResult {
    enabled: boolean;
    busy: boolean;
    disabledReason: string | null;
    toggle: (next: boolean) => Promise<void>;
}

export function usePrAutoMergeMutation(ctx: PrAutoMergeMutationContext): UsePrAutoMergeMutationResult {
    const { workspaceId, originId, prId, currentEnabled } = ctx;
    const [optimistic, setOptimistic] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);
    const mountedRef = useRef(true);
    const currentEnabledRef = useRef(currentEnabled);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    useEffect(() => { currentEnabledRef.current = currentEnabled; }, [currentEnabled]);

    // Clear optimistic state when the external source catches up.
    useEffect(() => {
        if (optimistic !== null && optimistic === currentEnabled) {
            setOptimistic(null);
        }
    }, [currentEnabled, optimistic]);

    const available = Boolean(workspaceId && originId && prId);
    const enabled = optimistic !== null ? optimistic : currentEnabled;

    const toggle = useCallback(async (next: boolean) => {
        if (!available || !workspaceId || !originId || !prId) return;
        setOptimistic(next);
        setBusy(true);
        try {
            await getCocClientForWorkspace(workspaceId).pullRequests.setAutoMergeForOrigin(
                originId,
                prId,
                next,
                { workspaceId },
            );
        } catch {
            if (mountedRef.current) setOptimistic(currentEnabledRef.current);
        } finally {
            if (mountedRef.current) setBusy(false);
        }
    }, [available, workspaceId, originId, prId]);

    const disabledReason = !available ? 'Auto-merge toggle needs a resolved pull request.' : null;

    return { enabled, busy, disabledReason, toggle };
}
