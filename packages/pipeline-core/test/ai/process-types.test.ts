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
