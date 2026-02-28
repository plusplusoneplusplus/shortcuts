import type { DAGChartData, DAGNodeData, DAGNodeState } from './types';
import type { PipelinePhase, PipelinePhaseStatus } from '@plusplusoneplusplus/pipeline-core';
import type { LivePhaseEntry, LiveProgress } from '../../hooks/usePipelinePhase';

const phaseLabels: Record<PipelinePhase, string> = {
    input: 'Input',
    filter: 'Filter',
    map: 'Map',
    reduce: 'Reduce',
    job: 'Job',
};

function deriveNodeStates(
    phases: PipelinePhase[],
    processStatus: string,
    phaseInfos?: Array<{ phase: string; status: string }>,
): Record<PipelinePhase, DAGNodeState> {
    const states: Partial<Record<PipelinePhase, DAGNodeState>> = {};

    if (processStatus === 'completed') {
        for (const p of phases) states[p] = 'completed';
    } else if (processStatus === 'failed') {
        // Find last phase that has info; mark it as failed, previous as completed, rest as cancelled
        if (phaseInfos && phaseInfos.length > 0) {
            const infoMap = new Map(phaseInfos.map(i => [i.phase, i.status]));
            let foundFailed = false;
            for (let i = phases.length - 1; i >= 0; i--) {
                const p = phases[i];
                const info = infoMap.get(p);
                if (!foundFailed && (info === 'failed' || info === 'started')) {
                    states[p] = 'failed';
                    foundFailed = true;
                } else if (foundFailed || info === 'completed') {
                    states[p] = 'completed';
                } else {
                    states[p] = 'cancelled';
                }
            }
        } else {
            // Heuristic: last phase failed, rest completed
            for (let i = 0; i < phases.length; i++) {
                states[phases[i]] = i < phases.length - 1 ? 'completed' : 'failed';
            }
        }
    } else if (processStatus === 'cancelled') {
        if (phaseInfos && phaseInfos.length > 0) {
            const infoMap = new Map(phaseInfos.map(i => [i.phase, i.status]));
            for (const p of phases) {
                states[p] = infoMap.get(p) === 'completed' ? 'completed' : 'cancelled';
            }
        } else {
            for (const p of phases) states[p] = 'cancelled';
        }
    } else if (processStatus === 'running') {
        if (phaseInfos && phaseInfos.length > 0) {
            const infoMap = new Map(phaseInfos.map(i => [i.phase, i.status]));
            for (const p of phases) {
                const info = infoMap.get(p);
                if (info === 'completed') states[p] = 'completed';
                else if (info === 'started') states[p] = 'running';
                else states[p] = 'waiting';
            }
        } else {
            // Heuristic: first phase running, rest waiting
            for (let i = 0; i < phases.length; i++) {
                states[phases[i]] = i === 0 ? 'running' : 'waiting';
            }
        }
    } else {
        // queued or unknown
        for (const p of phases) states[p] = 'waiting';
    }

    return states as Record<PipelinePhase, DAGNodeState>;
}

