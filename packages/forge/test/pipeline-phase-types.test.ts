import { describe, it, expect } from 'vitest';
import type {
    ProcessOutputEvent,
    PipelinePhase,
    PipelinePhaseStatus,
    PipelinePhaseEvent,
    PipelineProgressEvent,
    PipelinePhaseInfo,
    PipelineProcessMetadata,
    FilterStats,
} from '../src/index';

describe('Pipeline Phase Types', () => {
    describe('ProcessOutputEvent with pipeline-phase type', () => {
        it('should construct a pipeline-phase event', () => {
            const event: ProcessOutputEvent = {
                type: 'pipeline-phase',
                pipelinePhase: {
                    phase: 'map',
                    status: 'started',
                    timestamp: '2026-01-15T10:00:00.000Z',
                    itemCount: 42,
                },
            };
            expect(event.type).toBe('pipeline-phase');
            expect(event.pipelinePhase?.phase).toBe('map');
            expect(event.pipelinePhase?.status).toBe('started');
            expect(event.pipelinePhase?.timestamp).toBe('2026-01-15T10:00:00.000Z');
            expect(event.pipelinePhase?.itemCount).toBe(42);
        });

        it('should construct a pipeline-phase event with durationMs and error for failed status', () => {
            const event: ProcessOutputEvent = {
                type: 'pipeline-phase',
                pipelinePhase: {
                    phase: 'filter',
                    status: 'failed',
                    timestamp: '2026-01-15T10:00:01.000Z',
                    durationMs: 1500,
                    error: 'Filter timeout',
                },
            };
            expect(event.pipelinePhase?.durationMs).toBe(1500);
            expect(event.pipelinePhase?.error).toBe('Filter timeout');
        });
    });

    describe('ProcessOutputEvent with pipeline-progress type', () => {
        it('should construct a pipeline-progress event', () => {
            const event: ProcessOutputEvent = {
                type: 'pipeline-progress',
                pipelineProgress: {
                    phase: 'map',
                    totalItems: 100,
                    completedItems: 50,
                    failedItems: 2,
                    percentage: 50,
                    message: 'Processing items...',
                },
            };
            expect(event.type).toBe('pipeline-progress');
            expect(event.pipelineProgress?.totalItems).toBe(100);
            expect(event.pipelineProgress?.completedItems).toBe(50);
            expect(event.pipelineProgress?.failedItems).toBe(2);
            expect(event.pipelineProgress?.percentage).toBe(50);
            expect(event.pipelineProgress?.message).toBe('Processing items...');
        });
    });

    describe('PipelinePhaseEvent construction', () => {
        const phases: PipelinePhase[] = ['input', 'filter', 'map', 'reduce', 'job'];
        const statuses: PipelinePhaseStatus[] = ['started', 'completed', 'failed'];

        for (const phase of phases) {
            for (const status of statuses) {
                it(`should construct event for phase=${phase}, status=${status}`, () => {
                    const event: PipelinePhaseEvent = {
                        phase,
                        status,
                        timestamp: new Date().toISOString(),
                    };
                    expect(event.phase).toBe(phase);
                    expect(event.status).toBe(status);
                    expect(event.timestamp).toBeTruthy();
                });
            }
        }
    });

    describe('PipelineProgressEvent construction', () => {
        it('should handle 0% progress', () => {
            const event: PipelineProgressEvent = {
                phase: 'map',
                totalItems: 50,
                completedItems: 0,
                failedItems: 0,
                percentage: 0,
            };
            expect(event.percentage).toBe(0);
            expect(event.completedItems).toBe(0);
        });

        it('should handle 100% progress', () => {
            const event: PipelineProgressEvent = {
                phase: 'reduce',
                totalItems: 10,
                completedItems: 10,
                failedItems: 0,
                percentage: 100,
            };
            expect(event.percentage).toBe(100);
            expect(event.completedItems).toBe(event.totalItems);
        });

        it('should handle partial progress with failures', () => {
            const event: PipelineProgressEvent = {
                phase: 'map',
                totalItems: 20,
                completedItems: 15,
                failedItems: 3,
                percentage: 75,
                message: '15/20 done, 3 failed',
            };
            expect(event.failedItems).toBe(3);
            expect(event.message).toBe('15/20 done, 3 failed');
        });
    });

    describe('PipelineProcessMetadata construction', () => {
        it('should construct with realistic phase data', () => {
            const metadata: PipelineProcessMetadata = {
                pipelinePhases: [
                    {
                        phase: 'input',
                        status: 'completed',
                        startedAt: '2026-01-15T10:00:00.000Z',
                        completedAt: '2026-01-15T10:00:01.000Z',
                        durationMs: 1000,
                        itemCount: 50,
                    },
                    {
                        phase: 'filter',
                        status: 'completed',
                        startedAt: '2026-01-15T10:00:01.000Z',
                        completedAt: '2026-01-15T10:00:03.000Z',
                        durationMs: 2000,
                        itemCount: 30,
                    },
                    {
                        phase: 'map',
                        status: 'completed',
                        startedAt: '2026-01-15T10:00:03.000Z',
                        completedAt: '2026-01-15T10:00:10.000Z',
                        durationMs: 7000,
                        itemCount: 30,
                    },
                    {
                        phase: 'reduce',
                        status: 'completed',
                        startedAt: '2026-01-15T10:00:10.000Z',
                        completedAt: '2026-01-15T10:00:12.000Z',
                        durationMs: 2000,
                    },
                ],
                phaseTimings: {
                    input: 1000,
                    filter: 2000,
                    map: 7000,
                    reduce: 2000,
                    job: 0,
                },
                inputItemCount: 50,
            };
            expect(metadata.pipelinePhases).toHaveLength(4);
            expect(metadata.phaseTimings.map).toBe(7000);
            expect(metadata.inputItemCount).toBe(50);
        });

        it('should construct with optional filterStats', () => {
            const filterStats: FilterStats = {
                totalItems: 50,
                includedCount: 30,
                excludedCount: 20,
                executionTimeMs: 2000,
                filterType: 'hybrid',
            };
            const metadata: PipelineProcessMetadata = {
                pipelinePhases: [],
                phaseTimings: { input: 0, filter: 0, map: 0, reduce: 0, job: 0 },
                filterStats,
            };
            expect(metadata.filterStats?.totalItems).toBe(50);
            expect(metadata.filterStats?.filterType).toBe('hybrid');
        });

        it('should construct PipelinePhaseInfo with failed status and error', () => {
            const info: PipelinePhaseInfo = {
                phase: 'map',
                status: 'failed',
                startedAt: '2026-01-15T10:00:00.000Z',
                durationMs: 5000,
                error: 'AI service unavailable',
            };
            expect(info.status).toBe('failed');
            expect(info.error).toBe('AI service unavailable');
            expect(info.completedAt).toBeUndefined();
        });
    });

    describe('Backward compatibility', () => {
        it('should construct chunk event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'chunk',
                content: 'Hello',
            };
            expect(event.type).toBe('chunk');
            expect(event.pipelinePhase).toBeUndefined();
            expect(event.pipelineProgress).toBeUndefined();
        });

        it('should construct complete event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'complete',
                status: 'completed',
                duration: '5.2s',
            };
            expect(event.type).toBe('complete');
            expect(event.pipelinePhase).toBeUndefined();
        });

        it('should construct tool-start event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'tool-start',
                toolName: 'read_file',
                toolCallId: 'tc-1',
                turnIndex: 0,
            };
            expect(event.type).toBe('tool-start');
        });

        it('should construct tool-complete event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'tool-complete',
                toolCallId: 'tc-1',
                result: 'file contents',
            };
            expect(event.type).toBe('tool-complete');
        });

        it('should construct tool-failed event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'tool-failed',
                toolCallId: 'tc-1',
                error: 'File not found',
            };
            expect(event.type).toBe('tool-failed');
        });

        it('should construct permission-request event without new fields', () => {
            const event: ProcessOutputEvent = {
                type: 'permission-request',
                permissionId: 'perm-1',
                kind: 'write',
                description: 'Write to file',
            };
            expect(event.type).toBe('permission-request');
        });
    });
});
