/**
 * Executor wiring for the Sentinel to-do ledger: only Sentinel chats with the
 * flag on receive `sentinel_todos` and its guidance, the tool is bound to the
 * invoking chat, and Sentinel stays read-only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, QueuedTask } from '@plusplusoneplusplus/forge';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import { SENTINEL_TODOS_TOOL_NAME } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { SENTINEL_TODO_LEDGER_GUIDANCE } from '../../../src/server/executors/prompt-builder';
import { SENTINEL_DISPATCHER_DIRECTIVE } from '../../../src/server/executors/chat-mode-directive';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { nestRuntime, type FlatExecutorOptions } from '../executors/runtime-options-helper';

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

vi.mock('../../../src/server/executors/image-store', () => ({
    saveImagesToTempFiles: vi.fn().mockReturnValue({ tempDir: undefined, attachments: [] }),
    cleanupTempDir: vi.fn(),
    rehydrateImagesIfNeeded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: vi.fn().mockReturnValue({ absolutePath: '/tasks-root' }),
}));

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: vi.fn().mockResolvedValue({
        tools: [], suffix: '', systemMessageSuffix: undefined, excludedBuiltinTools: [], dispose: vi.fn(),
    }),
}));

const sdkMocks = createMockSDKService();

function makeService() {
    return {
        list: vi.fn().mockResolvedValue({ revision: 0, items: [] }),
        create: vi.fn(),
        update: vi.fn(),
    };
}

function makeOptions(overrides?: FlatExecutorOptions) {
    return nestRuntime({
        aiService: sdkMocks.service as any,
        defaultTimeoutMs: 30_000,
        followUpSuggestions: { enabled: false, count: 3 },
        askUser: { enabled: true },
        resolveSkillConfig: vi.fn().mockResolvedValue({ skillDirectories: undefined, disabledSkills: undefined }),
        resolveWorkspaceIdForPath: vi.fn().mockResolvedValue('ws-1'),
        resolveAiServiceForProvider: () => sdkMocks.service as any,
        ...overrides,
    }) as any;
}

function makeTask(mode: string, id: string): QueuedTask {
    return {
        id, type: 'chat', priority: 'normal', status: 'running', createdAt: Date.now(),
        payload: { kind: 'chat', mode, prompt: 'Hello', workspaceId: 'ws-1' },
        config: {}, displayName: 'Hello',
    } as QueuedTask;
}

function makeProcess(id: string, mode: string): AIProcess {
    return {
        id, type: 'chat', status: 'completed', startTime: new Date(), promptPreview: 'hi',
        metadata: { type: 'chat', workspaceId: 'ws-1', mode },
        conversationTurns: [
            { role: 'user', content: 'Hello', timestamp: new Date(), turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Hi', timestamp: new Date(), turnIndex: 1, timeline: [] },
        ],
    } as AIProcess;
}

function lastCall(): any {
    return sdkMocks.mockSendMessage.mock.calls.at(-1)![0];
}

function toolNames(call = lastCall()): string[] {
    return (call.tools ?? []).map((tool: any) => tool.name);
}

describe('sentinel to-do ledger executor wiring', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
        sdkMocks.mockSendMessage.mockResolvedValue({ success: true, response: 'ok', sessionId: 's1' });
    });

    it('gives a sentinel first turn the tool and guidance, bound to its own chat, still read-only', async () => {
        const service = makeService();
        const executor = new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelTodos: () => service as any }));
        await executor.execute(makeTask('sentinel', 'task-s1'), 'Hello');

        const call = lastCall();
        expect(toolNames(call)).toContain(SENTINEL_TODOS_TOOL_NAME);
        expect(toolNames(call)).not.toContain('create_pull_request');
        expect(call.mode).toBe('interactive');
        expect(call.systemMessage?.content).toContain(SENTINEL_TODO_LEDGER_GUIDANCE);
        expect(call.prompt).toContain(SENTINEL_DISPATCHER_DIRECTIVE);

        const tool = call.tools.find((t: any) => t.name === SENTINEL_TODOS_TOOL_NAME);
        await tool.handler({ action: 'list', processId: 'queue_forged', workspaceId: 'ws-other' }, {});
        expect(service.list).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_task-s1' });
    });

    it('leaves the sentinel turn unchanged when the flag is off', async () => {
        const executor = new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelTodos: () => undefined }));
        await executor.execute(makeTask('sentinel', 'task-s-off'), 'Hello');
        const flagOff = lastCall();

        const plain = new ChatExecutor(createMockProcessStore(), makeOptions());
        await plain.execute(makeTask('sentinel', 'task-s-off'), 'Hello');

        expect(toolNames(flagOff)).not.toContain(SENTINEL_TODOS_TOOL_NAME);
        expect(flagOff.systemMessage?.content ?? '').not.toContain('sentinel_todos');
        expect(toolNames(flagOff)).toEqual(toolNames(lastCall()));
        expect(flagOff.prompt).toContain(SENTINEL_DISPATCHER_DIRECTIVE);
    });

    it('never offers the tool to ask chats', async () => {
        const executor = new ChatExecutor(createMockProcessStore(), makeOptions({ getSentinelTodos: () => makeService() as any }));
        await executor.execute(makeTask('ask', 'task-ask'), 'Hello');
        expect(toolNames()).not.toContain(SENTINEL_TODOS_TOOL_NAME);
        expect(lastCall().systemMessage?.content ?? '').not.toContain('sentinel_todos');
    });

    it('offers the tool on sentinel follow-ups, bound to the persisted chat', async () => {
        const service = makeService();
        const store = createMockProcessStore();
        await store.addProcess(makeProcess('queue_parent', 'sentinel'));
        await new FollowUpExecutor(store, makeOptions({ getSentinelTodos: () => service as any }))
            .executeFollowUp('queue_parent', 'next', undefined, 'sentinel');

        const call = lastCall();
        expect(call.mode).toBe('interactive');
        const tool = call.tools.find((t: any) => t.name === SENTINEL_TODOS_TOOL_NAME);
        expect(tool).toBeDefined();
        await tool.handler({ action: 'list' }, {});
        expect(service.list).toHaveBeenCalledWith({ workspaceId: 'ws-1', processId: 'queue_parent' });
    });

    it('does not offer the tool on ask follow-ups', async () => {
        const store = createMockProcessStore();
        await store.addProcess(makeProcess('proc-ask', 'ask'));
        await new FollowUpExecutor(store, makeOptions({ getSentinelTodos: () => makeService() as any }))
            .executeFollowUp('proc-ask', 'next', undefined, 'ask');
        expect(toolNames()).not.toContain(SENTINEL_TODOS_TOOL_NAME);
    });
});
