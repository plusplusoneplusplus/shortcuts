/**
 * useItemProcessEvents — React hook that subscribes to SSE `item-process`
 * named events, maintaining a live map of per-item states for the workflow
 * detail view's MapItemGrid.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export interface ItemProcessState {
    processId: string;
    itemIndex: number;
    status: string;
    promptPreview?: string;
    durationMs?: number;
    error?: string;
    startedAt?: number;
}

export interface UseItemProcessEventsResult {
    items: Map<string, ItemProcessState>;
    isConnected: boolean;
}

const THROTTLE_MS = 250;

export function useItemProcessEvents(
    eventSource: EventSource | null,
): UseItemProcessEventsResult {
    const [items, setItems] = useState<Map<string, ItemProcessState>>(new Map());
    const [disconnected, setDisconnected] = useState(false);

    const lastUpdateRef = useRef(0);
    const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ref-callback pattern to avoid re-subscribing
    const setItemsRef = useRef(setItems);
    setItemsRef.current = setItems;
    const setDisconnectedRef = useRef(setDisconnected);
    setDisconnectedRef.current = setDisconnected;

    const applyUpdate = useCallback((processId: string, data: ItemProcessState) => {
        setItemsRef.current(prev => {
            const next = new Map(prev);
            next.set(processId, data);
            return next;
        });
        lastUpdateRef.current = Date.now();
    }, []);

    useEffect(() => {
        if (!eventSource) {
            return;
        }

        setDisconnectedRef.current(false);

        const handleItemProcess = (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data) as ItemProcessState;
                const now = Date.now();
                if (now - lastUpdateRef.current >= THROTTLE_MS) {
                    applyUpdate(data.processId, data);
                } else {
                    if (pendingRef.current) clearTimeout(pendingRef.current);
                    pendingRef.current = setTimeout(
                        () => applyUpdate(data.processId, data),
                        THROTTLE_MS - (now - lastUpdateRef.current),
                    );
                }
            } catch { /* ignore parse errors */ }
        };

        const handleError = () => {
            setDisconnectedRef.current(true);
        };

        eventSource.addEventListener('item-process', handleItemProcess);
        eventSource.addEventListener('error', handleError);

        return () => {
            eventSource.removeEventListener('item-process', handleItemProcess);
            eventSource.removeEventListener('error', handleError);
            if (pendingRef.current) {
                clearTimeout(pendingRef.current);
                pendingRef.current = null;
            }
        };
    }, [eventSource, applyUpdate]);

    return { items, isConnected: !disconnected };
}
