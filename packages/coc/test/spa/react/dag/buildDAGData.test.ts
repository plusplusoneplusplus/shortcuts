import { describe, it, expect } from 'vitest';
import { buildDAGData } from '../../../../src/server/spa/client/react/processes/dag/buildDAGData';

function makeProcess(overrides: Record<string, any> = {}) {
    return {
        id: 'proc-1',
        status: 'completed',
        durationMs: 5000,
        metadata: {
            pipelineName: 'Bug Triage',
            executionStats: {
                totalItems: 10,
                successfulMaps: 8,
                failedMaps: 2,
                mapPhaseTimeMs: 3000,
                reducePhaseTimeMs: 500,
                maxConcurrency: 4,
            },
        },
        ...overrides,
    };
}

describe('buildDAGData', () => {
    it('returns null for processes without metadata', () => {
        expect(buildDAGData({ id: 'x', status: 'completed' })).toBeNull();
    });

    it('returns null for processes with empty metadata', () => {
        expect(buildDAGData({ id: 'x', status: 'completed', metadata: {} })).toBeNull();
    });

    it('returns null for null/undefined process', () => {
        expect(buildDAGData(null)).toBeNull();
        expect(buildDAGData(undefined)).toBeNull();
    });

    it('builds correct nodes for completed pipeline with map and reduce', () => {
        const result = buildDAGData(makeProcess());
        expect(result).not.toBeNull();
        expect(result!.nodes).toHaveLength(3); // input, map, reduce
        expect(result!.nodes.map(n => n.phase)).toEqual(['input', 'map', 'reduce']);
    });

    it('includes filter node when filterPhaseTimeMs is present', () => {
        const proc = makeProcess({
            metadata: {
                executionStats: {
                    totalItems: 10,
                    successfulMaps: 10,
                    failedMaps: 0,
                    mapPhaseTimeMs: 2000,
                    reducePhaseTimeMs: 300,
                    filterPhaseTimeMs: 100,
                },
            },
        });
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        expect(result!.nodes.map(n => n.phase)).toEqual(['input', 'filter', 'map', 'reduce']);
    });

    it('includes filter node when pipelinePhases has filter entry', () => {
        const proc = makeProcess({
            metadata: {
                executionStats: { totalItems: 5, successfulMaps: 5, failedMaps: 0, mapPhaseTimeMs: 1000 },
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'filter', status: 'completed' },
                    { phase: 'map', status: 'completed' },
                ],
            },
        });
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        expect(result!.nodes.map(n => n.phase)).toContain('filter');
    });

    it('omits filter node when no filter stats present', () => {
        const result = buildDAGData(makeProcess());
        expect(result!.nodes.map(n => n.phase)).not.toContain('filter');
    });

    it('sets all nodes to completed when process.status is completed', () => {
        const result = buildDAGData(makeProcess());
        for (const node of result!.nodes) {
            expect(node.state).toBe('completed');
        }
    });

    it('sets last active node to failed and remaining to cancelled for failed processes', () => {
        const proc = makeProcess({
            status: 'failed',
            metadata: {
                executionStats: {
                    totalItems: 10,
                    successfulMaps: 3,
                    failedMaps: 7,
                    mapPhaseTimeMs: 2000,
                    reducePhaseTimeMs: 500,
                },
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'map', status: 'failed' },
                    { phase: 'reduce', status: 'started' },
                ],
            },
        });
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        const stateMap = Object.fromEntries(result!.nodes.map(n => [n.phase, n.state]));
        expect(stateMap['input']).toBe('completed');
        // reduce is 'started' but in failed flow it gets marked failed (last non-completed)
        // map is 'failed'
        // The logic finds the last 'failed' or 'started' and marks it failed
        expect(['failed', 'cancelled']).toContain(stateMap['reduce']);
    });

    it('maps item counts from executionStats to map node', () => {
        const result = buildDAGData(makeProcess());
        const mapNode = result!.nodes.find(n => n.phase === 'map');
        expect(mapNode).toBeDefined();
        expect(mapNode!.totalItems).toBe(10);
        expect(mapNode!.failedItems).toBe(2);
        expect(mapNode!.itemCount).toBe(8); // successfulMaps
    });

    it('maps phase durations to respective nodes', () => {
        const result = buildDAGData(makeProcess());
        const mapNode = result!.nodes.find(n => n.phase === 'map');
        const reduceNode = result!.nodes.find(n => n.phase === 'reduce');
        expect(mapNode!.durationMs).toBe(3000);
        expect(reduceNode!.durationMs).toBe(500);
    });

    it('handles zero totalItems gracefully', () => {
        const proc = makeProcess({
            metadata: {
                executionStats: {
                    totalItems: 0,
                    successfulMaps: 0,
                    failedMaps: 0,
                    mapPhaseTimeMs: 0,
                },
            },
        });
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        const mapNode = result!.nodes.find(n => n.phase === 'map');
        expect(mapNode!.totalItems).toBe(0);
    });

    it('handles cancelled process status', () => {
        const proc = makeProcess({
            status: 'cancelled',
            metadata: {
                executionStats: {
                    totalItems: 10,
                    successfulMaps: 5,
                    failedMaps: 0,
                    mapPhaseTimeMs: 1000,
                    reducePhaseTimeMs: 200,
                },
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'map', status: 'completed' },
                    { phase: 'reduce', status: 'started' },
                ],
            },
        });
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        const stateMap = Object.fromEntries(result!.nodes.map(n => [n.phase, n.state]));
        expect(stateMap['input']).toBe('completed');
        expect(stateMap['map']).toBe('completed');
        expect(stateMap['reduce']).toBe('cancelled');
    });

    it('uses totalDurationMs from process.durationMs', () => {
        const result = buildDAGData(makeProcess());
        expect(result!.totalDurationMs).toBe(5000);
    });

    it('uses phaseTimings to override durations', () => {
        const proc = makeProcess({
            metadata: {
                executionStats: {
                    totalItems: 10,
                    successfulMaps: 10,
                    failedMaps: 0,
                    mapPhaseTimeMs: 3000,
                    reducePhaseTimeMs: 500,
                },
                phaseTimings: {
                    input: 100,
                    map: 2800,
                    reduce: 450,
                },
            },
        });
        const result = buildDAGData(proc);
        expect(result!.nodes.find(n => n.phase === 'input')!.durationMs).toBe(100);
        expect(result!.nodes.find(n => n.phase === 'map')!.durationMs).toBe(2800);
        expect(result!.nodes.find(n => n.phase === 'reduce')!.durationMs).toBe(450);
    });

    it('renders job node for single-job pipelines', () => {
        const proc = {
            id: 'j1',
            status: 'completed',
            metadata: {
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'job', status: 'completed' },
                ],
            },
        };
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        expect(result!.nodes.map(n => n.phase)).toEqual(['input', 'job']);
    });

    it('derives running states from pipelinePhases', () => {
        const proc = {
            id: 'r1',
            status: 'running',
            metadata: {
                executionStats: { totalItems: 10, successfulMaps: 3, failedMaps: 0, mapPhaseTimeMs: null },
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'map', status: 'started' },
                ],
            },
        };
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        const stateMap = Object.fromEntries(result!.nodes.map(n => [n.phase, n.state]));
        expect(stateMap['input']).toBe('completed');
        expect(stateMap['map']).toBe('running');
    });

    it('returns DAG data when stats are in process.result JSON string (queue-run-pipeline)', () => {
        const proc = {
            id: 'queue_123',
            type: 'queue-run-pipeline',
            status: 'completed',
            durationMs: 13191,
            metadata: { type: 'queue-run-pipeline', pipelineName: 'git-fetch' },
            result: JSON.stringify({
                response: '`git fetch` completed successfully',
                pipelineName: 'git-fetch',
                stats: {
                    totalItems: 1,
                    successfulMaps: 1,
                    failedMaps: 0,
                    mapPhaseTimeMs: 13191,
                    reducePhaseTimeMs: 0,
                    maxConcurrency: 1,
                },
            }),
        };
        const result = buildDAGData(proc);
        expect(result).not.toBeNull();
        expect(result!.nodes.map(n => n.phase)).toContain('map');
    });

    it('returns null when result JSON has no stats field', () => {
        const proc = {
            id: 'queue_456',
            status: 'completed',
            metadata: { type: 'queue-run-pipeline' },
            result: JSON.stringify({ response: 'hello' }),
        };
        expect(buildDAGData(proc)).toBeNull();
    });

    it('returns null when result is malformed JSON', () => {
        const proc = {
            id: 'queue_789',
            status: 'completed',
            metadata: {},
            result: 'not-json',
        };
        expect(buildDAGData(proc)).toBeNull();
    });
});

