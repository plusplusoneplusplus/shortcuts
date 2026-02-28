/**
 * Queue Executor Bridge Tests
 *
 * Tests for CLITaskExecutor and createQueueExecutorBridge:
 * - Task execution by type (ai-clarification, chat, custom, follow-prompt)
 * - Process tracking in ProcessStore
 * - Cancellation handling
 * - Error handling and failure paths
 * - Queue executor integration (tasks move from queued → running → completed/failed)
 * - History population after execution
 * - Concurrent execution limits
 *
 * Uses mock CopilotSDKService to avoid real AI calls.
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Partial mock of fs — allows overriding existsSync/readFileSync per test
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import {
    TaskQueueManager,
    QueueExecutor,
    createQueueExecutor,
    QueuedTask,
    TaskExecutionResult,
} from '@plusplusoneplusplus/pipeline-core';
import type { ProcessStore, AIProcess } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor, createQueueExecutorBridge } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable, mockSendFollowUp, mockCanResumeSession } = sdkMocks;

const mockExecutePipeline = vi.fn();
const mockGatherFeatureContext = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
        executePipeline: (...args: any[]) => mockExecutePipeline(...args),
        gatherFeatureContext: (...args: any[]) => mockGatherFeatureContext(...args),
    };
});

const mockCreateCLIAIInvoker = vi.fn().mockReturnValue(vi.fn());
vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: (...args: any[]) => mockCreateCLIAIInvoker(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// Tests
// ============================================================================

describe('CLITaskExecutor', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    // ========================================================================
    // AI Clarification Tasks
    // ========================================================================

    describe('ai-clarification tasks', () => {
        it('should execute an ai-clarification task successfully', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Explain this code' },
                config: { timeoutMs: 30000 },
                displayName: 'Explain code',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.result).toEqual({
                response: 'AI response text',
                sessionId: 'session-123',
            });

            // Verify process was created in store
            expect(store.addProcess).toHaveBeenCalledOnce();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.id).toBe('queue_task-1');
            expect(addedProcess.type).toBe('queue-ai-clarification');
            expect(addedProcess.status).toBe('running');
            expect(addedProcess.fullPrompt).toBe('Explain this code');

            // Verify process was marked completed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-1', expect.objectContaining({
                status: 'completed',
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue_task-1',
                'completed',
                expect.stringMatching(/\d+ms/)
            );
        });

        it('should use displayName as prompt fallback for ai-clarification', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: '' },
                config: {},
                displayName: 'My clarification task',
            };

            await executor.execute(task);

            // Prompt should fall back to displayName
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'My clarification task',
            }));
        });

        it('should pass model and timeout from task config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/my/dir' },
                config: { model: 'gpt-4', timeoutMs: 60000 },
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                model: 'gpt-4',
                timeoutMs: 60000,
                workingDirectory: '/my/dir',
            }));
        });
    });

    // ========================================================================
    // Chat Tasks
    // ========================================================================

    describe('chat tasks', () => {
        it('should execute a chat task successfully', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, prompt: 'What does this repo do?' },
                config: { timeoutMs: 30000 },
                displayName: 'Chat message',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
            expect(result.result).toEqual({
                response: 'AI response text',
                sessionId: 'session-123',
            });

            // Verify process was created in store
            expect(store.addProcess).toHaveBeenCalled();
            const addedProcess = (store.addProcess as any).mock.calls.at(-1)[0];
            expect(addedProcess.id).toBe('queue_chat-1');
            expect(addedProcess.type).toBe('queue-chat');
            expect(addedProcess.status).toBe('running');
            expect(addedProcess.fullPrompt).toBe('What does this repo do?');

            // Verify process was marked completed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_chat-1', expect.objectContaining({
                status: 'completed',
            }));
        });

        it('should use displayName as prompt fallback for chat', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, prompt: '' },
                config: {},
                displayName: 'My chat message',
            };

            await executor.execute(task);

            // Prompt should fall back to displayName
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'My chat message',
            }));
        });

        it('should fall back to default prompt when both prompt and displayName are empty', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { kind: 'chat' as const, prompt: '' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Chat message',
            }));
        });
    });

    // ========================================================================
    // Custom Tasks
    // ========================================================================

    describe('custom tasks', () => {
        it('should execute a custom task with data.prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-4',
                type: 'custom',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { data: { prompt: 'Analyze performance' } },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Analyze performance',
            }));
        });

        it('should use displayName for custom task without data.prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-5',
                type: 'custom',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { data: {} },
                config: {},
                displayName: 'Custom task name',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Custom task name',
            }));
        });
    });

    // ========================================================================
    // Chat Tasks (promoted prompt from top-level)
    // ========================================================================

    describe('chat tasks with promoted prompt', () => {
        it('should use promoted prompt from payload for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'What does this repo do?' },
                config: {},
                displayName: 'Chat',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'What does this repo do?',
            }));

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.fullPrompt).toBe('What does this repo do?');
        });

        it('should use promoted prompt with workingDirectory for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Explain the architecture', workingDirectory: '/my/repo' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Explain the architecture',
                workingDirectory: '/my/repo',
            }));
        });

        it('should store correct user turn content for chat tasks', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'How do I build this project?' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns).toHaveLength(1);
            expect(addedProcess.conversationTurns[0].role).toBe('user');
            expect(addedProcess.conversationTurns[0].content).toBe('How do I build this project?');
        });

        it('should fall back to displayName when chat payload has no prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-4',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {},
                config: {},
                displayName: 'Chat',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.fullPrompt).toBe('Chat');
        });

        it('should persist images in the initial user conversation turn', async () => {
            const executor = new CLITaskExecutor(store);
            const images = ['data:image/png;base64,aaaa', 'data:image/jpeg;base64,bbbb'];

            const task: QueuedTask = {
                id: 'chat-img-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'What is in this image?', images },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns).toHaveLength(1);
            expect(addedProcess.conversationTurns[0].role).toBe('user');
            expect(addedProcess.conversationTurns[0].images).toEqual(images);
        });

        it('should not set images on user turn when payload has no images', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-img-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Hello' },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toBeUndefined();
        });

        it('should filter out non-string values from payload images', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'chat-img-3',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Check these', images: ['data:image/png;base64,ok', 42, null, 'data:image/jpeg;base64,fine'] },
                config: {},
                displayName: 'Chat',
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.conversationTurns[0].images).toEqual([
                'data:image/png;base64,ok',
                'data:image/jpeg;base64,fine',
            ]);
        });
    });

    // ========================================================================
    // Follow-Prompt Tasks
    // ========================================================================

    describe('follow-prompt tasks', () => {
        it('should execute a follow-prompt task with file path', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptFilePath: '/nonexistent/prompt.md',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // Should fall back to a descriptive prompt since file doesn't exist
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('prompt.md'),
                workingDirectory: '/my/workspace',
            }));
        });

        it('should execute a follow-prompt task with promptContent directly', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6b',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Analyze codebase for vulnerabilities.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Analyze codebase for vulnerabilities.',
                workingDirectory: '/my/workspace',
            }));
        });

        it('should prefer promptContent over promptFilePath', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6c',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Direct prompt text.',
                    promptFilePath: '/some/file.md',
                    planFilePath: '/some/plan.md',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.stringContaining('Direct prompt text.'),
            }));
            // Should NOT use file indirection
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: expect.not.stringContaining('Follow the instruction'),
            }));
        });

        it('should prepend planFilePath and additionalContext as structured context block', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-6d',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    promptContent: 'Refactor the auth module.',
                    planFilePath: '/workspace/plan.md',
                    additionalContext: 'Focus on tests.',
                    workingDirectory: '/my/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            // /workspace/plan.md doesn't exist so only additionalContext is included
            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Context document:\n\nFocus on tests.\n\n---\n\nRefactor the auth module.',
            }));
        });

        // ====================================================================
        // Follow-prompt context support
        // ====================================================================

        describe('follow-prompt context support', () => {
            it('should prepend additionalContext as structured context block', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-1',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Implement the feature described above.',
                        additionalContext: '# Task: Add login page\n\nCreate a login page with email and password fields.',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Context document:\n\n# Task: Add login page\n\nCreate a login page with email and password fields.\n\n---\n\nImplement the feature described above.',
                }));
            });

            it('should use path reference style with planFilePath content when no additionalContext', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-2',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Execute this plan.',
                        planFilePath: '/workspace/plan.md',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // New style: promptContent + planFilePath reference (no context block)
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Execute this plan. /workspace/plan.md',
                }));
            });

            it('should combine planFilePath content and additionalContext in context block', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                const readFileSyncMock = vi.mocked(fs.readFileSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/plan.md') return true;
                    return false;
                });
                readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                    if (String(p) === '/workspace/plan.md') return '# Plan\n\nDo things.';
                    throw new Error('not found');
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-3',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Execute plan with focus.',
                        planFilePath: '/workspace/plan.md',
                        additionalContext: 'Focus on error handling.',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Context document:\n\n# Plan\n\nDo things.\n\nFocus on error handling.\n\n---\n\nExecute plan with focus.',
                }));

                existsSyncMock.mockReset();
                readFileSyncMock.mockReset();
            });

            it('should not alter prompt when no context fields are provided', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-4',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Analyze codebase for vulnerabilities.',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Analyze codebase for vulnerabilities.',
                }));
            });

            it('should append planFilePath even when file does not exist', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-5',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Do something.',
                        planFilePath: '/nonexistent/plan.md',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // New style: planFilePath is appended as path reference regardless of existence
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Do something. /nonexistent/plan.md',
                }));
            });

            it('should prepend context when using promptFilePath fallback', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-ctx-6',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/nonexistent/prompt.md',
                        additionalContext: 'Task context here.',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Context document:\n\nTask context here.\n\n---\n\nFollow prompt: /nonexistent/prompt.md',
                }));
            });

            it('should use VS Code extension style prompt with planFilePath and no additionalContext', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/.github/skills/impl/SKILL.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-1',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/skills/impl/SKILL.md',
                        planFilePath: '/workspace/.vscode/tasks/my-task.plan.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Follow the instruction /workspace/.github/skills/impl/SKILL.md. /workspace/.vscode/tasks/my-task.plan.md',
                    workingDirectory: '/workspace',
                }));

                existsSyncMock.mockReset();
            });

            it('should use skill promptContent + planFilePath when no additionalContext', async () => {
                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-2',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Use the impl skill.',
                        planFilePath: '/workspace/.vscode/tasks/my-task.plan.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Use the impl skill. /workspace/.vscode/tasks/my-task.plan.md',
                    workingDirectory: '/workspace',
                }));
            });

            it('should include planFilePath in prompt when promptFilePath exists and no additionalContext (SPA flow)', async () => {
                // This test verifies the end-to-end flow when the SPA correctly constructs
                // promptFilePath as rootPath + relativePath (e.g., /workspace/.github/prompts/impl.prompt.md)
                const existsSyncMock = vi.mocked(fs.existsSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/.github/prompts/impl.prompt.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-spa-prompt',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/prompts/impl.prompt.md',
                        planFilePath: '/workspace/.vscode/tasks/coc/e2e-repo-tests/013-document-groups.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Should use the new-style format: "Follow the instruction {promptFilePath}. {planFilePath}"
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: 'Follow the instruction /workspace/.github/prompts/impl.prompt.md. /workspace/.vscode/tasks/coc/e2e-repo-tests/013-document-groups.md',
                    workingDirectory: '/workspace',
                }));

                existsSyncMock.mockReset();
            });

            it('should NOT include planFilePath when promptFilePath has wrong path (regression)', async () => {
                // This test documents the old bug: when promptFilePath was wrongly constructed
                // as /workspace/.vscode/pipelines/.github/prompts/impl.prompt.md, fs.existsSync
                // would return false, causing the prompt to fall through to legacy path without planFilePath
                const existsSyncMock = vi.mocked(fs.existsSync);

                existsSyncMock.mockImplementation((_p: fs.PathLike) => {
                    // The wrong path doesn't exist
                    return false;
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-wrong-path',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.vscode/pipelines/.github/prompts/impl.prompt.md',
                        planFilePath: '/workspace/.vscode/tasks/my-task.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // With wrong path, falls through to legacy: "Follow prompt: {path}" without planFilePath
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Follow prompt:'),
                }));
                // The planFilePath is NOT included because the prompt file doesn't exist
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.not.stringContaining('my-task.md'),
                }));

                existsSyncMock.mockReset();
            });

            it('should fall back to legacy context block when additionalContext is present with planFilePath', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                const readFileSyncMock = vi.mocked(fs.readFileSync);

                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    if (String(p) === '/workspace/.github/skills/impl/SKILL.md') return true;
                    if (String(p) === '/workspace/plan.md') return true;
                    return false;
                });
                readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                    if (String(p) === '/workspace/plan.md') return '# Old plan content';
                    throw new Error('not found');
                });

                const executor = new CLITaskExecutor(store);

                const task: QueuedTask = {
                    id: 'task-new-style-3',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/skills/impl/SKILL.md',
                        planFilePath: '/workspace/plan.md',
                        additionalContext: 'Legacy context from old client.',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);

                expect(result.success).toBe(true);
                // Should use legacy path with context block since additionalContext is present
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Context document:'),
                }));
                expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                    prompt: expect.stringContaining('Legacy context from old client.'),
                }));

                existsSyncMock.mockReset();
                readFileSyncMock.mockReset();
            });
        });

        // ====================================================================
        // CONTEXT.md auto-attachment
        // ====================================================================

        describe('CONTEXT.md auto-attachment', () => {
            it('should append CONTEXT.md reference for new-style prompt (promptFilePath + planFilePath)', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/prompts/impl.prompt.md') return true;
                    if (s === '/workspace/.vscode/tasks/feature/CONTEXT.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-1',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/prompts/impl.prompt.md',
                        planFilePath: '/workspace/.vscode/tasks/feature/plan.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('See context details in /workspace/.vscode/tasks/feature/CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should append CONTEXT.md reference for skill-type prompt (promptContent + planFilePath)', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.vscode/tasks/coc/CONTEXT.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-2',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptContent: 'Use the impl skill.',
                        planFilePath: '/workspace/.vscode/tasks/coc/task.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('Use the impl skill.');
                expect(prompt).toContain('See context details in /workspace/.vscode/tasks/coc/CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should not append CONTEXT.md reference when file does not exist', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/prompts/review.prompt.md') return true;
                    return false;
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-3',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/prompts/review.prompt.md',
                        planFilePath: '/workspace/.vscode/tasks/feature/plan.md',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).not.toContain('CONTEXT.md');
                existsSyncMock.mockReset();
            });

            it('should not duplicate CONTEXT.md if additionalContext is already present', async () => {
                const existsSyncMock = vi.mocked(fs.existsSync);
                const readFileSyncMock = vi.mocked(fs.readFileSync);
                existsSyncMock.mockImplementation((p: fs.PathLike) => {
                    const s = String(p).replace(/\\/g, '/');
                    if (s === '/workspace/.github/skills/impl/SKILL.md') return true;
                    if (s === '/workspace/plan.md') return true;
                    if (s === '/workspace/CONTEXT.md') return true;
                    return false;
                });
                readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                    if (String(p).replace(/\\/g, '/') === '/workspace/plan.md') return '# Plan content';
                    throw new Error('not found');
                });

                const executor = new CLITaskExecutor(store);
                const task: QueuedTask = {
                    id: 'task-ctx-md-4',
                    type: 'follow-prompt',
                    priority: 'normal',
                    status: 'running',
                    createdAt: Date.now(),
                    payload: {
                        promptFilePath: '/workspace/.github/skills/impl/SKILL.md',
                        planFilePath: '/workspace/plan.md',
                        additionalContext: 'Already provided context.',
                        workingDirectory: '/workspace',
                    },
                    config: {},
                };

                const result = await executor.execute(task);
                expect(result.success).toBe(true);
                const prompt = mockSendMessage.mock.calls[0][0].prompt;
                expect(prompt).toContain('Already provided context.');
                expect(prompt).toContain('See context details in /workspace/CONTEXT.md');
                existsSyncMock.mockReset();
                readFileSyncMock.mockReset();
            });
        });
    });

    // ========================================================================
    // Task Generation — enriched prompt written to store
    // ========================================================================

    describe('task-generation prompt store update', () => {
        beforeEach(() => {
            mockGatherFeatureContext.mockResolvedValue({
                description: 'Feature description',
                planContent: 'Plan content',
                specContent: 'Spec content',
                relatedFiles: [],
            });
        });

        afterEach(() => {
            mockGatherFeatureContext.mockReset();
        });

        it('should update process store with enriched prompt for deep mode', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-deep',
                type: 'task-generation',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'task-generation' as const,
                    workingDirectory: '/workspace',
                    prompt: 'Add retry logic',
                    mode: 'from-feature',
                    depth: 'deep',
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-deep';
            const process = await store.getProcess(processId);
            // The enriched prompt should contain go-deep prefix
            expect(process?.fullPrompt).toContain('Use go-deep skill when available');
            // The enriched prompt should contain the user ask
            expect(process?.fullPrompt).toContain('Add retry logic');
            // The initial conversation turn should also be updated
            expect(process?.conversationTurns?.[0]?.content).toContain('Use go-deep skill when available');
            // The prompt preview should be updated (not the raw prompt)
            expect(process?.promptPreview).not.toBe('Add retry logic');
        });

        it('should update process store with enriched prompt for normal mode', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-normal',
                type: 'task-generation',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'task-generation' as const,
                    workingDirectory: '/workspace',
                    prompt: 'Add retry logic',
                    mode: 'from-feature',
                    depth: 'normal',
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-normal';
            const process = await store.getProcess(processId);
            // Normal mode should NOT contain go-deep prefix
            expect(process?.fullPrompt).not.toContain('Use go-deep skill when available');
            // But should contain the enriched content (feature context)
            expect(process?.fullPrompt).toContain('Add retry logic');
            expect(process?.fullPrompt).toContain('Output Location Requirement');
            // The initial conversation turn should also be updated
            expect(process?.conversationTurns?.[0]?.content).toContain('Output Location Requirement');
        });

        it('should update process store for simple task generation (no from-feature)', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-gen-simple',
                type: 'task-generation',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'task-generation' as const,
                    workingDirectory: '/workspace',
                    prompt: 'Create a new test file',
                },
                config: { timeoutMs: 30000 },
                displayName: 'Generate task',
            };

            await executor.execute(task);

            const processId = 'queue_task-gen-simple';
            const process = await store.getProcess(processId);
            // Enriched prompt should differ from the raw user text
            expect(process?.fullPrompt).toContain('Create a new test file');
            // Should have output location directive (uses OS path separator)
            expect(process?.fullPrompt).toMatch(/[.\\/]vscode[.\\/]tasks/);
            // Conversation turn updated
            expect(process?.conversationTurns?.[0]?.content).toBe(process?.fullPrompt);
        });
    });

    // ========================================================================
    // Code Review / Resolve Comments (no-op)
    // ========================================================================

    describe('no-op task types', () => {
        it('should complete code-review tasks as no-op', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-7',
                type: 'code-review',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { diffType: 'staged', rulesFolder: '.github/cr-rules' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).not.toHaveBeenCalled();
            expect(result.result).toEqual(expect.objectContaining({
                status: 'completed',
                message: expect.stringContaining('no-op'),
            }));
        });

        it('should execute resolve-comments tasks via AI (no longer no-op)', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-8',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'file:///test.md',
                    commentIds: ['c1'],
                    promptTemplate: 'resolve prompt',
                    documentContent: 'doc content',
                    filePath: 'test.md',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).toHaveBeenCalled();
            expect(result.result).toEqual({
                revisedContent: 'AI response text',
                commentIds: ['c1'],
            });
        });
    });

    // ========================================================================
    // Error Handling
    // ========================================================================

    describe('error handling', () => {
        it('should handle SDK unavailability', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'Not installed' });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('not available');

            // Verify process was marked as failed
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-err-1', expect.objectContaining({
                status: 'failed',
                error: expect.stringContaining('not available'),
            }));
            expect(store.emitProcessComplete).toHaveBeenCalledWith(
                'queue_task-err-1',
                'failed',
                expect.stringMatching(/\d+ms/)
            );
        });

        it('should handle SDK execution failure', async () => {
            mockSendMessage.mockResolvedValue({
                success: false,
                error: 'Rate limited',
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('Rate limited');
        });

        it('should handle SDK throwing an exception', async () => {
            mockSendMessage.mockRejectedValue(new Error('Network error'));

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-err-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Network error');
        });
    });

    // ========================================================================
    // Cancellation
    // ========================================================================

    describe('cancellation', () => {
        it('should return failure for cancelled tasks', async () => {
            const executor = new CLITaskExecutor(store);
            executor.cancel('task-cancel-1');

            const task: QueuedTask = {
                id: 'task-cancel-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('cancelled');
            expect(mockSendMessage).not.toHaveBeenCalled();
        });
    });

    // ========================================================================
    // Process Tracking
    // ========================================================================

    describe('process tracking', () => {
        it('should create process with correct metadata', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-1',
                type: 'ai-clarification',
                priority: 'high',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'Analyze this' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata).toEqual({
                type: 'queue-ai-clarification',
                queueTaskId: 'task-meta-1',
                priority: 'high',
                model: undefined,
            });
        });

        it('should store model in process metadata when provided in config', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-model',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: { model: 'claude-sonnet-4-5' },
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.metadata?.model).toBe('claude-sonnet-4-5');
        });

        it('should store workingDirectory on process from ai-clarification payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/my/project' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/my/project');
        });

        it('should store workingDirectory on process from follow-prompt payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-cwd-fp',
                type: 'follow-prompt',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { promptFilePath: '/path/to/prompt.md', workingDirectory: '/workspace/root' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/workspace/root');
        });

        it('should store default workingDirectory on process when no payload cwd', async () => {
            const executor = new CLITaskExecutor(store, { workingDirectory: '/default/cwd' });

            const task: QueuedTask = {
                id: 'task-meta-cwd-default',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/default/cwd');
        });

        it('should store both model and workingDirectory on process', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-both',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test', workingDirectory: '/project' },
                config: { model: 'gpt-4' },
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.workingDirectory).toBe('/project');
            expect(addedProcess.metadata?.model).toBe('gpt-4');
        });

        it('should truncate long prompts in promptPreview', async () => {
            const executor = new CLITaskExecutor(store);

            const longPrompt = 'A'.repeat(200);
            const task: QueuedTask = {
                id: 'task-meta-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: longPrompt },
                config: {},
            };

            await executor.execute(task);

            const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
            expect(addedProcess.promptPreview.length).toBeLessThanOrEqual(80);
            expect(addedProcess.promptPreview).toContain('...');
            expect(addedProcess.fullPrompt).toBe(longPrompt);
        });

        it('should link processId to task', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-meta-3',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(task.processId).toBe('queue_task-meta-3');
        });
    });

    // ========================================================================
    // Permission Handling
    // ========================================================================

    describe('permission handling', () => {
        it('should approve permissions by default', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-perm-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                onPermissionRequest: expect.any(Function),
            }));
        });

        it('should not set permission handler when approvePermissions is false', async () => {
            const executor = new CLITaskExecutor(store, { approvePermissions: false });

            const task: QueuedTask = {
                id: 'task-perm-2',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                onPermissionRequest: undefined,
            }));
        });
    });

    // ========================================================================
    // Resolve Comments Tasks
    // ========================================================================

    describe('resolve-comments tasks', () => {
        it('should execute a resolve-comments task and return revisedContent + commentIds', async () => {
            mockSendMessage.mockResolvedValue({
                success: true,
                response: '# Revised Document\n\nFixed content.',
                sessionId: 'session-resolve-1',
            });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-1',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'feature/task.md',
                    commentIds: ['comment-a', 'comment-b'],
                    promptTemplate: '# Document Revision Request\n\nRevise this document.',
                    workingDirectory: '/workspace',
                    documentContent: '# Original Document\n\nOld content.',
                    filePath: 'feature/task.md',
                },
                config: { timeoutMs: 60000 },
                displayName: 'Resolve comments: feature/task.md',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(result.result).toEqual({
                revisedContent: '# Revised Document\n\nFixed content.',
                commentIds: ['comment-a', 'comment-b'],
            });
        });

        it('should pass promptTemplate as the AI prompt', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-2',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'task.md',
                    commentIds: ['c1'],
                    promptTemplate: 'Custom resolve prompt for testing',
                    documentContent: 'doc content',
                    filePath: 'task.md',
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                prompt: 'Custom resolve prompt for testing',
            }));
        });

        it('should use workingDirectory from payload', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-3',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'task.md',
                    commentIds: ['c1'],
                    promptTemplate: 'test prompt',
                    workingDirectory: '/my/workspace',
                    documentContent: 'doc',
                    filePath: 'task.md',
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
                workingDirectory: '/my/workspace',
            }));
        });

        it('should fail gracefully when AI service is unavailable', async () => {
            mockIsAvailable.mockResolvedValue({ available: false, error: 'not running' });

            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'resolve-4',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'task.md',
                    commentIds: ['c1'],
                    promptTemplate: 'test prompt',
                    documentContent: 'doc',
                    filePath: 'task.md',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message || String(result.error)).toContain('not running');
        });

        it('should update process store with the prompt preview', async () => {
            const executor = new CLITaskExecutor(store);

            const longPrompt = 'A'.repeat(100);
            const task: QueuedTask = {
                id: 'resolve-5',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    documentUri: 'task.md',
                    commentIds: ['c1'],
                    promptTemplate: longPrompt,
                    documentContent: 'doc',
                    filePath: 'task.md',
                },
                config: {},
            };

            await executor.execute(task);

            // Verify process store was updated with truncated preview
            expect(store.updateProcess).toHaveBeenCalledWith(
                'queue_resolve-5',
                expect.objectContaining({
                    fullPrompt: longPrompt,
                    promptPreview: longPrompt.substring(0, 77) + '...',
                })
            );
        });
    });
});

// ============================================================================
// executeFollowUp Tests
// ============================================================================

describe('CLITaskExecutor.executeFollowUp', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'Follow-up response',
            sessionId: 'sess-follow',
        });
    });

    it('should throw for missing process', async () => {
        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('nonexistent', 'msg')).rejects.toThrow('Process not found: nonexistent');
    });

    it('should throw for process without sdkSessionId', async () => {
        const process: AIProcess = {
            id: 'proc-1',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('proc-1', 'msg')).rejects.toThrow('Process proc-1 has no SDK session');
    });

    it('should append assistant turn and set status to completed on success', async () => {
        const process: AIProcess = {
            id: 'proc-2',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-123',
            workingDirectory: '/workspace/shortcuts',
            conversationTurns: [
                { role: 'user', content: 'initial question', timestamp: new Date(), turnIndex: 0 , timeline: [] },
            ],
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-2', 'follow up');

        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-123', 'follow up', expect.objectContaining({
            workingDirectory: '/workspace/shortcuts',
            onPermissionRequest: expect.any(Function),
            onStreamingChunk: expect.any(Function),
        }));

        // Verify the process was updated with assistant turn
        const updated = await store.getProcess('proc-2');
        expect(updated?.status).toBe('completed');
        expect(updated?.conversationTurns).toHaveLength(2);
        expect(updated?.conversationTurns![1].role).toBe('assistant');
        expect(updated?.conversationTurns![1].content).toBe('Follow-up response');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-2', 'completed', expect.stringMatching(/\d+ms/));
    });

    it('should append error turn and set status to failed on failure', async () => {
        mockSendFollowUp.mockResolvedValue({
            success: false,
            error: 'Session expired',
        });

        const process: AIProcess = {
            id: 'proc-3',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-456',
            conversationTurns: [],
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-3', 'follow up');

        const updated = await store.getProcess('proc-3');
        expect(updated?.status).toBe('failed');
        expect(updated?.conversationTurns).toHaveLength(1);
        expect(updated?.conversationTurns![0].role).toBe('assistant');
        expect(updated?.conversationTurns![0].content).toContain('Error:');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-3', 'failed', expect.stringMatching(/\d+ms/));
    });

    it('should stream chunks via store.emitProcessOutput', async () => {
        mockSendFollowUp.mockImplementation(async (_sessionId: string, _prompt: string, options?: any) => {
            // Simulate streaming chunks
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk1');
                options.onStreamingChunk('chunk2');
            }
            return { success: true, response: 'chunk1chunk2', sessionId: 'sess-stream' };
        });

        const process: AIProcess = {
            id: 'proc-4',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'running',
            startTime: new Date(),
            sdkSessionId: 'sess-789',
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-4', 'stream test');

        // Verify streaming chunks were emitted
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-4', 'chunk1');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-4', 'chunk2');
    });
});

// ============================================================================
// Follow-Up Chat Conversation Scenario Tests
// ============================================================================

describe('executeFollowUp - chat conversation scenarios', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should accumulate turns across 3 sequential follow-ups', async () => {
        const process = createCompletedProcessWithSession('proc-multi', 'sess-multi', [
            { role: 'user', content: 'Question 1', timestamp: new Date(), turnIndex: 0 , timeline: [] },
            { role: 'assistant', content: 'Reply 1', timestamp: new Date(), turnIndex: 1 , timeline: [] },
        ]);
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 2' });
        const executor = new CLITaskExecutor(store);

        // Follow-up 1
        await executor.executeFollowUp('proc-multi', 'Question 2');

        // Simulate api-handler adding user turn before 2nd follow-up
        const after1 = await store.getProcess('proc-multi');
        await store.updateProcess('proc-multi', {
            conversationTurns: [
                ...after1!.conversationTurns!,
                { role: 'user', content: 'Question 3', timestamp: new Date(), turnIndex: after1!.conversationTurns!.length , timeline: [] },
            ],
        });

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 3' });
        // Follow-up 2
        await executor.executeFollowUp('proc-multi', 'Question 3');

        // Simulate api-handler adding user turn before 3rd follow-up
        const after2 = await store.getProcess('proc-multi');
        await store.updateProcess('proc-multi', {
            conversationTurns: [
                ...after2!.conversationTurns!,
                { role: 'user', content: 'Question 4', timestamp: new Date(), turnIndex: after2!.conversationTurns!.length , timeline: [] },
            ],
        });

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'Reply 4' });
        // Follow-up 3
        await executor.executeFollowUp('proc-multi', 'Question 4');

        const final = await store.getProcess('proc-multi');
        // 2 initial + 3 assistant + 2 manually-added user = 7
        expect(final!.conversationTurns!.length).toBeGreaterThanOrEqual(5);

        // Last 3 assistant turns have role 'assistant'
        const assistantTurns = final!.conversationTurns!.filter(t => t.role === 'assistant');
        expect(assistantTurns.length).toBeGreaterThanOrEqual(4); // original Reply 1 + 3 follow-up replies

        // Each assistant turn's turnIndex equals its position
        for (let i = 0; i < final!.conversationTurns!.length; i++) {
            expect(final!.conversationTurns![i].turnIndex).toBe(i);
        }

        expect(mockSendFollowUp).toHaveBeenCalledTimes(3);
        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-multi', expect.any(String), expect.any(Object));
    });

    it('should use "(No text response)" fallback when SDK returns empty response', async () => {
        const process = createCompletedProcessWithSession('proc-empty', 'sess-empty');
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: '' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-empty', 'What happened?');

        const updated = await store.getProcess('proc-empty');
        expect(updated!.conversationTurns).toHaveLength(3); // 2 initial + 1 assistant
        expect(updated!.conversationTurns![2].content).toBe('(No text response)');
        expect(updated!.status).toBe('completed');
        // Empty string is falsy → result: undefined
        expect(store.updateProcess).toHaveBeenCalledWith('proc-empty', expect.objectContaining({
            result: undefined,
        }));
    });

    it('should append error turn when sendFollowUp throws (session expired)', async () => {
        const process = createCompletedProcessWithSession('proc-dying', 'sess-dying');
        await store.addProcess(process);

        mockSendFollowUp.mockRejectedValue(new Error('Session expired: connection reset'));
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-dying', 'Are you still there?');

        const updated = await store.getProcess('proc-dying');
        expect(updated!.status).toBe('failed');
        expect(updated!.error).toBe('Session expired: connection reset');
        expect(updated!.conversationTurns![2].role).toBe('assistant');
        expect(updated!.conversationTurns![2].content).toContain('Error: Session expired: connection reset');
        expect(store.emitProcessComplete).toHaveBeenCalledWith('proc-dying', 'failed', expect.stringMatching(/\d+ms/));
    });

    it('should concatenate streaming chunks in output buffer', async () => {
        const process = createCompletedProcessWithSession('proc-chunks', 'sess-chunks');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('Hello');
                options.onStreamingChunk(' ');
                options.onStreamingChunk('world');
                options.onStreamingChunk('!');
            }
            return { success: true, response: 'Hello world!' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-chunks', 'stream it');

        expect(store.emitProcessOutput).toHaveBeenCalledTimes(4);
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', 'Hello');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', ' ');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', 'world');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('proc-chunks', '!');

        // Verify output chunks recorded in store
        const outputChunks = store.outputs.get('proc-chunks');
        expect(outputChunks).toEqual(['Hello', ' ', 'world', '!']);
    });

    it('should handle concurrent follow-ups on the same process without data corruption', async () => {
        const process = createCompletedProcessWithSession('proc-concurrent', 'sess-concurrent');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string) => {
            await new Promise(r => setTimeout(r, 10));
            return { success: true, response: 'concurrent reply' };
        });

        const executor = new CLITaskExecutor(store);
        const [resultA, resultB] = await Promise.allSettled([
            executor.executeFollowUp('proc-concurrent', 'msg A'),
            executor.executeFollowUp('proc-concurrent', 'msg B'),
        ]);

        expect(resultA.status).toBe('fulfilled');
        expect(resultB.status).toBe('fulfilled');
        expect(mockSendFollowUp).toHaveBeenCalledTimes(2);

        const final = await store.getProcess('proc-concurrent');
        expect(final!.status).toBe('completed');
        // At least 3: 2 initial + at least 1 assistant turn
        expect(final!.conversationTurns!.length).toBeGreaterThanOrEqual(3);
        expect(store.emitProcessComplete).toHaveBeenCalledTimes(2);
    });

    it('should handle a very long follow-up message without truncation', async () => {
        const process = createCompletedProcessWithSession('proc-large', 'sess-large');
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'ack' });
        const executor = new CLITaskExecutor(store);
        const longMsg = 'x'.repeat(100_000);
        await executor.executeFollowUp('proc-large', longMsg);

        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-large', longMsg, expect.any(Object));
        const updated = await store.getProcess('proc-large');
        expect(updated!.status).toBe('completed');
    });

    it('should transition process status to completed on successful follow-up', async () => {
        const process = createCompletedProcessWithSession('proc-status-ok', 'sess-status-ok');
        process.status = 'running';
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'done' });
        const executor = new CLITaskExecutor(store);

        const before = await store.getProcess('proc-status-ok');
        expect(before!.status).toBe('running');

        await executor.executeFollowUp('proc-status-ok', 'finish up');

        const after = await store.getProcess('proc-status-ok');
        expect(after!.status).toBe('completed');
        expect(after!.endTime).toBeDefined();
        expect(after!.result).toBe('done');
    });

    it('should transition process status to failed on follow-up error', async () => {
        const process = createCompletedProcessWithSession('proc-status-fail', 'sess-status-fail');
        process.status = 'running';
        await store.addProcess(process);

        mockSendFollowUp.mockRejectedValue(new Error('SDK crash'));
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-status-fail', 'bad request');

        const after = await store.getProcess('proc-status-fail');
        expect(after!.status).toBe('failed');
        expect(after!.endTime).toBeDefined();
        expect(after!.error).toBe('SDK crash');
        expect(after!.conversationTurns!.at(-1)!.content).toContain('Error: SDK crash');
    });

    it('should clean up outputBuffers map after follow-up (success and failure)', async () => {
        const proc1 = createCompletedProcessWithSession('proc-cleanup-ok', 'sess-cleanup-ok');
        const proc2 = createCompletedProcessWithSession('proc-cleanup-fail', 'sess-cleanup-fail');
        await store.addProcess(proc1);
        await store.addProcess(proc2);

        // First follow-up succeeds with streaming
        mockSendFollowUp.mockImplementationOnce(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('old-data');
            }
            return { success: true, response: 'ok' };
        });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-cleanup-ok', 'first call');

        // Second follow-up fails
        mockSendFollowUp.mockRejectedValueOnce(new Error('boom'));
        await executor.executeFollowUp('proc-cleanup-fail', 'fail call');

        // Verify buffer cleanup: a subsequent follow-up starts fresh
        mockSendFollowUp.mockImplementationOnce(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('new-chunk');
            }
            return { success: true, response: 'fresh' };
        });
        // Reset output tracking to isolate the 3rd call
        store.outputs.clear();
        await executor.executeFollowUp('proc-cleanup-ok', 'second call');

        // Only 'new-chunk' should be present — no leftover 'old-data'
        const chunks = store.outputs.get('proc-cleanup-ok');
        expect(chunks).toEqual(['new-chunk']);
    });

    it('should handle follow-up when conversationTurns is empty array', async () => {
        const process = createCompletedProcessWithSession('proc-empty-turns', 'sess-empty-turns', []);
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'first reply' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-empty-turns', 'hello');

        const updated = await store.getProcess('proc-empty-turns');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0]).toMatchObject({
            role: 'assistant',
            content: 'first reply',
            turnIndex: 0,
            timeline: [],
        });
    });

    it('should handle follow-up when conversationTurns is undefined', async () => {
        const process: AIProcess = {
            id: 'proc-undef-turns',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-undef-turns',
        };
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({ success: true, response: 'reply' });
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-undef-turns', 'hi');

        const updated = await store.getProcess('proc-undef-turns');
        expect(updated!.conversationTurns).toHaveLength(1);
        expect(updated!.conversationTurns![0].turnIndex).toBe(0);
    });
});

// ============================================================================
// Session Tracking and Conversation Turns Tests
// ============================================================================

describe('session tracking and conversation turns', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sdk-session-abc',
        });
    });

    it('should store sdkSessionId on the process after successful execution', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test prompt' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        const processId = `queue_${task.id}`;
        const process = store.processes.get(processId);
        expect(process?.sdkSessionId).toBe('sdk-session-abc');
    });

    it('should populate initial conversationTurns with user + assistant pair', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'What is X?' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        const processId = `queue_${task.id}`;
        const process = store.processes.get(processId);
        expect(process?.conversationTurns).toHaveLength(2);

        const [userTurn, assistantTurn] = process!.conversationTurns!;
        expect(userTurn.role).toBe('user');
        expect(userTurn.content).toBe('What is X?');
        expect(userTurn.turnIndex).toBe(0);

        expect(assistantTurn.role).toBe('assistant');
        expect(assistantTurn.content).toBe('AI response');
        expect(assistantTurn.turnIndex).toBe(1);
    });

    it('should pass keepAlive: true to sendMessage', async () => {
        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-session-3',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: { timeoutMs: 30000 },
        };
        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ keepAlive: true })
        );
    });

    it('should append turns at correct indices on follow-up', async () => {
        // Setup: process with 2 existing turns
        const processId = 'proc-followup-turns';
        const process: AIProcess = {
            id: processId,
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-existing',
            conversationTurns: [
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 , timeline: [] },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 , timeline: [] },
            ],
        };
        await store.addProcess(process);

        mockSendFollowUp.mockResolvedValue({
            success: true,
            response: 'follow-up reply',
            sessionId: 'sess-existing',
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp(processId, 'What about Y?');

        const updated = store.processes.get(processId);
        // Existing 2 turns + 1 assistant turn appended (user turn is added by api-handler)
        expect(updated?.conversationTurns).toHaveLength(3);
        expect(updated?.conversationTurns![2].role).toBe('assistant');
        expect(updated?.conversationTurns![2].content).toBe('follow-up reply');
        expect(updated?.conversationTurns![2].turnIndex).toBe(2);
    });

    it('should throw if process has no sdkSessionId', async () => {
        const process: AIProcess = {
            id: 'proc-no-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await expect(executor.executeFollowUp('proc-no-session', 'hi'))
            .rejects.toThrow('no SDK session');
    });

    it('should report session expired when SDK cannot resume the persisted session', async () => {
        const process: AIProcess = {
            id: 'proc-expired-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-missing-after-restart',
            workingDirectory: '/workspace/repo',
        };
        await store.addProcess(process);

        mockCanResumeSession.mockResolvedValueOnce(false);

        const executor = new CLITaskExecutor(store);
        await expect(executor.isSessionAlive('proc-expired-session')).resolves.toBe(false);
        expect(mockCanResumeSession).toHaveBeenCalledWith('sess-missing-after-restart', expect.objectContaining({
            workingDirectory: '/workspace/repo',
            onPermissionRequest: expect.any(Function),
        }));
    });

    it('should treat persisted session as alive when SDK can resume it', async () => {
        const process: AIProcess = {
            id: 'proc-resumable-session',
            type: 'clarification',
            promptPreview: 'test',
            fullPrompt: 'test',
            status: 'completed',
            startTime: new Date(),
            sdkSessionId: 'sess-resumable',
            workingDirectory: '/workspace/repo',
        };
        await store.addProcess(process);

        mockCanResumeSession.mockResolvedValueOnce(true);

        const executor = new CLITaskExecutor(store);
        await expect(executor.isSessionAlive('proc-resumable-session')).resolves.toBe(true);
    });
});

// ============================================================================
// Conversation History Persistence (Page Refresh Resilience)
// ============================================================================

describe('conversation history persistence during streaming', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should store initial user turn when task starts executing (before AI call)', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-1',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-persist-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Explain this code' },
            config: {},
        };

        await executor.execute(task);

        // Verify addProcess was called with conversationTurns containing the user turn
        const addedProcess = (store.addProcess as any).mock.calls[0][0] as AIProcess;
        expect(addedProcess.conversationTurns).toBeDefined();
        expect(addedProcess.conversationTurns).toHaveLength(1);
        expect(addedProcess.conversationTurns![0].role).toBe('user');
        expect(addedProcess.conversationTurns![0].content).toBe('Explain this code');
        expect(addedProcess.conversationTurns![0].turnIndex).toBe(0);
    });

    it('should have user turn available in store during streaming (before completion)', async () => {
        let storedDuringStreaming: AIProcess | undefined;

        mockSendMessage.mockImplementation(async (opts: any) => {
            // During streaming, check what's in the store
            storedDuringStreaming = await store.getProcess('queue_task-during-stream');
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('streaming...');
            }
            return { success: true, response: 'done', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-during-stream',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'What is X?' },
            config: {},
        };

        await executor.execute(task);

        // The user turn should have been in the store during streaming
        expect(storedDuringStreaming).toBeDefined();
        expect(storedDuringStreaming!.conversationTurns).toBeDefined();
        expect(storedDuringStreaming!.conversationTurns).toHaveLength(1);
        expect(storedDuringStreaming!.conversationTurns![0].role).toBe('user');
        expect(storedDuringStreaming!.conversationTurns![0].content).toBe('What is X?');
    });

    it('should have both user and assistant turns after completion', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'The answer is Y',
            sessionId: 'sess-3',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-complete-turns',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'What is X?' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-complete-turns');
        expect(process).toBeDefined();
        expect(process!.conversationTurns).toHaveLength(2);
        expect(process!.conversationTurns![0].role).toBe('user');
        expect(process!.conversationTurns![0].content).toBe('What is X?');
        expect(process!.conversationTurns![1].role).toBe('assistant');
        expect(process!.conversationTurns![1].content).toBe('The answer is Y');
    });

    it('should preserve conversation turns on task failure', async () => {
        mockSendMessage.mockRejectedValue(new Error('AI crashed'));

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-fail-turns',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Analyze this' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-fail-turns');
        expect(process).toBeDefined();
        expect(process!.status).toBe('failed');
        // Should still have the user turn
        expect(process!.conversationTurns).toBeDefined();
        expect(process!.conversationTurns!.length).toBeGreaterThanOrEqual(1);
        expect(process!.conversationTurns![0].role).toBe('user');
        expect(process!.conversationTurns![0].content).toBe('Analyze this');
    });

    it('should create assistant turn with streaming=true on first chunk', async () => {
        const process = createCompletedProcessWithSession('proc-first-chunk', 'sess-first-chunk');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('first chunk');
            }
            return { success: true, response: 'first chunk' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-first-chunk', 'test');

        // Verify updateProcess was called with a streaming assistant turn
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);
        const firstFlush = streamingFlushCalls[0][1];
        const assistantTurn = firstFlush.conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming === true
        );
        expect(assistantTurn.content).toBe('first chunk');
    });

    it('should flush every 50 chunks', async () => {
        const process = createCompletedProcessWithSession('proc-50chunks', 'sess-50chunks');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 150; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'all chunks' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-50chunks', 'test');

        // Count streaming flushes (updateProcess calls with streaming: true turns)
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // 3 streaming flushes: first chunk (time-based), chunk 51 (count), chunk 101 (count)
        expect(streamingFlushCalls.length).toBe(3);

        // Final completion call should have streaming=undefined
        const completionCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.status === 'completed';
        });
        expect(completionCalls.length).toBeGreaterThanOrEqual(1);
        const finalTurns = completionCalls[completionCalls.length - 1][1].conversationTurns;
        const finalAssistant = finalTurns?.find((t: any) => t.role === 'assistant');
        expect(finalAssistant?.streaming).toBeUndefined();
    });

    it('should flush every 5 seconds', async () => {
        vi.useFakeTimers();

        const process = createCompletedProcessWithSession('proc-5sec', 'sess-5sec');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 10; i++) {
                    options.onStreamingChunk(`c${i} `);
                    await vi.advanceTimersByTimeAsync(1000);
                }
            }
            return { success: true, response: 'all 10' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-5sec', 'test');

        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // First chunk triggers time-based flush (lastFlushTime=0),
        // then ~5 seconds later another time-based flush
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(2);

        // Verify content grows between flushes
        const firstContent = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        const lastContent = streamingFlushCalls[streamingFlushCalls.length - 1][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        expect(lastContent.length).toBeGreaterThan(firstContent.length);

        vi.useRealTimers();
    });

    it('should update existing streaming turn on subsequent flushes', async () => {
        const process = createCompletedProcessWithSession('proc-update-turn', 'sess-update-turn');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 100; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'done' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-update-turn', 'test');

        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // At least 2 streaming flushes (first chunk + count-based at 51)
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(2);

        // Verify later flushes have more content than earlier ones
        const firstContent = streamingFlushCalls[0][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        const lastContent = streamingFlushCalls[streamingFlushCalls.length - 1][1].conversationTurns.find(
            (t: any) => t.role === 'assistant' && t.streaming
        ).content;
        expect(lastContent.length).toBeGreaterThan(firstContent.length);
    });

    it('should set streaming=false on completion', async () => {
        const process = createCompletedProcessWithSession('proc-complete-flag', 'sess-complete-flag');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 30; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'final response' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-complete-flag', 'test');

        const updated = await store.getProcess('proc-complete-flag');
        const lastTurn = updated!.conversationTurns![updated!.conversationTurns!.length - 1];
        expect(lastTurn.role).toBe('assistant');
        expect(lastTurn.streaming).toBeUndefined();
        expect(lastTurn.content).toBe('final response');
    });

    it('should handle store.updateProcess errors gracefully during flush', async () => {
        const process = createCompletedProcessWithSession('proc-flush-error', 'sess-flush-error');
        await store.addProcess(process);

        (store.updateProcess as any).mockImplementation(async (id: string, updates: any) => {
            // Fail streaming flushes, succeed for completion updates
            if (updates.conversationTurns?.some((t: any) => t.streaming === true)) {
                throw new Error('Store write failed');
            }
            const existing = store.processes.get(id);
            if (existing) {
                store.processes.set(id, { ...existing, ...updates });
            }
        });

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                for (let i = 0; i < 150; i++) {
                    options.onStreamingChunk(`c${i} `);
                }
            }
            return { success: true, response: 'completed despite errors' };
        });

        const executor = new CLITaskExecutor(store);
        // Should not throw despite flush errors
        await executor.executeFollowUp('proc-flush-error', 'test');

        const updated = await store.getProcess('proc-flush-error');
        expect(updated).toBeDefined();
        expect(updated!.status).toBe('completed');
    });

    it('should clean up throttle state after completion', async () => {
        const process = createCompletedProcessWithSession('proc-cleanup', 'sess-cleanup');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk');
            }
            return { success: true, response: 'done' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-cleanup', 'first');

        // Execute a second follow-up — should work cleanly with no stale throttle state
        await executor.executeFollowUp('proc-cleanup', 'second');

        const updated = await store.getProcess('proc-cleanup');
        expect(updated!.status).toBe('completed');
    });

    it('should clean up throttle state after error', async () => {
        const process = createCompletedProcessWithSession('proc-cleanup-err', 'sess-cleanup-err');
        await store.addProcess(process);

        let callCount = 0;
        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            callCount++;
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('chunk');
            }
            if (callCount === 1) {
                return { success: false, error: 'AI failed' };
            }
            return { success: true, response: 'recovered' };
        });

        const executor = new CLITaskExecutor(store);
        // First call fails
        await executor.executeFollowUp('proc-cleanup-err', 'fail');

        // Second call should work (throttle state cleaned up after error)
        await executor.executeFollowUp('proc-cleanup-err', 'succeed');

        const updated = await store.getProcess('proc-cleanup-err');
        expect(updated!.status).toBe('completed');
    });
});

// ============================================================================
// Queue Executor Bridge Integration Tests
// ============================================================================

describe('createQueueExecutorBridge', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let queueManager: TaskQueueManager;

    beforeEach(() => {
        store = createMockProcessStore();
        queueManager = new TaskQueueManager({
            maxQueueSize: 0,
            keepHistory: true,
            maxHistorySize: 100,
        });
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'sess-1',
        });
    });

    it('should create a running executor', () => {
        const { executor } = createQueueExecutorBridge(queueManager, store);
        expect(executor).toBeInstanceOf(QueueExecutor);
        expect(executor.isRunning()).toBe(true);
        executor.dispose();
    });

    it('should execute enqueued tasks automatically', async () => {
        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskCompleted = new Promise<void>((resolve) => {
            executor.on('taskCompleted', () => resolve());
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Hello AI' },
            config: { timeoutMs: 30000 },
            displayName: 'Test task',
        });

        await taskCompleted;

        // Task should be in history as completed
        const history = queueManager.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('completed');

        // Process should be in store
        expect(store.addProcess).toHaveBeenCalled();
        expect(store.updateProcess).toHaveBeenCalledWith(
            expect.stringContaining('queue_'),
            expect.objectContaining({ status: 'completed' })
        );

        executor.dispose();
    });

    it('should handle task failure and populate history', async () => {
        mockSendMessage.mockResolvedValue({
            success: false,
            error: 'Model overloaded',
        });

        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskFailed = new Promise<void>((resolve) => {
            executor.on('taskFailed', () => resolve());
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'test' },
            config: {},
        });

        await taskFailed;

        const history = queueManager.getHistory();
        expect(history).toHaveLength(1);
        expect(history[0].status).toBe('failed');
        expect(history[0].error).toContain('Model overloaded');

        executor.dispose();
    });

    it('should process multiple tasks in order', async () => {
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const completedTasks: string[] = [];

        executor.on('taskCompleted', (task: QueuedTask) => {
            completedTasks.push(task.displayName || task.id);
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Task A' },
            config: {},
            displayName: 'A',
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'Task B' },
            config: {},
            displayName: 'B',
        });

        // Wait for both tasks to complete
        await delay(500);

        expect(completedTasks).toContain('A');
        expect(completedTasks).toContain('B');
        expect(queueManager.getHistory()).toHaveLength(2);

        executor.dispose();
    });

    it('should respect high priority ordering', async () => {
        // Pause first so we can enqueue in specific order
        queueManager.pause();

        const { executor } = createQueueExecutorBridge(queueManager, store, {
            maxConcurrency: 1,
        });

        const executionOrder: string[] = [];
        mockSendMessage.mockImplementation(async (opts: any) => {
            executionOrder.push(opts.prompt);
            return { success: true, response: 'ok' };
        });

        // Enqueue low priority first, then high
        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'low',
            payload: { prompt: 'low-task' },
            config: {},
        });

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'high',
            payload: { prompt: 'high-task' },
            config: {},
        });

        // Resume and wait
        queueManager.resume();
        await delay(500);

        // High priority should execute first
        expect(executionOrder[0]).toBe('high-task');
        expect(executionOrder[1]).toBe('low-task');

        executor.dispose();
    });

    it('should not start when autoStart is false', () => {
        const { executor } = createQueueExecutorBridge(queueManager, store, {
            autoStart: false,
        });

        expect(executor.isRunning()).toBe(false);
        executor.dispose();
    });

    it('should stop processing when paused', async () => {
        const { executor } = createQueueExecutorBridge(queueManager, store);

        // Pause the queue
        queueManager.pause();

        queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'test' },
            config: {},
        });

        // Wait a bit — task should NOT execute
        await delay(300);

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(queueManager.getQueued()).toHaveLength(1);

        // Resume — task should execute
        const taskCompleted = new Promise<void>((resolve) => {
            executor.on('taskCompleted', () => resolve());
        });

        queueManager.resume();
        await taskCompleted;

        expect(mockSendMessage).toHaveBeenCalledOnce();
        expect(queueManager.getHistory()).toHaveLength(1);

        executor.dispose();
    });

    it('should cancel a running task via executor', async () => {
        // Make the AI call take a while
        mockSendMessage.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => resolve({ success: true, response: 'done' }), 5000);
        }));

        const { executor } = createQueueExecutorBridge(queueManager, store);

        const taskId = queueManager.enqueue({
            type: 'ai-clarification',
            priority: 'normal',
            payload: { prompt: 'long task' },
            config: {},
        });

        // Wait for task to start
        await delay(200);

        // Cancel it
        executor.cancelTask(taskId);

        // Wait for cancellation to process
        await delay(300);

        // Task should be cancelled
        const task = queueManager.getTask(taskId);
        expect(task?.status).toBe('cancelled');

        executor.dispose();
    });
});

// ============================================================================
// Server Integration Tests
// ============================================================================

describe('Queue execution via HTTP API', () => {
    // These tests verify the full flow: HTTP enqueue → executor picks up → task completes

    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
        });
    });

    it('should have CLITaskExecutor as a proper TaskExecutor', () => {
        const executor = new CLITaskExecutor(store);
        expect(typeof executor.execute).toBe('function');
        expect(typeof executor.cancel).toBe('function');
    });

    it('should handle store errors gracefully', async () => {
        // Make store.addProcess throw
        const failingStore = createMockProcessStore();
        (failingStore.addProcess as any).mockRejectedValue(new Error('Store error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        // Should still succeed (store errors are non-fatal)
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on success', async () => {
        const failingStore = createMockProcessStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should handle store update errors gracefully on failure', async () => {
        mockSendMessage.mockResolvedValue({ success: false, error: 'AI error' });

        const failingStore = createMockProcessStore();
        (failingStore.updateProcess as any).mockRejectedValue(new Error('Update error'));

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-store-err-3',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(false);
    });

    it('should pass onStreamingChunk to sendMessage for AI tasks', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Stream me' },
            config: {},
        };

        await executor.execute(task);

        // Verify onStreamingChunk was passed to sendMessage
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            onStreamingChunk: expect.any(Function),
        }));
    });

    it('should emit streaming chunks to process store via onStreamingChunk', async () => {
        // Capture the onStreamingChunk callback and invoke it during execution
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate streaming chunks
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('world!');
            }
            return { success: true, response: 'Hello world!', sessionId: 'sess-stream' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Stream test' },
            config: {},
        };

        await executor.execute(task);

        // Verify chunks were emitted to the store
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-2', 'Hello ');
        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-2', 'world!');
        expect(store.outputs.get('queue_task-stream-2')).toEqual(['Hello ', 'world!']);
    });

    it('should handle store.emitProcessOutput errors gracefully during streaming', async () => {
        // Make emitProcessOutput throw
        const failingStore = createMockProcessStore();
        (failingStore.emitProcessOutput as any).mockImplementation(() => {
            throw new Error('Store emit error');
        });

        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk1');
            }
            return { success: true, response: 'done', sessionId: 'sess-err' };
        });

        const executor = new CLITaskExecutor(failingStore);

        const task: QueuedTask = {
            id: 'task-stream-err',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        // Should not throw — store errors in streaming are non-fatal
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should emit streaming chunks for custom tasks', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('custom chunk');
            }
            return { success: true, response: 'custom response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-custom',
            type: 'custom',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { data: { prompt: 'Custom task' } },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-custom', 'custom chunk');
    });

    it('should emit streaming chunks for follow-prompt tasks', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('follow chunk');
            }
            return { success: true, response: 'follow response' };
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-stream-follow',
            type: 'follow-prompt',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { promptFilePath: '/nonexistent/file.md' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-stream-follow', 'follow chunk');
    });

    it('should use default working directory from options', async () => {
        const executor = new CLITaskExecutor(store, { workingDirectory: '/default/dir' });

        const task: QueuedTask = {
            id: 'task-wd',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            workingDirectory: '/default/dir',
        }));
    });

    it('should prefer task working directory over default', async () => {
        const executor = new CLITaskExecutor(store, { workingDirectory: '/default/dir' });

        const task: QueuedTask = {
            id: 'task-wd-2',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test', workingDirectory: '/task/dir' },
            config: {},
        };

        await executor.execute(task);

        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            workingDirectory: '/task/dir',
        }));
    });

    // ========================================================================
    // Output Persistence
    // ========================================================================

    describe('output persistence', () => {
        let tmpDir: string;

        beforeEach(async () => {
            const os = await import('os');
            const fsPromises = await import('fs/promises');
            const path = await import('path');
            tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'coc-bridge-test-'));
        });

        afterEach(async () => {
            const fsPromises = await import('fs/promises');
            await fsPromises.rm(tmpDir, { recursive: true, force: true });
        });

        it('should accumulate streaming chunks and save output file on success', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk1');
                opts.onStreamingChunk?.('chunk2');
                opts.onStreamingChunk?.('chunk3');
                return { success: true, response: 'done', sessionId: 's1' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-1',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test output' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);

            // Verify output file was written with concatenated chunks
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-1.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('chunk1chunk2chunk3');
        });

        it('should set rawStdoutFilePath on the process after completion', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('output data');
                return { success: true, response: 'done', sessionId: 's2' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-path',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Check that updateProcess was called with rawStdoutFilePath
            const path = await import('path');
            const expectedPath = path.join(tmpDir, 'outputs', 'queue_task-output-path.md');
            expect(store.updateProcess).toHaveBeenCalledWith('queue_task-output-path', {
                rawStdoutFilePath: expectedPath,
            });
        });

        it('should save output file on task failure too', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('partial1');
                opts.onStreamingChunk?.('partial2');
                throw new Error('AI execution failed mid-stream');
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-fail',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(false);

            // Verify partial output was still saved
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-fail.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('partial1partial2');
        });

        it('should still emit streaming chunks to store alongside file persistence', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk-a');
                opts.onStreamingChunk?.('chunk-b');
                return { success: true, response: 'done', sessionId: 's3' };
            });

            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-output-sse',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            await executor.execute(task);

            // Verify streaming chunks were emitted to store (SSE/WS)
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-output-sse', 'chunk-a');
            expect(store.emitProcessOutput).toHaveBeenCalledWith('queue_task-output-sse', 'chunk-b');

            // And also verify file was written
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputPath = path.join(tmpDir, 'outputs', 'queue_task-output-sse.md');
            const content = await fsPromises.readFile(outputPath, 'utf-8');
            expect(content).toBe('chunk-achunk-b');
        });

        it('should not create output file when no dataDir is provided', async () => {
            mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk?.('chunk');
                return { success: true, response: 'done', sessionId: 's4' };
            });

            // No dataDir — should skip persistence
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-no-datadir',
                type: 'ai-clarification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { prompt: 'test' },
                config: {},
            };

            const result = await executor.execute(task);
            expect(result.success).toBe(true);

            // updateProcess should not be called with rawStdoutFilePath
            const calls = (store.updateProcess as any).mock.calls;
            const pathCalls = calls.filter((c: any) => c[1]?.rawStdoutFilePath);
            expect(pathCalls).toHaveLength(0);
        });

        it('should not create output file for non-AI task types', async () => {
            const executor = new CLITaskExecutor(store, { dataDir: tmpDir });

            const task: QueuedTask = {
                id: 'task-noop',
                type: 'code-review',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {},
                config: {},
            };

            await executor.execute(task);

            // No output file should exist (no-op tasks produce no output)
            const path = await import('path');
            const fsPromises = await import('fs/promises');
            const outputsDir = path.join(tmpDir, 'outputs');
            await expect(fsPromises.access(outputsDir)).rejects.toThrow();
        });
    });
});

// ============================================================================
// Tool Event Emission Tests
// ============================================================================

describe('tool event emission via onToolEvent', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should pass onToolEvent callback to sendMessage', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Verify onToolEvent is provided
            expect(typeof opts.onToolEvent).toBe('function');
            return { success: true, response: 'done', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-event',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);
        expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({
            onToolEvent: expect.any(Function),
        }));
    });

    it('should emit tool-start events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-1',
                    toolName: 'view',
                    parameters: { path: '/test.ts' },
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-start',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-start', {
            type: 'tool-start',
            toolCallId: 'tc-1',
            toolName: 'view',
            parameters: { path: '/test.ts' },
            result: undefined,
            error: undefined,
        });
    });

    it('should emit tool-complete events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-2',
                    toolName: 'bash',
                    result: 'command output',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-3' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-complete',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-complete', {
            type: 'tool-complete',
            toolCallId: 'tc-2',
            toolName: 'bash',
            parameters: undefined,
            result: 'command output',
            error: undefined,
        });
    });

    it('should preserve parentToolCallId for nested subagent events', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-parent',
                    toolName: 'task',
                    parameters: { agent_type: 'explore' },
                });
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    parameters: { glob_pattern: '**/*.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    result: 'a.ts\nb.ts',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-parent' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-parent-tool',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-parent-tool', expect.objectContaining({
            type: 'tool-start',
            toolCallId: 'tc-child',
            parentToolCallId: 'tc-parent',
        }));
        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-parent-tool', expect.objectContaining({
            type: 'tool-complete',
            toolCallId: 'tc-child',
            parentToolCallId: 'tc-parent',
        }));
    });

    it('should emit tool-failed events to store.emitProcessEvent', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-failed',
                    toolCallId: 'tc-3',
                    toolName: 'edit',
                    error: 'Permission denied',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-4' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tool-failed',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledWith('queue_task-tool-failed', {
            type: 'tool-failed',
            toolCallId: 'tc-3',
            toolName: 'edit',
            parameters: undefined,
            result: undefined,
            error: 'Permission denied',
        });
    });

    it('should handle store.emitProcessEvent errors gracefully', async () => {
        const failingStore = createMockProcessStore();
        (failingStore.emitProcessEvent as any).mockImplementation(() => {
            throw new Error('Event emit error');
        });

        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-err',
                    toolName: 'grep',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-5' };
        });

        const executor = new CLITaskExecutor(failingStore);
        const task: QueuedTask = {
            id: 'task-tool-err',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        // Should not throw despite emitProcessEvent failing
        const result = await executor.execute(task);
        expect(result.success).toBe(true);
    });

    it('should emit tool events for follow-up messages', async () => {
        store = createMockProcessStore({
            initialProcesses: [createCompletedProcessWithSession('proc-tool-follow', 'sess-follow')],
        });

        mockSendFollowUp.mockImplementation(async (_sessionId: string, _prompt: string, options?: any) => {
            if (options?.onToolEvent) {
                options.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-follow-1',
                    toolName: 'view',
                    parameters: { path: '/file.ts' },
                });
                options.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-follow-1',
                    toolName: 'view',
                    result: 'file contents',
                });
            }
            return { success: true, response: 'follow-up done', sessionId: 'sess-follow' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-tool-follow', 'follow-up message');

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(2);
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-tool-follow', expect.objectContaining({
            type: 'tool-start',
            toolCallId: 'tc-follow-1',
            toolName: 'view',
        }));
        expect(store.emitProcessEvent).toHaveBeenCalledWith('proc-tool-follow', expect.objectContaining({
            type: 'tool-complete',
            toolCallId: 'tc-follow-1',
            result: 'file contents',
        }));
    });

    it('should emit multiple tool events in sequence', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-a', toolName: 'view' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-a', result: 'ok' });
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-b', toolName: 'bash' });
                opts.onToolEvent({ type: 'tool-failed', toolCallId: 'tc-b', error: 'timeout' });
            }
            return { success: true, response: 'done', sessionId: 'sess-multi' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-multi-tool',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        expect(store.emitProcessEvent).toHaveBeenCalledTimes(4);
    });
});

