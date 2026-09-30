import { describe, it, expect } from 'vitest';
import type { ConversationTurn, TimelineItem } from '@plusplusoneplusplus/forge';
import { createToolCallLedger } from '../../../src/server/executors/tool-call-ledger';

function item(
    type: TimelineItem['type'],
    id: string,
    name: string,
    extra: { result?: string; error?: string; parentToolCallId?: string } = {},
): TimelineItem {
    const status = type === 'tool-start' ? 'running' : type === 'tool-complete' ? 'completed' : 'failed';
    return {
        type,
        timestamp: new Date(),
        toolCall: { id, name, status, startTime: new Date(), args: {}, ...extra },
    };
}

function turn(turnIndex: number, timeline: TimelineItem[]): ConversationTurn {
    return { role: 'assistant', content: '', timestamp: new Date(), turnIndex, timeline };
}

describe('createToolCallLedger', () => {
    it('folds start/complete by id and the last status wins', async () => {
        const ledger = createToolCallLedger({
            getLiveTimeline: () => [
                item('tool-start', 'a', 'bash'),
                item('tool-start', 'b', 'grep'),
                item('tool-complete', 'a', 'bash', { result: 'A' }),
                item('tool-failed', 'b', 'grep', { error: 'boom' }),
            ],
            getStoredTurns: async () => [],
        });
        const entries = await ledger.list({ scope: 'current' });
        expect(entries.map(e => [e.id, e.status, e.result ?? e.error])).toEqual([
            ['a', 'completed', 'A'],
            ['b', 'failed', 'boom'],
        ]);
        expect(entries.every(e => e.current)).toBe(true);
    });

    it('merges stored turns before the live buffer and dedupes by id (live wins)', async () => {
        const ledger = createToolCallLedger({
            getLiveTimeline: () => [
                item('tool-complete', 'c', 'bash', { result: 'live' }),
                item('tool-start', 'd', 'view'),
            ],
            getStoredTurns: async () => [
                turn(0, [item('tool-complete', 'a', 'bash', { result: 'old' })]),
                // A throttled flush of the current turn already stored `c` as running.
                turn(1, [item('tool-start', 'c', 'bash')]),
            ],
        });
        const entries = await ledger.list({ scope: 'any' });
        expect(entries.map(e => [e.id, e.status, e.current])).toEqual([
            ['a', 'completed', false],
            ['c', 'completed', true],
            ['d', 'running', true],
        ]);
        expect(entries.find(e => e.id === 'c')?.result).toBe('live');
    });

    it('scope "current" ignores stored turns', async () => {
        const ledger = createToolCallLedger({
            getLiveTimeline: () => [item('tool-complete', 'b', 'bash', { result: 'B' })],
            getStoredTurns: async () => [turn(0, [item('tool-complete', 'a', 'bash', { result: 'A' })])],
        });
        expect((await ledger.list({ scope: 'current' })).map(e => e.id)).toEqual(['b']);
    });

    it('excludes the given id and skips nested calls', async () => {
        const ledger = createToolCallLedger({
            getLiveTimeline: () => [
                item('tool-complete', 'task-1', 'task', { result: 'summary' }),
                item('tool-complete', 'child', 'bash', { result: 'nested', parentToolCallId: 'task-1' }),
                item('tool-start', 'self', 'system_one'),
            ],
            getStoredTurns: async () => undefined,
        });
        expect((await ledger.list({ scope: 'any', excludeId: 'self' })).map(e => e.id)).toEqual(['task-1']);
    });

    it('returns nothing when there is no live buffer and no stored process', async () => {
        const ledger = createToolCallLedger({ getLiveTimeline: () => undefined, getStoredTurns: async () => undefined });
        expect(await ledger.list({ scope: 'any' })).toEqual([]);
    });
});