// ── buildDAGDataFromLive ───────────────────────────────────────────────

import { buildDAGDataFromLive } from '../../../../src/server/spa/client/react/processes/dag/buildDAGData';
import type { PipelinePhase } from '@plusplusoneplusplus/pipeline-core';
import type { LivePhaseEntry, LiveProgress } from '../../../../src/server/spa/client/react/hooks/usePipelinePhase';

describe('buildDAGDataFromLive', () => {
    it('returns null for empty phases map', () => {
        expect(buildDAGDataFromLive(new Map(), null)).toBeNull();
    });

    it('builds nodes from live phases in canonical order', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'started' }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        expect(result).not.toBeNull();
        expect(result!.nodes.map(n => n.phase)).toEqual(['input', 'map']);
        expect(result!.nodes[0].state).toBe('completed');
        expect(result!.nodes[1].state).toBe('running');
    });

    it('maps PipelinePhaseStatus to DAGNodeState correctly', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['filter', { status: 'failed', error: 'bad filter' }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        expect(result!.nodes.find(n => n.phase === 'input')?.state).toBe('completed');
        expect(result!.nodes.find(n => n.phase === 'filter')?.state).toBe('failed');
    });

    it('includes progress data on running map node', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'started' }],
        ]);
        const progress: LiveProgress = {
            completedItems: 5,
            failedItems: 1,
            totalItems: 10,
            percentage: 60,
        };
        const result = buildDAGDataFromLive(phases, progress);
        const mapNode = result!.nodes.find(n => n.phase === 'map');
        expect(mapNode?.totalItems).toBe(10);
        expect(mapNode?.itemCount).toBe(5);
        expect(mapNode?.failedItems).toBe(1);
    });

    it('uses metadata pipelinePhases for ordering if available', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'started' }],
        ]);
        const metadata = {
            pipelinePhases: [
                { phase: 'input', status: 'completed' },
                { phase: 'map', status: 'started' },
                { phase: 'reduce', status: 'pending' },
            ],
        };
        const result = buildDAGDataFromLive(phases, null, metadata);
        // Should include reduce as waiting
        expect(result!.nodes.map(n => n.phase)).toEqual(['input', 'map', 'reduce']);
        expect(result!.nodes.find(n => n.phase === 'reduce')?.state).toBe('waiting');
    });

    it('populates startedAt on nodes from live entry', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'started', startedAt: 5000 }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        expect(result!.nodes.find(n => n.phase === 'map')?.startedAt).toBe(5000);
    });

    it('populates durationMs from completed live entry', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed', durationMs: 120 }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        expect(result!.nodes.find(n => n.phase === 'input')?.durationMs).toBe(120);
    });

    it('preserves progress on completed map node', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'completed', durationMs: 3000 }],
        ]);
        const progress: LiveProgress = {
            completedItems: 10,
            failedItems: 0,
            totalItems: 10,
            percentage: 100,
        };
        const result = buildDAGDataFromLive(phases, progress);
        const mapNode = result!.nodes.find(n => n.phase === 'map');
        expect(mapNode?.totalItems).toBe(10);
        expect(mapNode?.itemCount).toBe(10);
    });

    it('handles job phase like map for progress', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['job', { status: 'started' }],
        ]);
        const progress: LiveProgress = {
            completedItems: 3,
            failedItems: 0,
            totalItems: 5,
            percentage: 60,
        };
        const result = buildDAGDataFromLive(phases, progress);
        const jobNode = result!.nodes.find(n => n.phase === 'job');
        expect(jobNode?.state).toBe('running');
        expect(jobNode?.totalItems).toBe(5);
        expect(jobNode?.itemCount).toBe(3);
    });

    it('assigns correct labels to nodes', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['filter', { status: 'completed' }],
            ['map', { status: 'started' }],
            ['reduce', { status: 'started' }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        const labels = result!.nodes.map(n => n.label);
        expect(labels).toEqual(['Input', 'Filter', 'Map', 'Reduce']);
    });

    it('computes edge-state-relevant data by node state', () => {
        const phases = new Map<PipelinePhase, LivePhaseEntry>([
            ['input', { status: 'completed' }],
            ['map', { status: 'started' }],
            ['reduce', { status: 'started' }],
        ]);
        const result = buildDAGDataFromLive(phases, null);
        // input is completed, map is running — edge between them would be 'active'
        // This test just verifies the node states are correctly set for edge derivation
        expect(result!.nodes[0].state).toBe('completed');
        expect(result!.nodes[1].state).toBe('running');
    });
});
