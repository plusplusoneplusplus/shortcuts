import { useState, useEffect, useRef } from 'react';
import { getApiBase } from '../utils/config';

export interface PipelineProgressState {
    completed: number;
    total: number;
    phase: string;
}

/**
 * Subscribes to SSE `pipeline-progress` events for a running pipeline process.
 * Returns live progress or null when no data is available yet.
 * Automatically closes the EventSource on unmount or when the process completes.
 */
export function usePipelineProgress(processId: string | null): PipelineProgressState | null {
    const [progress, setProgress] = useState<PipelineProgressState | null>(null);
    const esRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!processId) {
            setProgress(null);
            return;
        }

        const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(processId)}/stream`);
        esRef.current = es;

        es.addEventListener('pipeline-progress', (e) => {
            try {
                const data = JSON.parse((e as MessageEvent).data);
                setProgress({
                    completed: data.completedItems ?? 0,
                    total: data.totalItems ?? 0,
                    phase: data.phase ?? 'map',
                });
            } catch { /* ignore parse errors */ }
        });

        es.addEventListener('status', (e) => {
            try {
                const data = JSON.parse((e as MessageEvent).data);
                if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
                    es.close();
                    esRef.current = null;
                }
            } catch { /* ignore */ }
        });

        es.onerror = () => {
            es.close();
            esRef.current = null;
        };

        return () => {
            es.close();
            esRef.current = null;
        };
    }, [processId]);

    return progress;
}
