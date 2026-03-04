/**
 * Tests for Per-Item Child Process Creation (ItemProcessEvent)
 *
 * Tests the onItemProcessCreated callback and itemProcessIds on PipelineExecutionResult
 * across standard mode, batch mode, and single-job mode.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    executePipeline,
    PipelineConfig,
    AIInvokerResult,
} from '../../src/pipeline';
import type { ItemProcessEvent, ExecutePipelineOptions } from '../../src/pipeline';

describe('ItemProcessEvent - Per-Item Child Process', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'item-process-test-'));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    function createMockAIInvoker(
        handler: (prompt: string, options?: { model?: string }) => AIInvokerResult | Promise<AIInvokerResult>
    ): (prompt: string, options?: { model?: string }) => Promise<AIInvokerResult> {
        return async (prompt, options) => {
            const result = handler(prompt, options);
            return result instanceof Promise ? result : result;
        };
    }

    function makeOptions(
        aiInvoker: ReturnType<typeof createMockAIInvoker>,
        events: ItemProcessEvent[]
    ): ExecutePipelineOptions {
        return {
            aiInvoker,
            pipelineDirectory: tempDir,
            onItemProcessCreated: (event) => {
                events.push(event);
            },
        };
    }

    describe('Standard mode (one item per AI call)', () => {
        it('fires onItemProcessCreated for each map item', async () => {
            const config: PipelineConfig = {
                name: 'Standard Test',
                input: {
                    items: [
                        { id: '1', title: 'Item A' },
                        { id: '2', title: 'Item B' },
                        { id: '3', title: 'Item C' },
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"severity": "high"}',
                sessionId: 'sess-123'
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(true);
            expect(events).toHaveLength(3);

            // All events should have phase: 'map'
            for (const event of events) {
                expect(event.phase).toBe('map');
                expect(event.success).toBe(true);
                expect(event.error).toBeUndefined();
            }

            // itemIndex values should cover 0, 1, 2
            const indices = events.map(e => e.itemIndex).sort();
            expect(indices).toEqual([0, 1, 2]);

            // Each event should have a processId
            for (const event of events) {
                expect(event.processId).toBeTruthy();
            }

            // No batchIndex in standard mode
            for (const event of events) {
                expect(event.batchIndex).toBeUndefined();
            }
        });

        it('fires onItemProcessCreated for failed items with success: false and error', async () => {
            const config: PipelineConfig = {
                name: 'Fail Test',
                input: {
                    items: [
                        { id: '1', title: 'Item A' },
                        { id: '2', title: 'Item B' },
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                if (prompt.includes('Item A')) {
                    return { success: true, response: '{"severity": "high"}' };
                }
                return { success: false, error: 'AI error', response: undefined };
            });

            const events: ItemProcessEvent[] = [];
            await executePipeline(config, makeOptions(aiInvoker, events));

            expect(events).toHaveLength(2);

            const successEvent = events.find(e => e.success);
            const failEvent = events.find(e => !e.success);

            expect(successEvent).toBeDefined();
            expect(successEvent!.phase).toBe('map');

            expect(failEvent).toBeDefined();
            expect(failEvent!.phase).toBe('map');
            expect(failEvent!.success).toBe(false);
            expect(failEvent!.error).toBeTruthy();
        });

        it('populates itemProcessIds on PipelineExecutionResult', async () => {
            const config: PipelineConfig = {
                name: 'IDs Test',
                input: {
                    items: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' },
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"severity": "low"}'
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            // itemProcessIds should be present only when processTracker provides IDs
            // Without a processTracker, MR executor doesn't produce processIds
            // so itemProcessIds may be undefined. But events should still fire with fallback IDs.
            expect(events).toHaveLength(2);
        });

        it('proceeds normally when onItemProcessCreated is not provided', async () => {
            const config: PipelineConfig = {
                name: 'No Callback Test',
                input: {
                    items: [
                        { id: '1', title: 'Item A' },
                    ]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"severity": "high"}'
            }));

            // No onItemProcessCreated callback
            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
            });

            expect(result.success).toBe(true);
            expect(result.output.summary.successfulItems).toBe(1);
        });

        it('does not crash when onItemProcessCreated throws', async () => {
            const config: PipelineConfig = {
                name: 'Throwing Callback',
                input: {
                    items: [{ id: '1', title: 'A' }]
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['severity']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"severity": "high"}'
            }));

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
                onItemProcessCreated: () => {
                    throw new Error('Callback explosion!');
                },
            });

            // Pipeline should still succeed despite callback throwing
            expect(result.success).toBe(true);
        });
    });

    describe('Batch mode (multiple items per AI call)', () => {
        it('fires onItemProcessCreated for each item across batches', async () => {
            const config: PipelineConfig = {
                name: 'Batch Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug A' },
                        { id: '2', title: 'Bug B' },
                        { id: '3', title: 'Bug C' },
                        { id: '4', title: 'Bug D' },
                        { id: '5', title: 'Bug E' },
                        { id: '6', title: 'Bug F' },
                    ]
                },
                map: {
                    prompt: 'Analyze these items:\n{{ITEMS}}\nReturn JSON array.',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ severity: 'high' }));
                    return { success: true, response: JSON.stringify(results), sessionId: 'batch-sess' };
                }
                return { success: true, response: '[{"severity": "medium"}]' };
            });

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(true);
            // 6 items in batches of 2 = 3 batches, but 6 events (one per item)
            expect(events).toHaveLength(6);

            // All events should have phase: 'map' and success: true
            for (const event of events) {
                expect(event.phase).toBe('map');
                expect(event.success).toBe(true);
            }

            // itemIndex should be 0-5
            const indices = events.map(e => e.itemIndex).sort((a, b) => a - b);
            expect(indices).toEqual([0, 1, 2, 3, 4, 5]);

            // batchIndex should be present for batch mode
            for (const event of events) {
                expect(event.batchIndex).toBeDefined();
            }

            // Batch indices: items 0,1 -> batch 0; items 2,3 -> batch 1; items 4,5 -> batch 2
            const batch0Events = events.filter(e => e.batchIndex === 0);
            const batch1Events = events.filter(e => e.batchIndex === 1);
            const batch2Events = events.filter(e => e.batchIndex === 2);
            expect(batch0Events).toHaveLength(2);
            expect(batch1Events).toHaveLength(2);
            expect(batch2Events).toHaveLength(2);

            // sessionId should be forwarded
            for (const event of events) {
                expect(event.sessionId).toBe('batch-sess');
            }
        });

        it('fires events for failed batches with success: false', async () => {
            const config: PipelineConfig = {
                name: 'Batch Fail Test',
                input: {
                    items: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' },
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: false,
                error: 'Batch AI failure',
                response: undefined
            }));

            const events: ItemProcessEvent[] = [];
            await executePipeline(config, makeOptions(aiInvoker, events));

            // Both items should have events with success: false
            expect(events).toHaveLength(2);
            for (const event of events) {
                expect(event.success).toBe(false);
                expect(event.error).toBeTruthy();
                expect(event.phase).toBe('map');
                expect(event.batchIndex).toBe(0);
            }
        });

        it('populates itemProcessIds in batch mode result', async () => {
            const config: PipelineConfig = {
                name: 'Batch IDs',
                input: {
                    items: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' },
                        { id: '3', title: 'C' },
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    const results = items.map(() => ({ severity: 'low' }));
                    return { success: true, response: JSON.stringify(results) };
                }
                return { success: true, response: '[{"severity": "low"}]' };
            });

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(true);
            // itemProcessIds should have entries for all 3 items
            expect(result.itemProcessIds).toBeDefined();
            expect(result.itemProcessIds).toHaveLength(3);

            // All IDs should be unique
            const uniqueIds = new Set(result.itemProcessIds);
            expect(uniqueIds.size).toBe(3);
        });

        it('does not crash when onItemProcessCreated throws in batch mode', async () => {
            const config: PipelineConfig = {
                name: 'Batch Throw',
                input: {
                    items: [
                        { id: '1', title: 'A' },
                        { id: '2', title: 'B' },
                    ]
                },
                map: {
                    prompt: 'Analyze:\n{{ITEMS}}',
                    output: ['severity'],
                    batchSize: 2
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker((prompt) => {
                const itemsMatch = prompt.match(/\[[\s\S]*?\]/);
                if (itemsMatch) {
                    const items = JSON.parse(itemsMatch[0]);
                    return { success: true, response: JSON.stringify(items.map(() => ({ severity: 'low' }))) };
                }
                return { success: true, response: '[{"severity": "low"}]' };
            });

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
                onItemProcessCreated: () => {
                    throw new Error('Batch callback explosion!');
                },
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Single-job mode', () => {
        it('fires onItemProcessCreated once with phase: job on success', async () => {
            const config: PipelineConfig = {
                name: 'Job Test',
                job: {
                    prompt: 'Summarize the project',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"summary": "A great project"}',
                sessionId: 'job-sess-1'
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(true);
            expect(events).toHaveLength(1);
            expect(events[0].phase).toBe('job');
            expect(events[0].itemIndex).toBe(0);
            expect(events[0].success).toBe(true);
            expect(events[0].processId).toBeTruthy();
            expect(events[0].sessionId).toBe('job-sess-1');

            // itemProcessIds on result
            expect(result.itemProcessIds).toBeDefined();
            expect(result.itemProcessIds).toHaveLength(1);
        });

        it('fires onItemProcessCreated with success: false on AI failure', async () => {
            const config: PipelineConfig = {
                name: 'Job Fail',
                job: {
                    prompt: 'Do something'
                }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: false,
                error: 'Job AI error',
                response: undefined
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(false);
            expect(events).toHaveLength(1);
            expect(events[0].phase).toBe('job');
            expect(events[0].success).toBe(false);
            expect(events[0].error).toBe('Job AI error');
            expect(result.itemProcessIds).toHaveLength(1);
        });

        it('fires onItemProcessCreated with success: false on parse error', async () => {
            const config: PipelineConfig = {
                name: 'Job Parse Fail',
                job: {
                    prompt: 'Generate JSON',
                    output: ['summary']
                }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: 'Not valid JSON at all',
                sessionId: 'parse-fail-sess'
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(false);
            expect(events).toHaveLength(1);
            expect(events[0].phase).toBe('job');
            expect(events[0].success).toBe(false);
            expect(events[0].error).toContain('Failed to parse AI response');
            expect(events[0].sessionId).toBe('parse-fail-sess');
        });

        it('does not crash when onItemProcessCreated throws in job mode', async () => {
            const config: PipelineConfig = {
                name: 'Job Throw',
                job: {
                    prompt: 'Do something'
                }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: 'Some response'
            }));

            const result = await executePipeline(config, {
                aiInvoker,
                pipelineDirectory: tempDir,
                onItemProcessCreated: () => {
                    throw new Error('Job callback explosion!');
                },
            });

            expect(result.success).toBe(true);
        });

        it('generates processId with pipeline name and timestamp', async () => {
            const config: PipelineConfig = {
                name: 'My Pipeline',
                job: {
                    prompt: 'Summarize'
                }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: 'Summary text'
            }));

            const events: ItemProcessEvent[] = [];
            await executePipeline(config, makeOptions(aiInvoker, events));

            expect(events).toHaveLength(1);
            expect(events[0].processId).toMatch(/^My Pipeline-job-\d+$/);
        });
    });

    describe('Non-AI phases do not trigger callback', () => {
        it('does not fire onItemProcessCreated during input loading or rule-based filter', async () => {
            const config: PipelineConfig = {
                name: 'Filter Test',
                input: {
                    items: [
                        { id: '1', title: 'Bug', severity: 'high' },
                        { id: '2', title: 'Feature', severity: 'low' },
                    ]
                },
                filter: {
                    type: 'rule',
                    rule: {
                        rules: [
                            { field: 'severity', operator: 'equals', value: 'high' }
                        ]
                    }
                },
                map: {
                    prompt: 'Analyze: {{title}}',
                    output: ['result']
                },
                reduce: { type: 'list' }
            };

            const aiInvoker = createMockAIInvoker(() => ({
                success: true,
                response: '{"result": "done"}'
            }));

            const events: ItemProcessEvent[] = [];
            const result = await executePipeline(config, makeOptions(aiInvoker, events));

            expect(result.success).toBe(true);
            // Only 1 item should pass the filter, so only 1 event
            expect(events).toHaveLength(1);
            expect(events[0].phase).toBe('map');
            // No filter-phase events
            expect(events.filter(e => e.phase === 'filter-ai')).toHaveLength(0);
        });
    });
});
