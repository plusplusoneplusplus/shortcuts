/**
 * Tests for Pipeline Executor Phase Emission
 *
 * Verifies that the pipeline executor emits structured PipelinePhaseEvent
 * events at every phase boundary — input, filter, map, reduce, and completion.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    executePipelineWithItems,
    PipelineConfig,
    AIInvokerResult,
    PipelinePhaseEvent,
} from '../../src/pipeline';

describe('Pipeline Executor Phase Events', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'phase-events-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // Helper to create a mock AI invoker
    function createMockAIInvoker(
        responses?: Map<string, string> | ((prompt: string, options?: { model?: string }) => AIInvokerResult)
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt: string, options?: { model?: string }): Promise<AIInvokerResult> => {
            if (typeof responses === 'function') {
                return responses(prompt, options);
            }
            if (responses) {
                for (const [key, response] of responses) {
                    if (prompt.includes(key)) {
                        return { success: true, response };
                    }
                }
            }
            return { success: true, response: '{"result": "default"}' };
        };
    }

    // Helper to create test CSV
    async function createTestCSV(filename: string, content: string): Promise<string> {
        const filePath = path.join(tempDir, filename);
        await fs.promises.writeFile(filePath, content);
        return filePath;
    }

    // Helper: collect phase events from a pipeline execution
    function createPhaseCollector(): { events: PipelinePhaseEvent[]; callback: (e: PipelinePhaseEvent) => void } {
        const events: PipelinePhaseEvent[] = [];
        return { events, callback: (e: PipelinePhaseEvent) => events.push(e) };
    }

    // --------------------------------------------------------------------------
    // Input phase events
    // --------------------------------------------------------------------------

    describe('input phase events', () => {
        it('emits input started/completed events for inline items', async () => {
            const config: PipelineConfig = {
                name: 'Input Phase Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const inputEvents = events.filter(e => e.phase === 'input');
            expect(inputEvents.length).toBe(2);
            expect(inputEvents[0].status).toBe('started');
            expect(inputEvents[1].status).toBe('completed');
            expect(inputEvents[1].itemCount).toBe(2);
        });

        it('emits input started/completed events for CSV input', async () => {
            await createTestCSV('data.csv', 'id,title\n1,Bug A\n2,Bug B\n3,Bug C');

            const config: PipelineConfig = {
                name: 'CSV Input Test',
                input: { from: { type: 'csv' as const, path: 'data.csv' } },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const inputEvents = events.filter(e => e.phase === 'input');
            expect(inputEvents.length).toBe(2);
            expect(inputEvents[0].status).toBe('started');
            expect(inputEvents[1].status).toBe('completed');
            expect(inputEvents[1].itemCount).toBe(3);
        });

        it('emits input failed event on invalid CSV path', async () => {
            const config: PipelineConfig = {
                name: 'Bad CSV Test',
                input: { from: { type: 'csv' as const, path: 'nonexistent.csv' } },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await expect(
                executePipeline(config, {
                    aiInvoker: createMockAIInvoker(),
                    pipelineDirectory: tempDir,
                    onPhaseChange: callback,
                })
            ).rejects.toThrow();

            const inputEvents = events.filter(e => e.phase === 'input');
            expect(inputEvents.some(e => e.status === 'started')).toBe(true);
            expect(inputEvents.some(e => e.status === 'failed')).toBe(true);
            const failed = inputEvents.find(e => e.status === 'failed')!;
            expect(failed.error).toBeDefined();
        });

        it('emits input completed event for executePipelineWithItems', async () => {
            const config: PipelineConfig = {
                name: 'Pre-approved Items Test',
                input: { items: [] }, // placeholder; items provided externally
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipelineWithItems(
                config,
                [{ id: '1', title: 'A' }, { id: '2', title: 'B' }, { id: '3', title: 'C' }],
                {
                    aiInvoker: createMockAIInvoker(),
                    pipelineDirectory: tempDir,
                    onPhaseChange: callback,
                }
            );

            const inputEvents = events.filter(e => e.phase === 'input');
            expect(inputEvents.length).toBe(1);
            expect(inputEvents[0].status).toBe('completed');
            expect(inputEvents[0].itemCount).toBe(3);
        });
    });

    // --------------------------------------------------------------------------
    // Filter phase events
    // --------------------------------------------------------------------------

    describe('filter phase events', () => {
        it('emits filter started/completed events when filter is configured', async () => {
            const config: PipelineConfig = {
                name: 'Filter Phase Test',
                input: {
                    items: [
                        { id: '1', priority: 'high', title: 'A' },
                        { id: '2', priority: 'low', title: 'B' },
                        { id: '3', priority: 'high', title: 'C' },
                    ],
                },
                filter: {
                    type: 'rule',
                    rule: { rules: [{ field: 'priority', operator: 'equals', value: 'high' }] },
                },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const filterEvents = events.filter(e => e.phase === 'filter');
            expect(filterEvents.length).toBe(2);
            expect(filterEvents[0].status).toBe('started');
            expect(filterEvents[0].itemCount).toBe(3);
            expect(filterEvents[1].status).toBe('completed');
            expect(filterEvents[1].itemCount).toBe(2); // 2 items passed the filter
            expect(result.filterResult).toBeDefined();
        });

        it('does not emit filter events when no filter is configured', async () => {
            const config: PipelineConfig = {
                name: 'No Filter Test',
                input: { items: [{ id: '1', title: 'A' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const filterEvents = events.filter(e => e.phase === 'filter');
            expect(filterEvents.length).toBe(0);
        });
    });

    // --------------------------------------------------------------------------
    // Map / Reduce phase events (standard mode)
    // --------------------------------------------------------------------------

    describe('map/reduce phase events (standard mode)', () => {
        it('emits map started/completed and reduce started/completed events', async () => {
            const config: PipelineConfig = {
                name: 'Standard MR Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const mapEvents = events.filter(e => e.phase === 'map');
            expect(mapEvents.some(e => e.status === 'started')).toBe(true);
            expect(mapEvents.some(e => e.status === 'completed')).toBe(true);

            const reduceEvents = events.filter(e => e.phase === 'reduce');
            expect(reduceEvents.some(e => e.status === 'started')).toBe(true);
            expect(reduceEvents.some(e => e.status === 'completed')).toBe(true);
        });

        it('map started event includes itemCount', async () => {
            const config: PipelineConfig = {
                name: 'Map ItemCount Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }, { id: '3', title: 'C' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const mapStarted = events.find(e => e.phase === 'map' && e.status === 'started');
            expect(mapStarted).toBeDefined();
            expect(mapStarted!.itemCount).toBe(3);
        });
    });

    // --------------------------------------------------------------------------
    // Batch mode phase events
    // --------------------------------------------------------------------------

    describe('batch mode phase events', () => {
        it('emits map/reduce phase events in batch mode', async () => {
            const config: PipelineConfig = {
                name: 'Batch Phase Test',
                input: {
                    items: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' },
                        { id: '3', title: 'C' },
                        { id: '4', title: 'D' },
                    ],
                },
                map: {
                    prompt: 'Analyze items: {{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2,
                },
                reduce: { type: 'list' },
            };

            const responses = new Map([
                ['Analyze items', '[{"severity":"high"},{"severity":"low"}]'],
            ]);

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const mapEvents = events.filter(e => e.phase === 'map');
            expect(mapEvents.some(e => e.status === 'started')).toBe(true);
            expect(mapEvents.some(e => e.status === 'completed')).toBe(true);

            const mapStarted = mapEvents.find(e => e.status === 'started')!;
            expect(mapStarted.itemCount).toBe(4);

            const reduceEvents = events.filter(e => e.phase === 'reduce');
            expect(reduceEvents.some(e => e.status === 'started')).toBe(true);
            expect(reduceEvents.some(e => e.status === 'completed')).toBe(true);
        });

        it('reduce completed event has durationMs in batch mode', async () => {
            const config: PipelineConfig = {
                name: 'Batch Duration Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
                map: { prompt: 'Analyze items: {{ITEMS}}', output: ['severity'], batchSize: 2 },
                reduce: { type: 'list' },
            };

            const responses = new Map([['Analyze items', '[{"severity":"high"},{"severity":"low"}]']]);
            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(responses),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const reduceCompleted = events.find(e => e.phase === 'reduce' && e.status === 'completed');
            expect(reduceCompleted).toBeDefined();
            expect(reduceCompleted!.durationMs).toBeDefined();
            expect(reduceCompleted!.durationMs).toBeGreaterThanOrEqual(0);
        });
    });

    // --------------------------------------------------------------------------
    // Single-job phase events
    // --------------------------------------------------------------------------

    describe('single-job phase events', () => {
        it('emits job started/completed events on success', async () => {
            const config: PipelineConfig = {
                name: 'Job Phase Test',
                job: { prompt: 'Do something useful' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(
                    () => ({ success: true, response: 'Done!' })
                ),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const jobEvents = events.filter(e => e.phase === 'job');
            expect(jobEvents.length).toBe(2);
            expect(jobEvents[0].status).toBe('started');
            expect(jobEvents[1].status).toBe('completed');
            expect(jobEvents[1].durationMs).toBeDefined();
            expect(jobEvents[1].durationMs).toBeGreaterThanOrEqual(0);
        });

        it('emits job failed event when AI call fails', async () => {
            const config: PipelineConfig = {
                name: 'Job Failure Test',
                job: { prompt: 'Do something' },
            };

            const { events, callback } = createPhaseCollector();

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(
                    () => ({ success: false, error: 'AI unavailable' })
                ),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            expect(result.success).toBe(false);
            const jobEvents = events.filter(e => e.phase === 'job');
            expect(jobEvents.some(e => e.status === 'started')).toBe(true);
            expect(jobEvents.some(e => e.status === 'failed')).toBe(true);
            const failed = jobEvents.find(e => e.status === 'failed')!;
            expect(failed.error).toBeDefined();
        });

        it('emits job failed event on JSON parse error', async () => {
            const config: PipelineConfig = {
                name: 'Job Parse Failure',
                job: { prompt: 'Do something', output: ['result'] },
            };

            const { events, callback } = createPhaseCollector();

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(
                    () => ({ success: true, response: 'not json at all' })
                ),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            expect(result.success).toBe(false);
            const jobEvents = events.filter(e => e.phase === 'job');
            expect(jobEvents.some(e => e.status === 'failed')).toBe(true);
            const failed = jobEvents.find(e => e.status === 'failed')!;
            expect(failed.error).toContain('parse');
        });
    });

    // --------------------------------------------------------------------------
    // Full lifecycle and ordering
    // --------------------------------------------------------------------------

    describe('full lifecycle', () => {
        it('emits phases in correct order: input → map → reduce', async () => {
            const config: PipelineConfig = {
                name: 'Lifecycle Test',
                input: { items: [{ id: '1', title: 'A' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const phases = events.map(e => `${e.phase}:${e.status}`);
            const inputStartIdx = phases.indexOf('input:started');
            const inputCompleteIdx = phases.indexOf('input:completed');
            const mapStartIdx = phases.indexOf('map:started');
            const mapCompleteIdx = phases.indexOf('map:completed');
            const reduceStartIdx = phases.indexOf('reduce:started');
            const reduceCompleteIdx = phases.indexOf('reduce:completed');

            expect(inputStartIdx).toBeLessThan(inputCompleteIdx);
            expect(inputCompleteIdx).toBeLessThan(mapStartIdx);
            expect(mapStartIdx).toBeLessThan(mapCompleteIdx);
            expect(mapCompleteIdx).toBeLessThan(reduceStartIdx);
            expect(reduceStartIdx).toBeLessThan(reduceCompleteIdx);
        });

        it('emits phases in correct order: input → filter → map → reduce', async () => {
            const config: PipelineConfig = {
                name: 'Full Lifecycle with Filter',
                input: {
                    items: [
                        { id: '1', priority: 'high', title: 'A' },
                        { id: '2', priority: 'low', title: 'B' },
                    ],
                },
                filter: {
                    type: 'rule',
                    rule: { rules: [{ field: 'priority', operator: 'equals', value: 'high' }] },
                },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            const phases = events.map(e => `${e.phase}:${e.status}`);
            const inputCompleteIdx = phases.indexOf('input:completed');
            const filterStartIdx = phases.indexOf('filter:started');
            const filterCompleteIdx = phases.indexOf('filter:completed');
            const mapStartIdx = phases.indexOf('map:started');

            expect(inputCompleteIdx).toBeLessThan(filterStartIdx);
            expect(filterStartIdx).toBeLessThan(filterCompleteIdx);
            expect(filterCompleteIdx).toBeLessThan(mapStartIdx);
        });

        it('phase events have valid ISO timestamps', async () => {
            const config: PipelineConfig = {
                name: 'Timestamp Test',
                input: { items: [{ id: '1', title: 'A' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            expect(events.length).toBeGreaterThan(0);
            for (const event of events) {
                expect(event.timestamp).toBeDefined();
                const parsed = new Date(event.timestamp);
                expect(parsed.getTime()).not.toBeNaN();
            }
        });

        it('phase event timestamps are monotonically non-decreasing', async () => {
            const config: PipelineConfig = {
                name: 'Monotonic Timestamp Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
            });

            for (let i = 1; i < events.length; i++) {
                const prevTime = new Date(events[i - 1].timestamp).getTime();
                const currTime = new Date(events[i].timestamp).getTime();
                expect(currTime).toBeGreaterThanOrEqual(prevTime);
            }
        });
    });

    // --------------------------------------------------------------------------
    // No callback = no errors
    // --------------------------------------------------------------------------

    describe('callback omission', () => {
        it('executes normally when onPhaseChange is undefined', async () => {
            const config: PipelineConfig = {
                name: 'No Callback Test',
                input: { items: [{ id: '1', title: 'A' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                // onPhaseChange intentionally omitted
            });

            expect(result.success).toBe(true);
        });

        it('executes job mode normally when onPhaseChange is undefined', async () => {
            const config: PipelineConfig = {
                name: 'No Callback Job Test',
                job: { prompt: 'Do something' },
            };

            const result = await executePipeline(config, {
                aiInvoker: createMockAIInvoker(() => ({ success: true, response: 'Done' })),
                pipelineDirectory: tempDir,
            });

            expect(result.success).toBe(true);
        });
    });

    // --------------------------------------------------------------------------
    // Progress events alongside phase events
    // --------------------------------------------------------------------------

    describe('progress alongside phase events', () => {
        it('onProgress is still called when onPhaseChange is also set', async () => {
            const config: PipelineConfig = {
                name: 'Both Callbacks Test',
                input: { items: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }] },
                map: { prompt: 'Analyze: {{title}}', output: ['severity'] },
                reduce: { type: 'list' },
            };

            const progressEvents: any[] = [];
            const { events, callback } = createPhaseCollector();

            await executePipeline(config, {
                aiInvoker: createMockAIInvoker(),
                pipelineDirectory: tempDir,
                onPhaseChange: callback,
                onProgress: (p) => progressEvents.push(p),
            });

            expect(events.length).toBeGreaterThan(0);
            expect(progressEvents.length).toBeGreaterThan(0);
        });
    });
});
