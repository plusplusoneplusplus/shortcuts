import { describe, it, expect } from 'vitest';
import {
    AIProcess,
    SerializedAIProcess,
    ConversationTurn,
    SerializedConversationTurn,
    serializeProcess,
    deserializeProcess
} from '../src/ai/process-types';

/** Helper to create a minimal AIProcess for testing */
function makeProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'test-1',
        type: 'clarification',
        promptPreview: 'Hello',
        fullPrompt: 'Hello world',
        status: 'completed',
        startTime: new Date('2026-01-15T10:00:00.000Z'),
        endTime: new Date('2026-01-15T10:01:00.000Z'),
        ...overrides
    };
}

describe('ConversationTurn serialization', () => {
    it('round-trips a process with conversationTurns: undefined (backward compat)', () => {
        const process = makeProcess({ conversationTurns: undefined });
        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns).toBeUndefined();
    });

    it('round-trips a process with conversationTurns: [] (empty array preserved)', () => {
        const process = makeProcess({ conversationTurns: [] });
        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns).toEqual([]);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns).toEqual([]);
    });

    it('serializes a single user turn — timestamp becomes ISO string', () => {
        const ts = new Date('2026-02-01T12:00:00.000Z');
        const turn: ConversationTurn = {
            role: 'user',
            content: 'What does this code do?',
            timestamp: ts,
            turnIndex: 0
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns).toHaveLength(1);
        const sTurn = serialized.conversationTurns![0];
        expect(sTurn.timestamp).toBe('2026-02-01T12:00:00.000Z');
        expect(typeof sTurn.timestamp).toBe('string');
        expect(sTurn.role).toBe('user');
        expect(sTurn.content).toBe('What does this code do?');
        expect(sTurn.turnIndex).toBe(0);
        expect(sTurn.streaming).toBeUndefined();
    });

    it('round-trips multiple turns (user + assistant, with and without streaming)', () => {
        const turns: ConversationTurn[] = [
            {
                role: 'user',
                content: 'Explain this function',
                timestamp: new Date('2026-02-01T12:00:00.000Z'),
                turnIndex: 0
            },
            {
                role: 'assistant',
                content: 'This function calculates...',
                timestamp: new Date('2026-02-01T12:00:05.000Z'),
                turnIndex: 1,
                streaming: false
            },
            {
                role: 'user',
                content: 'Can you simplify it?',
                timestamp: new Date('2026-02-01T12:01:00.000Z'),
                turnIndex: 2
            },
            {
                role: 'assistant',
                content: 'Sure, here is a simpler version...',
                timestamp: new Date('2026-02-01T12:01:10.000Z'),
                turnIndex: 3,
                streaming: true
            }
        ];

        const process = makeProcess({ conversationTurns: turns });
        const serialized = serializeProcess(process);
        const deserialized = deserializeProcess(serialized);

        expect(deserialized.conversationTurns).toHaveLength(4);
        for (let i = 0; i < turns.length; i++) {
            const original = turns[i];
            const result = deserialized.conversationTurns![i];
            expect(result.role).toBe(original.role);
            expect(result.content).toBe(original.content);
            expect(result.turnIndex).toBe(original.turnIndex);
            expect(result.streaming).toBe(original.streaming);
            expect(result.timestamp).toBeInstanceOf(Date);
            expect(result.timestamp.toISOString()).toBe(original.timestamp.toISOString());
        }
    });

    it('existing processes without conversationTurns deserialize identically (no regression)', () => {
        const serialized: SerializedAIProcess = {
            id: 'legacy-1',
            type: 'clarification',
            promptPreview: 'old prompt',
            fullPrompt: 'old prompt full',
            status: 'completed',
            startTime: '2025-06-01T08:00:00.000Z',
            endTime: '2025-06-01T08:05:00.000Z',
            result: 'some result'
        };

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.id).toBe('legacy-1');
        expect(deserialized.type).toBe('clarification');
        expect(deserialized.startTime).toBeInstanceOf(Date);
        expect(deserialized.startTime.toISOString()).toBe('2025-06-01T08:00:00.000Z');
        expect(deserialized.endTime).toBeInstanceOf(Date);
        expect(deserialized.endTime!.toISOString()).toBe('2025-06-01T08:05:00.000Z');
        expect(deserialized.result).toBe('some result');
        expect(deserialized.conversationTurns).toBeUndefined();
    });

    it('serialize then deserialize preserves all non-turn fields unchanged', () => {
        const process = makeProcess({
            result: 'test result',
            error: undefined,
            parentProcessId: 'parent-1',
            sdkSessionId: 'sdk-123',
            backend: 'copilot-sdk',
            workingDirectory: '/tmp/test'
        });

        const roundTripped = deserializeProcess(serializeProcess(process));
        expect(roundTripped.id).toBe(process.id);
        expect(roundTripped.type).toBe(process.type);
        expect(roundTripped.promptPreview).toBe(process.promptPreview);
        expect(roundTripped.fullPrompt).toBe(process.fullPrompt);
        expect(roundTripped.status).toBe(process.status);
        expect(roundTripped.startTime.toISOString()).toBe(process.startTime.toISOString());
        expect(roundTripped.endTime!.toISOString()).toBe(process.endTime!.toISOString());
        expect(roundTripped.result).toBe(process.result);
        expect(roundTripped.parentProcessId).toBe(process.parentProcessId);
        expect(roundTripped.sdkSessionId).toBe(process.sdkSessionId);
        expect(roundTripped.backend).toBe(process.backend);
        expect(roundTripped.workingDirectory).toBe(process.workingDirectory);
    });
});
