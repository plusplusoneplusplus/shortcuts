import { describe, it, expect } from 'vitest';
import { aggregateTokenUsageStats } from '../../src/ai/token-usage-stats';
import type { SerializedAIProcess } from '../../src/ai/process-types';

function makeProcess(
    startTime: string,
    model: string | undefined,
    tokens: {
        inputTokens?: number;
        outputTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalTokens?: number;
        turnCount?: number;
        cost?: number;
        duration?: number;
    } | null = {}
): SerializedAIProcess {
    return {
        id: Math.random().toString(36).slice(2),
        promptPreview: '',
        fullPrompt: '',
        status: 'completed',
        startTime,
        metadata: model !== undefined ? { type: 'generic', model } : undefined,
        cumulativeTokenUsage: tokens === null ? undefined : {
            inputTokens: tokens.inputTokens ?? 10,
            outputTokens: tokens.outputTokens ?? 5,
            cacheReadTokens: tokens.cacheReadTokens ?? 0,
            cacheWriteTokens: tokens.cacheWriteTokens ?? 0,
            totalTokens: tokens.totalTokens ?? 15,
            turnCount: tokens.turnCount ?? 1,
            cost: tokens.cost,
            duration: tokens.duration,
        },
    } as SerializedAIProcess;
}

describe('aggregateTokenUsageStats', () => {
    it('1. empty input', () => {
        const result = aggregateTokenUsageStats([]);
        expect(result.entries).toEqual([]);
        expect(result.models).toEqual([]);
        expect(result.totalDays).toBe(0);
    });

    it('2. single process', () => {
        const proc = makeProcess('2024-06-01T10:00:00.000Z', 'gpt-4', {
            inputTokens: 100, outputTokens: 50, totalTokens: 150,
        });
        const result = aggregateTokenUsageStats([proc]);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].date).toBe('2024-06-01');
        expect(result.entries[0].byModel['gpt-4']).toBeDefined();
        expect(result.entries[0].byModel['gpt-4'].inputTokens).toBe(100);
        expect(result.models).toEqual(['gpt-4']);
    });

    it('3. two processes, same day, same model — tokens are summed', () => {
        const p1 = makeProcess('2024-06-01T08:00:00.000Z', 'gpt-4', { inputTokens: 100, totalTokens: 100 });
        const p2 = makeProcess('2024-06-01T12:00:00.000Z', 'gpt-4', { inputTokens: 200, totalTokens: 200 });
        const result = aggregateTokenUsageStats([p1, p2]);
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].byModel['gpt-4'].inputTokens).toBe(300);
    });

    it('4. two processes, same day, different models — dayTotal sums both', () => {
        const p1 = makeProcess('2024-06-01T08:00:00.000Z', 'gpt-4', { inputTokens: 100, totalTokens: 100 });
        const p2 = makeProcess('2024-06-01T09:00:00.000Z', 'gpt-3.5', { inputTokens: 50, totalTokens: 50 });
        const result = aggregateTokenUsageStats([p1, p2]);
        expect(result.entries).toHaveLength(1);
        expect(Object.keys(result.entries[0].byModel)).toHaveLength(2);
        expect(result.entries[0].dayTotal.inputTokens).toBe(150);
    });

    it('5. two processes, different days — sorted DESC', () => {
        const p1 = makeProcess('2024-06-01T10:00:00.000Z', 'gpt-4', {});
        const p2 = makeProcess('2024-06-02T10:00:00.000Z', 'gpt-4', {});
        const result = aggregateTokenUsageStats([p1, p2]);
        expect(result.entries).toHaveLength(2);
        expect(result.entries[0].date).toBe('2024-06-02');
        expect(result.entries[1].date).toBe('2024-06-01');
    });

    it('6. process with no metadata.model appears under "unknown"', () => {
        const p = makeProcess('2024-06-01T10:00:00.000Z', undefined, {});
        const result = aggregateTokenUsageStats([p]);
        expect(result.entries[0].byModel['unknown']).toBeDefined();
        expect(result.models).toContain('unknown');
    });

    it('7. options.days filters old processes', () => {
        const now = Date.now();
        const old = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();
        const recent = new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString();
        const pOld = makeProcess(old, 'gpt-4', { inputTokens: 999 });
        const pRecent = makeProcess(recent, 'gpt-4', { inputTokens: 10 });
        const result = aggregateTokenUsageStats([pOld, pRecent], { days: 7 });
        expect(result.entries).toHaveLength(1);
        expect(result.entries[0].byModel['gpt-4'].inputTokens).toBe(10);
    });

    it('8. cost is undefined when no process has cost', () => {
        const p = makeProcess('2024-06-01T10:00:00.000Z', 'gpt-4', { cost: undefined });
        const result = aggregateTokenUsageStats([p]);
        expect(result.entries[0].dayTotal.cost).toBeUndefined();
        expect(result.entries[0].byModel['gpt-4'].cost).toBeUndefined();
    });

    it('9. cost is summed when at least one process has cost', () => {
        const p1 = makeProcess('2024-06-01T08:00:00.000Z', 'gpt-4', { cost: 0.01 });
        const p2 = makeProcess('2024-06-01T09:00:00.000Z', 'gpt-4', { cost: undefined });
        const result = aggregateTokenUsageStats([p1, p2]);
        expect(result.entries[0].byModel['gpt-4'].cost).toBeCloseTo(0.01);
        expect(result.entries[0].dayTotal.cost).toBeCloseTo(0.01);
    });
});
