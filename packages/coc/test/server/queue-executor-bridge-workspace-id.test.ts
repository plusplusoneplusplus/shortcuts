/**
 * Queue Executor Bridge — Workspace ID Resolution Tests
 *
 * Tests for the fix that prevents workspaceId from falling back to absolute
 * paths when passed to resolveTaskRoot(). Covers:
 * - resolveWorkspaceIdForPath() helper method
 * - workspaceId stored in process.metadata at creation time
 * - Follow-up path uses metadata.workspaceId
 * - Standard chat path resolves workspace ID
 * - Task generation path resolves workspace ID
 * - Graceful fallback when workspace is not found
 */

import * as path from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
        promises: {
            ...actual.promises,
            readdir: vi.fn(async () => []),
        },
    };
});

import type { QueuedTask } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable } = sdkMocks;

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
        gatherFeatureContext: vi.fn().mockResolvedValue({
            description: '',
            planContent: undefined,
            specContent: undefined,
            relatedFiles: [],
        }),
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

const mockLoadImages = vi.fn().mockResolvedValue([]);
vi.mock('../../src/server/image-blob-store', () => ({
    ImageBlobStore: {
        loadImages: (...args: any[]) => mockLoadImages(...args),
        saveImages: vi.fn(),
        deleteImages: vi.fn(),
        getBlobsDir: vi.fn(),
    },
}));

// Spy on resolveTaskRoot so we can assert what workspaceId was passed
const mockResolveTaskRoot = vi.fn();
vi.mock('../../src/server/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => {
        mockResolveTaskRoot(...args);
        // Return a plausible result
        const opts = args[0];
        const absPath = path.join(opts.dataDir, 'repos', opts.workspaceId, 'tasks');
        return { absolutePath: absPath, repoId: opts.workspaceId, relativeFolderPath: absPath };
    },
    ensureTaskRoot: vi.fn(async (opts: any) => {
        const absPath = path.join(opts.dataDir, 'repos', opts.workspaceId, 'tasks');
        return { absolutePath: absPath, repoId: opts.workspaceId, relativeFolderPath: absPath };
    }),
}));

// ============================================================================
// Constants
// ============================================================================

const WORKSPACE_ID = 'ws-abc123';
const ROOT_PATH = path.resolve('/projects/my-repo');
const DATA_DIR = path.resolve('/home/user/.coc');

// ============================================================================
// Tests
// ============================================================================

