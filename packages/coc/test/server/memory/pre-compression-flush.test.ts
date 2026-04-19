import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConversationTurn } from '@plusplusoneplusplus/forge';
import { flushMemories, FLUSH_PROMPT } from '../../../src/server/memory/pre-compression-flush';

function makeTurn(overrides: Partial<ConversationTurn> & { role: 'user' | 'assistant'; content: string }): ConversationTurn {
    return {
        timestamp: new Date(),
        turnIndex: 0,
        timeline: [],
        ...overrides,
    };
}

function makeConversation(userTurnCount: number): ConversationTurn[] {
    const turns: ConversationTurn[] = [];
    for (let i = 0; i < userTurnCount; i++) {
        turns.push(makeTurn({ role: 'user', content: `question ${i}`, turnIndex: i * 2 }));
        turns.push(makeTurn({ role: 'assistant', content: `answer ${i}`, turnIndex: i * 2 + 1 }));
    }
    return turns;
}

describe('pre-compression-flush', () => {
    let mockAiService: any;
    let mockMemoryStore: any;

    beforeEach(() => {
        mockAiService = {
            sendMessage: vi.fn().mockResolvedValue({
                success: true,
                response: 'Nothing to save.',
            }),
        };
        mockMemoryStore = {
            read: vi.fn().mockReturnValue([]),
            add: vi.fn().mockResolvedValue({ success: true }),
            replace: vi.fn().mockResolvedValue({ success: true }),
            remove: vi.fn().mockResolvedValue({ success: true }),
            load: vi.fn().mockResolvedValue(undefined),
        };
    });

    it('triggers flush and sends prompt when conditions met', async () => {
        const turns = makeConversation(5);
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        expect(result.triggered).toBe(true);
        expect(mockAiService.sendMessage).toHaveBeenCalledTimes(1);
        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.prompt).toBe(FLUSH_PROMPT);
        expect(callArgs.systemMessage.content).toContain('<conversation>');
        expect(callArgs.tools).toHaveLength(1);
    });

    it('returns triggered: false when under minTurns threshold', async () => {
        const turns = makeConversation(1);
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
            minTurns: 3,
        });

        expect(result.triggered).toBe(false);
        expect(result.factsSaved).toBe(0);
        expect(mockAiService.sendMessage).not.toHaveBeenCalled();
    });

    it('always triggers when minTurns is 0', async () => {
        const turns = makeConversation(1);
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
            minTurns: 0,
        });

        // Conversation has 2 turns (1 user + 1 assistant), snapshot >= 2
        expect(result.triggered).toBe(true);
    });

    it('returns triggered: false for conversations with < 2 snapshot turns', async () => {
        const turns = [makeTurn({ role: 'user', content: 'hi' })];
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
            minTurns: 0,
        });

        expect(result.triggered).toBe(false);
    });

    it('handles AI error gracefully', async () => {
        mockAiService.sendMessage.mockRejectedValue(new Error('timeout'));
        const turns = makeConversation(5);
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        expect(result.triggered).toBe(true);
        expect(result.factsSaved).toBe(0);
        expect(result.error).toBe('timeout');
    });

    it('respects timeoutMs parameter', async () => {
        const turns = makeConversation(5);
        await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
            timeoutMs: 15_000,
        });

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.timeoutMs).toBe(15_000);
    });

    it('uses default timeoutMs of 30000', async () => {
        const turns = makeConversation(5);
        await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.timeoutMs).toBe(30_000);
    });

    it('passes model override to AI service', async () => {
        const turns = makeConversation(5);
        await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
            model: 'gpt-4o-mini',
        });

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.model).toBe('gpt-4o-mini');
    });

    it('includes current memory in system message', async () => {
        mockMemoryStore.read.mockReturnValue(['User prefers TypeScript']);
        const turns = makeConversation(5);
        await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage.content).toContain('<current_memory>');
        expect(callArgs.systemMessage.content).toContain('User prefers TypeScript');
    });

    it('omits current_memory block when store is empty', async () => {
        mockMemoryStore.read.mockReturnValue([]);
        const turns = makeConversation(5);
        await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        const callArgs = mockAiService.sendMessage.mock.calls[0][0];
        expect(callArgs.systemMessage.content).not.toContain('<current_memory>');
    });

    it('returns 0 factsSaved when nothing saved', async () => {
        const turns = makeConversation(5);
        const result = await flushMemories({
            turns,
            memoryStore: mockMemoryStore,
            aiService: mockAiService,
        });

        expect(result.factsSaved).toBe(0);
    });

    describe('FLUSH_PROMPT', () => {
        it('is a non-empty string', () => {
            expect(FLUSH_PROMPT.length).toBeGreaterThan(0);
        });

        it('mentions memory tool', () => {
            expect(FLUSH_PROMPT).toContain('memory tool');
        });
    });
});
