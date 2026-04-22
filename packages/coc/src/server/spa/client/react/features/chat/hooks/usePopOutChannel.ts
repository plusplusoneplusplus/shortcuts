/**
 * usePopOutChannel — BroadcastChannel-based communication between parent and pop-out windows.
 *
 * Provides a stable `postMessage` function and subscribes to incoming messages
 * via the 'coc-activity-popout' channel.  Falls back to `localStorage` storage
 * events on browsers without `BroadcastChannel` support.
 */

import { useEffect, useRef, useCallback } from 'react';

export type PopOutMessage =
    | { type: 'popout-opened'; taskId: string }
    | { type: 'popout-closed'; taskId: string }
    | { type: 'popout-restore'; taskId: string };

export const POPOUT_CHANNEL_NAME = 'coc-activity-popout';
export const POPOUT_LS_FALLBACK_KEY = 'coc-popout-msg';

export function usePopOutChannel(onMessage?: (msg: PopOutMessage) => void): {
    postMessage: (msg: PopOutMessage) => void;
} {
    const onMessageRef = useRef(onMessage);
    onMessageRef.current = onMessage;
    const channelRef = useRef<BroadcastChannel | null>(null);

    useEffect(() => {
        if (typeof BroadcastChannel === 'undefined') {
            // localStorage fallback for browsers without BroadcastChannel
            const handler = (e: StorageEvent) => {
                if (e.key !== POPOUT_LS_FALLBACK_KEY || !e.newValue) return;
                try {
                    const msg = JSON.parse(e.newValue) as PopOutMessage;
                    onMessageRef.current?.(msg);
                } catch { /* ignore malformed messages */ }
            };
            window.addEventListener('storage', handler);
            return () => window.removeEventListener('storage', handler);
        }

        const channel = new BroadcastChannel(POPOUT_CHANNEL_NAME);
        channelRef.current = channel;
        channel.onmessage = (event: MessageEvent<PopOutMessage>) => {
            onMessageRef.current?.(event.data);
        };
        return () => {
            channel.close();
            channelRef.current = null;
        };
    }, []);

    const postMessage = useCallback((msg: PopOutMessage) => {
        if (typeof BroadcastChannel !== 'undefined') {
            if (channelRef.current) {
                channelRef.current.postMessage(msg);
            } else {
                // Create a temporary channel when called before the effect runs
                try {
                    const ch = new BroadcastChannel(POPOUT_CHANNEL_NAME);
                    ch.postMessage(msg);
                    ch.close();
                } catch { /* ignore */ }
            }
        } else {
            // localStorage fallback: write then remove to trigger storage event in other tabs
            try {
                const value = JSON.stringify({ ...msg, _ts: Date.now() });
                localStorage.setItem(POPOUT_LS_FALLBACK_KEY, value);
                setTimeout(() => {
                    try { localStorage.removeItem(POPOUT_LS_FALLBACK_KEY); } catch { /* ignore */ }
                }, 100);
            } catch { /* ignore */ }
        }
    }, []);

    return { postMessage };
}
