/**
 * SqliteProcessStore Streaming & Turn Operation Tests
 *
 * Dedicated tests for upsertStreamingTurn race conditions,
 * appendConversationTurn with filterStreaming, and updateTurnContent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

import {
    SqliteProcessStore,
    AIProcess,
    AIProcessStatus,
    ConversationTurn,
} from '../src/index';

let tmpDir: string;
let store: SqliteProcessStore;

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

function makeTurn(index: number, overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: 'user',
        content: `message-${index}`,
        timestamp: new Date(),
        turnIndex: index,
        timeline: [],
        ...overrides,
    };
}

beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-stream-test-'));
    store = new SqliteProcessStore({ dbPath: path.join(tmpDir, 'test.db') });
});

afterEach(async () => {
    store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
});

// ============================================================================
// appendConversationTurn
// ============================================================================

describe('SqliteProcessStore — appendConversationTurn', () => {
    it('appends a turn and returns { turn, allTurns } with correct turnIndex (0-based)', async () => {
        await store.addProcess(makeProcess('at-1'));

        const result = await store.appendConversationTurn('at-1', (idx) => ({
            role: 'user',
            content: 'hello',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
        }));

        expect(result).toBeDefined();
        expect(result!.turn.turnIndex).toBe(0);
        expect(result!.turn.content).toBe('hello');
        expect(result!.allTurns).toHaveLength(1);

        const updated = await store.getProcess('at-1');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].content).toBe('hello');
    });

    it('round-trips interrupted assistant turn metadata', async () => {
        await store.addProcess(makeProcess('at-interrupted'));

        await store.appendConversationTurn('at-interrupted', (idx) => ({
            role: 'assistant',
            content: 'Partial answer',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
            interrupted: true,
            interruptionReason: 'Timed out waiting for model',
        }));

        const updated = await store.getProcess('at-interrupted');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].interrupted).toBe(true);
        expect(updated!.conversationTurns![0].interruptionReason).toBe('Timed out waiting for model');
    });

    it('assigns incrementing turnIndex across multiple sequential appends', async () => {
        await store.addProcess(makeProcess('at-2'));

        for (let i = 0; i < 3; i++) {
            await store.appendConversationTurn('at-2', (idx) => ({
                role: i % 2 === 0 ? 'user' : 'assistant',
                content: `msg-${i}`,
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }));
        }

        const updated = await store.getProcess('at-2');
        const turns = updated!.conversationTurns!;
        expect(turns).toHaveLength(3);
        expect(turns.map(t => t.turnIndex)).toEqual([0, 1, 2]);
        expect(turns.map(t => t.content)).toEqual(['msg-0', 'msg-1', 'msg-2']);
    });

    it('with filterStreaming: true, removes existing streaming assistant turns before appending', async () => {
        const p = makeProcess('at-3', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'hi' }),
                makeTurn(1, { role: 'assistant', content: '...streaming...', streaming: true }),
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'at-3',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true }
        );

        expect(result!.allTurns).toHaveLength(2);
        expect(result!.turn.turnIndex).toBe(1);
        expect(result!.allTurns[1].content).toBe('final answer');
        expect(result!.allTurns[1].streaming).toBeUndefined();

        const updated = await store.getProcess('at-3');
        expect(updated!.conversationTurns).toHaveLength(2);
        expect(updated!.conversationTurns![1].content).toBe('final answer');
    });

    it('stable turnIndex recovery: after filtering streaming turn, new turn takes streaming turn index', async () => {
        const p = makeProcess('at-stable', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'q1' }),
                makeTurn(1, { role: 'assistant', content: 'a1' }),
                makeTurn(2, { role: 'user', content: 'q2' }),
                makeTurn(3, { role: 'assistant', content: 'streaming...', streaming: true }),
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'at-stable',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true },
        );

        // stableTurnIndex=3 is valid (> maxExistingIndex=2)
        expect(result!.turn.turnIndex).toBe(3);
        expect(result!.allTurns).toHaveLength(4);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1, 2, 3]);
    });

    it('discards stale stableTurnIndex when user turn was appended after streaming turn', async () => {
        const p = makeProcess('at-stale', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'q1' }),
                makeTurn(1, { role: 'assistant', content: 'a1' }),
                makeTurn(2, { role: 'user', content: 'q2' }),
                makeTurn(3, { role: 'assistant', content: 'streaming...', streaming: true }),
                makeTurn(4, { role: 'user', content: 'q3' }),
            ],
        });
        await store.addProcess(p);

        const result = await store.appendConversationTurn(
            'at-stale',
            (idx) => ({
                role: 'assistant',
                content: 'final answer',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            }),
            { filterStreaming: true },
        );

        // stableTurnIndex=3 is discarded because user turn at idx=4 exists
        expect(result!.turn.turnIndex).toBe(5);
        expect(result!.allTurns).toHaveLength(5);
        expect(result!.allTurns.map(t => t.turnIndex)).toEqual([0, 1, 2, 4, 5]);
    });

    it('with additionalUpdates as object — applies scalar updates atomically', async () => {
        await store.addProcess(makeProcess('at-upd'));

        await store.appendConversationTurn(
            'at-upd',
            (idx) => ({ role: 'assistant', content: 'done', timestamp: new Date(), turnIndex: idx, timeline: [] }),
            { additionalUpdates: { status: 'completed', result: 'success' } }
        );

        const updated = await store.getProcess('at-upd');
        expect(updated!.status).toBe('completed');
        expect(updated!.result).toBe('success');
        expect(updated!.conversationTurns).toHaveLength(1);
    });

    it('with additionalUpdates as function — receives current process, returns partial updates', async () => {
        await store.addProcess(makeProcess('at-fn', {
            cumulativeTokenUsage: {
                inputTokens: 10, outputTokens: 5,
                cacheReadTokens: 0, cacheWriteTokens: 0,
                totalTokens: 15, turnCount: 1,
            },
        }));

        await store.appendConversationTurn(
            'at-fn',
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

        const updated = await store.getProcess('at-fn');
        expect(updated!.cumulativeTokenUsage?.inputTokens).toBe(30);
        expect(updated!.cumulativeTokenUsage?.outputTokens).toBe(15);
        expect(updated!.cumulativeTokenUsage?.turnCount).toBe(2);
    });

    it('returns undefined when process does not exist', async () => {
        const result = await store.appendConversationTurn('no-such', (idx) => ({
            role: 'user',
            content: 'test',
            timestamp: new Date(),
            turnIndex: idx,
            timeline: [],
        }));
        expect(result).toBeUndefined();
    });

    it('onProcessChange includes process object after appendConversationTurn', async () => {
        await store.addProcess(makeProcess('at-evt'));
        const changes: Array<{ type: string; process?: any }> = [];
        store.onProcessChange = (event) => changes.push(event);

        await store.appendConversationTurn(
            'at-evt',
            (idx) => ({ role: 'user', content: 'hi', timestamp: new Date(), turnIndex: idx, timeline: [] }),
            { additionalUpdates: { status: 'completed' } },
        );

        expect(changes).toHaveLength(1);
        expect(changes[0].type).toBe('process-updated');
        expect(changes[0].process).toBeDefined();
        expect(changes[0].process.id).toBe('at-evt');
        expect(changes[0].process.status).toBe('completed');
    });
});

// ============================================================================
// upsertStreamingTurn
// ============================================================================

describe('SqliteProcessStore — upsertStreamingTurn', () => {
    it('creates a new streaming assistant turn when no streaming turn exists', async () => {
        await store.addProcess(makeProcess('us-1'));
        await store.upsertStreamingTurn('us-1', 'Hello', true);

        const result = await store.getProcess('us-1');
        const turns = result!.conversationTurns!;
        expect(turns).toHaveLength(1);
        expect(turns[0].role).toBe('assistant');
        expect(turns[0].content).toBe('Hello');
        expect(turns[0].streaming).toBe(true);
    });

    it('updates existing streaming turn content in-place (no duplicate turns)', async () => {
        await store.addProcess(makeProcess('us-2'));

        await store.upsertStreamingTurn('us-2', 'Hello', true);
        await store.upsertStreamingTurn('us-2', 'Hello world', true);
        await store.upsertStreamingTurn('us-2', 'Hello world!', true);

        const result = await store.getProcess('us-2');
        const turns = result!.conversationTurns!;
        expect(turns).toHaveLength(1);
        expect(turns[0].content).toBe('Hello world!');
        expect(turns[0].streaming).toBe(true);
    });

    it('with streaming: false, clears the streaming flag on the turn (finalizes it)', async () => {
        await store.addProcess(makeProcess('us-3'));

        await store.upsertStreamingTurn('us-3', 'partial', true);
        await store.upsertStreamingTurn('us-3', 'complete answer', false);

        const result = await store.getProcess('us-3');
        const turns = result!.conversationTurns!;
        expect(turns).toHaveLength(1);
        expect(turns[0].content).toBe('complete answer');
        expect(turns[0].streaming).toBeUndefined();
    });

    it('timeline items are preserved/appended across upserts', async () => {
        await store.addProcess(makeProcess('us-4'));
        const ts1 = new Date('2025-01-01T00:00:00Z');
        const ts2 = new Date('2025-01-01T00:00:01Z');

        await store.upsertStreamingTurn('us-4', 'chunk1', true, [
            { type: 'content', timestamp: ts1, content: 'chunk1' },
        ]);

        await store.upsertStreamingTurn('us-4', 'chunk1 chunk2', true, [
            { type: 'content', timestamp: ts1, content: 'chunk1' },
            { type: 'content', timestamp: ts2, content: 'chunk2' },
        ]);

        const result = await store.getProcess('us-4');
        const timeline = result!.conversationTurns![0].timeline;
        expect(timeline).toHaveLength(2);
        expect(timeline[0].content).toBe('chunk1');
        expect(timeline[1].content).toBe('chunk2');
    });

    it('concurrent rapid upsertStreamingTurn calls produce consistent state', async () => {
        await store.addProcess(makeProcess('us-5'));

        // Rapid concurrent upserts
        await Promise.all(
            Array.from({ length: 20 }, (_, i) =>
                store.upsertStreamingTurn('us-5', `content-${i}`, true)
            )
        );

        const result = await store.getProcess('us-5');
        const turns = result!.conversationTurns!;
        // Must have exactly one streaming turn (no duplicates)
        expect(turns).toHaveLength(1);
        expect(turns[0].streaming).toBe(true);
        // Content should be from one of the upserts
        expect(turns[0].content).toMatch(/^content-\d+$/);
    });

    it('creates a new turn after finalizing a previous streaming turn', async () => {
        await store.addProcess(makeProcess('us-6'));

        // First streaming session
        await store.upsertStreamingTurn('us-6', 'first answer', false);
        // Second streaming session
        await store.upsertStreamingTurn('us-6', 'second answer', true);

        const result = await store.getProcess('us-6');
        const turns = result!.conversationTurns!;
        expect(turns).toHaveLength(2);
        expect(turns[0].content).toBe('first answer');
        expect(turns[0].streaming).toBeUndefined();
        expect(turns[1].content).toBe('second answer');
        expect(turns[1].streaming).toBe(true);
    });
});

// ============================================================================
// updateTurnContent
// ============================================================================

describe('SqliteProcessStore — updateTurnContent', () => {
    it('updates content at a specific turnIndex', async () => {
        await store.addProcess(makeProcess('utc-1', {
            conversationTurns: [
                makeTurn(0, { role: 'user', content: 'original' }),
            ],
        }));

        await store.updateTurnContent('utc-1', 0, 'updated content');

        const result = await store.getProcess('utc-1');
        expect(result!.conversationTurns![0].content).toBe('updated content');
    });

    it('guards against out-of-range index (no-op, logs warning)', async () => {
        await store.addProcess(makeProcess('utc-2', {
            conversationTurns: [makeTurn(0)],
        }));

        // Should not throw, just log a warning
        await expect(store.updateTurnContent('utc-2', 99, 'nope')).resolves.not.toThrow();
        await expect(store.updateTurnContent('utc-2', -1, 'nope')).resolves.not.toThrow();

        // Original content unchanged
        const result = await store.getProcess('utc-2');
        expect(result!.conversationTurns![0].content).toBe('message-0');
    });

    it('updated content is visible in subsequent getProcess', async () => {
        await store.addProcess(makeProcess('utc-3', {
            conversationTurns: [
                makeTurn(0, { content: 'placeholder' }),
                makeTurn(1, { role: 'assistant', content: 'reply' }),
            ],
        }));

        await store.updateTurnContent('utc-3', 0, 'backfilled prompt');

        const result = await store.getProcess('utc-3');
        expect(result!.conversationTurns![0].content).toBe('backfilled prompt');
        expect(result!.conversationTurns![1].content).toBe('reply');
    });
});

// ============================================================================
// Race condition regression tests
// ============================================================================

describe('SqliteProcessStore — Race condition regressions', () => {
    it('concurrent appendConversationTurn calls do not lose turns', async () => {
        await store.addProcess(makeProcess('race-1'));

        await Promise.all([
            store.appendConversationTurn('race-1', (idx) => ({
                role: 'user',
                content: 'user message',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            })),
            store.appendConversationTurn('race-1', (idx) => ({
                role: 'assistant',
                content: 'assistant reply',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            })),
        ]);

        const updated = await store.getProcess('race-1');
        expect(updated!.conversationTurns).toHaveLength(2);
        const roles = updated!.conversationTurns!.map(t => t.role).sort();
        expect(roles).toEqual(['assistant', 'user']);
    });

    it('concurrent appendConversationTurn across 5 calls produces unique indices', async () => {
        await store.addProcess(makeProcess('race-2'));

        await Promise.all(
            Array.from({ length: 5 }, (_, i) =>
                store.appendConversationTurn('race-2', (idx) => ({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    content: `turn-${i}`,
                    timestamp: new Date(),
                    turnIndex: idx,
                    timeline: [],
                }))
            )
        );

        const updated = await store.getProcess('race-2');
        expect(updated!.conversationTurns).toHaveLength(5);
        const indices = updated!.conversationTurns!.map(t => t.turnIndex).sort((a, b) => a - b);
        expect(indices).toEqual([0, 1, 2, 3, 4]);
    });

    it('concurrent upsertStreamingTurn + appendConversationTurn produce consistent state', async () => {
        await store.addProcess(makeProcess('race-3'));

        // Start streaming
        await store.upsertStreamingTurn('race-3', 'streaming...', true);

        // Concurrent streaming update + finalize-and-append
        await Promise.all([
            store.upsertStreamingTurn('race-3', 'updated streaming', true),
            store.appendConversationTurn('race-3', (idx) => ({
                role: 'user',
                content: 'user follow-up',
                timestamp: new Date(),
                turnIndex: idx,
                timeline: [],
            })),
        ]);

        const updated = await store.getProcess('race-3');
        const turns = updated!.conversationTurns!;
        // Should have at least 2 turns (streaming + user), no data loss
        expect(turns.length).toBeGreaterThanOrEqual(2);
        const contents = turns.map(t => t.content);
        expect(contents).toContain('user follow-up');
    });

    it('10 rapid concurrent addProcess calls to the same workspace all succeed', async () => {
        const n = 10;
        await Promise.all(
            Array.from({ length: n }, (_, i) =>
                store.addProcess(makeProcess(`race-add-${i}`, { metadata: { type: 'ai', workspaceId: 'ws-race' } }))
            )
        );

        const all = await store.getAllProcesses({ workspaceId: 'ws-race' });
        expect(all).toHaveLength(n);
    });
});

// ============================================================================
// Conversation turn field serialization
// ============================================================================

describe('SqliteProcessStore — Turn field serialization', () => {
    it('preserves images, suggestions, historical, pasteExternalized fields', async () => {
        const turn = makeTurn(0, {
            role: 'assistant',
            images: ['data:image/png;base64,abc123'],
            suggestions: ['try this', 'or that'],
            historical: true,
            pasteExternalized: true,
        });
        await store.addProcess(makeProcess('ser-1', {
            conversationTurns: [turn],
        }));

        const result = await store.getProcess('ser-1');
        const rt = result!.conversationTurns![0];
        expect(rt.images).toEqual(['data:image/png;base64,abc123']);
        expect(rt.suggestions).toEqual(['try this', 'or that']);
        expect(rt.historical).toBe(true);
        expect(rt.pasteExternalized).toBe(true);
    });

    it('preserves tokenUsage on turns', async () => {
        const turn = makeTurn(0, {
            tokenUsage: {
                inputTokens: 50, outputTokens: 25,
                cacheReadTokens: 5, cacheWriteTokens: 2,
                totalTokens: 75, turnCount: 1,
            },
        });
        await store.addProcess(makeProcess('ser-2', {
            conversationTurns: [turn],
        }));

        const result = await store.getProcess('ser-2');
        const tu = result!.conversationTurns![0].tokenUsage!;
        expect(tu.inputTokens).toBe(50);
        expect(tu.outputTokens).toBe(25);
        expect(tu.totalTokens).toBe(75);
    });

    it('preserves tool call with permission fields', async () => {
        const now = new Date('2025-06-01T00:00:00Z');
        const turn = makeTurn(0, {
            toolCalls: [{
                id: 'tc1',
                name: 'bash',
                status: 'completed',
                startTime: now,
                endTime: new Date(now.getTime() + 1000),
                args: { command: 'ls -la' },
                result: 'file1.txt',
                parentToolCallId: 'parent-tc',
                permissionRequest: {
                    kind: 'file-write',
                    timestamp: now,
                    resource: '/tmp/out.txt',
                    operation: 'write',
                },
                permissionResult: {
                    approved: true,
                    timestamp: new Date(now.getTime() + 500),
                    reason: 'user approved',
                },
            }],
        });
        await store.addProcess(makeProcess('ser-3', {
            conversationTurns: [turn],
        }));

        const result = await store.getProcess('ser-3');
        const tc = result!.conversationTurns![0].toolCalls![0];
        expect(tc.id).toBe('tc1');
        expect(tc.name).toBe('bash');
        expect(tc.parentToolCallId).toBe('parent-tc');
        expect(tc.permissionRequest?.kind).toBe('file-write');
        expect(tc.permissionRequest?.timestamp).toBeInstanceOf(Date);
        expect(tc.permissionResult?.approved).toBe(true);
        expect(tc.permissionResult?.timestamp).toBeInstanceOf(Date);
    });

    it('preserves timeline with tool events', async () => {
        const now = new Date('2025-06-01T00:00:00Z');
        const turn = makeTurn(0, {
            timeline: [
                { type: 'content', timestamp: now, content: 'thinking...' },
                {
                    type: 'tool-start', timestamp: new Date(now.getTime() + 100),
                    toolCall: {
                        id: 'tc1', name: 'grep', status: 'running',
                        startTime: now, args: { pattern: 'TODO' },
                    },
                },
                {
                    type: 'tool-complete', timestamp: new Date(now.getTime() + 200),
                    toolCall: {
                        id: 'tc1', name: 'grep', status: 'completed',
                        startTime: now, endTime: new Date(now.getTime() + 200),
                        args: { pattern: 'TODO' }, result: '3 matches',
                    },
                },
            ],
        });
        await store.addProcess(makeProcess('ser-4', {
            conversationTurns: [turn],
        }));

        const result = await store.getProcess('ser-4');
        const timeline = result!.conversationTurns![0].timeline;
        expect(timeline).toHaveLength(3);
        expect(timeline[0].type).toBe('content');
        expect(timeline[1].type).toBe('tool-start');
        expect(timeline[1].toolCall?.name).toBe('grep');
        expect(timeline[2].type).toBe('tool-complete');
        expect(timeline[2].toolCall?.result).toBe('3 matches');
    });
});