// ============================================================================
// Conversation Persistence Mid-Stream (Integration-style)
// ============================================================================

describe('conversation persistence mid-stream', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should persist conversation state mid-stream and restore on server restart', async () => {
        vi.useFakeTimers();

        const process = createCompletedProcessWithSession('proc-restart', 'sess-restart');
        await store.addProcess(process);

        let chunksSent = 0;
        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                // Emit 6 chunks with 500ms gaps (3 seconds total)
                for (let i = 0; i < 6; i++) {
                    options.onStreamingChunk(`chunk${i} `);
                    chunksSent++;
                    await vi.advanceTimersByTimeAsync(500);
                }
            }
            return { success: true, response: 'chunk0 chunk1 chunk2 chunk3 chunk4 chunk5 ' };
        });

        const executor1 = new CLITaskExecutor(store);
        await executor1.executeFollowUp('proc-restart', 'start streaming');

        // Verify that streaming content was flushed to the store during streaming
        const updateCalls = (store.updateProcess as any).mock.calls;
        const streamingFlushCalls = updateCalls.filter((call: any[]) => {
            const updates = call[1];
            return updates.conversationTurns?.some(
                (t: any) => t.role === 'assistant' && t.streaming === true
            );
        });
        // At least one streaming flush should have occurred during the 3 seconds
        expect(streamingFlushCalls.length).toBeGreaterThanOrEqual(1);

        // The flushed content should include chunk data
        const flushedTurns = streamingFlushCalls[0][1].conversationTurns;
        const streamingTurn = flushedTurns.find((t: any) => t.role === 'assistant' && t.streaming);
        expect(streamingTurn.content).toContain('chunk0');

        // Simulate "server restart": read persisted state from same store with new executor
        const executor2 = new CLITaskExecutor(store);
        const persisted = await store.getProcess('proc-restart');
        expect(persisted).toBeDefined();
        expect(persisted!.conversationTurns).toBeDefined();

        // Final state should have the complete response (first executor completed)
        const finalAssistant = persisted!.conversationTurns!.find(t => t.role === 'assistant');
        expect(finalAssistant).toBeDefined();
        expect(finalAssistant!.streaming).toBeUndefined();

        // New executor should be functional
        expect(await executor2.isSessionAlive('proc-restart')).toBeDefined();

        vi.useRealTimers();
    });
});

