/**
 * ask_user Integration Tests
 *
 * Verifies ask_user behavior at the executor level:
 * - ChatExecutor (ask mode) injects the custom ask_user tool
 * - Legacy plan payloads use ChatExecutor Ask semantics and inject the custom ask_user tool
 * - AutopilotExecutor does NOT inject ask_user
 * - The custom ask_user tool carries overridesBuiltInTool: true
 * - No executor enables both custom ask_user and native onUserInputRequest
 * - assertNoAskUserConflict catches dual-path misconfiguration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { QueuedTask, SendMessageOptions } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { assertNoAskUserConflict } from '../../../src/server/executors/prompt-builder';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        promises: {
            ...actual.promises,
            readdir: vi.fn().mockResolvedValue([]),
        },
    };
});

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return actual;
});

const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: {
        saveOutput: vi.fn().mockResolvedValue(undefined),
    },
}));

// ============================================================================
// Helpers
// ============================================================================

const sdkMocks = createMockSDKService();

function makeOptions(
    store: ReturnType<typeof createMockProcessStore>,
    overrides?: Partial<ChatModeExecutorOptions>,
): ChatModeExecutorOptions {
    return {
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
        ...overrides,
    };
}

function makeChatTask(mode: 'ask' | 'plan' | 'autopilot', id = 'task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello' },
        config: {},
        displayName: 'Hello',
    };
}

// ============================================================================
// ask_user tool presence in executors
// ============================================================================

describe('ask_user tool injection in chat-mode executors', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let capturedOptions: SendMessageOptions | undefined;

    beforeEach(() => {
        store = createMockProcessStore();
        capturedOptions = undefined;
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockImplementation(async (opts: SendMessageOptions) => {
            capturedOptions = opts;
            return { success: true, response: 'ok', sessionId: 'sess-1', toolCalls: [] };
        });
    });

    it('ChatExecutor (ask) includes ask_user tool with overridesBuiltInTool', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        await executor.execute(makeChatTask('ask'), 'Hello');

        const askTool = capturedOptions?.tools?.find(t => t.name === 'ask_user');
        expect(askTool).toBeDefined();
        expect(askTool!.overridesBuiltInTool).toBe(true);
    });

    it('ChatExecutor includes ask_user tool for legacy plan payloads', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        await executor.execute(makeChatTask('plan'), 'Hello');

        const askTool = capturedOptions?.tools?.find(t => t.name === 'ask_user');
        expect(askTool).toBeDefined();
        expect(askTool!.overridesBuiltInTool).toBe(true);
    });

    it('AutopilotExecutor does NOT include ask_user tool', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('autopilot'), 'Hello');

        const askTool = capturedOptions?.tools?.find(t => t.name === 'ask_user');
        expect(askTool).toBeUndefined();
    });

    it('ChatExecutor does not include ask_user when disabled', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: false },
        } as any));
        await executor.execute(makeChatTask('ask'), 'Hello');

        const askTool = capturedOptions?.tools?.find(t => t.name === 'ask_user');
        expect(askTool).toBeUndefined();
    });

    it('no executor sets onUserInputRequest (CoC uses custom path only)', async () => {
        // Test each executor type
        for (const [Ctor, mode] of [
            [ChatExecutor, 'ask'],
            [AutopilotExecutor, 'autopilot'],
        ] as const) {
            capturedOptions = undefined;
            const executor = new Ctor(store, makeOptions(store, {
                askUser: { enabled: true },
            } as any));
            await executor.execute(makeChatTask(mode), 'Hello');

            expect(capturedOptions?.onUserInputRequest).toBeUndefined();
        }
    });

    it('persists pending ask_user payload and clears it after answer', async () => {
        const processId = 'queue_task-ask-user';
        store.processes.set(processId, {
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'Hello',
            fullPrompt: 'Hello',
        });

        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));

        sdkMocks.mockSendMessage.mockImplementation(async (opts: SendMessageOptions) => {
            const askTool = opts.tools?.find(t => t.name === 'ask_user');
            expect(askTool).toBeDefined();

            const responsePromise = askTool!.handler({
                questions: [{
                    question: 'Pick a path',
                    type: 'select',
                    options: [{ value: 'a', label: 'Option A' }],
                    defaultValue: 'a',
                }],
            } as any);

            await vi.waitFor(() => {
                expect(store.processes.get(processId)?.pendingAskUser?.[0]).toMatchObject({
                    question: 'Pick a path',
                    type: 'select',
                    options: [{ value: 'a', label: 'Option A' }],
                    defaultValue: 'a',
                    turnIndex: 1,
                });
            });
            await vi.waitFor(() => {
                expect(executor.getAskUserHandles(processId)?.hasPending()).toBe(true);
            });

            const questionId = store.processes.get(processId)!.pendingAskUser![0].questionId;
            expect(executor.getAskUserHandles(processId)?.answerQuestion(questionId, 'a')).toBe(true);
            await expect(responsePromise).resolves.toMatchObject([{
                questionId,
                answer: 'a',
                skipped: false,
            }]);

            return { success: true, response: 'ok', sessionId: 'sess-1', toolCalls: [] };
        });

        await executor.execute(makeChatTask('plan', 'task-ask-user'), 'Hello');

        expect(store.processes.get(processId)?.pendingAskUser).toBeUndefined();
        expect(store.emitProcessEvent).toHaveBeenCalledWith(processId, {
            type: 'ask-user',
            askUser: expect.objectContaining({
                question: 'Pick a path',
                type: 'select',
            }),
        });
    });
});

// ============================================================================
// Built-in name collision regression
// ============================================================================

describe('ask_user built-in name collision regression', () => {
    it('assertNoAskUserConflict passes for CoC executor config (custom tool only)', () => {
        const tools = [{ name: 'ask_user', handler: async () => 'ok', overridesBuiltInTool: true }];
        expect(() => assertNoAskUserConflict({ tools })).not.toThrow();
    });

    it('assertNoAskUserConflict passes for native-only config (onUserInputRequest, no custom tool)', () => {
        const handler = async () => ({ answer: 'yes', wasFreeform: false });
        expect(() => assertNoAskUserConflict({ onUserInputRequest: handler })).not.toThrow();
    });

    it('assertNoAskUserConflict fails when both custom tool and native handler coexist', () => {
        const tools = [{ name: 'ask_user', handler: async () => 'ok', overridesBuiltInTool: true }];
        const handler = async () => ({ answer: 'yes', wasFreeform: false });
        expect(() => assertNoAskUserConflict({ tools, onUserInputRequest: handler })).toThrow(
            /Configuration conflict/,
        );
    });

    it('ChatExecutor (ask) injects ask_user tool when askUser.enabled is true', () => {
        // ask_user is enabled for ChatExecutor Ask semantics, including legacy plan payloads.
        const store = createMockProcessStore();
        const sdkM = createMockSDKService();
        sdkM.mockIsAvailable.mockResolvedValue({ available: true });
        let capturedTools: any[] | undefined;
        sdkM.mockSendMessage.mockImplementation(async (opts: any) => {
            capturedTools = opts.tools;
            return { success: true, response: 'ok', sessionId: 's1', toolCalls: [] };
        });

        const executor = new ChatExecutor(store, {
            aiService: sdkM.service as any,
            defaultTimeoutMs: 30_000,
            followUpSuggestions: { enabled: false, count: 3 },
            resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
            resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-id'),
            askUser: { enabled: true },
        } as any);

        return executor.execute(makeChatTask('ask'), 'Hello').then(() => {
            const askTool = capturedTools?.find((t: any) => t.name === 'ask_user');
            expect(askTool).toBeDefined();
            expect(askTool!.overridesBuiltInTool).toBe(true);
        });
    });
});
