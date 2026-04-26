/**
 * Get Conversation Tool Tests
 *
 * Unit tests for createGetConversationTool and the underlying compactTranscript driver.
 * Covers each of the 5 compaction levels, paging, prose-only mode, and error paths.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createGetConversationTool,
    compactTranscript,
} from '../../../src/server/llm-tools/get-conversation-tool';
import type { ProcessStore, ConversationTurn, ToolCall, AIProcess } from '@plusplusoneplusplus/forge';

// Minimal invocation stub for handler calls
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'get_conversation',
    arguments: {},
};

// ============================================================================
// Test fixtures
// ============================================================================

function makeToolCall(overrides?: Partial<ToolCall>): ToolCall {
    return {
        id: 'tc-' + Math.random().toString(36).slice(2),
        name: 'Read',
        status: 'completed',
        startTime: new Date('2026-04-25T10:00:00Z'),
        args: { file_path: '/tmp/foo.ts' },
        result: 'short result',
        ...overrides,
    };
}

function makeTurn(overrides?: Partial<ConversationTurn>): ConversationTurn {
    return {
        role: 'user',
        content: 'hello',
        timestamp: new Date('2026-04-25T10:00:00Z'),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

function makeStore(opts?: {
    turns?: ConversationTurn[];
    process?: Partial<AIProcess>;
    omitGetTurns?: boolean;
}): ProcessStore {
    const store: Partial<ProcessStore> = {};
    if (!opts?.omitGetTurns) {
        store.getConversationTurns = vi.fn().mockResolvedValue(opts?.turns ?? []);
    }
    store.getProcess = vi.fn().mockResolvedValue(
        opts?.process
            ? {
                  id: 'proc-1',
                  type: 'chat',
                  promptPreview: 'preview',
                  fullPrompt: 'preview',
                  status: 'completed',
                  startTime: new Date('2026-04-25T10:00:00Z'),
                  title: 'Test session',
                  conversationTurns: opts?.turns ?? [],
                  ...opts.process,
              }
            : undefined,
    );
    return store as ProcessStore;
}

// ============================================================================
// Tool shape
// ============================================================================

describe('createGetConversationTool', () => {
    it('returns a valid Tool shape', () => {
        const store = makeStore();
        const { tool } = createGetConversationTool({ store });

        expect(tool.name).toBe('get_conversation');
        expect(typeof tool.handler).toBe('function');
        expect(tool.parameters).toMatchObject({
            type: 'object',
            required: ['processId'],
        });
    });

    it('returns a not-found note when process does not exist', async () => {
        const store = makeStore({ omitGetTurns: true });
        // Override getProcess to return undefined
        (store.getProcess as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
        const { tool } = createGetConversationTool({ store });

        const result = await tool.handler({ processId: 'missing' }, invocationStub);

        expect(result.totalTurns).toBe(0);
        expect(result.transcript).toBe('');
        expect(result.note).toMatch(/not found|does not support/);
    });

    it('falls back to process.conversationTurns when getConversationTurns is absent', async () => {
        const turns = [makeTurn({ turnIndex: 0, content: 'fallback hello' })];
        const store = makeStore({
            turns,
            process: { conversationTurns: turns },
            omitGetTurns: true,
        });
        const { tool } = createGetConversationTool({ store });

        const result = await tool.handler({ processId: 'proc-1' }, invocationStub);

        expect(result.totalTurns).toBe(1);
        expect(result.transcript).toContain('fallback hello');
    });

    it('returns process metadata (title, status, startTime)', async () => {
        const store = makeStore({
            turns: [makeTurn({ content: 'hi' })],
            process: { title: 'My Title', status: 'completed' },
        });
        const { tool } = createGetConversationTool({ store });

        const result = await tool.handler({ processId: 'proc-1' }, invocationStub);

        expect(result.title).toBe('My Title');
        expect(result.status).toBe('completed');
        expect(result.startTime).toBe('2026-04-25T10:00:00.000Z');
    });

    it('clamps maxChars below the floor and above the ceiling', async () => {
        const store = makeStore({ turns: [makeTurn({ content: 'short' })] });
        const { tool } = createGetConversationTool({ store });

        const tiny = await tool.handler(
            { processId: 'proc-1', maxChars: 1 },
            invocationStub,
        );
        // Floor is 1000 — short content fits, so level 0
        expect(tiny.compactionLevel).toBe(0);

        const huge = await tool.handler(
            { processId: 'proc-1', maxChars: 999_999 },
            invocationStub,
        );
        expect(huge.compactionLevel).toBe(0);
    });
});

// ============================================================================
// Compaction levels
// ============================================================================

describe('compactTranscript — level 0 (noise stripping)', () => {
    it('drops turns marked as deletedAt', () => {
        const turns: ConversationTurn[] = [
            makeTurn({ turnIndex: 0, content: 'kept' }),
            makeTurn({
                turnIndex: 1,
                role: 'assistant',
                content: 'deleted',
                deletedAt: new Date(),
            }),
            makeTurn({ turnIndex: 2, content: 'also kept' }),
        ];
        const result = compactTranscript(turns, 100_000, true);
        expect(result.compactionLevel).toBe(0);
        expect(result.totalTurns).toBe(2);
        expect(result.transcript).toContain('kept');
        expect(result.transcript).toContain('also kept');
        expect(result.transcript).not.toContain('deleted');
    });

    it('renders user/assistant role labels', () => {
        const turns: ConversationTurn[] = [
            makeTurn({ role: 'user', content: 'q' }),
            makeTurn({ role: 'assistant', content: 'a', turnIndex: 1 }),
        ];
        const result = compactTranscript(turns, 100_000, true);
        expect(result.transcript).toContain('[User]: q');
        expect(result.transcript).toContain('[Assistant]: a');
    });
});

describe('compactTranscript — level 1 (compact tool calls)', () => {
    it('truncates long tool-call results', () => {
        const longResult = 'x'.repeat(5000);
        const turns: ConversationTurn[] = [
            makeTurn({
                role: 'assistant',
                content: 'thinking',
                turnIndex: 0,
                toolCalls: [makeToolCall({ result: longResult })],
            }),
        ];
        // Force level 1 by setting maxChars below the level-0 size.
        const result = compactTranscript(turns, 1500, true);
        expect(result.compactionLevel).toBeGreaterThanOrEqual(1);
        expect(result.transcript).toMatch(/chars omitted/);
        expect(result.transcript.length).toBeLessThanOrEqual(1500);
    });

    it('renders a compact tool-call line with arg summary', () => {
        const turns: ConversationTurn[] = [
            makeTurn({
                role: 'assistant',
                turnIndex: 0,
                content: 'doing',
                toolCalls: [
                    makeToolCall({ name: 'Read', args: { file_path: '/tmp/foo.ts' } }),
                ],
            }),
        ];
        const result = compactTranscript(turns, 100_000, true);
        expect(result.transcript).toContain('Read(file=/tmp/foo.ts)');
    });
});

describe('compactTranscript — level 2 (drop unimportant tool calls)', () => {
    it('drops Read calls and keeps Edit calls', () => {
        const big = 'y'.repeat(10_000);
        const turns: ConversationTurn[] = [
            makeTurn({
                role: 'assistant',
                turnIndex: 0,
                // Force size with prose so we drop into level 2.
                content: big,
                toolCalls: [
                    makeToolCall({ name: 'Read', result: 'r1' }),
                    makeToolCall({ name: 'Read', result: 'r2' }),
                    makeToolCall({
                        name: 'Edit',
                        args: { file_path: '/tmp/foo.ts' },
                        result: 'edited',
                    }),
                ],
            }),
        ];
        const result = compactTranscript(turns, 2000, true);
        expect(result.compactionLevel).toBeGreaterThanOrEqual(2);
        expect(result.transcript).toContain('Edit(file=/tmp/foo.ts)');
        expect(result.transcript).toMatch(/2 read\/search call\(s\) omitted/);
    });

    it('keeps failed tool calls regardless of name', () => {
        const big = 'z'.repeat(10_000);
        const turns: ConversationTurn[] = [
            makeTurn({
                role: 'assistant',
                turnIndex: 0,
                content: big,
                toolCalls: [
                    makeToolCall({
                        name: 'Read',
                        status: 'failed',
                        error: 'boom',
                        result: undefined,
                    }),
                ],
            }),
        ];
        const result = compactTranscript(turns, 2000, true);
        expect(result.compactionLevel).toBeGreaterThanOrEqual(2);
        expect(result.transcript).toContain('Read(file=');
        expect(result.transcript).toContain('error: boom');
    });
});

describe('compactTranscript — level 3 (truncate prose)', () => {
    it('truncates long assistant prose with head + tail', () => {
        const head = 'A'.repeat(500);
        const tail = 'B'.repeat(500);
        const middle = 'M'.repeat(20_000);
        const turns: ConversationTurn[] = [
            makeTurn({ role: 'assistant', turnIndex: 0, content: head + middle + tail }),
        ];
        const result = compactTranscript(turns, 2000, false);
        expect(result.compactionLevel).toBeGreaterThanOrEqual(3);
        expect(result.transcript).toMatch(/chars omitted/);
        // Should still contain start of head and end of tail
        expect(result.transcript).toContain('A'.repeat(50));
        expect(result.transcript).toContain('B'.repeat(50));
    });
});

describe('compactTranscript — level 4 (drop middle turns)', () => {
    it('drops middle turns when even level-3 cannot fit', () => {
        // Build many large turns so level 0–3 can't fit
        const turns: ConversationTurn[] = [];
        for (let i = 0; i < 20; i++) {
            turns.push(
                makeTurn({
                    role: i % 2 === 0 ? 'user' : 'assistant',
                    turnIndex: i,
                    content: `turn-${i}-` + 'x'.repeat(2000),
                }),
            );
        }
        const result = compactTranscript(turns, 5000, false);
        expect(result.compactionLevel).toBe(4);
        expect(result.truncated).toBe(true);
        expect(result.transcript).toMatch(/turn\(s\) omitted/);
        expect(result.returnedTurns).toBeLessThan(turns.length);
        // First two turns must be present
        expect(result.transcript).toContain('turn-0-');
        expect(result.transcript).toContain('turn-1-');
        // Last turn should be present
        expect(result.transcript).toContain('turn-19-');
    });
});

// ============================================================================
// Tool handler — paging and includeToolCalls
// ============================================================================

describe('createGetConversationTool — paging', () => {
    it('honors fromTurn/toTurn window', async () => {
        const turns: ConversationTurn[] = [];
        for (let i = 0; i < 10; i++) {
            turns.push(makeTurn({ turnIndex: i, content: `turn-${i}` }));
        }
        const store = makeStore({ turns });
        const { tool } = createGetConversationTool({ store });

        const result = await tool.handler(
            { processId: 'proc-1', fromTurn: 3, toTurn: 5 },
            invocationStub,
        );

        expect(result.totalTurns).toBe(10);
        expect(result.returnedTurns).toBe(3);
        expect(result.transcript).toContain('turn-3');
        expect(result.transcript).toContain('turn-4');
        expect(result.transcript).toContain('turn-5');
        expect(result.transcript).not.toContain('turn-6');
        expect(result.truncated).toBe(true); // window != full
    });

    it('omits tool calls when includeToolCalls=false', async () => {
        const turns: ConversationTurn[] = [
            makeTurn({
                role: 'assistant',
                content: 'thinking',
                turnIndex: 0,
                toolCalls: [makeToolCall({ name: 'Edit', args: { file_path: '/x.ts' } })],
            }),
        ];
        const store = makeStore({ turns });
        const { tool } = createGetConversationTool({ store });

        const result = await tool.handler(
            { processId: 'proc-1', includeToolCalls: false },
            invocationStub,
        );

        expect(result.transcript).toContain('thinking');
        expect(result.transcript).not.toContain('Edit(');
        expect(result.transcript).not.toContain('tool_calls:');
    });
});