// ============================================================================
// Timeline Population Tests
// ============================================================================

describe('timeline population during execution', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
        mockCanResumeSession.mockReset();
        mockCanResumeSession.mockResolvedValue(true);
        mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('should initialize timeline as empty array on new process', async () => {
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'done',
            sessionId: 'sess-tl-init',
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-init',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test prompt' },
            config: {},
        };

        await executor.execute(task);

        // User turn should have empty timeline
        const process = await store.getProcess('queue_task-tl-init');
        expect(process).toBeDefined();
        const userTurn = process!.conversationTurns!.find(t => t.role === 'user');
        expect(userTurn).toBeDefined();
        expect(userTurn!.timeline).toEqual([]);
    });

    it('should append content chunks to assistant turn timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('world');
            }
            return { success: true, response: 'Hello world', sessionId: 'sess-tl-content' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-content',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-content');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // Consecutive content chunks are merged during flush
        expect(assistantTurn!.timeline.length).toBe(1);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('Hello world');
    });

    it('should merge consecutive content chunks into single timeline item', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('Hello ');
                opts.onStreamingChunk('beautiful ');
                opts.onStreamingChunk('world');
            }
            return { success: true, response: 'Hello beautiful world', sessionId: 'sess-tl-merge' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-merge',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-merge');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(1);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('Hello beautiful world');
    });

    it('should not merge content across tool event boundaries', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) opts.onStreamingChunk('before ');
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-bnd-1', toolName: 'grep' });
            }
            if (opts.onStreamingChunk) opts.onStreamingChunk('after');
            return { success: true, response: 'before after', sessionId: 'sess-tl-bnd' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-bnd',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-bnd');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // content → tool-start → content = 3 items (tool breaks merge)
        expect(assistantTurn!.timeline.length).toBe(3);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('before ');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('content');
        expect(assistantTurn!.timeline[2].content).toBe('after');
    });

    it('should preserve first timestamp when merging content items', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('first ');
                opts.onStreamingChunk('second');
            }
            return { success: true, response: 'first second', sessionId: 'sess-tl-tstamp' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-tstamp',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-tstamp');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(1);
        // Timestamp should be a valid Date (the first chunk's timestamp)
        expect(assistantTurn!.timeline[0].timestamp).toBeInstanceOf(Date);
    });

    it('should handle complex merge boundaries with multiple tool types', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // content → content → tool-start → tool-complete → content → content
            if (opts.onStreamingChunk) opts.onStreamingChunk('a');
            if (opts.onStreamingChunk) opts.onStreamingChunk('b');
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-cx-1', toolName: 'view' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-cx-1', toolName: 'view', result: 'ok' });
            }
            if (opts.onStreamingChunk) opts.onStreamingChunk('c');
            if (opts.onStreamingChunk) opts.onStreamingChunk('d');
            return { success: true, response: 'abcd', sessionId: 'sess-tl-cx' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-cx',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-cx');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();
        // merged-content('ab') → tool-start → tool-complete → merged-content('cd')
        expect(assistantTurn!.timeline.length).toBe(4);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('ab');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[3].type).toBe('content');
        expect(assistantTurn!.timeline[3].content).toBe('cd');
    });

    it('should append tool events to assistant turn timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-tl-1',
                    toolName: 'view',
                    parameters: { path: '/test.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-tl-1',
                    toolName: 'view',
                    result: 'file contents',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-tool' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-tool',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-tool');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(2);
        expect(assistantTurn!.timeline[0].type).toBe('tool-start');
        expect(assistantTurn!.timeline[0].toolCall).toBeDefined();
        expect(assistantTurn!.timeline[0].toolCall!.name).toBe('view');
        expect(assistantTurn!.timeline[0].toolCall!.id).toBe('tc-tl-1');
        expect(assistantTurn!.timeline[1].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[1].toolCall!.result).toBe('file contents');
    });

    it('should preserve parentToolCallId in timeline tool calls', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-parent',
                    toolName: 'task',
                    parameters: { agent_type: 'explore' },
                });
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    parameters: { glob_pattern: '**/*.ts' },
                });
                opts.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-child',
                    toolName: 'glob',
                    parentToolCallId: 'tc-parent',
                    result: 'match',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-parent' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-parent',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-parent');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();

        const childStart = assistantTurn!.timeline.find(
            (item) => item.type === 'tool-start' && item.toolCall?.id === 'tc-child'
        );
        expect(childStart).toBeDefined();
        expect(childStart!.toolCall!.parentToolCallId).toBe('tc-parent');
    });

    it('should append tool-failed events to timeline', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onToolEvent) {
                opts.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-tl-fail',
                    toolName: 'edit',
                });
                opts.onToolEvent({
                    type: 'tool-failed',
                    toolCallId: 'tc-tl-fail',
                    toolName: 'edit',
                    error: 'Permission denied',
                });
            }
            return { success: true, response: 'done', sessionId: 'sess-tl-fail' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-fail',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-fail');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline[1].type).toBe('tool-failed');
        expect(assistantTurn!.timeline[1].toolCall!.error).toBe('Permission denied');
        expect(assistantTurn!.timeline[1].toolCall!.status).toBe('failed');
    });

    it('should have accurate timestamps in chronological order', async () => {
        const timestamps: Date[] = [];
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk1');
            }
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-ts', toolName: 'bash' });
                opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-ts', toolName: 'bash', result: 'ok' });
            }
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('chunk2');
            }
            return { success: true, response: 'chunk1chunk2', sessionId: 'sess-tl-ts' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-ts',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-tl-ts');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(4);

        // Verify all items have timestamps
        for (const item of assistantTurn!.timeline) {
            expect(item.timestamp).toBeInstanceOf(Date);
        }

        // Verify chronological order (each timestamp >= previous)
        for (let i = 1; i < assistantTurn!.timeline.length; i++) {
            expect(assistantTurn!.timeline[i].timestamp.getTime())
                .toBeGreaterThanOrEqual(assistantTurn!.timeline[i - 1].timestamp.getTime());
        }

        // Verify order: content, tool-start, tool-complete, content
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
        expect(assistantTurn!.timeline[3].type).toBe('content');
    });

    it('should persist timeline via store.updateProcess', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            if (opts.onStreamingChunk) {
                opts.onStreamingChunk('data');
            }
            if (opts.onToolEvent) {
                opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-p', toolName: 'grep' });
            }
            return { success: true, response: 'data', sessionId: 'sess-tl-persist' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-tl-persist',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test' },
            config: {},
        };

        await executor.execute(task);

        // Verify updateProcess was called with conversation turns containing timeline
        expect(store.updateProcess).toHaveBeenCalledWith(
            'queue_task-tl-persist',
            expect.objectContaining({
                conversationTurns: expect.arrayContaining([
                    expect.objectContaining({
                        role: 'assistant',
                        timeline: expect.arrayContaining([
                            expect.objectContaining({ type: 'content', content: 'data' }),
                            expect.objectContaining({ type: 'tool-start' }),
                        ]),
                    }),
                ]),
            })
        );
    });

    it('should populate timeline for follow-up messages', async () => {
        const process = createCompletedProcessWithSession('proc-tl-follow', 'sess-tl-follow');
        await store.addProcess(process);

        mockSendFollowUp.mockImplementation(async (_sid: string, _prompt: string, options?: any) => {
            if (options?.onStreamingChunk) {
                options.onStreamingChunk('follow-up text');
            }
            if (options?.onToolEvent) {
                options.onToolEvent({
                    type: 'tool-start',
                    toolCallId: 'tc-fu-1',
                    toolName: 'view',
                    parameters: { path: '/src/index.ts' },
                });
                options.onToolEvent({
                    type: 'tool-complete',
                    toolCallId: 'tc-fu-1',
                    toolName: 'view',
                    result: 'file content',
                });
            }
            return { success: true, response: 'follow-up text', sessionId: 'sess-tl-follow' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-tl-follow', 'follow up question');

        const updated = await store.getProcess('proc-tl-follow');
        const allTurns = updated!.conversationTurns!;
        // The follow-up assistant turn is the last non-streaming assistant turn
        const assistantTurns = allTurns.filter(t => t.role === 'assistant' && !t.streaming);
        const assistantTurn = assistantTurns[assistantTurns.length - 1];
        expect(assistantTurn).toBeDefined();
        expect(assistantTurn!.timeline.length).toBe(3);
        expect(assistantTurn!.timeline[0].type).toBe('content');
        expect(assistantTurn!.timeline[0].content).toBe('follow-up text');
        expect(assistantTurn!.timeline[1].type).toBe('tool-start');
        expect(assistantTurn!.timeline[1].toolCall!.name).toBe('view');
        expect(assistantTurn!.timeline[2].type).toBe('tool-complete');
    });

    it('should interleave content and tool events in chronological order', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate realistic interleaving: content → tool → content → tool → content
            if (opts.onStreamingChunk) opts.onStreamingChunk('Analyzing...');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-il-1', toolName: 'grep' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-il-1', toolName: 'grep', result: 'found' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('Found results. ');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-il-2', toolName: 'view' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-il-2', toolName: 'view', result: 'code' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('Done.');
            return { success: true, response: 'Analyzing...Found results. Done.', sessionId: 'sess-il' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-interleave',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'analyze code' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-interleave');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn!.timeline.length).toBe(7);

        // Verify interleaved order
        const types = assistantTurn!.timeline.map(t => t.type);
        expect(types).toEqual([
            'content', 'tool-start', 'tool-complete',
            'content', 'tool-start', 'tool-complete',
            'content',
        ]);
    });

    it('should merge consecutive content items but preserve tool boundaries during flush', async () => {
        mockSendMessage.mockImplementation(async (opts: any) => {
            // Simulate: 3 content chunks → tool → 2 content chunks
            if (opts.onStreamingChunk) opts.onStreamingChunk('word1 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word2 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word3 ');
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-start', toolCallId: 'tc-merge', toolName: 'grep' });
            if (opts.onToolEvent) opts.onToolEvent({ type: 'tool-complete', toolCallId: 'tc-merge', toolName: 'grep', result: 'ok' });
            if (opts.onStreamingChunk) opts.onStreamingChunk('word4 ');
            if (opts.onStreamingChunk) opts.onStreamingChunk('word5');
            return { success: true, response: 'word1 word2 word3 word4 word5', sessionId: 'sess-merge' };
        });

        const executor = new CLITaskExecutor(store);
        const task: QueuedTask = {
            id: 'task-merge-flush',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'test merge' },
            config: {},
        };

        await executor.execute(task);

        const process = await store.getProcess('queue_task-merge-flush');
        const assistantTurn = process!.conversationTurns!.find(t => t.role === 'assistant');
        expect(assistantTurn).toBeDefined();

        // 3 content chunks merged into 1, tool-start, tool-complete, 2 content chunks merged into 1
        expect(assistantTurn!.timeline.length).toBe(4);
        expect(assistantTurn!.timeline[0]).toMatchObject({ type: 'content', content: 'word1 word2 word3 ' });
        expect(assistantTurn!.timeline[1]).toMatchObject({ type: 'tool-start' });
        expect(assistantTurn!.timeline[2]).toMatchObject({ type: 'tool-complete' });
        expect(assistantTurn!.timeline[3]).toMatchObject({ type: 'content', content: 'word4 word5' });
    });
});

