/**
 * usePipelinePhase — React hook that subscribes to SSE `pipeline-phase` and
 * `pipeline-progress` named events, maintaining live phase/progress state
 * for the DAG visualization.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { PipelinePhase, PipelinePhaseStatus } from '@plusplusoneplusplus/pipeline-core';
import type { DAGChartData } from '../processes/dag/types';
import { buildDAGDataFromLive } from '../processes/dag/buildDAGData';

export interface LivePhaseEntry {
    status: PipelinePhaseStatus;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
    error?: string;
    itemCount?: number;
}

export interface LiveProgress {
    completedItems: number;
    failedItems: number;
    totalItems: number;
    percentage: number;
}

export interface UsePipelinePhaseResult {
    dagData: DAGChartData | null;
    phases: Map<PipelinePhase, LivePhaseEntry>;
    progress: LiveProgress | null;
    disconnected: boolean;
}

const THROTTLE_MS = 250;

export function usePipelinePhase(
    eventSource: EventSource | null,
    metadata: any | undefined,
): UsePipelinePhaseResult {
    const [phases, setPhases] = useState<Map<PipelinePhase, LivePhaseEntry>>(new Map());
    const [progress, setProgress] = useState<LiveProgress | null>(null);
    const [disconnected, setDisconnected] = useState(false);

    // Throttle refs for progress events
    const lastProgressRef = useRef(0);
    const pendingProgressRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Ref-callback pattern: store latest setters in refs to avoid re-subscribing
    const setPhasesRef = useRef(setPhases);
    setPhasesRef.current = setPhases;
    const setProgressRef = useRef(setProgress);
    setProgressRef.current = setProgress;
    const setDisconnectedRef = useRef(setDisconnected);
    setDisconnectedRef.current = setDisconnected;

    const applyProgress = useCallback((data: LiveProgress) => {
        setProgressRef.current(data);
        lastProgressRef.current = Date.now();
    }, []);

    useEffect(() => {
        if (!eventSource) {
            return;
        }

        setDisconnectedRef.current(false);

        const handlePhase = (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data);
                const phase = data.phase as PipelinePhase;
                const status = data.status as PipelinePhaseStatus;
                setPhasesRef.current(prev => {
                    const next = new Map(prev);
                    const existing = next.get(phase) || {};
                    const entry: LivePhaseEntry = {
                        ...existing,
                        status,
                    };
                    if (status === 'started') {
                        entry.startedAt = Date.now();
                    }
                    if (status === 'completed' || status === 'failed') {
                        entry.completedAt = Date.now();
                        if (data.durationMs != null) entry.durationMs = data.durationMs;
                        if (data.error) entry.error = data.error;
                    }
                    if (data.itemCount != null) entry.itemCount = data.itemCount;
                    next.set(phase, entry);
                    return next;
                });
            } catch { /* ignore parse errors */ }
        };

        const handleProgress = (event: Event) => {
            try {
                const data = JSON.parse((event as MessageEvent).data) as LiveProgress;
                const now = Date.now();
                if (now - lastProgressRef.current >= THROTTLE_MS) {
                    applyProgress(data);
                } else {
                    if (pendingProgressRef.current) clearTimeout(pendingProgressRef.current);
                    pendingProgressRef.current = setTimeout(
                        () => applyProgress(data),
                        THROTTLE_MS - (now - lastProgressRef.current),
                    );
                }
            } catch { /* ignore parse errors */ }
        };

        const handleError = () => {
            setDisconnectedRef.current(true);
        };

        eventSource.addEventListener('pipeline-phase', handlePhase);
        eventSource.addEventListener('pipeline-progress', handleProgress);
        eventSource.addEventListener('error', handleError);

        return () => {
            eventSource.removeEventListener('pipeline-phase', handlePhase);
            eventSource.removeEventListener('pipeline-progress', handleProgress);
            eventSource.removeEventListener('error', handleError);
            if (pendingProgressRef.current) {
                clearTimeout(pendingProgressRef.current);
                pendingProgressRef.current = null;
            }
        };
    }, [eventSource, applyProgress]);

    // Build DAGChartData from live phases+progress
    const dagData = phases.size > 0
        ? buildDAGDataFromLive(phases, progress, metadata)
        : null;

    return { dagData, phases, progress, disconnected };
}
