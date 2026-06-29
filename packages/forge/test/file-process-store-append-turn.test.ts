/**
 * Regression tests for FileProcessStore.appendConversationTurn
 *
 * Verifies that concurrent user-turn and assistant-turn writes do NOT lose data
 * (the race condition described in the "Lost Conversation Turns" bug).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import { FileProcessStore, AIProcess, AIProcessStatus } from '../src/index';
import type { PendingMessage } from '../src/index';

function makeProcess(id: string, overrides?: Partial<AIProcess>): AIProcess {
    return {
        id,
        type: 'ai',
        promptPreview: 'test prompt',
        fullPrompt: 'test full prompt',
        status: 'running' as AIProcessStatus,
        startTime: new Date(),
        metadata: { type: 'ai', workspaceId: 'ws-test' },
        ...overrides,
    };
}

describe('FileProcessStore.appendConversationTurn', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-append-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('appends a turn with the correct turnIndex', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const p = makeProcess('p1');
        await store.addProcess(p);

        const result = await store.appendConversationTurn('p1', (idx) => ({
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
        }));

        expect(result).toBeDefined();
        expect(result!.turn.turnIndex).toBe(0);
        expect(result!.allTurns).toHaveLength(1);

        const updated = await store.getProcess('p1');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].content).toBe('hello');
    });

    it('assigns incrementing turnIndex across multiple appends', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p2'));

        for (let i = 0; i < 3; i++) {
            await store.appendConversationTurn('p2', (idx) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `msg-${i}`,
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }));
        }

        const updated = await store.getProcess('p2');
        const turns = updated!.conversationTurns!;
        expect(turns).toHaveLength(3);
        expect(turns.map(t => t.turnIndex)).toEqual([0, 1, 2]);
        expect(turns.map(t => t.content)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    });

    it('filters out streaming assistant turns when filterStreaming=true', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const p = makeProcess('p3', {
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: '...streaming...', timestamp: new Date(), turnIndex: 1, timeline: [], streaming: true },
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'p3',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true }
        );

        expect(result!.allTurns).toHaveLength(2); // streaming turn replaced
        expect(result!.turn.turnIndex).toBe(1);
        expect(result!.allTurns[1].content).toBe('final answer');
        expect(result!.allTurns[1].streaming).toBeUndefined();

        const updated = await store.getProcess('p3');
        expect(updated!.conversationTurns).toHaveLength(2);
        expect(updated!.conversationTurns![1].content).toBe('final answer');
    });

    it('applies scalar additionalUpdates atomically', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p4'));

        await store.appendConversationTurn(
            'p4',
            (idx) => ({ role: 'assistant', content: 'done', timestamp: new Date(), turnIndex: idx, timeline: [] }),
            { additionalUpdates: { status: 'completed', result: 'success' } }
        );

        const updated = await store.getProcess('p4');
        expect(updated!.status).toBe('completed');
        expect(updated!.result).toBe('success');
        expect(updated!.conversationTurns).toHaveLength(1);
    });

    it('applies function additionalUpdates with access to current process', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p5', {
            cumulativeTokenUsage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 15, turnCount: 1 },
        }));

        await store.appendConversationTurn(
            'p5',
            (idx) => ({ role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: idx, timeline: [] }),
            {
                additionalUpdates: (current) => ({
                    cumulativeTokenUsage: {
                        inputTokens: (current.cumulativeTokenUsage?.inputTokens ?? 0) + 20,
                        outputTokens: (current.cumulativeTokenUsage?.outputTokens ?? 0) + 10,
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                        totalTokens: (current.cumulativeTokenUsage?.totalTokens ?? 0) + 30,
                        turnCount: (current.cumulativeTokenUsage?.turnCount ?? 0) + 1,
                    },
                }),
            }
        );

        const updated = await store.getProcess('p5');
        expect(updated!.cumulativeTokenUsage?.inputTokens).toBe(30);
        expect(updated!.cumulativeTokenUsage?.outputTokens).toBe(15);
        expect(updated!.cumulativeTokenUsage?.turnCount).toBe(2);
    });

    it('does NOT lose turns under concurrent user+assistant appends (race regression)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p6'));

        // Simulate concurrent user-turn (api-handler) and assistant-turn (follow-up-executor)
        await Promise.all([
            store.appendConversationTurn('p6', (idx) => ({
                role: 'user',
                content: 'user message',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            })),
            store.appendConversationTurn('p6', (idx) => ({
                role: 'assistant',
                content: 'assistant reply',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            })),
        ]);

        const updated = await store.getProcess('p6');
        // Both turns must survive — this was the bug: one turn was silently lost
        expect(updated!.conversationTurns).toHaveLength(2);
        const roles = updated!.conversationTurns!.map(t => t.role).sort();
        expect(roles).toEqual(['assistant', 'user']);
    });

    it('does NOT lose turns across 5 concurrent appends', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p7'));

        await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                store.appendConversationTurn('p7', (idx) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `turn-${i}`,
                    timestamp: new Date(),
                    turnIndex: idx,
                    timeline: [],
                }))
            )
        );

        const updated = await store.getProcess('p7');
        expect(updated!.conversationTurns).toHaveLength(5);
        // All turn indices must be unique (0-4)
        const indices = updated!.conversationTurns!.map(t => t.turnIndex).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4]);
    });

    it('returns undefined for a non-existent process', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const result = await store.appendConversationTurn('no-such-process', (idx) => ({
            role: 'user',
            content: 'test',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
        }));
        expect(result).toBeUndefined();
    });

    it('recovers stable turnIndex from streaming turn when filterStreaming=true (race regression)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        // Simulate race: streaming assistant at idx 3, then user msg appended at idx 4
        const p = makeProcess('p-race', {
            conversationTurns: [
                { role: 'user', content: 'q1', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'a1', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'q2', timestamp: new Date(), turnIndex: 2, timeline: [] },
                { role: 'assistant', content: 'streaming...', timestamp: new Date(), turnIndex: 3, timeline: [], streaming: true },
                { role: 'user', content: 'q3', timestamp: new Date(), turnIndex: 4, timeline: [] },
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'p-race',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true },
        );

        // The stale streaming turnIndex=3 is discarded because a user turn at turnIndex=4
        // was appended after it (cancel + new follow-up). Fallback = max(4, 4+1) = 5.
        expect(result!.turn.turnIndex).toBe(5);
        // Streaming turn should be replaced, so 5 turns total: 4 non-streaming + 1 new
        expect(result!.allTurns).toHaveLength(5);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1, 2, 4, 5]);
    });

    it('recovers stableTurnIndex when no user turn was appended after streaming turn', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        // Normal case: streaming assistant is the last turn, no new user turn after it
        const p = makeProcess('p-normal-stable', {
            conversationTurns: [
                { role: 'user', content: 'q1', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'a1', timestamp: new Date(), turnIndex: 1, timeline: [] },
                { role: 'user', content: 'q2', timestamp: new Date(), turnIndex: 2, timeline: [] },
                { role: 'assistant', content: 'streaming...', timestamp: new Date(), turnIndex: 3, timeline: [], streaming: true },
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'p-normal-stable',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true },
        );

        // stableTurnIndex=3 is valid (> maxExistingIndex=2), so it should be recovered
        expect(result!.turn.turnIndex).toBe(3);
        expect(result!.allTurns).toHaveLength(4);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1, 2, 3]);
    });

    it('round-trips the displayOnly flag through serialization (AC-03)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('p-display-only'));

        await store.appendConversationTurn('p-display-only', (idx) => ({
            role: 'assistant',
            content: 'Context compacted — removed 3 messages, freed ~120 tokens',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
            displayOnly: true,
        }));

        // Fresh store instance forces a deserialize-from-disk read, exercising
        // both serializeProcess (on write) and deserializeProcess (on read).
        const reloaded = new FileProcessStore({ dataDir: tmpDir });
        const updated = await reloaded.getProcess('p-display-only');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].displayOnly).toBe(true);
        expect(updated!.conversationTurns![0].content).toContain('Context compacted');
    });

    describe('lastEventAt tracking', () => {
        it('addProcess sets lastEventAt to startTime', async () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const startTime = new Date('2026-01-15T10:00:00Z');
            await store.addProcess(makeProcess('p-lea', { startTime }));

            const result = await store.getProcess('p-lea');
            expect(result).toBeDefined();
            expect(result!.lastEventAt).toBeInstanceOf(Date);
            expect(result!.lastEventAt!.toISOString()).toBe(startTime.toISOString());
        });

        it('appendConversationTurn updates lastEventAt to current time', async () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const startTime = new Date('2026-01-15T10:00:00Z');
            await store.addProcess(makeProcess('p-lea2', { startTime }));

            await store.appendConversationTurn('p-lea2', (idx) => ({
                role: 'assistant',
                content: 'response',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }));

            const result = await store.getProcess('p-lea2');
            expect(result).toBeDefined();
            expect(result!.lastEventAt).toBeInstanceOf(Date);
            // lastEventAt should be newer than the original startTime
            expect(result!.lastEventAt!.getTime()).toBeGreaterThan(startTime.getTime());
        });

        it('lastEventAt appears in the workspace index entry', async () => {
            const store = new FileProcessStore({ dataDir: tmpDir });
            const startTime = new Date('2026-01-15T10:00:00Z');
            await store.addProcess(makeProcess('p-lea3', { startTime }));

            const { entries } = await store.getProcessSummaries({ workspaceId: 'ws-test' });
            const entry = entries.find(e => e.id === 'p-lea3');
            expect(entry).toBeDefined();
            expect(entry!.lastEventAt).toBe(startTime.toISOString());
        });
    });
});

describe('FileProcessStore.appendPendingMessage', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fps-pending-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    function makePending(id: string, content: string): PendingMessage {
        return { id, content, createdAt: new Date().toISOString() };
    }

    it('appends a pending message and returns the full array', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('pm1'));

        const result = await store.appendPendingMessage('pm1', makePending('m1', 'first'));

        expect(result).toHaveLength(1);
        expect(result![0].content).toBe('first');

        const updated = await store.getProcess('pm1');
        expect(updated!.pendingMessages).toHaveLength(1);
        expect(updated!.pendingMessages![0].id).toBe('m1');
    });

    it('accumulates pending messages in order', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('pm2'));

        await store.appendPendingMessage('pm2', makePending('m1', 'first'));
        await store.appendPendingMessage('pm2', makePending('m2', 'second'));
        await store.appendPendingMessage('pm2', makePending('m3', 'third'));

        const updated = await store.getProcess('pm2');
        expect(updated!.pendingMessages!.map(m => m.content)).toEqual(['first', 'second', 'third']);
    });

    it('does NOT lose messages under concurrent appends (lost-update regression)', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        await store.addProcess(makeProcess('pm3'));

        await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                store.appendPendingMessage('pm3', makePending(`m${i}`, `msg-${i}`)),
            ),
        );

        const updated = await store.getProcess('pm3');
        // All 5 survive — the read-modify-write runs under the write queue lock.
        expect(updated!.pendingMessages).toHaveLength(5);
        const ids = updated!.pendingMessages!.map(m => m.id).sort();
        expect(ids).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    });

    it('returns undefined for a non-existent process', async () => {
        const store = new FileProcessStore({ dataDir: tmpDir });
        const result = await store.appendPendingMessage('no-such', makePending('m1', 'x'));
        expect(result).toBeUndefined();
    });
});
