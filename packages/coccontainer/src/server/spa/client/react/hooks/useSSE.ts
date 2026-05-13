/**
 * Hook for SSE event streaming from the container.
 */

import { useEffect, useRef, useCallback } from 'react';

interface UseSSEOptions {
    onEvent: (event: { agentId: string; agentName: string; eventType?: string; payload: any }) => void;
    enabled?: boolean;
}

export function useSSE({ onEvent, enabled = true }: UseSSEOptions) {
    const onEventRef = useRef(onEvent);
    useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

    useEffect(() => {
        if (!enabled) return;

        const eventSource = new EventSource('/api/events');

        eventSource.onmessage = (e) => {
            try {
                const envelope = JSON.parse(e.data);
                onEventRef.current({
                    agentId: envelope.agentId,
                    agentName: envelope.agentName,
                    payload: typeof envelope.payload === 'string' ? JSON.parse(envelope.payload) : envelope.payload,
                });
            } catch { /* ignore */ }
        };

        return () => eventSource.close();
    }, [enabled]);
}
