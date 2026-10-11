import { describe, expect, it } from 'vitest';
import type { AIProcess, ConversationTurn } from '@plusplusoneplusplus/forge';
import { createStubStore } from '../../src/server/processes/in-memory-process-store';
import { createMockProcessStore as createMockStore } from '../helpers/mock-process-store';
import { createMockProcessStore as createServerMockStore } from './helpers/mock-process-store';

describe.each([
    ['stub', createStubStore],
    ['mock', createMockStore],
    ['server mock', createServerMockStore],
] as const)('%s history parity', (_name, createStore) => {
    const fixture = (): AIProcess => ({
        id: 'history', type: 'ai', status: 'completed', fullPrompt: 'prompt',
        promptPreview: 'prompt', startTime: new Date('2026-01-01'),
        metadata: { type: 'ai', workspaceId: 'ws-a' },
        conversationTurns: Array.from({ length: 200 }, (_, turnIndex): ConversationTurn => ({
            turnIndex, role: turnIndex % 2 ? 'assistant' : 'user',
            content: `turn ${turnIndex}`, timestamp: new Date('2026-01-01'),
        })),
    });

    it('returns bounded chronological pages and exact workspace ownership', async () => {
        const store = createStore();
        await store.addProcess(fixture());
        const latest = (await store.getProcessHistory('history', 'ws-a'))!;
        expect(latest.page).toMatchObject({ oldestTurnIndex: 170, totalTurns: 200, hasMore: true, historyRevision: 0 });
        expect(latest.process.conversationTurns).toHaveLength(30);
        expect((await store.getProcess('history'))!.conversationTurns).toHaveLength(200);
        expect(await store.getProcessHistory('history', '')).toBeUndefined();
        expect(await store.getProcessHistory('history', 'ws-b')).toBeUndefined();
        expect(await store.getProcessHistory('unknown')).toBeUndefined();
        const earlier = (await store.getProcessHistory('history', 'ws-a', { beforeTurnIndex: 199 }))!.page;
        expect(earlier.turns).toHaveLength(31);
        expect(earlier.oldestTurnIndex).toBe(168);
        expect((await store.getProcessHistory('history', undefined, { beforeTurnIndex: 0 }))!.page.hasMore).toBe(false);
        await expect(store.getProcessHistory('history', undefined, { limit: 201 })).rejects.toThrow(RangeError);
    });

    it('keeps streaming stable and invalidates edits, rewinds and successful compaction', async () => {
        const store = createStore();
        await store.addProcess(fixture());
        const revision = async () => (await store.getProcessHistory('history'))!.page.historyRevision;
        await store.upsertStreamingTurn('history', 'partial', true);
        await store.upsertStreamingTurn('history', 'more', true);
        await store.appendConversationTurn('history', turnIndex => ({
            turnIndex, role: 'assistant', content: 'done', timestamp: new Date(),
        }), { filterStreaming: true });
        expect(await revision()).toBe(0);
        await store.updateTurnContent('history', 0, 'edited');
        expect(await revision()).toBe(1);
        await store.truncateConversationTurns('history', 190);
        expect(await revision()).toBe(2);
        const metadata = (await store.getProcess('history'))!.metadata!;
        await store.updateProcess('history', { metadata: { ...metadata, compaction: { state: 'running', priorStatus: 'completed' } } });
        expect(await revision()).toBe(2);
        await store.updateProcess('history', { metadata: { ...metadata, compaction: { state: 'completed', priorStatus: 'completed', completedAt: '2026-01-01' } } });
        expect(await revision()).toBe(3);
        expect(await store.getProcess('history')).not.toHaveProperty('historyRevision');
    });

    it('invalidates explicit streaming edits without exposing private revision state', async () => {
        const store = createStore();
        await store.addProcess(fixture());
        await store.upsertStreamingTurn('history', 'draft', true);
        await store.updateTurnContent('history', 200, 'edited draft');
        expect((await store.getProcessHistory('history'))!.page.historyRevision).toBe(1);
        await store.upsertStreamingTurn('history', 'streamed', false);
        expect((await store.getProcessHistory('history'))!.page.historyRevision).toBe(1);
    });
});
