/**
 * useQueueTaskGeneration — hook for submitting AI task generation to the queue.
 *
 * Instead of streaming results inline (like useTaskGeneration), this hook
 * POSTs to /api/workspaces/:id/queue/generate and returns immediately
 * with a taskId. The user can track progress in the Queue tab.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

// ── Request ──────────────────────────────────────────────────────────────

export interface QueueTaskGenerationParams {
    prompt: string;
    targetFolder?: string;
    name?: string;
    model?: string;
    mode?: 'from-feature' | string;
    depth?: 'deep' | string;
    priority?: 'high' | 'normal' | 'low';
    images?: string[];
}

// ── Hook state ───────────────────────────────────────────────────────────

export type QueueTaskGenerationStatus = 'idle' | 'submitting' | 'queued' | 'error';

export interface UseQueueTaskGenerationReturn {
    enqueue: (params: QueueTaskGenerationParams) => Promise<void>;
    reset: () => void;

    status: QueueTaskGenerationStatus;
    taskId: string | null;
    error: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useQueueTaskGeneration(wsId: string): UseQueueTaskGenerationReturn {
    const [status, setStatus] = useState<QueueTaskGenerationStatus>('idle');
    const [taskId, setTaskId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const reset = useCallback(() => {
        setStatus('idle');
        setTaskId(null);
        setError(null);
    }, []);

    const enqueue = useCallback(async (params: QueueTaskGenerationParams): Promise<void> => {
        if (mountedRef.current) {
            setStatus('submitting');
            setTaskId(null);
            setError(null);
        }

        const url = `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/queue/generate`;

        const body: Record<string, unknown> = { prompt: params.prompt };
        if (params.targetFolder !== undefined) body.targetFolder = params.targetFolder;
        if (params.name !== undefined) body.name = params.name;
        if (params.model !== undefined) body.model = params.model;
        if (params.mode !== undefined) body.mode = params.mode;
        if (params.depth !== undefined) body.depth = params.depth;
        if (params.priority !== undefined) body.priority = params.priority;
        if (params.images !== undefined && params.images.length > 0) body.images = params.images;

        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err: any) {
            if (mountedRef.current) {
                setStatus('error');
                setError(err.message || 'Network error');
            }
            return;
        }

        if (!res.ok) {
            const errorBody = await res.json().catch(() => ({ error: 'Request failed' }));
            if (mountedRef.current) {
                setStatus('error');
                setError(errorBody.error || `HTTP ${res.status}`);
            }
            return;
        }

        const data = await res.json().catch(() => ({}));
        if (mountedRef.current) {
            setStatus('queued');
            setTaskId(data.taskId || null);
        }
    }, [wsId]);

    return {
        enqueue,
        reset,
        status,
        taskId,
        error,
    };
}
