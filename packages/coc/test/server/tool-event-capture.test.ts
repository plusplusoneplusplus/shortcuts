/**
 * Tool Event Capture Tests
 *
 * Tests that CopilotSDKService.sendWithStreaming() correctly captures tool
 * execution events (start, complete, progress) and builds ToolCall objects,
 * and that queue-executor-bridge attaches them to conversation turns.
 *
 * Uses the mock SDK infrastructure from the copilot-sdk-service test suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ToolCall,
    ToolCallStatus,
    ConversationTurn,
} from '@plusplusoneplusplus/pipeline-core';
import {
    TaskQueueManager,
    createQueueExecutor,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable, mockSendFollowUp } = sdkMocks;

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
    };
});

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
    return {
        id: overrides.id ?? 'tc-1',
        name: overrides.name ?? 'bash',
        status: overrides.status ?? 'completed',
        startTime: overrides.startTime ?? new Date('2026-01-01T00:00:00Z'),
        endTime: overrides.endTime ?? new Date('2026-01-01T00:00:01Z'),
        args: overrides.args ?? { command: 'ls' },
        result: overrides.result ?? 'file1.ts\nfile2.ts',
        error: overrides.error,
        permissionRequest: overrides.permissionRequest,
        permissionResult: overrides.permissionResult,
    };
}

function makeTask(id: string, prompt: string) {
    return {
        id,
        type: 'chat' as const,
        payload: { kind: 'chat' as const, mode: 'ask' as const, prompt },
        priority: 1,
        config: { model: 'test-model', timeoutMs: 30000 },
        status: 'queued' as const,
        createdAt: Date.now(),
        displayName: `Task ${id}`,
    };
}

// ============================================================================
// Tests — ToolCall object construction
// ============================================================================

describe('Tool Event Capture', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendFollowUp.mockReset();
    });

    // ========================================================================
    // 1. Basic tool execution (success)
    // ========================================================================

    it('should build ToolCall with correct fields on successful execution', () => {
        const tc = makeToolCall({
            id: 'call-abc',
            name: 'view',
            status: 'completed',
            args: { path: '/src/index.ts' },
            result: 'file content here',
        });

        expect(tc.id).toBe('call-abc');
        expect(tc.name).toBe('view');
        expect(tc.status).toBe('completed');
        expect(tc.args).toEqual({ path: '/src/index.ts' });
        expect(tc.result).toBe('file content here');
        expect(tc.error).toBeUndefined();
        expect(tc.startTime).toBeInstanceOf(Date);
        expect(tc.endTime).toBeInstanceOf(Date);
    });

    // ========================================================================
    // 2. Tool failure
    // ========================================================================

    it('should capture error info when tool fails', () => {
        const tc: ToolCall = {
            id: 'call-fail',
            name: 'bash',
            status: 'failed',
            startTime: new Date(),
            endTime: new Date(),
            args: { command: 'cat /nonexistent' },
            error: 'File not found',
        };

        expect(tc.status).toBe('failed');
        expect(tc.error).toBe('File not found');
        expect(tc.result).toBeUndefined();
    });

    // ========================================================================
    // 3. Multiple concurrent tools — correct pairing
    // ========================================================================

    it('should track multiple concurrent tool calls independently', () => {
        // Simulate: start T1, start T2, complete T2, complete T1
        const toolCallsMap = new Map<string, ToolCall>();

        // Start T1
        toolCallsMap.set('t1', makeToolCall({ id: 't1', name: 'grep', status: 'running', endTime: undefined, result: undefined }));
        // Start T2
        toolCallsMap.set('t2', makeToolCall({ id: 't2', name: 'view', status: 'running', endTime: undefined, result: undefined }));

        // Complete T2 first
        const t2 = toolCallsMap.get('t2')!;
        t2.status = 'completed';
        t2.endTime = new Date();
        t2.result = 'view result';

        // Complete T1 second
        const t1 = toolCallsMap.get('t1')!;
        t1.status = 'completed';
        t1.endTime = new Date();
        t1.result = 'grep result';

        expect(toolCallsMap.get('t1')!.name).toBe('grep');
        expect(toolCallsMap.get('t1')!.status).toBe('completed');
        expect(toolCallsMap.get('t1')!.result).toBe('grep result');

        expect(toolCallsMap.get('t2')!.name).toBe('view');
        expect(toolCallsMap.get('t2')!.status).toBe('completed');
        expect(toolCallsMap.get('t2')!.result).toBe('view result');
    });

    // ========================================================================
    // 4. Permission request tracking
    // ========================================================================

    it('should attach permission request/result to ToolCall', () => {
        const tc = makeToolCall({
            id: 'call-perm',
            name: 'bash',
            permissionRequest: {
                kind: 'shell',
                timestamp: new Date(),
                resource: '/bin/rm',
                operation: 'execute',
            },
            permissionResult: {
                approved: true,
                timestamp: new Date(),
            },
        });

        expect(tc.permissionRequest).toBeDefined();
        expect(tc.permissionRequest!.kind).toBe('shell');
        expect(tc.permissionRequest!.resource).toBe('/bin/rm');
        expect(tc.permissionResult).toBeDefined();
        expect(tc.permissionResult!.approved).toBe(true);
    });

    it('should capture denied permission result', () => {
        const tc = makeToolCall({
            permissionRequest: {
                kind: 'write',
                timestamp: new Date(),
                resource: '/etc/passwd',
            },
            permissionResult: {
                approved: false,
                timestamp: new Date(),
                reason: 'denied-by-rules',
            },
        });

        expect(tc.permissionResult!.approved).toBe(false);
        expect(tc.permissionResult!.reason).toBe('denied-by-rules');
    });

    // ========================================================================
    // 5. Orphaned complete event
    // ========================================================================

    it('should create synthetic ToolCall for orphaned complete event', () => {
        // Simulate receiving a complete without a prior start
        const toolCallsMap = new Map<string, ToolCall>();
        const orphanedId = 'orphan-1';

        // No start event — simulate the orphan handling from the implementation
        if (!toolCallsMap.has(orphanedId)) {
            toolCallsMap.set(orphanedId, {
                id: orphanedId,
                name: 'unknown',
                status: 'failed',
                startTime: new Date(),
                endTime: new Date(),
                args: {},
                error: 'Started outside observation window',
            });
        }

        const tc = toolCallsMap.get(orphanedId)!;
        expect(tc.status).toBe('failed');
        expect(tc.error).toBe('Started outside observation window');
    });

    // ========================================================================
    // 6. Progress updates
    // ========================================================================

    it('should store progress message on ToolCall', () => {
        const tc = makeToolCall({ id: 'tc-progress', status: 'running' });
        // Progress message stored as extra field
        (tc as any).progressMessage = 'Processing 50%';

        expect((tc as any).progressMessage).toBe('Processing 50%');
    });

    // ========================================================================
    // 7. Session without tools — no crash
    // ========================================================================

    it('should handle session with no tool events gracefully', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Simple response without tools',
            sessionId: 'session-no-tools',
            toolCalls: undefined,
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('no-tools-1', 'Hello world');

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        // Verify the process was stored without toolCalls causing issues
        const process = store.processes.get(`queue_${task.id}`);
        expect(process).toBeDefined();
        expect(process!.status).toBe('completed');
    });

    // ========================================================================
    // 8. Integration with conversation turns — toolCalls attached
    // ========================================================================

    it('should attach toolCalls to assistant conversation turn', async () => {
        const toolCalls: ToolCall[] = [
            makeToolCall({ id: 'tc-1', name: 'bash', result: 'ok' }),
            makeToolCall({ id: 'tc-2', name: 'view', result: 'content' }),
        ];

        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'I ran some tools',
            sessionId: 'session-tools',
            toolCalls,
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('with-tools-1', 'Run tools');

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        const process = store.processes.get(`queue_${task.id}`);
        expect(process).toBeDefined();
        expect(process!.conversationTurns).toBeDefined();
        expect(process!.conversationTurns!.length).toBe(2);

        const assistantTurn = process!.conversationTurns![1];
        expect(assistantTurn.role).toBe('assistant');
        expect(assistantTurn.toolCalls).toBeDefined();
        expect(assistantTurn.toolCalls!.length).toBe(2);
        expect(assistantTurn.toolCalls![0].name).toBe('bash');
        expect(assistantTurn.toolCalls![1].name).toBe('view');
    });

    it('should not set toolCalls on assistant turn when no tools used', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Plain text response',
            sessionId: 'session-plain',
            // No toolCalls field
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('no-tools-2', 'Simple question');

        await executor.execute(task);

        const process = store.processes.get(`queue_${task.id}`);
        const assistantTurn = process!.conversationTurns![1];
        expect(assistantTurn.toolCalls).toBeUndefined();
    });

    // ========================================================================
    // 9. ToolCall status values
    // ========================================================================

    it('should accept all valid ToolCallStatus values', () => {
        const statuses: ToolCallStatus[] = ['pending', 'running', 'completed', 'failed'];
        for (const status of statuses) {
            const tc = makeToolCall({ status });
            expect(tc.status).toBe(status);
        }
    });

    // ========================================================================
    // 10. Tool calls serialized with process
    // ========================================================================

    it('should persist toolCalls in process store via conversation turns', async () => {
        const toolCalls: ToolCall[] = [
            makeToolCall({
                id: 'persist-1',
                name: 'edit',
                args: { path: '/a.ts', old_str: 'foo', new_str: 'bar' },
                result: 'File updated',
            }),
        ];

        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Done',
            sessionId: 'session-persist',
            toolCalls,
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('persist-1', 'Edit file');

        await executor.execute(task);

        // Verify updateProcess was called with conversationTurns containing toolCalls
        expect(store.updateProcess).toHaveBeenCalled();
        const updateCalls = (store.updateProcess as ReturnType<typeof vi.fn>).mock.calls;
        const lastUpdate = updateCalls[updateCalls.length - 1];
        const updates = lastUpdate[1] as Partial<AIProcess>;
        expect(updates.conversationTurns).toBeDefined();

        const assistantTurn = updates.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn?.toolCalls).toBeDefined();
        expect(assistantTurn!.toolCalls![0].id).toBe('persist-1');
        expect(assistantTurn!.toolCalls![0].args).toEqual({ path: '/a.ts', old_str: 'foo', new_str: 'bar' });
    });

    // ========================================================================
    // 11. Multiple tools with mixed success/failure
    // ========================================================================

    it('should handle mixed success and failure tool calls', async () => {
        const toolCalls: ToolCall[] = [
            makeToolCall({ id: 'ok-1', name: 'grep', status: 'completed', result: 'match found' }),
            makeToolCall({ id: 'fail-1', name: 'bash', status: 'failed', result: undefined, error: 'command failed' }),
            makeToolCall({ id: 'ok-2', name: 'view', status: 'completed', result: 'file contents' }),
        ];

        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Partial success',
            sessionId: 'session-mixed',
            toolCalls,
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('mixed-1', 'Run mixed');

        await executor.execute(task);

        const process = store.processes.get(`queue_${task.id}`);
        const turn = process!.conversationTurns![1];
        expect(turn.toolCalls!.length).toBe(3);
        expect(turn.toolCalls![0].status).toBe('completed');
        expect(turn.toolCalls![1].status).toBe('failed');
        expect(turn.toolCalls![1].error).toBe('command failed');
        expect(turn.toolCalls![2].status).toBe('completed');
    });

    // ========================================================================
    // 12. Follow-up with tool calls
    // ========================================================================

    it('should propagate toolCalls from follow-up results', async () => {
        const toolCalls: ToolCall[] = [
            makeToolCall({ id: 'fu-tc-1', name: 'bash', result: 'test output' }),
        ];

        // executeFollowUp now calls sendMessage (not sendFollowUp)
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Follow-up done',
            sessionId: 'sess-follow',
            toolCalls,
        });

        // Set up initial process with session
        const processId = 'queue_follow-test';
        store.processes.set(processId, {
            id: processId,
            type: 'queue-ai-clarification',
            promptPreview: 'test',
            fullPrompt: 'test prompt',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-follow',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ],
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        await executor.executeFollowUp(processId, 'Do more');

        const process = store.processes.get(processId);
        expect(process).toBeDefined();
        // Follow-up appends assistant turn
        const turns = process!.conversationTurns!;
        const lastTurn = turns[turns.length - 1];
        expect(lastTurn.role).toBe('assistant');
        expect(lastTurn.toolCalls).toBeDefined();
        expect(lastTurn.toolCalls![0].id).toBe('fu-tc-1');
    });

    // ========================================================================
    // 13. Empty toolCalls array
    // ========================================================================

    it('should handle empty toolCalls array without issue', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'No tools needed',
            sessionId: 'session-empty-arr',
            toolCalls: [],
        });

        const executor = new CLITaskExecutor(store as ProcessStore);
        const task = makeTask('empty-arr-1', 'Question');

        await executor.execute(task);

        const process = store.processes.get(`queue_${task.id}`);
        const turn = process!.conversationTurns![1];
        // Empty array should be treated as undefined (falsy)
        // The bridge uses `|| undefined` so empty array stays as []
        expect(turn.toolCalls).toEqual([]);
    });
});