export function buildDAGData(process: any): DAGChartData | null {
    const metadata = process?.metadata;
    if (!metadata) return null;

    const stats = metadata.executionStats;
    const pipelinePhases: Array<{ phase: string; status: string }> | undefined = metadata.pipelinePhases;

    // Must have at least some pipeline metadata
    if (!stats && !pipelinePhases) return null;

    // Determine which phases exist
    const phases: PipelinePhase[] = [];
    phases.push('input');

    const hasFilter = stats?.filterPhaseTimeMs != null ||
        (pipelinePhases && pipelinePhases.some(p => p.phase === 'filter'));
    if (hasFilter) phases.push('filter');

    const hasMap = stats?.totalItems != null ||
        (pipelinePhases && pipelinePhases.some(p => p.phase === 'map'));
    const hasJob = pipelinePhases && pipelinePhases.some(p => p.phase === 'job');

    if (hasJob && !hasMap) {
        phases.push('job');
    } else if (hasMap) {
        phases.push('map');
    }

    const hasReduce = stats?.reducePhaseTimeMs != null ||
        (pipelinePhases && pipelinePhases.some(p => p.phase === 'reduce'));
    if (hasReduce) phases.push('reduce');

    // If only 'input' detected and no other signals, not a pipeline visualization
    if (phases.length === 1 && !stats && !pipelinePhases) return null;

    const stateMap = deriveNodeStates(phases, process.status || 'completed', pipelinePhases);

    const nodes: DAGNodeData[] = phases.map(phase => {
        const node: DAGNodeData = {
            phase,
            state: stateMap[phase],
            label: phaseLabels[phase],
        };

        if (phase === 'map' && stats) {
            if (stats.totalItems != null) node.totalItems = stats.totalItems;
            if (stats.successfulMaps != null) {
                node.itemCount = stats.successfulMaps;
            }
            if (stats.failedMaps != null) node.failedItems = stats.failedMaps;
            if (stats.mapPhaseTimeMs != null) node.durationMs = stats.mapPhaseTimeMs;
        } else if (phase === 'reduce' && stats?.reducePhaseTimeMs != null) {
            node.durationMs = stats.reducePhaseTimeMs;
        } else if (phase === 'filter' && stats?.filterPhaseTimeMs != null) {
            node.durationMs = stats.filterPhaseTimeMs;
        } else if (phase === 'input' && metadata.inputItemCount != null) {
            node.itemCount = metadata.inputItemCount;
        }

        // Override durations from phaseTimings if available
        if (metadata.phaseTimings && metadata.phaseTimings[phase] != null) {
            node.durationMs = metadata.phaseTimings[phase];
        }

        return node;
    });

    const totalDurationMs = process.durationMs ?? process.duration ?? undefined;

    return { nodes, totalDurationMs };
}

const phaseStatusToNodeState: Record<PipelinePhaseStatus, DAGNodeState> = {
    started: 'running',
    completed: 'completed',
    failed: 'failed',
};

/**
 * Build DAGChartData from live SSE phase/progress state.
 * Used when a pipeline process is actively running.
 */
export function buildDAGDataFromLive(
    phases: Map<PipelinePhase, LivePhaseEntry>,
    progress: LiveProgress | null,
    metadata?: any,
): DAGChartData | null {
    if (phases.size === 0) return null;

    // Determine ordered phase list from metadata or from the live phases
    const orderedPhases: PipelinePhase[] = [];
    const canonicalOrder: PipelinePhase[] = ['input', 'filter', 'map', 'reduce', 'job'];

    // Prefer metadata-based ordering if available (includes future phases)
    if (metadata?.pipelinePhases && Array.isArray(metadata.pipelinePhases)) {
        const seen = new Set<PipelinePhase>();
        for (const p of metadata.pipelinePhases) {
            if (!seen.has(p.phase)) {
                seen.add(p.phase);
                orderedPhases.push(p.phase);
            }
        }
    }

    // Add any phases from live data not yet in the list
    for (const phase of canonicalOrder) {
        if (phases.has(phase) && !orderedPhases.includes(phase)) {
            orderedPhases.push(phase);
        }
    }

    if (orderedPhases.length === 0) return null;

    const nodes: DAGNodeData[] = orderedPhases.map(phase => {
        const liveEntry = phases.get(phase);
        const state: DAGNodeState = liveEntry
            ? phaseStatusToNodeState[liveEntry.status] ?? 'waiting'
            : 'waiting';

        const node: DAGNodeData = {
            phase,
            state,
            label: phaseLabels[phase],
        };

        if (liveEntry?.durationMs != null) {
            node.durationMs = liveEntry.durationMs;
        }
        if (liveEntry?.itemCount != null) {
            node.itemCount = liveEntry.itemCount;
        }
        if (liveEntry?.startedAt != null) {
            node.startedAt = liveEntry.startedAt;
        }

        // Map progress data onto the running map/job node
        if (progress && (phase === 'map' || phase === 'job') && state === 'running') {
            node.totalItems = progress.totalItems;
            node.itemCount = progress.completedItems;
            node.failedItems = progress.failedItems;
        }

        // For map node with progress when completed, keep the final counts
        if (progress && (phase === 'map' || phase === 'job') && state === 'completed') {
            node.totalItems = progress.totalItems;
            node.itemCount = progress.completedItems;
            node.failedItems = progress.failedItems;
        }

        return node;
    });

    return { nodes };
}