// ============================================================================
// AI Service Injection Tests
// ============================================================================

describe('AI service injection', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        // Reset global mocks
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response text',
            sessionId: 'session-123',
        });
    });

    it('should use injected aiService when provided', async () => {
        const injectedMock = createMockSDKService({
            sendMessageResponse: {
                success: true,
                response: 'Injected mock response',
                sessionId: 'injected-session-456',
            },
        });

        const executor = new CLITaskExecutor(store, {
            aiService: injectedMock.service as any,
        });

        const task: QueuedTask = {
            id: 'task-injection-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Test injection' },
            config: { timeoutMs: 30000 },
            displayName: 'Test injection',
        };

        const result = await executor.execute(task);

        // Verify the injected mock was called (not the global mock)
        expect(injectedMock.mockIsAvailable).toHaveBeenCalledTimes(1);
        expect(injectedMock.mockSendMessage).toHaveBeenCalledTimes(1);
        expect(injectedMock.mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Test injection',
            })
        );

        // Verify global mock was NOT called
        expect(mockIsAvailable).not.toHaveBeenCalled();
        expect(mockSendMessage).not.toHaveBeenCalled();

        // Verify result contains injected mock's response
        expect(result.success).toBe(true);
        expect((result.result as any).response).toBe('Injected mock response');
        expect((result.result as any).sessionId).toBe('injected-session-456');
    });

    it('should fallback to getCopilotSDKService() when no aiService provided', async () => {
        mockIsAvailable.mockReset().mockResolvedValue({ available: true });
        mockSendMessage.mockReset().mockResolvedValue({
            success: true,
            response: 'Global mock response',
            sessionId: 'global-session-789',
        });

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'task-fallback-1',
            type: 'ai-clarification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { prompt: 'Test fallback' },
            config: { timeoutMs: 30000 },
            displayName: 'Test fallback',
        };

        const result = await executor.execute(task);

        // Verify the global mock from getCopilotSDKService() was called
        expect(mockIsAvailable).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledTimes(1);
        expect(mockSendMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: 'Test fallback',
            })
        );

        // Verify result contains global mock's response
        expect(result.success).toBe(true);
        expect((result.result as any).response).toBe('Global mock response');
        expect((result.result as any).sessionId).toBe('global-session-789');
    });
});

