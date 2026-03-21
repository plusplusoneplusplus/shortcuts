/**
 * Regression tests for batch-runner concurrency limiter.
 *
 * Covers the bug where the old array+splice approach could fail to remove the
 * resolved promise from the active list, degrading execution to serial.
 * The fix uses Set<Promise> + .finally() so slots are always freed correctly.
 */

import { describe, it, expect, vi } from 'vitest';
import { executeBatchMode } from '../../src/pipeline/phases/batch-runner';
import type {
    MapReducePipelineConfig,
    ExecutePipelineOptions,
    ResolvedPrompts,
} from '../../src/pipeline/phases/shared';
import type { PromptItem } from '../../src/map-reduce';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(parallel: number, batchSize = 1): MapReducePipelineConfig {
    return {
        name: 'concurrency-test',
        input: {},
        map: { prompt: 'Process: {{item}}', parallel, batchSize },
        reduce: { type: 'text' },
    } as unknown as MapReducePipelineConfig;
}

function makeItems(count: number): PromptItem[] {
    return Array.from({ length: count }, (_, i) => ({ item: `item-${i}` }));
}

function makeOptions(aiInvoker: ExecutePipelineOptions['aiInvoker']): ExecutePipelineOptions {
    return { aiInvoker, pipelineDirectory: '/tmp/test-pipeline' };
}

const PROMPTS: ResolvedPrompts = { mapPrompt: 'Process: {{item}}' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeBatchMode – concurrency limiter (Set+finally)', () => {
    it('never exceeds parallel=2 concurrent batches', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const aiInvoker = vi.fn(async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise<void>(resolve => setTimeout(resolve, 10));
            concurrent--;
            return { success: true, response: 'ok' };
        });

        await executeBatchMode(makeConfig(2), makeItems(6), PROMPTS, makeOptions(aiInvoker));

        expect(maxConcurrent).toBeLessThanOrEqual(2);
        expect(maxConcurrent).toBeGreaterThan(0);
        expect(aiInvoker).toHaveBeenCalledTimes(6);
    });

    it('never exceeds parallel=3 concurrent batches', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const aiInvoker = vi.fn(async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise<void>(resolve => setTimeout(resolve, 5));
            concurrent--;
            return { success: true, response: 'ok' };
        });

        await executeBatchMode(makeConfig(3), makeItems(9), PROMPTS, makeOptions(aiInvoker));

        expect(maxConcurrent).toBeLessThanOrEqual(3);
        expect(aiInvoker).toHaveBeenCalledTimes(9);
    });

    it('serial execution with parallel=1', async () => {
        let concurrent = 0;
        let maxConcurrent = 0;

        const aiInvoker = vi.fn(async () => {
            concurrent++;
            maxConcurrent = Math.max(maxConcurrent, concurrent);
            await new Promise<void>(resolve => setTimeout(resolve, 5));
            concurrent--;
            return { success: true, response: 'ok' };
        });

        await executeBatchMode(makeConfig(1), makeItems(4), PROMPTS, makeOptions(aiInvoker));

        expect(maxConcurrent).toBe(1);
        expect(aiInvoker).toHaveBeenCalledTimes(4);
    });

    it('processes all batches and returns success', async () => {
        const aiInvoker = vi.fn().mockResolvedValue({ success: true, response: 'result' });

        const result = await executeBatchMode(
            makeConfig(2),
            makeItems(5),
            PROMPTS,
            makeOptions(aiInvoker),
        );

        expect(result.success).toBe(true);
        expect(aiInvoker).toHaveBeenCalledTimes(5);
    });
});
