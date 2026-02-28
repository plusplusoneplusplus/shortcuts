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
});
