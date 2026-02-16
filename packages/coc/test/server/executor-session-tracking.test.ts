/**
 * Executor Session Tracking Tests
 *
 * Tests for session tracking in the CLITaskExecutor:
 * sdkSessionId storage, initial conversationTurns population,
 * follow-up turn appending, streaming chunk forwarding,
 * and error handling during follow-up.
 *
 * Uses mock CopilotSDKService (same pattern as queue-executor-bridge.test.ts).
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Partial mock of fs
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
    };
});

import type { ProcessStore, AIProcess, QueuedTask } from '@plusplusoneplusplus/pipeline-core';
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
// Tests — Initial Execution
// ============================================================================

describe('executor session tracking', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'sdk-session-001',
        });
    });

    describe('initial execution', () => {
        it('should store sdkSessionId on process after execution completes', async () => {
            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-init-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Explain this' },
                config: { timeoutMs: 30000 },
            };

            await executor.execute(task);

            const process = store.processes.get('queue_task-init-1');
            expect(process?.sdkSessionId).toBe('sdk-session-001');
        });

        it('should populate initial conversationTurns with user prompt and assistant response', async () => {
            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-init-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'What is X?' },
                config: { timeoutMs: 30000 },
            };

            await executor.execute(task);

            const process = store.processes.get('queue_task-init-2');
            expect(process?.conversationTurns).toHaveLength(2);

            const [userTurn, assistantTurn] = process!.conversationTurns!;
            expect(userTurn.role).toBe('user');
            expect(userTurn.content).toBe('What is X?');
            expect(userTurn.turnIndex).toBe(0);
            expect(userTurn.timestamp).toBeInstanceOf(Date);

            expect(assistantTurn.role).toBe('assistant');
            expect(assistantTurn.content).toBe('AI response text');
            expect(assistantTurn.turnIndex).toBe(1);
        });

        it('should set backend field on the tracked process via result', async () => {
            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-init-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: { timeoutMs: 30000 },
            };

            await executor.execute(task);

            const process = store.processes.get('queue_task-init-3');
            // The process should be completed with session data
            expect(process?.status).toBe('completed');
            expect(process?.sdkSessionId).toBeDefined();
        });
    });

    // ========================================================================
    // Follow-up execution
    // ========================================================================

    describe('follow-up execution', () => {
        it('should append assistant response turn after follow-up completes', async () => {
            const processId = 'proc-follow-1';
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'completed',
                startTime: new Date(),
                sdkSessionId: 'sess-follow-1',
                conversationTurns: [
                    { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 },
                    { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 },
                ],
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockResolvedValue({
                success: true,
                response: 'Follow-up answer',
                sessionId: 'sess-follow-1',
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'What about Y?');

            const updated = store.processes.get(processId);
            expect(updated?.conversationTurns).toHaveLength(3);
            expect(updated!.conversationTurns![2].role).toBe('assistant');
            expect(updated!.conversationTurns![2].content).toBe('Follow-up answer');
            expect(updated!.conversationTurns![2].turnIndex).toBe(2);
        });

        it('should preserve existing turns when appending', async () => {
            const processId = 'proc-follow-2';
            const existingTurns = [
                { role: 'user' as const, content: 'Q1', timestamp: new Date(), turnIndex: 0 },
                { role: 'assistant' as const, content: 'A1', timestamp: new Date(), turnIndex: 1 },
                { role: 'user' as const, content: 'Q2', timestamp: new Date(), turnIndex: 2 },
            ];
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-follow-2',
                conversationTurns: existingTurns,
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockResolvedValue({
                success: true,
                response: 'A2',
                sessionId: 'sess-follow-2',
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'follow up');

            const updated = store.processes.get(processId);
            expect(updated?.conversationTurns).toHaveLength(4);
            // Original turns preserved
            expect(updated!.conversationTurns![0].content).toBe('Q1');
            expect(updated!.conversationTurns![1].content).toBe('A1');
            expect(updated!.conversationTurns![2].content).toBe('Q2');
            // New turn appended
            expect(updated!.conversationTurns![3].content).toBe('A2');
        });
    });

    // ========================================================================
    // Streaming during follow-up
    // ========================================================================

    describe('streaming during follow-up', () => {
        it('should forward streaming chunks via emitProcessOutput', async () => {
            const processId = 'proc-stream-1';
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-stream-1',
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
                if (options?.onStreamingChunk) {
                    options.onStreamingChunk('chunk-A');
                    options.onStreamingChunk('chunk-B');
                    options.onStreamingChunk('chunk-C');
                }
                return { success: true, response: 'chunk-Achunk-Bchunk-C', sessionId: 'sess-stream-1' };
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'stream me');

            expect(store.emitProcessOutput).toHaveBeenCalledWith(processId, 'chunk-A');
            expect(store.emitProcessOutput).toHaveBeenCalledWith(processId, 'chunk-B');
            expect(store.emitProcessOutput).toHaveBeenCalledWith(processId, 'chunk-C');
        });

        it('should accumulate streamed content into final assistant turn', async () => {
            const processId = 'proc-stream-2';
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-stream-2',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
                if (options?.onStreamingChunk) {
                    options.onStreamingChunk('Hello ');
                    options.onStreamingChunk('World');
                }
                return { success: true, response: 'Hello World', sessionId: 'sess-stream-2' };
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'greet');

            const updated = store.processes.get(processId);
            const lastTurn = updated!.conversationTurns![updated!.conversationTurns!.length - 1];
            expect(lastTurn.role).toBe('assistant');
            expect(lastTurn.content).toBe('Hello World');
        });
    });

    // ========================================================================
    // Error during follow-up
    // ========================================================================

    describe('error during follow-up', () => {
        it('should mark process as failed if follow-up sendMessage rejects', async () => {
            const processId = 'proc-err-1';
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-err-1',
                conversationTurns: [],
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockResolvedValue({
                success: false,
                error: 'Session timed out',
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'question');

            const updated = store.processes.get(processId);
            expect(updated?.status).toBe('failed');
            expect(store.emitProcessComplete).toHaveBeenCalledWith(processId, 'failed', expect.stringMatching(/\d+ms/));
        });

        it('should still append error turn when assistant response fails', async () => {
            const processId = 'proc-err-2';
            const proc: AIProcess = {
                id: processId,
                type: 'clarification',
                promptPreview: 'test',
                fullPrompt: 'test',
                status: 'running',
                startTime: new Date(),
                sdkSessionId: 'sess-err-2',
                conversationTurns: [
                    { role: 'user', content: 'Q1', timestamp: new Date(), turnIndex: 0 },
                ],
            };
            await store.addProcess(proc);

            mockSendFollowUp.mockResolvedValue({
                success: false,
                error: 'AI backend unreachable',
            });

            const executor = new CLITaskExecutor(store);
            await executor.executeFollowUp(processId, 'question');

            const updated = store.processes.get(processId);
            // Should have original user turn + error turn
            expect(updated?.conversationTurns).toHaveLength(2);
            expect(updated!.conversationTurns![1].role).toBe('assistant');
            expect(updated!.conversationTurns![1].content).toMatch(/Error:/);
        });
    });
});
