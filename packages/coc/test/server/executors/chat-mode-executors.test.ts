/**
 * Chat Mode Executor Unit Tests
 *
 * Tests for ChatExecutor, AutopilotExecutor, and ClassificationExecutor.
 *
 * Verified for each executor:
 * - Happy path: AI SDK called with correct agentMode, systemMessage, returns result
 * - System message: ask gets READ_ONLY_SYSTEM_MESSAGE, autopilot gets no read-only directive
 * - Agent mode: ask → interactive, autopilot → autopilot
 * - AI unavailability throws with helpful message
 * - AI sendMessage failure (success: false) propagates as thrown error
 * - Streaming chunks are forwarded via store.emitProcessOutput
 * - Session cleanup + output persistence happens in finally (no leaks)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ModelInfo, QueuedTask } from '@plusplusoneplusplus/forge';
import { modelMetadataStore, READ_ONLY_SYSTEM_MESSAGE, setHomeDirectoryOverride, clearMcpConfigCache } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { ClassificationExecutor } from '../../../src/server/executors/classification-executor';
import { SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE } from '../../../src/server/executors/prompt-builder';
import { GLOBAL_SYSTEM_PROMPT_TAG } from '../../../src/server/executors/system-message-builder';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { RALPH_GRILL_MAX_ROUNDS } from '../../../src/server/ralph/grill-planning';

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
            mkdir: vi.fn().mockResolvedValue(undefined),
        },
    };
});

// Mock image-store to avoid temp-file side effects
vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return actual;
});

// Mock task-root-resolver to avoid real filesystem calls
const mockResolveTaskRoot = vi.fn().mockReturnValue({ absolutePath: '/tasks-root' });
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: (...args: any[]) => mockResolveTaskRoot(...args),
}));

// Mock output-file-manager to avoid disk writes
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

function makeChatTask(mode: 'ask' | 'autopilot', id = 'task-1'): QueuedTask {
    return {
        id,
        type: 'chat',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'chat',
            mode,
            prompt: 'Hello',
        },
        config: {},
        displayName: 'Hello',
    };
}

function makeClassificationTask(
    id = 'task-classify-1',
    payloadOverrides: Record<string, unknown> = {},
): QueuedTask {
    return {
        id,
        type: 'pr-classification',
        priority: 'normal',
        status: 'running',
        createdAt: Date.now(),
        payload: {
            kind: 'pr-classification',
            prompt: 'Classify PR #42',
            workspaceId: 'ws-1',
            repoId: 'repo-1',
            prId: '42',
            headSha: 'deadbeef',
            workingDirectory: '/fake/ws',
            skills: ['classify-diff'],
            ...payloadOverrides,
        },
        config: {},
        displayName: 'Classify PR #42',
    } as unknown as QueuedTask;
}

// ============================================================================
// Provider routing
// ============================================================================

describe('ChatBaseExecutor provider routing', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
    });

    it('uses the server default provider when payload.provider is omitted', async () => {
        const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
        const executor = new ChatExecutor(store, makeOptions(store, {
            provider: 'codex',
            resolveAiServiceForProvider,
        }));

        await executor.execute(makeChatTask('ask', 'task-default-provider'), 'Hello');

        expect(resolveAiServiceForProvider).toHaveBeenCalledWith('codex');
    });

    it('uses payload.provider over the server default provider when present', async () => {
        const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
        const executor = new ChatExecutor(store, makeOptions(store, {
            provider: 'codex',
            resolveAiServiceForProvider,
        }));
        const task = makeChatTask('ask', 'task-provider-override');
        task.payload = { ...(task.payload as any), provider: 'claude' } as any;

        await executor.execute(task, 'Hello');

        expect(resolveAiServiceForProvider).toHaveBeenCalledWith('claude');
    });

    it('passes CoC-built system messages with repo instructions to Claude-selected chats', async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-claude-system-'));
        try {
            const instructionDir = path.join(tmpRoot, '.github', 'coc');
            fs.mkdirSync(instructionDir, { recursive: true });
            fs.writeFileSync(path.join(instructionDir, 'instructions.md'), 'Base CoC repo instruction\n');
            fs.writeFileSync(path.join(instructionDir, 'instructions-ask.md'), 'Ask-only CoC repo instruction\n');

            const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
            const executor = new ChatExecutor(store, makeOptions(store, {
                provider: 'copilot',
                resolveAiServiceForProvider,
            }));
            const task = makeChatTask('ask', 'task-claude-system');
            task.payload = {
                ...(task.payload as any),
                provider: 'claude',
                workingDirectory: tmpRoot,
                workspaceId: 'ws-claude',
            } as any;

            await executor.execute(task, 'Hello Claude');

            expect(resolveAiServiceForProvider).toHaveBeenCalledWith('claude');
            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toBe('Hello Claude');
            expect(call.workingDirectory).toBe(tmpRoot);
            expect(call.systemMessage?.mode).toBe('append');
            expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
            expect(call.systemMessage?.content).toContain('Base CoC repo instruction');
            expect(call.systemMessage?.content).toContain('Ask-only CoC repo instruction');
            expect(call.systemMessage?.content).toContain('<chosen-folder>');
            expect(call.prompt).not.toContain('Base CoC repo instruction');
            expect(call.prompt).not.toContain('Ask-only CoC repo instruction');
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('drops cross-provider model before sending to Codex', async () => {
        const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
        const executor = new ChatExecutor(store, makeOptions(store, {
            provider: 'copilot',
            resolveAiServiceForProvider,
        }));
        const task = makeChatTask('ask', 'task-codex-model');
        task.config = { model: 'claude-opus-4.8' } as any;
        task.payload = { ...(task.payload as any), provider: 'codex', workspaceId: 'ws-abc' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call).not.toHaveProperty('model');
    });

    it.each(['copilot', 'claude'] as const)('adds source-location Markdown-link instructions for %s chats', async (provider) => {
        const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
        const executor = new ChatExecutor(store, makeOptions(store, {
            provider: 'codex',
            resolveAiServiceForProvider,
        }));
        const task = makeChatTask('ask', `task-source-link-${provider}`);
        task.payload = { ...(task.payload as any), provider } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
    });

    it('omits source-location Markdown-link instructions for Codex chats', async () => {
        const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
        const executor = new ChatExecutor(store, makeOptions(store, {
            provider: 'copilot',
            resolveAiServiceForProvider,
        }));
        const task = makeChatTask('ask', 'task-source-link-codex');
        task.payload = { ...(task.payload as any), provider: 'codex' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).not.toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
    });
});

// ============================================================================
// Shared behaviour — parameterised per executor
// ============================================================================

interface ExecutorFactory {
    label: string;
    expectedAgentMode: string;
    expectsSystemMessage: boolean;
    makeExecutor: (store: ReturnType<typeof createMockProcessStore>, overrides?: Partial<ChatModeExecutorOptions>) => { execute: (task: QueuedTask, prompt: string) => Promise<unknown> };
    makeTask: (id?: string) => QueuedTask;
}

const executors: ExecutorFactory[] = [
    {
        label: 'ChatExecutor (ask)',
        expectedAgentMode: 'interactive',
        expectsSystemMessage: true,
        makeExecutor: (store, overrides) => new ChatExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('ask', id),
    },
    {
        label: 'AutopilotExecutor (autopilot)',
        expectedAgentMode: 'autopilot',
        expectsSystemMessage: true,
        makeExecutor: (store, overrides) => new AutopilotExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('autopilot', id),
    },
];

for (const { label, expectedAgentMode, expectsSystemMessage, makeExecutor, makeTask } of executors) {
    describe(label, () => {
        let store: ReturnType<typeof createMockProcessStore>;

        beforeEach(() => {
            store = createMockProcessStore();
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({
                success: true,
                response: 'AI answer',
                sessionId: 'sess-1',
                toolCalls: [],
            });
        });

        it('calls aiService.sendMessage with the correct agentMode', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(sdkMocks.mockSendMessage).toHaveBeenCalledOnce();
            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.mode).toBe(expectedAgentMode);
        });

        it('passes infiniteSessions enabled to sendMessage', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.infiniteSessions).toEqual({ enabled: true });
        });

        it('opts into warm-client keep-alive (keepWarm: true)', async () => {
            // Interactive chat-process turns (ask, autopilot) request keepWarm so
            // the SDK service retains the provider client for this process's next
            // turn.
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.keepWarm).toBe(true);
            expect(call.warmKey).toBe(`queue_${task.id}`);
        });

        it(`${expectsSystemMessage ? 'includes' : 'omits'} system message`, async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            if (expectsSystemMessage) {
                expect(call.systemMessage).toBeDefined();
                if (expectedAgentMode === 'interactive') {
                    expect(call.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
                } else {
                    expect(call.systemMessage.content).not.toContain(READ_ONLY_SYSTEM_MESSAGE);
                    expect(call.systemMessage.content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
                }
            } else {
                expect(call.systemMessage).toBeUndefined();
            }
        });

        it('returns response, sessionId, toolCalls, timeline, pendingSuggestions', async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            const result = await executor.execute(task, 'Hello') as any;

            expect(result.response).toBe('AI answer');
            expect(result.sessionId).toBe('sess-1');
            expect(Array.isArray(result.timeline)).toBe(true);
            // pendingSuggestions is undefined when no suggestions tool fires
        });

        it('throws when AI SDK is unavailable', async () => {
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: false, error: 'no token' });

            const executor = makeExecutor(store);
            const task = makeTask();

            await expect(executor.execute(task, 'Hello')).rejects.toThrow('Copilot SDK not available');
        });

        it('throws when sendMessage returns success: false', async () => {
            sdkMocks.mockSendMessage.mockResolvedValue({ success: false, error: 'rate limit' });

            const executor = makeExecutor(store);
            const task = makeTask();

            await expect(executor.execute(task, 'Hello')).rejects.toThrow('rate limit');
        });

        it('forwards streaming chunks via store.emitProcessOutput', async () => {
            sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onStreamingChunk('chunk-a');
                opts.onStreamingChunk('chunk-b');
                return { success: true, response: 'done', sessionId: 's1', toolCalls: [] };
            });

            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(store.emitProcessOutput).toHaveBeenCalledWith(
                `queue_${task.id}`,
                'chunk-a',
            );
            expect(store.emitProcessOutput).toHaveBeenCalledWith(
                `queue_${task.id}`,
                'chunk-b',
            );
        });

        it('stores sdkSessionId via onSessionCreated', async () => {
            // Make the mock call onSessionCreated (as the real SDK does when creating a session)
            sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
                opts.onSessionCreated?.('sess-1');
                return { success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] };
            });

            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            expect(store.updateProcess).toHaveBeenCalledWith(
                `queue_${task.id}`,
                expect.objectContaining({ sdkSessionId: 'sess-1' }),
            );
        });
    });
}

// ============================================================================
// Mode-specific system message content tests
// ============================================================================

describe('ChatExecutor system message content', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('injects auto-folder block when task has workingDirectory', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-wd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'ask', prompt: 'Hi', workingDirectory: '/fake/ws' },
            config: {},
            displayName: 'Hi',
        };

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
        expect(call.systemMessage?.content).toContain('<chosen-folder>');
    });

    it('does NOT inject auto-folder block when task has no workingDirectory', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-no-wd');

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
        expect(call.systemMessage?.content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
        expect(call.systemMessage?.content).not.toContain('<chosen-folder>');
    });

    it('injects note-file permission block when payload has noteChat.notePath', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-note',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hi',
                context: { noteChat: { notePath: 'notes/design.md' } },
            },
            config: {},
            displayName: 'Hi',
        };

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain('notes/design.md');
        expect(call.systemMessage?.content).toContain('You may also edit the attached note file');
    });

    it('does NOT inject note-file block when noteChat is absent', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-no-note');

        await executor.execute(task, 'Hi');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content ?? '').not.toContain('You may also edit the attached note file');
    });
});

describe('ChatExecutor legacy plan-mode system message content', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('injects note-file permission block when a legacy plan payload has noteChat.notePath', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-plan-note',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'plan',
                prompt: 'Plan it',
                context: { noteChat: { notePath: 'notes/spec.md' } },
            },
            config: {},
            displayName: 'Plan it',
        };

        await executor.execute(task, 'Plan it');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain('notes/spec.md');
        expect(call.systemMessage?.content).toContain('You may also edit the attached note file');
    });
});

// ============================================================================
// ChatExecutor injects ask_user tool when enabled
// ============================================================================

describe('ChatExecutor ask_user enabled', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('includes ask_user tool when askUser option is enabled', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeChatTask('ask', 'task-no-ask');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('ask_user');
    });

    it('routes ask_user tool guidance into systemMessage (not user prompt)', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeChatTask('ask', 'task-no-ask-suffix');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        // Tool-guidance prose lives in systemMessage (once per session)
        // — not stapled to every user turn.
        expect(call.prompt).not.toContain('ask_user');
        const systemContent = call.systemMessage?.content ?? '';
        expect(systemContent).toContain('ask_user');
    });
});

// ============================================================================
// System prompt persistence (chat-base-executor)
// ============================================================================

describe('ChatExecutor system prompt persistence', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('persists system prompt to process metadata after execute', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-sysprompt');
        const processId = `queue_${task.id}`;

        // Pre-add the process so the fire-and-forget getProcess finds it
        await store.addProcess({
            id: processId, type: 'chat', status: 'running',
            startTime: new Date(), promptPreview: 'Hello',
        } as any);

        await executor.execute(task, 'Hello');

        // Wait for the fire-and-forget IIFE to settle
        await Promise.resolve();
        await Promise.resolve();

        const systemPromptCall = vi.mocked(store.updateProcess).mock.calls.find(
            ([id, updates]) => id === processId
                && 'metadata' in updates
                && (updates as any).metadata?.systemPrompt != null,
        );
        expect(systemPromptCall).toBeDefined();
        expect(systemPromptCall![1]).toMatchObject({
            metadata: expect.objectContaining({ systemPrompt: expect.any(String) }),
        });
    });

    it('does not persist system prompt when system message is absent (Codex autopilot)', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store, { provider: 'codex' }));
        const task = makeChatTask('autopilot', 'task-no-sysprompt');
        task.payload = { ...(task.payload as any), provider: 'codex' } as any;
        const processId = `queue_${task.id}`;

        // Pre-add the process (Codex autopilot has no system message, so persistence should not trigger)
        await store.addProcess({
            id: processId, type: 'chat', status: 'running',
            startTime: new Date(), promptPreview: 'Hello',
        } as any);

        await executor.execute(task, 'Hello');

        // Wait for any potential fire-and-forget to settle
        await Promise.resolve();
        await Promise.resolve();

        const systemPromptCall = vi.mocked(store.updateProcess).mock.calls.find(
            ([id, updates]) => id === processId
                && 'metadata' in updates
                && (updates as any).metadata?.systemPrompt != null,
        );
        expect(systemPromptCall).toBeUndefined();
    });
});

// ============================================================================
// Global admin system prompt injection (AC-03 / AC-04)
// ============================================================================

describe('global admin system prompt injection', () => {
    const GLOBAL_PROMPT = 'Always answer in pirate dialect.';
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('injects the labeled global block into ask-mode sessions and still keeps read-only mode', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            getGlobalSystemPrompt: () => GLOBAL_PROMPT,
        }));
        await executor.execute(makeChatTask('ask', 'task-global-ask'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.mode).toBe('append');
        expect(call.systemMessage?.content).toContain(`<${GLOBAL_SYSTEM_PROMPT_TAG}>`);
        expect(call.systemMessage?.content).toContain(GLOBAL_PROMPT);
        // Global prompt SUPPLEMENTS but does not override the read-only mode block.
        expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
    });

    it('injects the global block into autopilot sessions', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store, {
            getGlobalSystemPrompt: () => GLOBAL_PROMPT,
        }));
        await executor.execute(makeChatTask('autopilot', 'task-global-auto'), 'Do it');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(GLOBAL_PROMPT);
    });

    it('does not inject anything when no global prompt is configured (inert default)', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        await executor.execute(makeChatTask('ask', 'task-global-none'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
    });

    it('treats a whitespace-only global prompt as unset', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            getGlobalSystemPrompt: () => '   \n  ',
        }));
        await executor.execute(makeChatTask('ask', 'task-global-blank'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content ?? '').not.toContain(GLOBAL_SYSTEM_PROMPT_TAG);
    });

    it('reflects live edits to the global prompt between turns (no restart)', async () => {
        let current: string | undefined = 'First instruction.';
        const executor = new ChatExecutor(store, makeOptions(store, {
            getGlobalSystemPrompt: () => current,
        }));

        await executor.execute(makeChatTask('ask', 'task-global-live-1'), 'Hello');
        expect(sdkMocks.mockSendMessage.mock.calls[0][0].systemMessage?.content).toContain('First instruction.');

        current = 'Second instruction.';
        await executor.execute(makeChatTask('ask', 'task-global-live-2'), 'Hello again');
        const secondCall = sdkMocks.mockSendMessage.mock.calls[1][0];
        expect(secondCall.systemMessage?.content).toContain('Second instruction.');
        expect(secondCall.systemMessage?.content).not.toContain('First instruction.');
    });

    it('persists the global block in process metadata systemPrompt', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            getGlobalSystemPrompt: () => GLOBAL_PROMPT,
        }));
        const task = makeChatTask('ask', 'task-global-persist');
        const processId = `queue_${task.id}`;
        await store.addProcess({
            id: processId, type: 'chat', status: 'running',
            startTime: new Date(), promptPreview: 'Hello',
        } as any);

        await executor.execute(task, 'Hello');
        await Promise.resolve();
        await Promise.resolve();

        const persistCall = vi.mocked(store.updateProcess).mock.calls.find(
            ([id, updates]) => id === processId && (updates as any).metadata?.systemPrompt != null,
        );
        expect(persistCall).toBeDefined();
        expect((persistCall![1] as any).metadata.systemPrompt).toContain(GLOBAL_PROMPT);
    });

    it.each(['copilot', 'codex', 'claude'] as const)(
        'reaches provider-level systemMessage for %s-routed sessions (provider parity)',
        async (provider) => {
            const resolveAiServiceForProvider = vi.fn().mockReturnValue(sdkMocks.service as any);
            const executor = new ChatExecutor(store, makeOptions(store, {
                provider: 'copilot',
                getGlobalSystemPrompt: () => GLOBAL_PROMPT,
                resolveAiServiceForProvider,
            }));
            const task = makeChatTask('ask', `task-global-${provider}`);
            task.payload = { ...(task.payload as any), provider } as any;

            await executor.execute(task, 'Hello');

            expect(resolveAiServiceForProvider).toHaveBeenCalledWith(provider);
            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.systemMessage?.content).toContain(GLOBAL_PROMPT);
        },
    );
});

describe('AutopilotExecutor system message', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('passes source-location instructions without read-only mode for Copilot', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-auto-wd',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'Do it', workingDirectory: '/fake/ws' },
            config: {},
            displayName: 'Do it',
        };

        await executor.execute(task, 'Do it');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.systemMessage?.content).toContain(SOURCE_LOCATION_MARKDOWN_LINK_SYSTEM_MESSAGE);
        expect(call.systemMessage?.content).not.toContain(READ_ONLY_SYSTEM_MESSAGE);
    });
});

describe('ClassificationExecutor ask-mode behavior', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });
    });

    it('runs classification in interactive ask mode with read-only system instructions', async () => {
        const executor = new ClassificationExecutor(store, makeOptions(store));
        const task = makeClassificationTask('task-classify-ask-mode');

        await executor.execute(task, 'Classify PR #42');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.mode).toBe('interactive');
        expect(call.systemMessage?.mode).toBe('append');
        expect(call.systemMessage?.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
    });

    it('stays cold (no keepWarm) — a one-shot background job must not retain the client', async () => {
        const executor = new ClassificationExecutor(store, makeOptions(store));
        const task = makeClassificationTask('task-classify-cold');

        await executor.execute(task, 'Classify PR #42');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.keepWarm).toBeUndefined();
        expect(call.warmKey).toBeUndefined();
    });

    it('loads ask repo instructions instead of autopilot repo instructions', async () => {
        const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-classify-ask-instructions-'));
        try {
            const instructionDir = path.join(tmpRoot, '.github', 'coc');
            fs.mkdirSync(instructionDir, { recursive: true });
            fs.writeFileSync(path.join(instructionDir, 'instructions.md'), 'Base classification instruction\n');
            fs.writeFileSync(path.join(instructionDir, 'instructions-ask.md'), 'Ask classification instruction\n');
            fs.writeFileSync(path.join(instructionDir, 'instructions-autopilot.md'), 'Autopilot classification instruction\n');

            const executor = new ClassificationExecutor(store, makeOptions(store));
            const task = makeClassificationTask('task-classify-ask-instructions', {
                workingDirectory: tmpRoot,
            });

            await executor.execute(task, 'Classify PR #42');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const content = call.systemMessage?.content ?? '';
            expect(content).toContain('Base classification instruction');
            expect(content).toContain('Ask classification instruction');
            expect(content).not.toContain('Autopilot classification instruction');
        } finally {
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        }
    });

    it('keeps saveClassification available when running in ask mode', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-classify-save-tool-'));
        try {
            const executor = new ClassificationExecutor(store, makeOptions(store), dataDir);
            const task = makeClassificationTask('task-classify-save-tool');

            await executor.execute(task, 'Classify PR #42');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(call.mode).toBe('interactive');
            expect(toolNames).toContain('saveClassification');
            expect(call.systemMessage?.content).toContain('saveClassification');
        } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Ralph grilling phase — ask_user clarification protocol
// ============================================================================

describe('ChatExecutor ralph grilling phase', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    function makeGrillingTask(id = 'task-grill'): QueuedTask {
        return {
            id,
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Grill me on this idea',
                context: { ralph: { phase: 'grilling' } },
            } as any,
            config: {},
            displayName: 'Grill me',
        };
    }

    it('prepends the grilling skill pointer to the user prompt (not system message)', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeGrillingTask();

        await executor.execute(task, 'Grill me on this idea');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = call.systemMessage?.content ?? '';
        const userPrompt = call.prompt ?? '';
        // System message must NOT contain Ralph/grilling content (AC-03)
        expect(systemContent).not.toContain('ultra-ralph');
        expect(systemContent).not.toContain('`grill` section');
        expect(systemContent).not.toContain('## Goal');
        // User prompt MUST contain the grill skill pointer and machine contract (AC-03)
        expect(userPrompt).toContain('ultra-ralph');
        expect(userPrompt).toContain('`grill` section');
        expect(userPrompt).toContain('## Goal');
    });

    it('exposes the ask_user tool to grilling tasks when askUser is enabled', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeGrillingTask('task-grill-tools');

        await executor.execute(task, 'Grill me');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('ask_user');
    });

    it('precomputes a multi-agent question plan before the consolidated grilling turn', async () => {
        sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
            if (options.systemMessage?.content?.includes('one specialized Ralph grill agent')) {
                const role = /Agent role: (.+)/.exec(options.prompt)?.[1] ?? 'Unknown Agent';
                return {
                    success: true,
                    response: JSON.stringify({
                        questions: [{
                            question: `Question from ${role}`,
                            type: 'text',
                        }],
                    }),
                    sessionId: `agent-${role}`,
                };
            }
            return { success: true, response: 'ok', sessionId: 'main-session' };
        });
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
            ralphMultiAgentGrillEnabled: true,
        } as any));
        const task = makeGrillingTask('task-grill-agent-plan');
        task.payload = {
            ...(task.payload as any),
            provider: 'copilot',
            context: {
                ralph: {
                    phase: 'grilling',
                    grill: {
                        enabled: true,
                        depth: 'light',
                        agents: [
                            { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                            { role: 'ux', provider: 'copilot', model: 'gpt-5.5' },
                            { role: 'architecture-system', provider: 'copilot', model: 'gpt-5.5' },
                        ],
                    },
                },
            },
        } as any;

        await executor.execute(task, 'Grill me on this idea');

        expect(sdkMocks.mockSendMessage).toHaveBeenCalledTimes(4);
        const planningEvents = vi.mocked(store.emitProcessEvent).mock.calls
            .filter(([, event]) => (event as any).type === 'ralph-grill-planning');
        expect(planningEvents).toHaveLength(2);
        expect((planningEvents[0][1] as any).ralphGrillPlanning).toMatchObject({
            status: 'running',
            depth: 'light',
            round: 1,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            agentCount: 3,
            agents: [
                expect.objectContaining({ role: 'product', status: 'running', provenanceLabel: 'Product Agent · copilot/gpt-5.5' }),
                expect.objectContaining({ role: 'ux', status: 'running', provenanceLabel: 'UX Agent · copilot/gpt-5.5' }),
                expect.objectContaining({ role: 'architecture-system', status: 'running', provenanceLabel: 'Architecture/System Agent · copilot/gpt-5.5' }),
            ],
        });
        expect((planningEvents[1][1] as any).ralphGrillPlanning).toMatchObject({
            status: 'completed',
            depth: 'light',
            round: 1,
            maxRounds: RALPH_GRILL_MAX_ROUNDS,
            agents: [
                expect.objectContaining({ role: 'product', status: 'completed', candidateCount: 1 }),
                expect.objectContaining({ role: 'ux', status: 'completed', candidateCount: 1 }),
                expect.objectContaining({ role: 'architecture-system', status: 'completed', candidateCount: 1 }),
            ],
        });
        expect(vi.mocked(store.emitProcessEvent).mock.invocationCallOrder[0])
            .toBeLessThan(sdkMocks.mockSendMessage.mock.invocationCallOrder[0]);
        const agentCalls = sdkMocks.mockSendMessage.mock.calls.slice(0, 3).map(call => call[0]);
        expect(agentCalls.map(call => call.prompt)).toEqual([
            expect.stringContaining('Agent role: Product Agent'),
            expect.stringContaining('Agent role: UX Agent'),
            expect.stringContaining('Agent role: Architecture/System Agent'),
        ]);
        expect(agentCalls.every(call => call.loadDefaultMcpConfig === false)).toBe(true);

        const mainCall = sdkMocks.mockSendMessage.mock.calls[3][0];
        expect(mainCall.prompt).toContain('Multi-agent grilling is enabled');
        expect(mainCall.prompt).toContain('Actual grill-agent planning result');
        expect(mainCall.prompt).toContain('CoC already invoked the separate grill agents');
        expect(mainCall.prompt).toContain('[Product Agent · copilot/gpt-5.5] (text) Question from Product Agent');
        expect(mainCall.prompt).toContain('[UX Agent · copilot/gpt-5.5] (text) Question from UX Agent');
        expect(mainCall.prompt).toContain('Final goal coverage summary requirement');
        expect(mainCall.prompt).toContain('`## Agent Coverage Summary`');
        expect(mainCall.prompt).toContain('[decision] Depth: light');
        expect(mainCall.prompt).toContain(`[decision] Rounds run: 1 of up to ${RALPH_GRILL_MAX_ROUNDS}`);
        expect(mainCall.prompt).toContain('[decision] Provider/tier or provider/model used per agent:');
        expect(mainCall.prompt).toContain('[decision] Dedupe/conflict outcomes: raw 3 -> selected 3');
        expect(mainCall.prompt).toContain('[decision] Warnings / reduced coverage: none');
        expect((mainCall.tools ?? []).map((tool: any) => tool.name)).toContain('ask_user');
    });

    it('enriches the consolidated ask_user batch with Ralph grill provenance metadata', async () => {
        const task = makeGrillingTask('task-grill-agent-ask');
        const processId = `queue_${task.id}`;
        store.processes.set(processId, {
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'Grill me',
            fullPrompt: 'Grill me',
        });
        task.payload = {
            ...(task.payload as any),
            provider: 'copilot',
            context: {
                ralph: {
                    phase: 'grilling',
                    grill: {
                        enabled: true,
                        depth: 'light',
                        agents: [
                            { role: 'product', provider: 'copilot', model: 'gpt-5.5' },
                            { role: 'ux', provider: 'copilot', model: 'gpt-5.5' },
                            { role: 'architecture-system', provider: 'copilot', model: 'gpt-5.5' },
                        ],
                    },
                },
            },
        } as any;

        sdkMocks.mockSendMessage.mockImplementation(async (options: any) => {
            if (options.systemMessage?.content?.includes('one specialized Ralph grill agent')) {
                const role = /Agent role: (.+)/.exec(options.prompt)?.[1] ?? 'Unknown Agent';
                return {
                    success: true,
                    response: JSON.stringify({
                        questions: [{
                            question: `Question from ${role}`,
                            type: 'text',
                        }],
                    }),
                    sessionId: `agent-${role}`,
                };
            }

            const askTool = options.tools?.find((tool: any) => tool.name === 'ask_user');
            expect(askTool).toBeDefined();
            const responsePromise = askTool.handler({
                questions: [{
                    question: 'Question from Product Agent',
                    type: 'text',
                }],
            });
            await vi.waitFor(() => {
                const pendingQuestion = store.processes.get(processId)?.pendingAskUser?.[0];
                expect(pendingQuestion).toMatchObject({
                    question: 'Question from Product Agent',
                    ralphGrill: {
                        planning: {
                            depth: 'light',
                            consolidation: {
                                rawCandidateCount: 3,
                                selectedQuestionCount: 3,
                            },
                        },
                        sources: [expect.objectContaining({
                            role: 'product',
                            provenanceLabel: 'Product Agent · copilot/gpt-5.5',
                        })],
                    },
                });
            });
            const questionId = store.processes.get(processId)!.pendingAskUser![0].questionId;
            expect(executor.getAskUserHandles(processId)?.answerQuestion(questionId, 'answer')).toBe(true);
            await expect(responsePromise).resolves.toMatchObject([{
                questionId,
                answer: 'answer',
                skipped: false,
            }]);
            return { success: true, response: 'ok', sessionId: 'main-session' };
        });

        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
            ralphMultiAgentGrillEnabled: true,
        } as any));

        await executor.execute(task, 'Grill me on this idea');
    });

    it('does NOT add the grilling directive to a non-grilling ask task', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeChatTask('ask', 'task-not-grill');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = call.systemMessage?.content ?? '';
        const userPrompt = call.prompt ?? '';
        expect(systemContent).not.toContain('ultra-ralph');
        expect(systemContent).not.toContain('## Goal');
        expect(userPrompt).not.toContain('ultra-ralph');
        expect(userPrompt).not.toContain('## Goal');
    });

    it('injects the goal-file save location (notes/Plans, *.goal.md) into the user prompt — not the system message', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeGrillingTask('task-grill-goalfile');
        // A working directory is required for the auto-folder context to resolve.
        task.payload = {
            ...(task.payload as any),
            workspaceId: 'ws-id',
            workingDirectory: '/repo/work',
        } as any;

        await executor.execute(task, 'Grill me on this idea');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = call.systemMessage?.content ?? '';
        const userPrompt = call.prompt ?? '';

        // The goal-file directive must live in the user message, pointing at the
        // repo's notes/Plans root with a *.goal.md filename so the Notes/scratchpad
        // UI can open and edit it — and must NOT write into the repo working tree.
        expect(userPrompt).toContain('repos/ws-id/notes/Plans');
        expect(userPrompt).toContain('.goal.md');
        expect(userPrompt).toContain('repository working tree');
        // The goal-file directive must never leak into the system message.
        // (READ_ONLY_SYSTEM_MESSAGE legitimately mentions .goal.md, so assert on
        // phrasing unique to the injected directive instead.)
        expect(systemContent).not.toContain('repository working tree');
        // The generic auto-folder block (which advertises .plan.md) must be
        // suppressed during grilling so the model gets no contradictory target.
        expect(systemContent).not.toContain('.plan.md');
        expect(systemContent).not.toContain('Save location');
    });
});

// ============================================================================
// Skill injection tests (context.skills)
// ============================================================================

describe('ChatBaseExecutor selected skills', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
    });

    it('prepends a selected-skills directive without inlining skill bodies', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: '<commit>abc123</commit>',
                workingDirectory: '/fake/ws',
                context: { skills: ['go-deep'] },
            },
            config: {},
            displayName: 'skill test',
        };

        await executor.execute(task, '<commit>abc123</commit>');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('<selected_skills>');
        expect(call.prompt).toContain('The user explicitly selected these skills: go-deep.');
        expect(call.prompt).toContain('<commit>abc123</commit>');
        expect(call.prompt.indexOf('<selected_skills>')).toBeLessThan(call.prompt.indexOf('<commit>'));
        expect(call.prompt).not.toContain('<skill name=');
    });

    it('adds resolved SKILL.md paths for selected skills when directories are available', async () => {
        const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-selected-skills-'));
        try {
            fs.mkdirSync(path.join(skillsDir, 'impl'), { recursive: true });
            fs.writeFileSync(path.join(skillsDir, 'impl', 'SKILL.md'), '# Impl skill');
            const executor = new ChatExecutor(store, makeOptions(store, {
                resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: [skillsDir], disabledSkills: undefined }),
            }));
            const task: QueuedTask = {
                id: 'task-skill-path',
                type: 'chat',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'chat',
                    mode: 'ask',
                    prompt: 'Do work',
                    workingDirectory: '/fake/ws',
                    context: { skills: ['impl'] },
                },
                config: {},
                displayName: 'skill path test',
            };

            await executor.execute(task, 'Do work');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toContain(`- impl: ${path.join(skillsDir, 'impl', 'SKILL.md')}`);
        } finally {
            fs.rmSync(skillsDir, { recursive: true, force: true });
        }
    });

    it('preserves explicit user intent even when a selected skill might not exist locally', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-unknown-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello',
                workingDirectory: '/fake/ws',
                context: { skills: ['unknown-skill'] },
            },
            config: {},
            displayName: 'unknown skill test',
        };

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('unknown-skill');
        expect(call.prompt).toContain('<selected_skills>');
        expect(call.prompt).not.toContain('<skill name=');
    });

    it('does not alter prompt when context.skills is undefined', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task = makeChatTask('ask', 'task-no-skills');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).not.toContain('<selected_skills>');
    });

    it('deduplicates multiple selected skills while preserving the directive', async () => {
        const executor = new ChatExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-multi-skill',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'test prompt',
                workingDirectory: '/fake/ws',
                context: { skills: ['skill-a', 'skill-a', 'skill-b'] },
            },
            config: {},
            displayName: 'multi skill test',
        };

        await executor.execute(task, 'test prompt');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('The user explicitly selected these skills: skill-a, skill-b.');
        expect(call.prompt).not.toContain('<skill name=');
    });

    it('reads top-level skills from pr-classification payloads', async () => {
        const executor = new ClassificationExecutor(store, makeOptions(store));
        const task: QueuedTask = {
            id: 'task-classify-skill',
            type: 'pr-classification',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'pr-classification',
                prompt: 'Classify PR #42',
                workspaceId: 'ws-1',
                repoId: 'repo-1',
                prId: '42',
                headSha: 'deadbeef',
                workingDirectory: '/fake/ws',
                skills: ['classify-diff'],
            },
            config: {},
            displayName: 'classification skill test',
        } as unknown as QueuedTask;

        await executor.execute(task, 'Classify PR #42');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.prompt).toContain('<selected_skills>');
        expect(call.prompt).toContain('The user explicitly selected these skills: classify-diff.');
        expect(call.prompt).toContain('Classify PR #42');
        expect(call.prompt.indexOf('<selected_skills>')).toBeLessThan(call.prompt.indexOf('Classify PR #42'));
        expect(call.mode).toBe('interactive');
    });

    it('adds resolved SKILL.md paths for top-level classification skills', async () => {
        const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-classify-skill-'));
        try {
            fs.mkdirSync(path.join(skillsDir, 'classify-diff'), { recursive: true });
            fs.writeFileSync(path.join(skillsDir, 'classify-diff', 'SKILL.md'), '# Classify diff');
            const executor = new ClassificationExecutor(store, makeOptions(store, {
                resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: [skillsDir], disabledSkills: undefined }),
            }));
            const task: QueuedTask = {
                id: 'task-classify-skill-path',
                type: 'pr-classification',
                priority: 'normal',
                status: 'running',
                createdAt: Date.now(),
                payload: {
                    kind: 'pr-classification',
                    prompt: 'Classify commit abc123',
                    workspaceId: 'ws-1',
                    repoId: 'repo-1',
                    prId: '42',
                    headSha: 'deadbeef',
                    workingDirectory: '/fake/ws',
                    skills: ['classify-diff'],
                },
                config: {},
                displayName: 'classification skill path test',
            } as unknown as QueuedTask;

            await executor.execute(task, 'Classify commit abc123');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            expect(call.prompt).toContain(`- classify-diff: ${path.join(skillsDir, 'classify-diff', 'SKILL.md')}`);
        } finally {
            fs.rmSync(skillsDir, { recursive: true, force: true });
        }
    });
});

// ============================================================================
// Live chat executors include the unified create_update_work_item tool
// ============================================================================

describe('create_update_work_item tool wiring', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let dataDir: string;

    function writeLayoutMode(uiLayoutMode: 'classic' | 'dev-workflow') {
        fs.writeFileSync(
            path.join(dataDir, 'preferences.json'),
            JSON.stringify({ global: { uiLayoutMode } }),
        );
    }

    beforeEach(() => {
        store = createMockProcessStore();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-tool-wiring-'));
        fs.mkdirSync(path.join(dataDir, 'repos', 'ws-123'), { recursive: true });
        writeLayoutMode('dev-workflow');
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    function makeTaskWithWorkspace(mode: 'ask' | 'plan' | 'autopilot', id: string): QueuedTask {
        return {
            id,
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode,
                prompt: 'Hello',
                workspaceId: 'ws-123',
            },
            config: {},
            displayName: 'Hello',
        };
    }

    it('ChatExecutor includes create_update_work_item and not create_bug', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), dataDir);
        const task = makeTaskWithWorkspace('ask', 'task-wi-ask');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('get_work_item');
        expect(toolNames).toContain('create_update_work_item');
        expect(toolNames).not.toContain('create_work_item');
        expect(toolNames).not.toContain('update_work_item');
        expect(toolNames).not.toContain('create_bug');
    });

    it('AutopilotExecutor includes create_update_work_item and not create_bug', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);
        const task = makeTaskWithWorkspace('autopilot', 'task-wi-auto');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('get_work_item');
        expect(toolNames).toContain('create_update_work_item');
        expect(toolNames).not.toContain('create_work_item');
        expect(toolNames).not.toContain('update_work_item');
        expect(toolNames).not.toContain('create_bug');
    });

    it('all live initial executors include create_update_work_item and not create_bug', async () => {
        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'sfx-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'sfx-auto' },
        ]) {
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });

            const executor = new Ctor(store, makeOptions(store), dataDir);
            const task = makeTaskWithWorkspace(mode, id);

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(toolNames).toContain('get_work_item');
            expect(toolNames).toContain('create_update_work_item');
            expect(toolNames).not.toContain('create_work_item');
            expect(toolNames).not.toContain('update_work_item');
            expect(toolNames).not.toContain('create_bug');
        }
    });

    it('all live initial executors include tavily_web_search when explicitly enabled', async () => {
        writeRepoPreferences(dataDir, 'ws-123', { disabledLlmTools: [] });

        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'tavily-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'tavily-auto' },
        ]) {
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });

            const executor = new Ctor(store, makeOptions(store), dataDir);
            const task = makeTaskWithWorkspace(mode, id);

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(toolNames).toContain('tavily_web_search');
            const systemContent = call.systemMessage?.content ?? '';
            expect(systemContent).toContain('tavily_web_search');
        }
    });

    it('classic mode disables create_update_work_item by default', async () => {
        writeLayoutMode('classic');

        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'classic-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'classic-auto' },
        ]) {
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });

            const executor = new Ctor(store, makeOptions(store), dataDir);
            const task = makeTaskWithWorkspace(mode, id);

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(toolNames).not.toContain('get_work_item');
            expect(toolNames).not.toContain('create_update_work_item');
            expect(toolNames).not.toContain('create_work_item');
            expect(toolNames).not.toContain('update_work_item');
            expect(toolNames).not.toContain('create_bug');
            expect(call.prompt).not.toContain('create-work-item');
            expect(call.prompt).not.toContain('create-bug');
        }
    });
});

// ============================================================================
// Legacy plan auto-folder: notes/Plans/ path
// ============================================================================

describe('ChatExecutor legacy plan auto-folder path (notes/Plans)', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    const DATA_DIR = '/tmp/test-coc';

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'ok',
            sessionId: 's1',
            toolCalls: [],
        });
        vi.mocked(fs.promises.mkdir).mockClear().mockResolvedValue(undefined);
        vi.mocked(fs.promises.readdir).mockClear().mockResolvedValue([]);
    });

    function makePlanTaskWithWorkdir(id: string): QueuedTask {
        return {
            id,
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'plan',
                prompt: 'Plan something',
                workingDirectory: '/fake/repo',
                workspaceId: 'ws-plan-test',
            },
            config: {},
            displayName: 'Plan something',
        };
    }

    it('system message contains notes/Plans path for legacy plan mode', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), DATA_DIR);
        const task = makePlanTaskWithWorkdir('plan-path-test');

        await executor.execute(task, 'Plan something');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const sysContent: string = call.systemMessage?.content ?? '';
        expect(sysContent).toContain('notes');
        expect(sysContent).toContain('Plans');
        expect(sysContent).not.toContain('/tasks/');
    });

    it('creates notes/Plans directory via mkdir during legacy plan mode', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), DATA_DIR);
        const task = makePlanTaskWithWorkdir('plan-mkdir-test');

        await executor.execute(task, 'Plan something');

        const expectedPath = path.join(DATA_DIR, 'repos', 'ws-plan-test', 'notes', 'Plans');
        expect(vi.mocked(fs.promises.mkdir)).toHaveBeenCalledWith(
            expectedPath,
            { recursive: true },
        );
    });

    it('ChatExecutor also uses notes/Plans for ask mode', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), DATA_DIR);
        const task: QueuedTask = {
            id: 'chat-tasks-root',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Hello',
                workingDirectory: '/fake/repo',
                workspaceId: 'ws-chat-test',
            },
            config: {},
            displayName: 'Hello',
        };

        await executor.execute(task, 'Hello');

        // mkdir SHOULD be called — ask mode targets notes/Plans
        const expectedPath = path.join(DATA_DIR, 'repos', 'ws-chat-test', 'notes', 'Plans');
        expect(vi.mocked(fs.promises.mkdir)).toHaveBeenCalledWith(
            expectedPath,
            { recursive: true },
        );
        // notes/Plans path should appear in system message
        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const sysContent: string = call.systemMessage?.content ?? '';
        expect(sysContent).toContain('notes');
        expect(sysContent).toContain('Plans');
    });
});

// ============================================================================
// Copilot long-context tier
// ============================================================================

describe('ChatBaseExecutor contextTier', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    function makeCatalogModel(id: string, billing?: unknown): ModelInfo {
        return {
            id,
            name: id,
            capabilities: {
                supports: { vision: false, reasoningEffort: false },
                limits: { max_context_window_tokens: 128_000 },
            },
            ...(billing !== undefined ? { billing: billing as ModelInfo['billing'] } : {}),
        };
    }

    const longContextModel = makeCatalogModel('gpt-5-long-ctx', { tokenPrices: { longContext: { contextMax: 1_000_000 } } });
    const standardModel = makeCatalogModel('gpt-5-standard', { multiplier: 1 });

    beforeEach(async () => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'AI answer',
            sessionId: 'sess-1',
            toolCalls: [],
        });
        await modelMetadataStore.initialize({ listModels: async () => [longContextModel, standardModel] });
    });

    afterEach(async () => {
        // Clear the singleton cache so other suites are unaffected.
        await modelMetadataStore.initialize({ listModels: async () => [] });
    });

    function makeExecutorForProvider(provider: 'copilot' | 'codex' | 'claude') {
        return new ChatExecutor(store, makeOptions(store, {
            provider,
            resolveAiServiceForProvider: vi.fn().mockReturnValue(sdkMocks.service as any),
        }));
    }

    it('passes contextTier "long_context" for a Copilot model with long-context metadata', async () => {
        const executor = makeExecutorForProvider('copilot');
        const task = makeChatTask('ask', 'task-ctx-long');
        task.config = { model: 'gpt-5-long-ctx' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call.contextTier).toBe('long_context');
    });

    it('omits contextTier for a Copilot model without long-context metadata', async () => {
        const executor = makeExecutorForProvider('copilot');
        const task = makeChatTask('ask', 'task-ctx-standard');
        task.config = { model: 'gpt-5-standard' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call).not.toHaveProperty('contextTier');
    });

    it('omits contextTier for Codex even when the catalog model has long-context metadata', async () => {
        sdkMocks.mockListModels.mockResolvedValue([longContextModel]);
        const executor = makeExecutorForProvider('codex');
        const task = makeChatTask('ask', 'task-ctx-codex');
        task.config = { model: 'gpt-5-long-ctx' } as any;
        task.payload = { ...(task.payload as any), provider: 'codex' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call).not.toHaveProperty('contextTier');
    });

    it('omits contextTier for Claude even when the catalog model has long-context metadata', async () => {
        const claudeLongContext = makeCatalogModel('claude-sonnet-4.6', { tokenPrices: { longContext: { contextMax: 1_000_000 } } });
        sdkMocks.mockListModels.mockResolvedValue([claudeLongContext]);
        const executor = makeExecutorForProvider('claude');
        const task = makeChatTask('ask', 'task-ctx-claude');
        task.config = { model: 'claude-sonnet-4.6' } as any;
        task.payload = { ...(task.payload as any), provider: 'claude' } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        expect(call).not.toHaveProperty('contextTier');
    });
});

// ============================================================================
// AC-04 — MCP per-tool allow-list enforcement on the new-chat execute() path
// ============================================================================

describe('ChatExecutor MCP allow-list enforcement', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let tmpHome: string;
    let tmpWorkspace: string;
    let tmpData: string;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'AI answer', sessionId: 'sess-1', toolCalls: [] });

        tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-chat-mcp-home-'));
        tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-chat-mcp-ws-'));
        tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-chat-mcp-data-'));
        setHomeDirectoryOverride(tmpHome);
        clearMcpConfigCache();
        fs.mkdirSync(path.join(tmpHome, '.copilot'), { recursive: true });
        fs.writeFileSync(
            path.join(tmpHome, '.copilot', 'mcp-config.json'),
            JSON.stringify({ mcpServers: { srv: { command: 'srv-bin' } } }),
        );
    });

    afterEach(() => {
        setHomeDirectoryOverride(null);
        clearMcpConfigCache();
        fs.rmSync(tmpHome, { recursive: true, force: true });
        fs.rmSync(tmpWorkspace, { recursive: true, force: true });
        fs.rmSync(tmpData, { recursive: true, force: true });
    });

    it('sends mcpServers with the disabled tool absent and loadDefaultMcpConfig=false', async () => {
        await store.registerWorkspace({ id: 'ws-mcp', name: 'ws', rootPath: tmpWorkspace, enabledMcpServers: null } as any);
        writeRepoPreferences(tmpData, 'ws-mcp', { enabledMcpTools: { srv: ['kept_tool'] } });

        const executor = new ChatExecutor(store, makeOptions(store), tmpData);
        const task = makeChatTask('ask', 'task-mcp-allow');
        task.payload = { ...(task.payload as any), workspaceId: 'ws-mcp', workingDirectory: tmpWorkspace } as any;

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(call.loadDefaultMcpConfig).toBe(false);
        expect(call.mcpServers.srv.tools).toEqual(['kept_tool']);
        expect(call.mcpServers.srv.tools).not.toContain('dropped_tool');
    });

    it('does not set mcpServers when the chat has no workspace context', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), tmpData);
        // makeChatTask payload has no workspaceId/workingDirectory → no rootPath.
        await executor.execute(makeChatTask('ask', 'task-mcp-no-ws'), 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0] as any;
        expect(call).not.toHaveProperty('mcpServers');
        expect(call).not.toHaveProperty('loadDefaultMcpConfig');
    });
});
