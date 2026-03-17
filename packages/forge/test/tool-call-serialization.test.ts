/**
 * ToolCall Type & Serialization Tests
 *
 * Tests for the ToolCall interface and its serialization/deserialization
 * via serializeProcess / deserializeProcess, including permission handling,
 * edge cases, and backward compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
    AIProcess,
    ConversationTurn,
    ToolCall,
    serializeProcess,
    deserializeProcess
} from '../src/ai/process-types';

/** Helper to create a minimal AIProcess for testing */
function makeProcess(overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id: 'test-1',
        type: 'clarification',
        promptPreview: 'Test',
        fullPrompt: 'Test prompt',
        status: 'completed',
        startTime: new Date('2026-02-15T10:00:00.000Z'),
        endTime: new Date('2026-02-15T10:05:00.000Z'),
        ...overrides
    };
}

describe('ToolCall serialization', () => {
    it('round-trips with no tool calls (backward compat)', () => {
        const process = makeProcess({ conversationTurns: undefined });
        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns).toBeUndefined();
    });

    it('round-trips with toolCalls: undefined on a turn', () => {
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Hello',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: undefined,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].toolCalls).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].toolCalls).toBeUndefined();
    });

    it('round-trips with empty tool calls array', () => {
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'No tools used',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].toolCalls).toEqual([]);

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].toolCalls).toEqual([]);
    });

    it('round-trips a single tool call without permissions', () => {
        const startTime = new Date('2026-02-15T10:01:00.000Z');
        const endTime = new Date('2026-02-15T10:01:05.000Z');
        const tc: ToolCall = {
            id: 'tc1',
            name: 'view',
            status: 'completed',
            startTime,
            endTime,
            args: { path: '/file.ts' },
            result: 'file content'
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Viewing file',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        // Verify serialization converts Date → ISO string
        const serialized = serializeProcess(process);
        const sTc = serialized.conversationTurns![0].toolCalls![0];
        expect(typeof sTc.startTime).toBe('string');
        expect(sTc.startTime).toBe('2026-02-15T10:01:00.000Z');
        expect(typeof sTc.endTime).toBe('string');
        expect(sTc.endTime).toBe('2026-02-15T10:01:05.000Z');
        expect(sTc.id).toBe('tc1');
        expect(sTc.name).toBe('view');
        expect(sTc.status).toBe('completed');
        expect(sTc.args).toEqual({ path: '/file.ts' });
        expect(sTc.result).toBe('file content');
        expect(sTc.permissionRequest).toBeUndefined();
        expect(sTc.permissionResult).toBeUndefined();

        // Verify deserialization converts ISO string → Date
        const deserialized = deserializeProcess(serialized);
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.startTime).toBeInstanceOf(Date);
        expect(dTc.startTime.toISOString()).toBe('2026-02-15T10:01:00.000Z');
        expect(dTc.endTime).toBeInstanceOf(Date);
        expect(dTc.endTime!.toISOString()).toBe('2026-02-15T10:01:05.000Z');
        expect(dTc.id).toBe('tc1');
        expect(dTc.name).toBe('view');
        expect(dTc.status).toBe('completed');
        expect(dTc.args).toEqual({ path: '/file.ts' });
        expect(dTc.result).toBe('file content');
    });

    it('round-trips parentToolCallId for nested tool calls', () => {
        const parent: ToolCall = {
            id: 'tc-parent',
            name: 'task',
            status: 'completed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:10.000Z'),
            args: { agent_type: 'explore' },
        };
        const child: ToolCall = {
            id: 'tc-child',
            name: 'glob',
            status: 'completed',
            startTime: new Date('2026-02-15T10:01:01.000Z'),
            endTime: new Date('2026-02-15T10:01:02.000Z'),
            args: { glob_pattern: '**/*.ts' },
            result: 'a.ts\nb.ts',
            parentToolCallId: 'tc-parent',
        };

        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Nested run',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [parent, child],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].toolCalls![1].parentToolCallId).toBe('tc-parent');

        const deserialized = deserializeProcess(serialized);
        expect(deserialized.conversationTurns![0].toolCalls![1].parentToolCallId).toBe('tc-parent');
    });

    it('round-trips tool call with permission request and approval', () => {
        const permReqTs = new Date('2026-02-15T10:01:01.000Z');
        const permResTs = new Date('2026-02-15T10:01:02.000Z');
        const tc: ToolCall = {
            id: 'tc2',
            name: 'bash',
            status: 'completed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:05.000Z'),
            args: { command: 'ls -la' },
            result: 'total 42\ndrwxr-xr-x ...',
            permissionRequest: {
                kind: 'shell',
                timestamp: permReqTs,
                resource: '/bin/ls',
                operation: 'execute command'
            },
            permissionResult: {
                approved: true,
                timestamp: permResTs
            }
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Running command',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        // Verify serialized permission timestamps are ISO strings
        const serialized = serializeProcess(process);
        const sTc = serialized.conversationTurns![0].toolCalls![0];
        expect(typeof sTc.permissionRequest!.timestamp).toBe('string');
        expect(sTc.permissionRequest!.timestamp).toBe('2026-02-15T10:01:01.000Z');
        expect(sTc.permissionRequest!.kind).toBe('shell');
        expect(sTc.permissionRequest!.resource).toBe('/bin/ls');
        expect(sTc.permissionRequest!.operation).toBe('execute command');
        expect(typeof sTc.permissionResult!.timestamp).toBe('string');
        expect(sTc.permissionResult!.timestamp).toBe('2026-02-15T10:01:02.000Z');
        expect(sTc.permissionResult!.approved).toBe(true);

        // Verify deserialized permission timestamps are Date objects
        const deserialized = deserializeProcess(serialized);
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.permissionRequest!.timestamp).toBeInstanceOf(Date);
        expect(dTc.permissionRequest!.timestamp.toISOString()).toBe('2026-02-15T10:01:01.000Z');
        expect(dTc.permissionRequest!.kind).toBe('shell');
        expect(dTc.permissionRequest!.resource).toBe('/bin/ls');
        expect(dTc.permissionResult!.timestamp).toBeInstanceOf(Date);
        expect(dTc.permissionResult!.timestamp.toISOString()).toBe('2026-02-15T10:01:02.000Z');
        expect(dTc.permissionResult!.approved).toBe(true);
    });

    it('round-trips tool call with permission denial', () => {
        const tc: ToolCall = {
            id: 'tc3',
            name: 'edit',
            status: 'failed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:01.000Z'),
            args: { path: '/etc/passwd' },
            error: 'Permission denied',
            permissionRequest: {
                kind: 'write',
                timestamp: new Date('2026-02-15T10:01:00.500Z'),
                resource: '/etc/passwd'
            },
            permissionResult: {
                approved: false,
                timestamp: new Date('2026-02-15T10:01:01.000Z'),
                reason: 'User denied'
            }
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Trying to edit',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.permissionResult!.approved).toBe(false);
        expect(dTc.permissionResult!.reason).toBe('User denied');
        expect(dTc.error).toBe('Permission denied');
        expect(dTc.result).toBeUndefined();
    });

    it('round-trips multiple tool calls in a single turn', () => {
        const toolCalls: ToolCall[] = [
            {
                id: 'tc-view',
                name: 'view',
                status: 'completed',
                startTime: new Date('2026-02-15T10:01:00.000Z'),
                endTime: new Date('2026-02-15T10:01:01.000Z'),
                args: { path: '/src/main.ts' },
                result: 'export function main() {}'
            },
            {
                id: 'tc-grep',
                name: 'grep',
                status: 'failed',
                startTime: new Date('2026-02-15T10:01:01.000Z'),
                endTime: new Date('2026-02-15T10:01:02.000Z'),
                args: { pattern: 'TODO', path: '/src' },
                error: 'No matches found'
            },
            {
                id: 'tc-edit',
                name: 'edit',
                status: 'running',
                startTime: new Date('2026-02-15T10:01:02.000Z'),
                args: { path: '/src/main.ts', old_str: 'main', new_str: 'app' },
                permissionRequest: {
                    kind: 'write',
                    timestamp: new Date('2026-02-15T10:01:02.500Z'),
                    resource: '/src/main.ts'
                },
                permissionResult: {
                    approved: true,
                    timestamp: new Date('2026-02-15T10:01:03.000Z')
                }
            }
        ];
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Working on changes',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls,
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dToolCalls = deserialized.conversationTurns![0].toolCalls!;
        expect(dToolCalls).toHaveLength(3);

        expect(dToolCalls[0].name).toBe('view');
        expect(dToolCalls[0].status).toBe('completed');
        expect(dToolCalls[0].result).toBe('export function main() {}');

        expect(dToolCalls[1].name).toBe('grep');
        expect(dToolCalls[1].status).toBe('failed');
        expect(dToolCalls[1].error).toBe('No matches found');

        expect(dToolCalls[2].name).toBe('edit');
        expect(dToolCalls[2].status).toBe('running');
        expect(dToolCalls[2].endTime).toBeUndefined();
        expect(dToolCalls[2].permissionRequest).toBeDefined();
        expect(dToolCalls[2].permissionResult!.approved).toBe(true);
    });

    it('round-trips multiple turns with mixed tool calls', () => {
        const turns: ConversationTurn[] = [
            {
                role: 'user',
                content: 'Fix the bug',
                timestamp: new Date('2026-02-15T10:00:00.000Z'),
                turnIndex: 0,
                timeline: [],
                // No tool calls on user turn
            },
            {
                role: 'assistant',
                content: 'Looking at the code',
                timestamp: new Date('2026-02-15T10:00:05.000Z'),
                turnIndex: 1,
                toolCalls: [
                    {
                        id: 'tc-a1',
                        name: 'view',
                        status: 'completed',
                        startTime: new Date('2026-02-15T10:00:05.000Z'),
                        endTime: new Date('2026-02-15T10:00:06.000Z'),
                        args: { path: '/bug.ts' },
                        result: 'buggy code'
                    },
                    {
                        id: 'tc-a2',
                        name: 'edit',
                        status: 'completed',
                        startTime: new Date('2026-02-15T10:00:06.000Z'),
                        endTime: new Date('2026-02-15T10:00:07.000Z'),
                        args: { path: '/bug.ts', old_str: 'bug', new_str: 'fix' }
                    }
                ],
                timeline: [],
            },
            {
                role: 'user',
                content: 'Run the tests',
                timestamp: new Date('2026-02-15T10:01:00.000Z'),
                turnIndex: 2,
                timeline: [],
            },
            {
                role: 'assistant',
                content: 'Tests failed',
                timestamp: new Date('2026-02-15T10:01:05.000Z'),
                turnIndex: 3,
                toolCalls: [
                    {
                        id: 'tc-b1',
                        name: 'bash',
                        status: 'failed',
                        startTime: new Date('2026-02-15T10:01:05.000Z'),
                        endTime: new Date('2026-02-15T10:01:30.000Z'),
                        args: { command: 'npm test' },
                        error: 'Test suite failed: 3 failures'
                    }
                ],
                timeline: [],
            }
        ];
        const process = makeProcess({ conversationTurns: turns });

        const deserialized = deserializeProcess(serializeProcess(process));
        expect(deserialized.conversationTurns).toHaveLength(4);

        // Turn 0: user, no tools
        expect(deserialized.conversationTurns![0].toolCalls).toBeUndefined();

        // Turn 1: assistant with 2 tool calls
        expect(deserialized.conversationTurns![1].toolCalls).toHaveLength(2);
        expect(deserialized.conversationTurns![1].toolCalls![0].name).toBe('view');
        expect(deserialized.conversationTurns![1].toolCalls![1].name).toBe('edit');

        // Turn 2: user, no tools
        expect(deserialized.conversationTurns![2].toolCalls).toBeUndefined();

        // Turn 3: assistant with 1 failed tool call
        expect(deserialized.conversationTurns![3].toolCalls).toHaveLength(1);
        expect(deserialized.conversationTurns![3].toolCalls![0].status).toBe('failed');
        expect(deserialized.conversationTurns![3].toolCalls![0].error).toBe('Test suite failed: 3 failures');
    });

    it('handles missing endTime (tool still running)', () => {
        const tc: ToolCall = {
            id: 'tc-running',
            name: 'bash',
            status: 'running',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            args: { command: 'long-running-task' }
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Running...',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const serialized = serializeProcess(process);
        expect(serialized.conversationTurns![0].toolCalls![0].endTime).toBeUndefined();

        const deserialized = deserializeProcess(serialized);
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.endTime).toBeUndefined();
        expect(dTc.startTime).toBeInstanceOf(Date);
        expect(dTc.status).toBe('running');
    });

    it('handles empty args object', () => {
        const tc: ToolCall = {
            id: 'tc-empty-args',
            name: 'view',
            status: 'completed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:01.000Z'),
            args: {},
            result: 'output'
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Done',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        expect(deserialized.conversationTurns![0].toolCalls![0].args).toEqual({});
    });

    it('handles very long result string (100k chars)', () => {
        const longResult = 'x'.repeat(100_000);
        const tc: ToolCall = {
            id: 'tc-long',
            name: 'bash',
            status: 'completed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:01.000Z'),
            args: { command: 'cat large-file' },
            result: longResult
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'File content',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        expect(deserialized.conversationTurns![0].toolCalls![0].result).toBe(longResult);
        expect(deserialized.conversationTurns![0].toolCalls![0].result!.length).toBe(100_000);
    });

    it('handles tool call with error but no result', () => {
        const tc: ToolCall = {
            id: 'tc-err',
            name: 'edit',
            status: 'failed',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            endTime: new Date('2026-02-15T10:01:01.000Z'),
            args: { path: '/nonexistent.ts' },
            error: 'File not found'
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Failed',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.status).toBe('failed');
        expect(dTc.error).toBe('File not found');
        expect(dTc.result).toBeUndefined();
    });

    it('handles pending tool call (no endTime, no result)', () => {
        const tc: ToolCall = {
            id: 'tc-pending',
            name: 'bash',
            status: 'pending',
            startTime: new Date('2026-02-15T10:01:00.000Z'),
            args: { command: 'echo hello' }
        };
        const turn: ConversationTurn = {
            role: 'assistant',
            content: 'Queued',
            timestamp: new Date('2026-02-15T10:01:00.000Z'),
            turnIndex: 0,
            toolCalls: [tc],
            timeline: [],
        };
        const process = makeProcess({ conversationTurns: [turn] });

        const deserialized = deserializeProcess(serializeProcess(process));
        const dTc = deserialized.conversationTurns![0].toolCalls![0];
        expect(dTc.status).toBe('pending');
        expect(dTc.startTime).toBeInstanceOf(Date);
        expect(dTc.endTime).toBeUndefined();
        expect(dTc.result).toBeUndefined();
        expect(dTc.error).toBeUndefined();
    });
});
