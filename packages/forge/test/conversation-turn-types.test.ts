/**
 * ConversationTurn Type & Serialization Tests
 *
 * Tests for the ConversationTurn interface, its serialization via
 * serializeProcess / deserializeProcess, and edge cases around
 * backward compatibility and extreme content.
 */

import { describe, it, expect } from 'vitest';
import {
    AIProcess,
    SerializedAIProcess,
    ConversationTurn,
    SerializedConversationTurn,
    TimelineItem,
    ToolCall,
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
            turnIndex: 0,
            timeline: [],
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
                turnIndex: 0,
                timeline: [],
            },
            {
                role: 'assistant',
                content: 'This function calculates...',
                timestamp: new Date('2026-02-01T12:00:05.000Z'),
                turnIndex: 1,
                timeline: [],
                streaming: false,
                timeline: [],
            },
            {
                role: 'user',
                content: 'Can you simplify it?',
                timestamp: new Date('2026-02-01T12:01:00.000Z'),
                turnIndex: 2,
                timeline: [],
            },
            {
                role: 'assistant',
                content: 'Sure, here is a simpler version...',
                timestamp: new Date('2026-02-01T12:01:10.000Z'),
                turnIndex: 3,
                timeline: [],
                streaming: true,
                timeline: [],
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

// ============================================================================
// ConversationTurn Type Shape
// ============================================================================

describe('ConversationTurn type', () => {
    it('should have role and content fields', () => {
        const turn: ConversationTurn = {
            role: 'user',
            content: 'Hello',
            timestamp: new Date(),
            turnIndex: 0,
            timeline: [],
        };
        expect(turn.role).toBe('user');
        expect(turn.content).toBe('Hello');
        expect(turn.turnIndex).toBe(0);
    });

    it('should accept optional streaming field', () => {
        const turnWithStreaming: ConversationTurn = {
            role: 'assistant',
            content: 'Streaming...',
            timestamp: new Date(),
            turnIndex: 1,
            timeline: [],
            streaming: true,
            timeline: [],
        };
        expect(turnWithStreaming.streaming).toBe(true);

        const turnWithout: ConversationTurn = {
            role: 'assistant',
            content: 'Done',
            timestamp: new Date(),
            turnIndex: 2,
            timeline: [],
        };
        expect(turnWithout.streaming).toBeUndefined();
    });
});

// ============================================================================
// Deserialization Edge Cases
// ============================================================================

describe('deserializeProcess edge cases', () => {
    it('should deserialize when conversationTurns is null (edge case)', () => {
        const serialized: SerializedAIProcess = {
            id: 'null-turns',
            type: 'clarification',
            promptPreview: 'prompt',
            fullPrompt: 'full prompt',
            status: 'completed',
            startTime: '2026-01-15T10:00:00.000Z',
            conversationTurns: null as unknown as undefined,
        };

        const deserialized = deserializeProcess(serialized);
        // null?.map() returns undefined, so conversationTurns should be undefined
        expect(deserialized.conversationTurns).toBeUndefined();
    });

    it('should restore turn timestamps as Date objects if present', () => {
        const serialized: SerializedAIProcess = {
            id: 'ts-check',
            type: 'clarification',
            promptPreview: 'p',
            fullPrompt: 'fp',
            status: 'completed',
            startTime: '2026-01-15T10:00:00.000Z',
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: '2026-01-15T10:00:00.000Z', turnIndex: 0, timeline: [] },
            ],
        };

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].timestamp).toBeInstanceOf(Date);
        expect(deserialized.conversationTurns![0].timestamp.toISOString()).toBe('2026-01-15T10:00:00.000Z');
    });
});

// ============================================================================
// Content Edge Cases
// ============================================================================

