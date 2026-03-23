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
});