describe('createQueueExecutorBridge', () => {
    describe('AI service injection', () => {
        it('should pass aiService through createQueueExecutorBridge factory', async () => {
            const queueManager = new TaskQueueManager();
            const store = createMockProcessStore();

            const bridgeMock = createMockSDKService({
                sendMessageResponse: {
                    success: true,
                    response: 'Bridge integration response',
                    sessionId: 'bridge-session-999',
                },
            });

            const { executor, bridge } = createQueueExecutorBridge(queueManager, store, {
                maxConcurrency: 1,
                autoStart: false,
                aiService: bridgeMock.service as any,
            });

            queueManager.enqueue({
                type: 'ai-clarification',
                priority: 'normal',
                payload: { prompt: 'Bridge integration test' },
                config: {},
                displayName: 'Bridge test',
            });

            executor.start();
            await delay(100);

            // Verify the injected service was used
            expect(bridgeMock.mockIsAvailable).toHaveBeenCalledTimes(1);
            expect(bridgeMock.mockSendMessage).toHaveBeenCalledTimes(1);
            expect(bridgeMock.mockSendMessage).toHaveBeenCalledWith(
                expect.objectContaining({
                    prompt: 'Bridge integration test',
                })
            );

            // Verify task completed successfully
            await delay(100);
            const history = queueManager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].status).toBe('completed');

            executor.dispose();
        });
    });

    // ========================================================================
    // Run Pipeline Tasks
    // ========================================================================

    describe('run-pipeline tasks', () => {
        let store: ReturnType<typeof createMockProcessStore>;
        const existsSyncMock = vi.mocked(fs.existsSync);
        const readFileSyncMock = vi.mocked(fs.readFileSync);

        const SIMPLE_JOB_YAML = `name: "Test Job"
job:
  prompt: "Say hello"
`;

        beforeEach(() => {
            store = createMockProcessStore();
            mockSendMessage.mockReset();
            mockIsAvailable.mockReset();
            mockIsAvailable.mockResolvedValue({ available: true });
            mockExecutePipeline.mockReset();
            mockCreateCLIAIInvoker.mockReset();
            mockCreateCLIAIInvoker.mockReturnValue(vi.fn());
        });

        it('should execute a run-pipeline task successfully', async () => {
            // Mock fs to return pipeline YAML
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecutePipeline.mockResolvedValue({
                executionStats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 100 },
                output: { formattedOutput: 'Pipeline result output' },
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-run-pipeline',
                type: 'run-pipeline',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-pipeline' as const,
                    pipelinePath: '/workspace/.vscode/pipelines/my-pipeline',
                    workingDirectory: '/workspace',
                },
                config: {},
                displayName: 'Run Pipeline: my-pipeline',
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockExecutePipeline).toHaveBeenCalledOnce();
            expect(mockCreateCLIAIInvoker).toHaveBeenCalledOnce();
            // Verify the pipeline result is returned
            expect(result.result).toEqual(expect.objectContaining({
                pipelineName: 'Test Job',
                response: 'Pipeline result output',
            }));
        });

        it('should apply model override from payload', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecutePipeline.mockResolvedValue({
                executionStats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                output: { formattedOutput: 'result' },
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-model-override',
                type: 'run-pipeline',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-pipeline' as const,
                    pipelinePath: '/workspace/.vscode/pipelines/test',
                    workingDirectory: '/workspace',
                    model: 'gpt-4',
                },
                config: {},
            };

            await executor.execute(task);

            expect(mockCreateCLIAIInvoker).toHaveBeenCalledWith(expect.objectContaining({
                model: 'gpt-4',
            }));
        });

        it('should handle pipeline execution failure', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecutePipeline.mockRejectedValue(new Error('Pipeline execution failed'));

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-pipeline-fail',
                type: 'run-pipeline',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-pipeline' as const,
                    pipelinePath: '/workspace/.vscode/pipelines/failing',
                    workingDirectory: '/workspace',
                },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('Pipeline execution failed');
        });

        it('should extract prompt as pipeline basename', async () => {
            readFileSyncMock.mockImplementation((p: fs.PathOrFileDescriptor, _opts?: any) => {
                if (String(p).includes('pipeline.yaml')) {
                    return SIMPLE_JOB_YAML;
                }
                return '';
            });

            mockExecutePipeline.mockResolvedValue({
                executionStats: { totalItems: 1, successfulItems: 1, failedItems: 0, durationMs: 50 },
                output: { formattedOutput: 'done' },
            });

            const executor = new CLITaskExecutor(store);
            const task: QueuedTask = {
                id: 'task-prompt-extract',
                type: 'run-pipeline',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'run-pipeline' as const,
                    pipelinePath: '/workspace/.vscode/pipelines/my-named-pipeline',
                    workingDirectory: '/workspace',
                },
                config: {},
            };

            await executor.execute(task);

            // Verify the process was added with the correct prompt
            expect(store.addProcess).toHaveBeenCalledWith(expect.objectContaining({
                fullPrompt: 'Run pipeline: my-named-pipeline',
                promptPreview: 'Run pipeline: my-named-pipeline',
            }));
        });
    });
});
