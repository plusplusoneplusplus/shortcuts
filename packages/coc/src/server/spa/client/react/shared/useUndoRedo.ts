import { useRef, useCallback } from 'react';

export interface HistorySnapshot {
    value: string;
    selStart: number;
    selEnd: number;
}

/**
 * Custom undo/redo stack for the source-mode textarea.
 *
 * Native browser undo is broken by React's controlled-value prop, so we
 * maintain our own history.  Each push saves the state *before* a change;
 * undo/redo swap between past and future stacks.
 */
export function useUndoRedo() {
    const past = useRef<HistorySnapshot[]>([]);
    const future = useRef<HistorySnapshot[]>([]);

    /** Save `snapshot` as a past state and clear the redo stack. */
    const push = useCallback((snapshot: HistorySnapshot) => {
        past.current.push(snapshot);
        future.current = [];
    }, []);

    /**
     * Move `current` to the redo stack and return the most-recent past state,
     * or `null` when there is nothing left to undo.
     */
    const undo = useCallback((current: HistorySnapshot): HistorySnapshot | null => {
        if (past.current.length === 0) return null;
        future.current.push(current);
        return past.current.pop()!;
    }, []);

    /**
     * Move `current` back to the past stack and return the next future state,
     * or `null` when there is nothing to redo.
     */
    const redo = useCallback((current: HistorySnapshot): HistorySnapshot | null => {
        if (future.current.length === 0) return null;
        past.current.push(current);
        return future.current.pop()!;
    }, []);

    /** Clear both stacks (e.g. when loading a different note). */
    const reset = useCallback(() => {
        past.current = [];
        future.current = [];
    }, []);

    return { push, undo, redo, reset };
}
