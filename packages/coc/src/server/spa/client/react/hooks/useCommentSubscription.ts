import { useEffect } from 'react';

/** The domain owns event matching; this hook owns the socket lifetime. */
export function useCommentSubscription(
    url: string,
    subscription: string | null,
    onMessage: (message: unknown) => void,
) {
    useEffect(() => {
        if (subscription === null) return;
        let active = true;
        const socket = new WebSocket(url);
        socket.addEventListener('open', () => {
            if (active) socket.send(subscription);
        });
        socket.addEventListener('message', event => {
            if (!active || typeof event.data !== 'string') return;
            let message: unknown;
            try {
                message = JSON.parse(event.data);
            } catch {
                return; // Other peers may send non-JSON frames.
            }
            onMessage(message);
        });
        return () => {
            active = false;
            socket.close();
        };
    }, [url, subscription, onMessage]);
}
