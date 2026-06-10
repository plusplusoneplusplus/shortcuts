/**
 * BaseExecutor — streaming-flush vs final-append race tests.
 *
 * Regression coverage for the e2e flake where an SSE subscriber's
 * `requestFlush` raced turn completion: the flush's `upsertStreamingTurn`
 * landed after `appendConversationTurn(filterStreaming)` had already
 * persisted the final assistant turn, re-inserting the streamed content as a
 * permanent duplicate ("zombie") streaming turn. The UI then rendered five
 * timestamped bubbles for a four-turn conversation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { AIProcess, ConversationTurn, ProcessStore } from '@plusplusoneplusplus/forge';
import { BaseExecutor } from '../../../src/server/executors/base-executor';
import { createStubStore } from '../../../src/server/processes/in-memory-process-store';

class TestExecutor extends BaseExecutor {
    seedBuffer(processId: string, content: string): void {
        this.getOrCreateSession(processId).outputBuffer = content;
    }

    flush(processId: string, streaming: boolean): Promise<void> {
        return this.flushConversationTurn(processId, streaming);
    }

    appendFinal(processId: string, content: string): Promise<{ turn: ConversationTurn; allTurns: ConversationTurn[] } | undefined> {
        return this.appendFinalConversationTurn(
            processId,
            (turnIndex) => ({
                role: 'assistant' as const,
                content,
                timestamp: new Date(),
                turnIndex,
                timeline: [],
            }),
            { filterStreaming: true },
        );
    }

    resetStreamingState(processId: string): void {
        this.resetSessionStreamingState(processId);
    }

    cleanup(processId: string): void {
        this.cleanupSession(processId);
    }
}

function makeProcess(id: string): AIProcess {
    return {
        id,
        status: 'running',
        startTime: new Date(),
        conversationTurns: [
            { role: 'user', content: 'First question', timestamp: new Date(), turnIndex: 0, timeline: [] },
        ],
    } as unknown as AIProcess;
}

async function getTurns(store: ProcessStore, id: string): Promise<ConversationTurn[]> {
    const proc = await store.getProcess(id);
    return proc?.conversationTurns ?? [];
}

describe('BaseExecutor flush/finalize race', () => {
    const PID = 'proc-flush-race';
    let store: ProcessStore;
    let executor: TestExecutor;

    beforeEach(async () => {
        store = createStubStore();
        executor = new TestExecutor(store);
        await store.addProcess(makeProcess(PID));
    });

    it('a flush landing after the final append does not re-insert a zombie streaming turn', async () => {
        executor.seedBuffer(PID, 'Follow-up answer');

        await executor.appendFinal(PID, 'Follow-up answer');
        // Simulates the SSE subscriber's requestFlush firing in the window
        // between the final append and session cleanup.
        await executor.flush(PID, true);

        const turns = await getTurns(store, PID);
        expect(turns).toHaveLength(2);
        expect(turns[1]).toMatchObject({ role: 'assistant', content: 'Follow-up answer' });
        expect(turns.some(t => t.streaming)).toBe(false);
    });

    it('a flush before the final append is replaced via filterStreaming', async () => {
        executor.seedBuffer(PID, 'partial');

        await executor.flush(PID, true);
        expect((await getTurns(store, PID)).some(t => t.streaming)).toBe(true);

        await executor.appendFinal(PID, 'final answer');

        const turns = await getTurns(store, PID);
        expect(turns).toHaveLength(2);
        expect(turns[1]).toMatchObject({ role: 'assistant', content: 'final answer' });
        expect(turns.some(t => t.streaming)).toBe(false);
    });

    it('concurrent flush and final append never duplicate the assistant turn (either start order)', async () => {
        executor.seedBuffer(PID, 'racy content');
        await Promise.all([
            executor.flush(PID, true),
            executor.appendFinal(PID, 'racy content'),
        ]);

        let turns = await getTurns(store, PID);
        expect(turns).toHaveLength(2);
        expect(turns.filter(t => t.role === 'assistant')).toHaveLength(1);
        expect(turns.some(t => t.streaming)).toBe(false);

        // Second turn on the same process, opposite start order.
        executor.resetStreamingState(PID);
        executor.seedBuffer(PID, 'second turn');
        await Promise.all([
            executor.appendFinal(PID, 'second turn'),
            executor.flush(PID, true),
        ]);

        turns = await getTurns(store, PID);
        expect(turns).toHaveLength(3);
        expect(turns.filter(t => t.role === 'assistant')).toHaveLength(2);
        expect(turns.some(t => t.streaming)).toBe(false);
    });

    it('flushing an active (unfinalized) turn still persists the streaming turn', async () => {
        executor.seedBuffer(PID, 'streaming now');

        await executor.flush(PID, true);

        const turns = await getTurns(store, PID);
        expect(turns).toHaveLength(2);
        expect(turns[1]).toMatchObject({ role: 'assistant', content: 'streaming now', streaming: true });
    });

    it('a flush after session cleanup is a no-op (no empty zombie turn)', async () => {
        executor.seedBuffer(PID, 'Follow-up answer');
        await executor.appendFinal(PID, 'Follow-up answer');
        executor.cleanup(PID);

        await executor.flush(PID, true);

        const turns = await getTurns(store, PID);
        expect(turns).toHaveLength(2);
        expect(turns.some(t => t.streaming)).toBe(false);
    });

    it('a new turn after finalize flushes normally again', async () => {
        executor.seedBuffer(PID, 'turn one');
        await executor.appendFinal(PID, 'turn one');

        // Follow-up turns reset streaming state before streaming begins.
        executor.resetStreamingState(PID);
        executor.seedBuffer(PID, 'turn two streaming');
        await executor.flush(PID, true);

        const turns = await getTurns(store, PID);
        expect(turns).toHaveLength(3);
        expect(turns[2]).toMatchObject({ role: 'assistant', content: 'turn two streaming', streaming: true });
    });
});
