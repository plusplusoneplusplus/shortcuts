/**
 * Process Types Tests
 *
 * Round-trip serialization tests for ConversationTurn images field.
 */

import { describe, it, expect } from 'vitest';
import { serializeProcess, deserializeProcess } from '../../src/ai/process-types';
import type { AIProcess } from '../../src/ai/process-types';

function makeMinimalProcess(overrides?: Partial<AIProcess>): AIProcess {
    return {
        id: 'test-1',
        type: 'chat',
        promptPreview: 'hello',
        fullPrompt: 'hello world',
        status: 'completed',
        startTime: new Date('2026-01-01T00:00:00Z'),
        ...overrides,
    };
}

describe('serializeProcess / deserializeProcess round-trip', () => {
    it('should preserve images array on conversation turns', () => {
        const images = ['data:image/png;base64,abc', 'data:image/jpeg;base64,def'];
        const process = makeMinimalProcess({
            conversationTurns: [{
                role: 'user',
                content: 'see these images',
                timestamp: new Date('2026-01-01T00:00:01Z'),
                turnIndex: 0,
                timeline: [],
                images,
            }],
        });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].images).toEqual(images);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].images).toEqual(images);
    });

    it('should handle turns without images (undefined)', () => {
        const process = makeMinimalProcess({
            conversationTurns: [{
                role: 'user',
                content: 'no images here',
                timestamp: new Date('2026-01-01T00:00:01Z'),
                turnIndex: 0,
                timeline: [],
            }],
        });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].images).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].images).toBeUndefined();
    });
});

describe('serializeProcess / deserializeProcess — pendingMessages', () => {
    it('should round-trip pendingMessages array', () => {
        const pendingMessages = [
            { id: 'msg-1', content: 'Fix the bug', mode: 'ask', createdAt: '2026-04-10T00:00:00.000Z' },
            { id: 'msg-2', content: 'Then deploy', createdAt: '2026-04-10T00:01:00.000Z' },
        ];
        const process = makeMinimalProcess({ pendingMessages });

        const serialized = serializeProcess(process);
        expect(serialized.pendingMessages).toEqual(pendingMessages);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingMessages).toEqual(pendingMessages);
    });

    it('should handle undefined pendingMessages', () => {
        const process = makeMinimalProcess();

        const serialized = serializeProcess(process);
        expect(serialized.pendingMessages).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingMessages).toBeUndefined();
    });

    it('should handle empty pendingMessages array', () => {
        const process = makeMinimalProcess({ pendingMessages: [] });

        const serialized = serializeProcess(process);
        expect(serialized.pendingMessages).toEqual([]);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingMessages).toEqual([]);
    });

    it('should preserve optional mode field when undefined', () => {
        const pendingMessages = [
            { id: 'msg-no-mode', content: 'No mode', createdAt: '2026-04-10T00:00:00.000Z' },
        ];
        const process = makeMinimalProcess({ pendingMessages });

        const serialized = serializeProcess(process);
        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingMessages![0].mode).toBeUndefined();
    });
});

describe('serializeProcess / deserializeProcess — pendingAskUser', () => {
    it('should round-trip a pending ask-user question', () => {
        const pendingAskUser = {
            questionId: 'ask-1',
            question: 'Choose a retry strategy',
            type: 'select' as const,
            options: [
                { value: 'fast', label: 'Fast' },
                { value: 'safe', label: 'Safe', description: 'Retry with extra validation' },
            ],
            defaultValue: 'safe',
            turnIndex: 1,
        };
        const process = makeMinimalProcess({ pendingAskUser });

        const serialized = serializeProcess(process);
        expect(serialized.pendingAskUser).toEqual(pendingAskUser);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingAskUser).toEqual(pendingAskUser);
    });

    it('should handle undefined pendingAskUser', () => {
        const process = makeMinimalProcess();

        const serialized = serializeProcess(process);
        expect(serialized.pendingAskUser).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.pendingAskUser).toBeUndefined();
    });
});
