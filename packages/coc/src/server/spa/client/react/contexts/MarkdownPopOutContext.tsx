/**
 * MarkdownPopOutContext — tracks markdown files currently popped out into separate browser windows.
 *
 * Components check `poppedOutFiles` to know if a given filePath is already open in a pop-out.
 * Uses BroadcastChannel (via usePopOutChannel pattern) for cross-window communication.
 */

import { createContext, useContext, useReducer, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';

export const MD_POPOUT_CHANNEL = 'coc-markdown-popout';
export const MD_POPOUT_LS_KEY = 'coc-md-popout-msg';

// ── Messages ───────────────────────────────────────────────────────────────────

export type MdPopOutMessage =
    | { type: 'md-popout-opened'; key: string }
    | { type: 'md-popout-closed'; key: string }
    | { type: 'md-popout-restore'; key: string };

// ── State ──────────────────────────────────────────────────────────────────────

interface MdPopOutState {
    poppedOutFiles: Set<string>;
}

type MdPopOutAction =
    | { type: 'MARK_POPPED_OUT'; key: string }
    | { type: 'MARK_RESTORED'; key: string };

function reducer(state: MdPopOutState, action: MdPopOutAction): MdPopOutState {
    const next = new Set(state.poppedOutFiles);
    if (action.type === 'MARK_POPPED_OUT') {
        next.add(action.key);
        return { poppedOutFiles: next };
    }
    if (action.type === 'MARK_RESTORED') {
        next.delete(action.key);
        return { poppedOutFiles: next };
    }
    return state;
}

// ── Context ────────────────────────────────────────────────────────────────────

export interface MarkdownPopOutContextValue {
    poppedOutFiles: Set<string>;
    markPoppedOut: (key: string) => void;
    markRestored: (key: string) => void;
    postMessage: (msg: MdPopOutMessage) => void;
}

const MarkdownPopOutContext = createContext<MarkdownPopOutContextValue>({
    poppedOutFiles: new Set(),
    markPoppedOut: () => {},
    markRestored: () => {},
    postMessage: () => {},
});

// ── Channel hook (mirrors usePopOutChannel but on its own channel) ─────────────

function useMdPopOutChannel(onMessage?: (msg: MdPopOutMessage) => void): {
    postMessage: (msg: MdPopOutMessage) => void;
} {
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') {
            const handler = (e: StorageEvent) => {
                if (e.key !== MD_POPOUT_LS_KEY || !e.newValue) return;
                try {
                    const msg = JSON.parse(e.newValue) as MdPopOutMessage;
                    onMessageRef.current?.(msg);
                } catch { /* ignore */ }
            };
            window.addEventListener('storage', handler);
            return () => window.removeEventListener('storage', handler);
        }

        const channel = new BroadcastChannel(MD_POPOUT_CHANNEL);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent<MdPopOutMessage>) => {
            onMessageRef.current?.(event.data);
        };
        return () => {
            channel.close();
            channelRef.current = null;
        };
    }, []);

    const postMessage = useCallback((msg: MdPopOutMessage) => {
        if (typeof BroadcastChannel !== 'undefined') {
            if (channelRef.current) {
                channelRef.current.postMessage(msg);
            } else {
                try {
                    const ch = new BroadcastChannel(MD_POPOUT_CHANNEL);
                    ch.postMessage(msg);
                    ch.close();
                } catch { /* ignore */ }
            }
        } else {
            try {
                const value = JSON.stringify({ ...msg, _ts: Date.now() });
                localStorage.setItem(MD_POPOUT_LS_KEY, value);
                setTimeout(() => {
                    try { localStorage.removeItem(MD_POPOUT_LS_KEY); } catch { /* ignore */ }
                }, 100);
            } catch { /* ignore */ }
        }
    }, []);

    return { postMessage };
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function MarkdownPopOutProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, { poppedOutFiles: new Set<string>() });

    const handleMessage = useCallback((msg: MdPopOutMessage) => {
        if (msg.type === 'md-popout-closed') {
            dispatch({ type: 'MARK_RESTORED', key: msg.key });
        }
    }, []);

    const { postMessage } = useMdPopOutChannel(handleMessage);

    const markPoppedOut = useCallback((key: string) => {
        dispatch({ type: 'MARK_POPPED_OUT', key });
    }, []);

    const markRestored = useCallback((key: string) => {
        dispatch({ type: 'MARK_RESTORED', key });
        postMessage({ type: 'md-popout-restore', key });
    }, [postMessage]);

    const value = useMemo<MarkdownPopOutContextValue>(() => ({
        poppedOutFiles: state.poppedOutFiles,
        markPoppedOut,
        markRestored,
        postMessage,
    }), [state.poppedOutFiles, markPoppedOut, markRestored, postMessage]);

    return (
        <MarkdownPopOutContext.Provider value={value}>
            {children}
        </MarkdownPopOutContext.Provider>
    );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMarkdownPopOut(): MarkdownPopOutContextValue {
    return useContext(MarkdownPopOutContext);
}

/** Re-export for use in pop-out shell */
export { useMdPopOutChannel };
