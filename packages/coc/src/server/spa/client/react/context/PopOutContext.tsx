/**
 * PopOutContext — tracks tasks currently popped out into separate browser windows.
 *
 * Components check `poppedOutTasks` to show a placeholder instead of the inline
 * detail pane.  `markRestored` closes the popup via BroadcastChannel and removes
 * the task from the popped-out set.
 */

import { createContext, useContext, useReducer, useCallback, useMemo, type ReactNode } from 'react';
import { usePopOutChannel, type PopOutMessage } from '../hooks/usePopOutChannel';

// ── State ──────────────────────────────────────────────────────────────────────

interface PopOutState {
    poppedOutTasks: Set<string>;
}

type PopOutAction =
    | { type: 'MARK_POPPED_OUT'; taskId: string }
    | { type: 'MARK_RESTORED'; taskId: string };

function reducer(state: PopOutState, action: PopOutAction): PopOutState {
    const next = new Set(state.poppedOutTasks);
    if (action.type === 'MARK_POPPED_OUT') {
        next.add(action.taskId);
        return { poppedOutTasks: next };
    }
    if (action.type === 'MARK_RESTORED') {
        next.delete(action.taskId);
        return { poppedOutTasks: next };
    }
    return state;
}

// ── Context ────────────────────────────────────────────────────────────────────

export interface PopOutContextValue {
    /** Set of task IDs currently displayed in pop-out windows. */
    poppedOutTasks: Set<string>;
    /** Mark a task as popped out (after successfully opening a popup). */
    markPoppedOut: (taskId: string) => void;
    /** Restore a task inline: sends a `popout-restore` message and removes from set. */
    markRestored: (taskId: string) => void;
    /** Send a message via BroadcastChannel (exposed for pop-out shell use). */
    postMessage: (msg: PopOutMessage) => void;
}

const PopOutContext = createContext<PopOutContextValue>({
    poppedOutTasks: new Set(),
    markPoppedOut: () => {},
    markRestored: () => {},
    postMessage: () => {},
});

// ── Provider ───────────────────────────────────────────────────────────────────

export function PopOutProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, { poppedOutTasks: new Set<string>() });

    const handleMessage = useCallback((msg: PopOutMessage) => {
        // When a popup window closes, restore the task inline
        if (msg.type === 'popout-closed') {
            dispatch({ type: 'MARK_RESTORED', taskId: msg.taskId });
        }
    }, []);

    const { postMessage } = usePopOutChannel(handleMessage);

    const markPoppedOut = useCallback((taskId: string) => {
        dispatch({ type: 'MARK_POPPED_OUT', taskId });
    }, []);

    const markRestored = useCallback((taskId: string) => {
        dispatch({ type: 'MARK_RESTORED', taskId });
        postMessage({ type: 'popout-restore', taskId });
    }, [postMessage]);

    const value = useMemo<PopOutContextValue>(() => ({
        poppedOutTasks: state.poppedOutTasks,
        markPoppedOut,
        markRestored,
        postMessage,
    }), [state.poppedOutTasks, markPoppedOut, markRestored, postMessage]);

    return (
        <PopOutContext.Provider value={value}>
            {children}
        </PopOutContext.Provider>
    );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function usePopOut(): PopOutContextValue {
    return useContext(PopOutContext);
}
