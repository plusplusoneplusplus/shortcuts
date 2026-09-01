/**
 * useTransientToast — the Git tab's single bottom-right toast surface.
 *
 * Skill enqueue, cherry-pick, squash, reorder, conflict actions and auto-pull
 * skips all report through one toast. Sharing a hook (rather than a shared
 * `setState` + ad-hoc `setTimeout` at each call site) means a newer message
 * always cancels the older message's dismissal timer, so a toast can never be
 * cleared early by a timer armed for a message that is no longer showing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a toast stays up when the caller doesn't say. */
export const DEFAULT_TOAST_MS = 3000;

export interface UseTransientToastReturn {
    toast: string | null;
    /** Show `message`, auto-dismissing after `durationMs`. */
    showToast: (message: string, durationMs?: number) => void;
    /** Dismiss immediately (the toast's × button). */
    clearToast: () => void;
}

export function useTransientToast(): UseTransientToastReturn {
    const [toast, setToast] = useState<string | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cancelTimer = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const clearToast = useCallback(() => {
        cancelTimer();
        setToast(null);
    }, [cancelTimer]);

    const showToast = useCallback((message: string, durationMs = DEFAULT_TOAST_MS) => {
        cancelTimer();
        setToast(message);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setToast(null);
        }, durationMs);
    }, [cancelTimer]);

    // Never leave a dismissal timer running past unmount.
    useEffect(() => cancelTimer, [cancelTimer]);

    return { toast, showToast, clearToast };
}
