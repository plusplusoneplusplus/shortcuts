/**
 * Queue Executor Bridge Tests
 *
 * Tests for CLITaskExecutor and createQueueExecutorBridge:
 * - Task execution by type (ai-clarification, custom, follow-prompt)
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

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const mockSendMessage = vi.fn();
const mockIsAvailable = vi.fn();
const mockSendFollowUp = vi.fn();

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => ({
            sendMessage: mockSendMessage,
            isAvailable: mockIsAvailable,
            sendFollowUp: mockSendFollowUp,
        }),
    };
});

// ============================================================================
// Mock ProcessStore
// ============================================================================

function createMockStore(): ProcessStore & {
    processes: Map<string, AIProcess>;
    outputs: Map<string, string[]>;
    completions: Map<string, { status: string; duration: string }>;
} {
    const processes = new Map<string, AIProcess>();
    const outputs = new Map<string, string[]>();
    const completions = new Map<string, { status: string; duration: string }>();

    return {
        processes,
        outputs,
        completions,
        addProcess: vi.fn(async (process: AIProcess) => {
            processes.set(process.id, { ...process });
        }),
        updateProcess: vi.fn(async (id: string, updates: Partial<AIProcess>) => {
            const existing = processes.get(id);
            if (existing) {
                processes.set(id, { ...existing, ...updates });
            }
        }),
        getProcess: vi.fn(async (id: string) => processes.get(id)),
        getAllProcesses: vi.fn(async () => Array.from(processes.values())),
        removeProcess: vi.fn(async (id: string) => { processes.delete(id); }),
        clearProcesses: vi.fn(async () => {
            const count = processes.size;
            processes.clear();
            return count;
        }),
        getWorkspaces: vi.fn(async () => []),
        registerWorkspace: vi.fn(async () => {}),
        onProcessOutput: vi.fn((_id: string, _callback: any) => () => {}),
        emitProcessOutput: vi.fn((id: string, content: string) => {
            const existing = outputs.get(id) || [];
            existing.push(content);
            outputs.set(id, existing);
        }),
        emitProcessComplete: vi.fn((id: string, status: string, duration: string) => {
            completions.set(id, { status, duration });
        }),
    };
}

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
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
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

        it('should complete resolve-comments tasks as no-op', async () => {
            const executor = new CLITaskExecutor(store);

            const task: QueuedTask = {
                id: 'task-8',
                type: 'resolve-comments',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: { documentUri: 'file:///test.md', commentIds: ['c1'], promptTemplate: '' },
                config: {},
            };

            const result = await executor.execute(task);

            expect(result.success).toBe(true);
            expect(mockSendMessage).not.toHaveBeenCalled();
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
});

// ============================================================================
// executeFollowUp Tests
// ============================================================================

describe('CLITaskExecutor.executeFollowUp', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
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
            conversationTurns: [
                { role: 'user', content: 'initial question', timestamp: new Date(), turnIndex: 0 },
            ],
        };
        await store.addProcess(process);

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-2', 'follow up');

        expect(mockSendFollowUp).toHaveBeenCalledWith('sess-123', 'follow up', expect.objectContaining({
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
// Session Tracking and Conversation Turns Tests
// ============================================================================

describe('session tracking and conversation turns', () => {
    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockSendFollowUp.mockReset();
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
                { role: 'user', content: 'initial', timestamp: new Date(), turnIndex: 0 },
                { role: 'assistant', content: 'reply', timestamp: new Date(), turnIndex: 1 },
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
});

// ============================================================================
// Queue Executor Bridge Integration Tests
// ============================================================================

describe('createQueueExecutorBridge', () => {
    let store: ReturnType<typeof createMockStore>;
    let queueManager: TaskQueueManager;

    beforeEach(() => {
        store = createMockStore();
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

    let store: ReturnType<typeof createMockStore>;

    beforeEach(() => {
        store = createMockStore();
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
        const failingStore = createMockStore();
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
        const failingStore = createMockStore();
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

        const failingStore = createMockStore();
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
        const failingStore = createMockStore();
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
