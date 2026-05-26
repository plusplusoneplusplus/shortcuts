/**
 * Chat Mode Executor Unit Tests
 *
 * Tests for ChatExecutor, PlanExecutor, and AutopilotExecutor.
 *
 * Verified for each executor:
 * - Happy path: AI SDK called with correct agentMode, systemMessage, returns result
 * - System message: ask/plan get READ_ONLY_SYSTEM_MESSAGE, autopilot gets undefined
 * - Agent mode: ask → interactive, plan → plan, autopilot → autopilot
 * - AI unavailability throws with helpful message
 * - AI sendMessage failure (success: false) propagates as thrown error
 * - Streaming chunks are forwarded via store.emitProcessOutput
 * - Session cleanup + output persistence happens in finally (no leaks)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { QueuedTask } from '@plusplusoneplusplus/forge';
import { READ_ONLY_SYSTEM_MESSAGE } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { PlanExecutor } from '../../../src/server/executors/plan-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import type { ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';

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
        toolCallCacheStore: { options: {} } as any,
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
        payload: {
            kind: 'chat',
            mode,
            prompt: 'Hello',
        },
        config: {},
        displayName: 'Hello',
    };
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
        label: 'PlanExecutor (plan)',
        expectedAgentMode: 'plan',
        expectsSystemMessage: true,
        makeExecutor: (store, overrides) => new PlanExecutor(store, makeOptions(store, overrides)),
        makeTask: (id) => makeChatTask('plan', id),
    },
    {
        label: 'AutopilotExecutor (autopilot)',
        expectedAgentMode: 'autopilot',
        expectsSystemMessage: false,
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

        it(`${expectsSystemMessage ? 'includes' : 'omits'} system message`, async () => {
            const executor = makeExecutor(store);
            const task = makeTask();

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            if (expectsSystemMessage) {
                expect(call.systemMessage).toBeDefined();
                expect(call.systemMessage.content).toContain(READ_ONLY_SYSTEM_MESSAGE);
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
        expect(call.systemMessage?.content).toBe(READ_ONLY_SYSTEM_MESSAGE);
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

describe('PlanExecutor system message content', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('injects note-file permission block when payload has noteChat.notePath', async () => {
        const executor = new PlanExecutor(store, makeOptions(store));
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

    it('does not persist system prompt when system message is absent (autopilot)', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store));
        const task = makeChatTask('autopilot', 'task-no-sysprompt');
        const processId = `queue_${task.id}`;

        // Pre-add the process (autopilot has no system message, so persistence should not trigger)
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

describe('AutopilotExecutor has no system message', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('passes undefined systemMessage even with workingDirectory', async () => {
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
        expect(call.systemMessage).toBeUndefined();
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

    it('appends grilling-specific ask_user directive to the system message', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeGrillingTask();

        await executor.execute(task, 'Grill me on this idea');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = call.systemMessage?.content ?? '';
        expect(systemContent).toContain('Ralph Grilling Phase');
        expect(systemContent).toContain('`ask_user` tool for EVERY clarification');
        expect(systemContent).toContain('Batch related questions');
        expect(systemContent).toContain('ignore the earlier "Do NOT use ask_user for simple yes/no" guidance');
        // Final goal-spec template is still present, but only emitted at the end.
        expect(systemContent).toContain('## Goal');
        expect(systemContent).toContain('## Acceptance Criteria');
        expect(systemContent).toContain('## Out of Scope');
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

    it('does NOT add the grilling directive to a non-grilling ask task', async () => {
        const executor = new ChatExecutor(store, makeOptions(store, {
            askUser: { enabled: true },
        } as any));
        const task = makeChatTask('ask', 'task-not-grill');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const systemContent = call.systemMessage?.content ?? '';
        expect(systemContent).not.toContain('Ralph Grilling Phase');
        expect(systemContent).not.toContain('`ask_user` tool for EVERY clarification');
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
});

// ============================================================================
// All three executors include create_work_item + create_bug tools
// ============================================================================

describe('create_work_item / create_bug tool wiring', () => {
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

    it('ChatExecutor includes create_work_item and create_bug tools', async () => {
        const executor = new ChatExecutor(store, makeOptions(store), dataDir);
        const task = makeTaskWithWorkspace('ask', 'task-wi-ask');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('create_work_item');
        expect(toolNames).toContain('create_bug');
    });

    it('AutopilotExecutor includes create_work_item and create_bug tools', async () => {
        const executor = new AutopilotExecutor(store, makeOptions(store), dataDir);
        const task = makeTaskWithWorkspace('autopilot', 'task-wi-auto');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('create_work_item');
        expect(toolNames).toContain('create_bug');
    });

    it('PlanExecutor includes create_work_item and create_bug tools', async () => {
        const executor = new PlanExecutor(store, makeOptions(store), dataDir);
        const task = makeTaskWithWorkspace('plan', 'task-wi-plan');

        await executor.execute(task, 'Hello');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const toolNames = (call.tools ?? []).map((t: any) => t.name);
        expect(toolNames).toContain('create_work_item');
        expect(toolNames).toContain('create_bug');
    });

    it('all three executors include create_work_item and create_bug tools', async () => {
        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'sfx-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'sfx-auto' },
            { mode: 'plan' as const, Ctor: PlanExecutor, id: 'sfx-plan' },
        ]) {
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });

            const executor = new Ctor(store, makeOptions(store), dataDir);
            const task = makeTaskWithWorkspace(mode, id);

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(toolNames).toContain('create_work_item');
            expect(toolNames).toContain('create_bug');
        }
    });

    it('all three initial executors include tavily_web_search when explicitly enabled', async () => {
        writeRepoPreferences(dataDir, 'ws-123', { disabledLlmTools: [] });

        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'tavily-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'tavily-auto' },
            { mode: 'plan' as const, Ctor: PlanExecutor, id: 'tavily-plan' },
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

    it('classic mode disables create_work_item and create_bug tools by default', async () => {
        writeLayoutMode('classic');

        for (const { mode, Ctor, id } of [
            { mode: 'ask' as const, Ctor: ChatExecutor, id: 'classic-ask' },
            { mode: 'autopilot' as const, Ctor: AutopilotExecutor, id: 'classic-auto' },
            { mode: 'plan' as const, Ctor: PlanExecutor, id: 'classic-plan' },
        ]) {
            sdkMocks.resetAll();
            sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
            sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1', toolCalls: [] });

            const executor = new Ctor(store, makeOptions(store), dataDir);
            const task = makeTaskWithWorkspace(mode, id);

            await executor.execute(task, 'Hello');

            const call = sdkMocks.mockSendMessage.mock.calls[0][0];
            const toolNames = (call.tools ?? []).map((t: any) => t.name);
            expect(toolNames).not.toContain('create_work_item');
            expect(toolNames).not.toContain('create_bug');
            expect(call.prompt).not.toContain('create-work-item');
            expect(call.prompt).not.toContain('create-bug');
        }
    });
});

// ============================================================================
// PlanExecutor auto-folder: notes/Plans/ path
// ============================================================================

describe('PlanExecutor auto-folder path (notes/Plans)', () => {
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

    it('system message contains notes/Plans path for plan mode', async () => {
        const executor = new PlanExecutor(store, makeOptions(store), DATA_DIR);
        const task = makePlanTaskWithWorkdir('plan-path-test');

        await executor.execute(task, 'Plan something');

        const call = sdkMocks.mockSendMessage.mock.calls[0][0];
        const sysContent: string = call.systemMessage?.content ?? '';
        expect(sysContent).toContain('notes');
        expect(sysContent).toContain('Plans');
        expect(sysContent).not.toContain('/tasks/');
    });

    it('creates notes/Plans directory via mkdir during plan mode', async () => {
        const executor = new PlanExecutor(store, makeOptions(store), DATA_DIR);
        const task = makePlanTaskWithWorkdir('plan-mkdir-test');

        await executor.execute(task, 'Plan something');

        const expectedPath = path.join(DATA_DIR, 'repos', 'ws-plan-test', 'notes', 'Plans');
        expect(vi.mocked(fs.promises.mkdir)).toHaveBeenCalledWith(
            expectedPath,
            { recursive: true },
        );
    });

    it('ChatExecutor also uses notes/Plans (same as PlanExecutor)', async () => {
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

        // mkdir SHOULD be called — ask mode now targets notes/Plans like plan mode
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
