/**
 * GitReviewPopOutContext — tracks git reviews currently popped out into separate browser windows.
 *
 * Components check `poppedOutReviews` to know if a given commit/branch-range review
 * is already open in a pop-out. Uses BroadcastChannel (with localStorage fallback)
 * for cross-window communication.
 */

import { createContext, useContext, useReducer, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';

export const GIT_REVIEW_POPOUT_CHANNEL = 'coc-git-review-popout';
export const GIT_REVIEW_POPOUT_LS_KEY = 'coc-git-review-popout-msg';

// ── Messages ───────────────────────────────────────────────────────────────────

export type GitReviewPopOutMessage =
    | { type: 'git-review-popout-opened'; key: string }
    | { type: 'git-review-popout-closed'; key: string }
    | { type: 'git-review-popout-restore'; key: string }
    | { type: 'git-review-comments-updated'; key: string };

// ── State ──────────────────────────────────────────────────────────────────────

interface GitReviewPopOutState {
    poppedOutReviews: Set<string>;
}

type GitReviewPopOutAction =
    | { type: 'MARK_POPPED_OUT'; key: string }
    | { type: 'MARK_RESTORED'; key: string };

function reducer(state: GitReviewPopOutState, action: GitReviewPopOutAction): GitReviewPopOutState {
    const next = new Set(state.poppedOutReviews);
    if (action.type === 'MARK_POPPED_OUT') {
        next.add(action.key);
        return { poppedOutReviews: next };
    }
    if (action.type === 'MARK_RESTORED') {
        next.delete(action.key);
        return { poppedOutReviews: next };
    }
    return state;
}

// ── Context ────────────────────────────────────────────────────────────────────

export interface GitReviewPopOutContextValue {
    poppedOutReviews: Set<string>;
    markPoppedOut: (key: string) => void;
    markRestored: (key: string) => void;
    postMessage: (msg: GitReviewPopOutMessage) => void;
}

const GitReviewPopOutContext = createContext<GitReviewPopOutContextValue>({
    poppedOutReviews: new Set(),
    markPoppedOut: () => {},
    markRestored: () => {},
    postMessage: () => {},
});

// ── Channel hook ───────────────────────────────────────────────────────────────

export function useGitReviewPopOutChannel(onMessage?: (msg: GitReviewPopOutMessage) => void): {
    postMessage: (msg: GitReviewPopOutMessage) => void;
} {
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') {
            const handler = (e: StorageEvent) => {
                if (e.key !== GIT_REVIEW_POPOUT_LS_KEY || !e.newValue) return;
                try {
                    const msg = JSON.parse(e.newValue) as GitReviewPopOutMessage;
                    onMessageRef.current?.(msg);
                } catch { /* ignore */ }
            };
            window.addEventListener('storage', handler);
            return () => window.removeEventListener('storage', handler);
        }

        const channel = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent<GitReviewPopOutMessage>) => {
            onMessageRef.current?.(event.data);
        };
        return () => {
            channel.close();
            channelRef.current = null;
        };
    }, []);

    const postMessage = useCallback((msg: GitReviewPopOutMessage) => {
        if (typeof BroadcastChannel !== 'undefined') {
            if (channelRef.current) {
                channelRef.current.postMessage(msg);
            } else {
                try {
                    const ch = new BroadcastChannel(GIT_REVIEW_POPOUT_CHANNEL);
                    ch.postMessage(msg);
                    ch.close();
                } catch { /* ignore */ }
            }
        } else {
            try {
                const value = JSON.stringify({ ...msg, _ts: Date.now() });
                localStorage.setItem(GIT_REVIEW_POPOUT_LS_KEY, value);
                setTimeout(() => {
                    try { localStorage.removeItem(GIT_REVIEW_POPOUT_LS_KEY); } catch { /* ignore */ }
                }, 100);
            } catch { /* ignore */ }
        }
    }, []);

    return { postMessage };
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function GitReviewPopOutProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, { poppedOutReviews: new Set<string>() });

    const handleMessage = useCallback((msg: GitReviewPopOutMessage) => {
        if (msg.type === 'git-review-popout-closed') {
            dispatch({ type: 'MARK_RESTORED', key: msg.key });
        }
    }, []);

    const { postMessage } = useGitReviewPopOutChannel(handleMessage);

    const markPoppedOut = useCallback((key: string) => {
        dispatch({ type: 'MARK_POPPED_OUT', key });
    }, []);

    const markRestored = useCallback((key: string) => {
        dispatch({ type: 'MARK_RESTORED', key });
        postMessage({ type: 'git-review-popout-restore', key });
    }, [postMessage]);

    const value = useMemo<GitReviewPopOutContextValue>(() => ({
        poppedOutReviews: state.poppedOutReviews,
        markPoppedOut,
        markRestored,
        postMessage,
    }), [state.poppedOutReviews, markPoppedOut, markRestored, postMessage]);

    return (
        <GitReviewPopOutContext.Provider value={value}>
            {children}
        </GitReviewPopOutContext.Provider>
    );
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useGitReviewPopOut(): GitReviewPopOutContextValue {
    return useContext(GitReviewPopOutContext);
}

// ── Key builders ───────────────────────────────────────────────────────────────

export function gitReviewPopOutKey(workspaceId: string, commitHash: string): string {
    return `${workspaceId}::commit::${commitHash}`;
}

export function gitReviewBranchPopOutKey(workspaceId: string): string {
    return `${workspaceId}::branch-range`;
}

export function gitReviewPrPopOutKey(workspaceId: string, prId: string): string {
    return `${workspaceId}::pr::${prId}`;
}