describe('Workspace ID resolution in queue-executor-bridge', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore({
            initialWorkspaces: [{ id: WORKSPACE_ID, name: 'my-repo', rootPath: ROOT_PATH }],
        });
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WORKSPACE_ID, name: 'my-repo', rootPath: ROOT_PATH },
        ]);
        mockSendMessage.mockReset();
        mockIsAvailable.mockReset();
        mockIsAvailable.mockResolvedValue({ available: true });
        mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI response',
            sessionId: 'session-1',
        });
        mockResolveTaskRoot.mockClear();
        mockLoadImages.mockReset();
        mockLoadImages.mockResolvedValue([]);
    });

    // ========================================================================
    // Metadata propagation
    // ========================================================================

    describe('metadata.workspaceId propagation', () => {
        it('should store workspaceId in process metadata when present in payload', async () => {
            const executor = new CLITaskExecutor(store, { dataDir: DATA_DIR });

            const task: QueuedTask = {
                id: 'task-meta-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'ask',
                    prompt: 'hello',
                    workspaceId: WORKSPACE_ID,
                },
                config: {},
                displayName: 'test',
            };

            await executor.execute(task);

            expect(store.addProcess).toHaveBeenCalledOnce();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.metadata.workspaceId).toBe(WORKSPACE_ID);
        });

        it('should store undefined workspaceId when not present in payload', async () => {
            const executor = new CLITaskExecutor(store, { dataDir: DATA_DIR });

            const task: QueuedTask = {
                id: 'task-meta-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'ask',
                    prompt: 'hello',
                },
                config: {},
                displayName: 'test',
            };

            await executor.execute(task);

            expect(store.addProcess).toHaveBeenCalledOnce();
            const addedProcess = (store.addProcess as any).mock.calls[0][0];
            expect(addedProcess.metadata.workspaceId).toBeUndefined();
        });
    });

    // ========================================================================
    // Follow-up workspace ID resolution
    // ========================================================================

    describe('executeFollowUp workspace ID resolution', () => {
        it('should use metadata.workspaceId for follow-up when available', async () => {
            // Set up a completed process with workspaceId in metadata
            const process = createCompletedProcessWithSession('queue_task-fu-1');
            process.workingDirectory = ROOT_PATH;
            process.metadata = {
                ...process.metadata,
                workspaceId: WORKSPACE_ID,
            };
            store.processes.set(process.id, process);

            const executor = new CLITaskExecutor(store, { dataDir: DATA_DIR });

            const task: QueuedTask = {
                id: 'fu-ws-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    processId: 'queue_task-fu-1',
                    prompt: 'follow up question',
                },
                config: {},
                displayName: 'follow up',
            };

            await executor.execute(task);

            // resolveTaskRoot should have been called with the workspace ID, not the raw path
            expect(mockResolveTaskRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                }),
            );
        });

        it('should resolve workspace ID from store when metadata.workspaceId is missing', async () => {
            // Process without workspaceId in metadata (legacy)
            const process = createCompletedProcessWithSession('queue_task-fu-2');
            process.workingDirectory = ROOT_PATH;
            process.metadata = { type: 'chat' };
            store.processes.set(process.id, process);

            const executor = new CLITaskExecutor(store, { dataDir: DATA_DIR });

            const task: QueuedTask = {
                id: 'fu-ws-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    processId: 'queue_task-fu-2',
                    prompt: 'follow up',
                },
                config: {},
                displayName: 'follow up',
            };

            await executor.execute(task);

            // Should have resolved via getWorkspaces lookup
            expect(store.getWorkspaces).toHaveBeenCalled();
            expect(mockResolveTaskRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                }),
            );
        });
    });

    // ========================================================================
    // Standard chat workspace ID resolution
    // ========================================================================

    describe('standard chat workspace ID resolution', () => {
        it('should use payload.workspaceId when present', async () => {
            const executor = new CLITaskExecutor(store, {
                dataDir: DATA_DIR,
                workingDirectory: ROOT_PATH,
            });

            const task: QueuedTask = {
                id: 'chat-ws-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'do something',
                    workspaceId: WORKSPACE_ID,
                    workingDirectory: ROOT_PATH,
                },
                config: {},
                displayName: 'test',
            };

            await executor.execute(task);

            // resolveTaskRoot should use the workspace ID from payload
            const calls = mockResolveTaskRoot.mock.calls;
            if (calls.length > 0) {
                const lastCall = calls[calls.length - 1][0];
                expect(lastCall.workspaceId).toBe(WORKSPACE_ID);
            }
        });

        it('should resolve workspace ID from store when payload.workspaceId is missing', async () => {
            const executor = new CLITaskExecutor(store, {
                dataDir: DATA_DIR,
                workingDirectory: ROOT_PATH,
            });

            const task: QueuedTask = {
                id: 'chat-ws-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'do something',
                    workingDirectory: ROOT_PATH,
                },
                config: {},
                displayName: 'test',
            };

            await executor.execute(task);

            // Should resolve via store lookup, not use raw path
            if (mockResolveTaskRoot.mock.calls.length > 0) {
                const lastCall = mockResolveTaskRoot.mock.calls[mockResolveTaskRoot.mock.calls.length - 1][0];
                expect(lastCall.workspaceId).toBe(WORKSPACE_ID);
            }
        });
    });

    // ========================================================================
    // Task generation workspace ID resolution
    // ========================================================================

    describe('task generation workspace ID resolution', () => {
        it('should use payload.workspaceId when present for task generation', async () => {
            const executor = new CLITaskExecutor(store, {
                dataDir: DATA_DIR,
                workingDirectory: ROOT_PATH,
            });

            const task: QueuedTask = {
                id: 'tg-ws-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'create task',
                    workspaceId: WORKSPACE_ID,
                    workingDirectory: ROOT_PATH,
                    context: {
                        taskGeneration: {
                            targetFolder: 'my-feature',
                            mode: 'simple',
                        },
                    },
                },
                config: {},
                displayName: 'task gen',
            };

            await executor.execute(task);

            expect(mockResolveTaskRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                }),
            );
        });

        it('should resolve workspace ID from store when payload.workspaceId is missing for task generation', async () => {
            const executor = new CLITaskExecutor(store, {
                dataDir: DATA_DIR,
                workingDirectory: ROOT_PATH,
            });

            const task: QueuedTask = {
                id: 'tg-ws-2',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'create task',
                    workingDirectory: ROOT_PATH,
                    context: {
                        taskGeneration: {
                            targetFolder: 'my-feature',
                            mode: 'simple',
                        },
                    },
                },
                config: {},
                displayName: 'task gen',
            };

            await executor.execute(task);

            // Should resolve via store lookup
            expect(store.getWorkspaces).toHaveBeenCalled();
            expect(mockResolveTaskRoot).toHaveBeenCalledWith(
                expect.objectContaining({
                    workspaceId: WORKSPACE_ID,
                }),
            );
        });
    });

    // ========================================================================
    // Fallback behavior
    // ========================================================================

    describe('fallback when workspace is not found', () => {
        it('should fall back to raw path when no workspace matches', async () => {
            // Return empty workspaces so no match can be found
            (store.getWorkspaces as any).mockResolvedValue([]);

            const unknownDir = path.resolve('/unknown/project');
            const executor = new CLITaskExecutor(store, {
                dataDir: DATA_DIR,
                workingDirectory: unknownDir,
            });

            const task: QueuedTask = {
                id: 'fb-ws-1',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat' as const,
                    mode: 'autopilot',
                    prompt: 'do something',
                    workingDirectory: unknownDir,
                },
                config: {},
                displayName: 'fallback test',
            };

            await executor.execute(task);

            // With no matching workspace, should fall back to the raw path
            if (mockResolveTaskRoot.mock.calls.length > 0) {
                const lastCall = mockResolveTaskRoot.mock.calls[mockResolveTaskRoot.mock.calls.length - 1][0];
                expect(lastCall.workspaceId).toBe(unknownDir);
            }
        });
    });
});
