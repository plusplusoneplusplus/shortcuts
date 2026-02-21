/**
 * useTaskGeneration — hook for streaming AI task generation via SSE.
 *
 * Manages state and streaming logic for POST /api/workspaces/:id/tasks/generate.
 * Parses named SSE events (progress, chunk, done, error) from the response stream.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { getApiBase } from '../utils/config';

// ── Request ──────────────────────────────────────────────────────────────

export interface TaskGenerationParams {
    prompt: string;
    targetFolder?: string;
    name?: string;
    model?: string;
    mode?: 'from-feature' | string;
    depth?: 'deep' | string;
}

// ── SSE event payloads ───────────────────────────────────────────────────

interface ProgressEvent {
    phase: 'generating' | 'complete';
    message: string;
}

interface ChunkEvent {
    content: string;
}

interface DoneEventSuccess {
    success: true;
    filePath: string | null;
    content: string;
}

interface DoneEventFailure {
    success: false;
}

type DoneEvent = DoneEventSuccess | DoneEventFailure;

interface ErrorEvent {
    message: string;
}

// ── Hook state ───────────────────────────────────────────────────────────

export type TaskGenerationStatus =
    | 'idle'
    | 'generating'
    | 'complete'
    | 'error'
    | 'cancelled';

export interface TaskGenerationResult {
    filePath: string | null;
    content: string;
}

export interface UseTaskGenerationReturn {
    generate: (params: TaskGenerationParams) => Promise<void>;
    cancel: () => void;
    reset: () => void;

    status: TaskGenerationStatus;
    progressMessage: string | null;
    chunks: string[];
    result: TaskGenerationResult | null;
    error: string | null;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useTaskGeneration(wsId: string): UseTaskGenerationReturn {
    const [status, setStatus] = useState<TaskGenerationStatus>('idle');
    const [progressMessage, setProgressMessage] = useState<string | null>(null);
    const [chunks, setChunks] = useState<string[]>([]);
    const [result, setResult] = useState<TaskGenerationResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const reset = useCallback(() => {
        setStatus('idle');
        setProgressMessage(null);
        setChunks([]);
        setResult(null);
        setError(null);
    }, []);

    const cancel = useCallback(() => {
        abortRef.current?.abort();
    }, []);

    const generate = useCallback(async (params: TaskGenerationParams): Promise<void> => {
        // Abort any in-flight request
        abortRef.current?.abort();

        const controller = new AbortController();
        abortRef.current = controller;

        if (mountedRef.current) {
            setStatus('generating');
            setProgressMessage(null);
            setChunks([]);
            setResult(null);
            setError(null);
        }

        const url = `${getApiBase()}/workspaces/${encodeURIComponent(wsId)}/tasks/generate`;

        // Build body with only defined params
        const body: Record<string, unknown> = { prompt: params.prompt };
        if (params.targetFolder !== undefined) body.targetFolder = params.targetFolder;
        if (params.name !== undefined) body.name = params.name;
        if (params.model !== undefined) body.model = params.model;
        if (params.mode !== undefined) body.mode = params.mode;
        if (params.depth !== undefined) body.depth = params.depth;

        let res: Response;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (err: any) {
            if (err.name === 'AbortError') {
                if (mountedRef.current) setStatus('cancelled');
            } else {
                if (mountedRef.current) {
                    setStatus('error');
                    setError(err.message || 'Network error');
                }
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

        // Stream SSE frames
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop()!; // keep unterminated tail

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        currentEvent = line.slice(7).trim();
                    } else if (line.startsWith('data: ') && currentEvent !== '') {
                        const payload = JSON.parse(line.slice(6));
                        if (mountedRef.current) {
                            dispatchEvent(currentEvent, payload);
                        }
                        currentEvent = '';
                    } else if (line === '') {
                        currentEvent = '';
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                if (mountedRef.current) setStatus('cancelled');
            } else {
                if (mountedRef.current) {
                    setStatus('error');
                    setError(err.message || 'Stream error');
                }
            }
        }

        function dispatchEvent(eventName: string, payload: any): void {
            switch (eventName) {
                case 'progress': {
                    const p = payload as ProgressEvent;
                    setProgressMessage(p.message);
                    break;
                }
                case 'chunk': {
                    const c = payload as ChunkEvent;
                    setChunks(prev => [...prev, c.content]);
                    break;
                }
                case 'done': {
                    const d = payload as DoneEvent;
                    if (d.success) {
                        setStatus('complete');
                        setResult({ filePath: d.filePath, content: d.content });
                    } else {
                        setStatus('error');
                        setError('AI generation failed');
                    }
                    break;
                }
                case 'error': {
                    const e = payload as ErrorEvent;
                    setStatus('error');
                    setError(e.message);
                    break;
                }
            }
        }
    }, [wsId]);

    return {
        generate,
        cancel,
        reset,
        status,
        progressMessage,
        chunks,
        result,
        error,
    };
}
