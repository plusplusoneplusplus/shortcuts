import { describe, it, expect } from 'vitest';
import { getConversationTurns } from '../../../../src/server/spa/client/react/chat/chatConversationUtils';

describe('getConversationTurns', () => {
    describe('process.conversationTurns (highest priority)', () => {
        it('returns conversationTurns when present on process', () => {
            const turns = [{ role: 'user', content: 'hello', timeline: [] }];
            const result = getConversationTurns({ process: { conversationTurns: turns } });
            expect(result).toEqual(turns);
        });

        it('ignores empty conversationTurns array', () => {
            const result = getConversationTurns({ process: { conversationTurns: [] } });
            expect(result).toEqual([]);
        });

        it('ignores non-array conversationTurns', () => {
            const result = getConversationTurns({ process: { conversationTurns: 'invalid' } });
            expect(result).toEqual([]);
        });
    });

    describe('data.conversation fallback', () => {
        it('returns data.conversation when process has no conversationTurns', () => {
            const conv = [{ role: 'assistant', content: 'hi', timeline: [] }];
            const result = getConversationTurns({ conversation: conv });
            expect(result).toEqual(conv);
        });

        it('ignores empty conversation array', () => {
            const result = getConversationTurns({ conversation: [] });
            expect(result).toEqual([]);
        });
    });

    describe('data.turns fallback', () => {
        it('returns data.turns when conversation is absent', () => {
            const turns = [{ role: 'user', content: 'test', timeline: [] }];
            const result = getConversationTurns({ turns });
            expect(result).toEqual(turns);
        });

        it('ignores empty turns array', () => {
            const result = getConversationTurns({ turns: [] });
            expect(result).toEqual([]);
        });
    });

    describe('synthetic turns from process fields', () => {
        it('creates user turn from fullPrompt', () => {
            const result = getConversationTurns({
                process: { fullPrompt: 'my prompt', startTime: '2024-01-01T00:00:00Z' },
            });
            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('my prompt');
            expect(result[0].timestamp).toBe('2024-01-01T00:00:00Z');
        });

        it('creates user turn from promptPreview when fullPrompt is absent', () => {
            const result = getConversationTurns({
                process: { promptPreview: 'preview' },
            });
            expect(result).toHaveLength(1);
            expect(result[0].content).toBe('preview');
        });

        it('creates assistant turn from result', () => {
            const result = getConversationTurns({
                process: { result: 'answer', endTime: '2024-01-01T01:00:00Z' },
            });
            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('assistant');
            expect(result[0].content).toBe('answer');
        });

        it('creates both user and assistant turns', () => {
            const result = getConversationTurns({
                process: { fullPrompt: 'q', result: 'a' },
            });
            expect(result).toHaveLength(2);
            expect(result[0].role).toBe('user');
            expect(result[1].role).toBe('assistant');
        });

        it('returns empty array when process has no prompt or result', () => {
            const result = getConversationTurns({ process: {} });
            expect(result).toEqual([]);
        });
    });

    describe('task payload fallback', () => {
        it('creates user turn from task.payload.prompt', () => {
            const result = getConversationTurns({}, { payload: { prompt: 'task prompt' } });
            expect(result).toHaveLength(1);
            expect(result[0].role).toBe('user');
            expect(result[0].content).toBe('task prompt');
        });

        it('returns empty array when task has no payload prompt', () => {
            const result = getConversationTurns({}, { payload: {} });
            expect(result).toEqual([]);
        });

        it('returns empty array when task is undefined', () => {
            const result = getConversationTurns({});
            expect(result).toEqual([]);
        });
    });

    describe('null/undefined data', () => {
        it('returns empty array for null data', () => {
            expect(getConversationTurns(null)).toEqual([]);
        });

        it('returns empty array for undefined data', () => {
            expect(getConversationTurns(undefined)).toEqual([]);
        });
    });

    describe('priority order', () => {
        it('prefers conversationTurns over conversation', () => {
            const ct = [{ role: 'user', content: 'ct', timeline: [] }];
            const conv = [{ role: 'user', content: 'conv', timeline: [] }];
            const result = getConversationTurns({
                process: { conversationTurns: ct },
                conversation: conv,
            });
            expect(result[0].content).toBe('ct');
        });

        it('prefers conversation over turns', () => {
            const conv = [{ role: 'user', content: 'conv', timeline: [] }];
            const turns = [{ role: 'user', content: 'turns', timeline: [] }];
            const result = getConversationTurns({ conversation: conv, turns });
            expect(result[0].content).toBe('conv');
        });

        it('prefers process synthetic over task payload', () => {
            const result = getConversationTurns(
                { process: { fullPrompt: 'from process' } },
                { payload: { prompt: 'from task' } },
            );
            expect(result[0].content).toBe('from process');
        });
    });
});