describe('ConversationTurn content edge cases', () => {
    it('should handle turns with empty content string', () => {
        const turn: ConversationTurn = {
            role: 'assistant',
            content: '',
            timestamp: new Date('2026-01-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const roundTripped = deserializeProcess(serializeProcess(process));
        expect(roundTripped.conversationTurns).toHaveLength(1);
        expect(roundTripped.conversationTurns![0].content).toBe('');
        expect(roundTripped.conversationTurns![0].role).toBe('assistant');
    });

    it('should handle turns with very long content', () => {
        const longContent = 'x'.repeat(100_000);
        const turn: ConversationTurn = {
            role: 'user',
            content: longContent,
            timestamp: new Date('2026-01-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const roundTripped = deserializeProcess(serializeProcess(process));
        expect(roundTripped.conversationTurns).toHaveLength(1);
        expect(roundTripped.conversationTurns![0].content).toBe(longContent);
        expect(roundTripped.conversationTurns![0].content.length).toBe(100_000);
    });
});

// ============================================================================
// Timeline Serialization
// ============================================================================

describe('Timeline serialization', () => {
    it('round-trips empty timeline array', () => {
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Hello',
            timestamp: new Date('2026-02-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].timeline).toEqual([]);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].timeline).toEqual([]);
    });

    it('round-trips timeline with content items (Date conversion)', () => {
        const ts1 = new Date('2026-02-15T10:00:01.000Z');
        const ts2 = new Date('2026-02-15T10:00:02.000Z');
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Here is the answer',
            timestamp: new Date('2026-02-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [
                { type: 'content', timestamp: ts1, content: 'Here is ' },
                { type: 'content', timestamp: ts2, content: 'the answer' },
            ],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].timeline).toHaveLength(2);
        expect(typeof serialized.conversationTurns![0].timeline[0].timestamp).toBe('string');
        expect(serialized.conversationTurns![0].timeline[0].timestamp).toBe('2026-02-15T10:00:01.000Z');
        expect(serialized.conversationTurns![0].timeline[0].content).toBe('Here is ');

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].timeline).toHaveLength(2);
        expect(deserialized.conversationTurns![0].timeline[0].timestamp).toBeInstanceOf(Date);
        expect(deserialized.conversationTurns![0].timeline[0].timestamp.toISOString()).toBe('2026-02-15T10:00:01.000Z');
        expect(deserialized.conversationTurns![0].timeline[0].content).toBe('Here is ');
        expect(deserialized.conversationTurns![0].timeline[1].content).toBe('the answer');
    });

    it('round-trips timeline with tool events (full ToolCall preserved)', () => {
        const toolCall: ToolCall = {
            id: 'tc-timeline-1',
            name: 'view',
            status: 'completed',
            startTime: new Date('2026-02-15T10:00:01.000Z'),
            endTime: new Date('2026-02-15T10:00:02.000Z'),
            args: { path: '/src/main.ts' },
            result: 'file content',
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Viewing file',
            timestamp: new Date('2026-02-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [
                { type: 'tool-start', timestamp: new Date('2026-02-15T10:00:01.000Z'), toolCall },
                { type: 'tool-complete', timestamp: new Date('2026-02-15T10:00:02.000Z'), toolCall },
            ],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        const sItem = serialized.conversationTurns![0].timeline[0];
        expect(sItem.type).toBe('tool-start');
        expect(sItem.toolCall).toBeDefined();
        expect(sItem.toolCall!.id).toBe('tc-timeline-1');
        expect(typeof sItem.toolCall!.startTime).toBe('string');

        const deserialized = deserializeProcess(serialized);
        const dItem = deserialized.conversationTurns![0].timeline[0];
        expect(dItem.type).toBe('tool-start');
        expect(dItem.toolCall).toBeDefined();
        expect(dItem.toolCall!.id).toBe('tc-timeline-1');
        expect(dItem.toolCall!.startTime).toBeInstanceOf(Date);
        expect(dItem.toolCall!.startTime.toISOString()).toBe('2026-02-15T10:00:01.000Z');
        expect(dItem.toolCall!.result).toBe('file content');
    });

    it('round-trips timeline with multiple interleaved content/tool events', () => {
        const toolCall: ToolCall = {
            id: 'tc-interleaved',
            name: 'bash',
            status: 'completed',
            startTime: new Date('2026-02-15T10:00:02.000Z'),
            endTime: new Date('2026-02-15T10:00:04.000Z'),
            args: { command: 'ls' },
            result: 'file1.ts\nfile2.ts',
        };
        const timeline: TimelineItem[] = [
            { type: 'content', timestamp: new Date('2026-02-15T10:00:01.000Z'), content: 'Let me check...' },
            { type: 'tool-start', timestamp: new Date('2026-02-15T10:00:02.000Z'), toolCall },
            { type: 'tool-complete', timestamp: new Date('2026-02-15T10:00:04.000Z'), toolCall },
            { type: 'content', timestamp: new Date('2026-02-15T10:00:05.000Z'), content: 'Found 2 files.' },
        ];
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Let me check... Found 2 files.',
            timestamp: new Date('2026-02-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline,
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dTimeline = deserialized.conversationTurns![0].timeline;
        expect(dTimeline).toHaveLength(4);
        expect(dTimeline[0].type).toBe('content');
        expect(dTimeline[0].content).toBe('Let me check...');
        expect(dTimeline[1].type).toBe('tool-start');
        expect(dTimeline[1].toolCall!.name).toBe('bash');
        expect(dTimeline[2].type).toBe('tool-complete');
        expect(dTimeline[3].type).toBe('content');
        expect(dTimeline[3].content).toBe('Found 2 files.');

        // All timestamps are Date objects
        for (const item of dTimeline) {
            expect(item.timestamp).toBeInstanceOf(Date);
        }
    });

    it('deserializes legacy turn without timeline field as empty array', () => {
        const serialized: SerializedAIProcess = {
            id: 'legacy-no-timeline',
            type: 'clarification',
            promptPreview: 'p',
            fullPrompt: 'fp',
            status: 'completed',
            startTime: '2026-01-15T10:00:00.000Z',
            conversationTurns: [
                { role: 'user', content: 'hi', timestamp: '2026-01-15T10:00:00.000Z', turnIndex: 0, timeline: [] },
            ],
        };

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].timeline).toEqual([]);
    });

    it('round-trips tool-failed timeline event', () => {
        const failedTool: ToolCall = {
            id: 'tc-fail',
            name: 'edit',
            status: 'failed',
            startTime: new Date('2026-02-15T10:00:01.000Z'),
            endTime: new Date('2026-02-15T10:00:02.000Z'),
            args: { path: '/missing.ts' },
            error: 'File not found',
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Error editing file',
            timestamp: new Date('2026-02-15T10:00:00.000Z'),
            turnIndex: 0,
            timeline: [
                { type: 'tool-start', timestamp: new Date('2026-02-15T10:00:01.000Z'), toolCall: failedTool },
                { type: 'tool-failed', timestamp: new Date('2026-02-15T10:00:02.000Z'), toolCall: failedTool },
            ],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dTimeline = deserialized.conversationTurns![0].timeline;
        expect(dTimeline).toHaveLength(2);
        expect(dTimeline[1].type).toBe('tool-failed');
        expect(dTimeline[1].toolCall!.status).toBe('failed');
        expect(dTimeline[1].toolCall!.error).toBe('File not found');
    });
});
