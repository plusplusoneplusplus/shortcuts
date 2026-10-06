/**
 * Integration test for the send_to_conversation create-mode enqueue binding.
 *
 * Proves the tool is functional end-to-end against the *real* enqueue machinery
 * that `POST /api/queue` uses: `createSendToConversationTool` wired to an
 * `enqueueChat` callback that runs `enqueueViaBridge` against a real
 * `MultiRepoQueueRouter`. Calling the handler with `{ content }` (no processId)
 * routes a `type:'chat'` task into the per-repo queue (so it appears in the chat
 * list) and returns the queued conversation's identity.
 *
 * Mirrors the binding built at the route layer in `registerAllRoutes`:
 *   enqueueChat = (input) => enqueueViaBridge(input, bridge, state, root, store)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { CreateTaskInput } from '@plusplusoneplusplus/forge';

// SDK mock — MultiRepoQueueRouter → CLITaskExecutor → getCopilotSDKService.
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import {
    enqueueViaBridge,
    serializeTaskSummary,
    type QueueGlobalState,
} from '../../../src/server/routes/queue-shared';
import { prepareTaskForEnqueue } from '../../../src/server/routes/queue-enqueue';
import { SqliteQueuePersistence } from '../../../src/server/queue/sqlite-queue-persistence';
import { ProcessLifecycleRunner } from '../../../src/server/executors/process-lifecycle-runner';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { resolveChatTurnModel } from '../../../src/server/executors/chat-turn-policy-resolver';
import { launchRalphSession } from '../../../src/server/ralph/ralph-launch-service';
import { TitleGenerationService } from '../../../src/server/executors/title-generator';

const WS_ID = 'ws-spawn';
const ROOT = '/repo/spawn';

function freshState(): QueueGlobalState {
    return {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        resumeInProgress: new Set(),
    };
}

const PARENT_PID = 'queue_parent';

function setup(state: QueueGlobalState = freshState()) {
    const registry = new RepoQueueRegistry();
    const store = createMockProcessStore();
    (store.getWorkspaces as any).mockResolvedValue([{ id: WS_ID, rootPath: ROOT }]);
    // Seed the parent chat the spawned conversation inherits provider/model/effort
    // from. Without a resolvable parent the create-mode handler errors.
    void store.addProcess({
        id: PARENT_PID,
        metadata: { type: 'chat', provider: 'copilot' },
    } as any);
    // autoStart:false → enqueued tasks stay queued (no SDK execution in the test).
    const bridge = new MultiRepoQueueRouter(registry, store, { autoStart: false });

    const enqueueChat = async (input: CreateTaskInput): Promise<string> => {
        await prepareTaskForEnqueue(input, {
            getDefaultProvider: () => 'copilot',
        });
        return enqueueViaBridge(input, bridge, state, ROOT, store);
    };

    const { tool } = createSendToConversationTool({
        store: store as any,
        workspaceId: WS_ID,
        enqueueChat,
        parentProcessId: PARENT_PID,
    });
    return { bridge, store, tool };
}

describe('send_to_conversation create-mode enqueue binding (real enqueueViaBridge path)', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
    });

    it('enqueues a type:chat task that appears in the queue and returns its identity', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({ content: 'spawn me a helper chat' }) as any;

        // Returned identity is queue_<taskId> with an openable deep link.
        expect(result.error).toBeUndefined();
        expect(result.processId).toMatch(/^queue_/);
        expect(result.openLink).toBe(`#/process/${result.processId}`);
        // Create mode has no turnIndex.
        expect(result.turnIndex).toBeUndefined();

        // The conversation is actually in the queue (chat-list visible).
        const taskId = result.processId.slice('queue_'.length);
        const task = bridge.getTask(taskId);
        expect(task).toBeDefined();
        expect(task!.type).toBe('chat');
        expect((task!.payload as any).prompt).toBe('spawn me a helper chat');
        expect((task!.payload as any).mode).toBe('ask');
    });

    it('routes an explicit autopilot mode + title through the real path', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({
            content: 'do the thing',
            mode: 'autopilot',
            title: ' \tHelper task\n ',
        }) as any;

        expect(result.error).toBeUndefined();

        const task = bridge.getTask(result.processId.slice('queue_'.length));
        expect((task!.payload as any).mode).toBe('autopilot');
        expect(task!.displayName).toBe('Helper task');
        expect(task!.payload.customTitle).toBe('Helper task');
    });

    it.each([' \t\n ', 'x'.repeat(81)])('does not enqueue an invalid title %j', async title => {
        const { bridge, tool } = setup();
        const result = await tool.handler({ content: 'do the thing', title }) as any;
        expect(result.error).toMatch(/title/i);
        expect(bridge.createAggregateQueueFacade().getQueued()).toHaveLength(0);
    });

    it('does not enqueue when validation fails (unknown workspace)', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({ content: 'x', workspaceId: 'nope' }) as any;

        expect(result.error).toMatch(/Unknown workspaceId/);
        expect(bridge.createAggregateQueueFacade().getQueued()).toHaveLength(0);
    });

    it.each(['ask', 'autopilot', 'ralph'] as const)('executes explicit Auto %s in the target workspace with target selections', async mode => {
        const { bridge, store } = setup();
        const targetRoot = path.join(os.tmpdir(), 'coc-auto-target');
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WS_ID, rootPath: ROOT }, { id: 'ws-target', rootPath: targetRoot },
        ]);
        await store.updateProcess(PARENT_PID, { metadata: {
            provider: 'codex', model: 'gpt-5.5', reasoningEffort: 'low', mode: 'sentinel',
        } });
        bridge.registerRepoId(WS_ID, ROOT);
        bridge.registerRepoId('ws-target', targetRoot);
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delegate-auto-'));
        writeRepoPreferences(dataDir, WS_ID, { defaultModels: { ask: 'gpt-5.5', task: 'gpt-5.5' } });
        writeRepoPreferences(dataDir, 'ws-target', { defaultModels: { ask: 'haiku', task: 'sonnet' } });
        const prepare = (input: CreateTaskInput) => prepareTaskForEnqueue(input, {
            getDefaultProvider: () => 'codex', isAutoProviderRoutingActive: () => true,
        });
        const { tool } = createSendToConversationTool({
            runtime: { isAutoProviderRoutingAvailable: () => true },
            store, workspaceId: WS_ID, parentProcessId: PARENT_PID,
            enqueueChat: async input => {
                await prepare(input);
                return enqueueViaBridge(input, bridge, freshState(), ROOT, store);
            },
            launchRalph: input => launchRalphSession(input, {
                store, dataDir,
                bridge: { enqueue: async (task: CreateTaskInput) => {
                    await prepare(task);
                    return enqueueViaBridge(task, bridge, freshState(), ROOT, store);
                } } as any,
            }),
        });
        try {
            for (const overrides of [{}, { effortTier: 'medium' as const }, { model: 'opus', effortTier: 'high' as const }]) {
                const result = await tool.handler({ content: 'goal', provider: 'auto', mode, workspaceId: 'ws-target', ...overrides });
                if ('error' in result) throw new Error(result.error);
                const task = bridge.getTask(result.processId.slice('queue_'.length))!;
                expect(task.repoId).toBe('ws-target');
                expect(task.payload.workingDirectory).toBe(targetRoot);
                expect(task.payload.provider).toBeUndefined();
                expect(task.config?.model).toBe(overrides.model);
                expect(task.config?.reasoningEffort).toBeUndefined();
                expect(task.payload.context).toMatchObject({
                    spawnedFromProcessId: PARENT_PID, autoProviderRouting: { requested: true },
                });
                const resolveDefaultProvider = vi.fn().mockResolvedValue({
                    provider: 'claude', selectedByAuto: true, fallbackUsed: false, warnings: [], decisions: [],
                });
                const executeByTypeFn = vi.fn().mockResolvedValue({ response: 'done' });
                const runner = new ProcessLifecycleRunner(store, dataDir, vi.fn(), 'codex');
                expect((await runner.run(task, {
                    cancelledTasks: new Set(), executeFollowUpFn: vi.fn(), executeByTypeFn,
                    getWorkingDirectoryFn: () => targetRoot, resolveDefaultProvider,
                    getEffortTiersForProvider: provider => provider === 'claude'
                        ? { medium: { model: 'opus', reasoningEffort: 'high' } } : undefined,
                })).success).toBe(true);
                expect(resolveDefaultProvider).toHaveBeenCalledExactlyOnceWith({ forceAuto: true });
                expect(executeByTypeFn.mock.calls[0][0].payload.provider).toBe('claude');
                expect(task.config?.model).toBe(overrides.model || 'opus');
                expect(task.config?.reasoningEffort).toBe(!overrides.model ? 'high' : undefined);
                // The default Medium tier resolves against the target provider, ahead of repo model defaults.
                expect(resolveChatTurnModel({
                    provider: 'claude', requestedModel: task.config?.model, dataDir,
                    workspaceId: task.payload.workspaceId as string,
                    defaultModelMode: mode === 'ask' ? 'ask' : 'task',
                })).toBe(overrides.model || 'opus');
                expect((await store.getProcess(result.processId))?.metadata?.provider).toBe('claude');
            }
        } finally {
            bridge.dispose();
            fs.rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it.each(['ask', 'autopilot'] as const)('prepares disabled Auto %s fallback without requesting runtime routing', async mode => {
        const { bridge, store } = setup();
        await store.updateProcess(PARENT_PID, { metadata: { provider: 'claude', model: 'sonnet', reasoningEffort: 'high' } });
        const resolveDefaultProvider = vi.fn().mockRejectedValue(new Error('Auto disabled'));
        const { tool } = createSendToConversationTool({
            store, workspaceId: WS_ID, parentProcessId: PARENT_PID,
            runtime: { isAutoProviderRoutingAvailable: () => false },
            enqueueChat: async input => {
                await prepareTaskForEnqueue(input, {
                    getDefaultProvider: () => 'copilot', isAutoProviderRoutingActive: () => false, resolveDefaultProvider,
                });
                return enqueueViaBridge(input, bridge, freshState(), ROOT, store);
            },
        });
        try {
            const result = await tool.handler({ content: 'goal', provider: 'auto', mode });
            if ('error' in result) throw new Error(result.error);
            const task = bridge.getTask(result.processId.slice('queue_'.length))!;
            expect(task.payload.provider).toBe('claude');
            expect((task.payload.context as any).autoProviderRouting).toBeUndefined();
            expect(task.config).toMatchObject({ model: 'opus', reasoningEffort: 'medium', afterEffortTier: 'medium' });
            expect(resolveDefaultProvider).not.toHaveBeenCalled();
        } finally {
            bridge.dispose();
        }
    });

    it('resolves omitted Auto effort to Copilot Medium and records it on the process', async () => {
        const { bridge, store } = setup();
        const { tool } = createSendToConversationTool({
            store, workspaceId: WS_ID, parentProcessId: PARENT_PID,
            runtime: { isAutoProviderRoutingAvailable: () => true },
            enqueueChat: async input => {
                await prepareTaskForEnqueue(input, { isAutoProviderRoutingActive: () => true });
                return enqueueViaBridge(input, bridge, freshState(), ROOT, store);
            },
        });
        try {
            const result = await tool.handler({ content: 'audit', provider: 'auto', mode: 'ask' });
            if ('error' in result) throw new Error(result.error);
            const task = bridge.getTask(result.processId.slice('queue_'.length))!;
            expect(task.config).toMatchObject({ afterEffortTier: 'medium' });
            expect(task.config.model).toBeUndefined();
            const executeByTypeFn = vi.fn(async (executedTask: Parameters<ProcessLifecycleRunner['run']>[0]) => ({
                response: 'done', effectiveModel: executedTask.config.model,
            }));
            const runner = new ProcessLifecycleRunner(store, undefined, vi.fn(), 'claude');
            expect((await runner.run(task, {
                cancelledTasks: new Set(), executeFollowUpFn: vi.fn(), executeByTypeFn,
                getWorkingDirectoryFn: () => ROOT,
                resolveDefaultProvider: async () => ({
                    provider: 'copilot', selectedByAuto: true, fallbackUsed: false, warnings: [], decisions: [],
                }),
            })).success).toBe(true);
            expect(executeByTypeFn.mock.calls[0][0].config).toMatchObject({
                model: 'gpt-6.1-sol', reasoningEffort: 'medium', afterEffortTier: 'medium',
            });
            expect((await store.getProcess(result.processId))?.metadata).toMatchObject({
                provider: 'copilot', model: 'gpt-6.1-sol', reasoningEffort: 'medium', afterEffortTier: 'medium',
            });
        } finally {
            bridge.dispose();
        }
    });

    it('resolves an explicit provider effort tier through queue preparation without persisting raw effortTier', async () => {
        const { bridge, tool } = setup();

        const result = await tool.handler({
            content: 'spawn claude helper',
            provider: 'claude',
            effortTier: 'medium',
        }) as any;

        expect(result.error).toBeUndefined();
        const task = bridge.getTask(result.processId.slice('queue_'.length))!;
        expect((task.payload as any).provider).toBe('claude');
        expect(task.config?.model).toBe('opus');
        expect(task.config?.reasoningEffort).toBe('medium');
        expect((task.config as any).afterEffortTier).toBe('medium');
        expect((task.config as any).effortTier).toBeUndefined();
    });
});

describe('send_to_conversation custom title lifecycle and SQLite restarts', () => {
    let tempDir: string;
    let store: SqliteProcessStore;
    let bridge: MultiRepoQueueRouter;
    let persistence: SqliteQueuePersistence;

    beforeEach(() => {
        sdkMocks.resetAll();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-spawn-title-'));
        store = new SqliteProcessStore({ dbPath: path.join(tempDir, 'processes.db') });
    });

    afterEach(() => {
        persistence?.dispose();
        bridge?.dispose();
        store.close();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it.each(['ws-caller', 'ws-other'])('retains a spawned custom title in %s across queue and process reloads', async targetWorkspaceId => {
        const workspaces = [
            { id: 'ws-caller', name: 'Caller', rootPath: path.join(tempDir, 'caller') },
            { id: 'ws-other', name: 'Other', rootPath: path.join(tempDir, 'other') },
        ];
        for (const workspace of workspaces) {
            fs.mkdirSync(workspace.rootPath);
            await store.registerWorkspace(workspace);
        }
        await store.addProcess({
            id: PARENT_PID,
            type: 'chat',
            promptPreview: 'Parent',
            status: 'completed',
            startTime: new Date(),
            metadata: { type: 'chat', workspaceId: 'ws-caller', provider: 'copilot' },
        });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
        for (const workspace of workspaces) bridge.registerRepoId(workspace.id, workspace.rootPath);
        persistence = new SqliteQueuePersistence(bridge, store.getDatabase());
        const { tool } = createSendToConversationTool({
            store,
            workspaceId: 'ws-caller',
            parentProcessId: PARENT_PID,
            enqueueChat: async input => {
                await prepareTaskForEnqueue(input, { getDefaultProvider: () => 'copilot' });
                return enqueueViaBridge(input, bridge, freshState(), workspaces[0].rootPath, store);
            },
        });
        const result = await tool.handler({
            content: 'Investigate the delegated task',
            title: ' \tDelegated investigation\n ',
            workspaceId: targetWorkspaceId,
        });
        if ('error' in result) throw new Error(result.error);
        const taskId = result.processId.slice('queue_'.length);

        persistence.dispose();
        bridge.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(tempDir, 'processes.db') });
        bridge = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { autoStart: false });
        persistence = new SqliteQueuePersistence(bridge, store.getDatabase());
        persistence.restore();
        const task = bridge.getTask(taskId)!;
        const targetRoot = workspaces.find(ws => ws.id === targetWorkspaceId)!.rootPath;
        expect(task.payload.customTitle).toBe('Delegated investigation');
        expect(task.displayName).toBe('Delegated investigation');
        expect(serializeTaskSummary(task).customTitle).toBe('Delegated investigation');
        expect(task.repoId).toBe(targetWorkspaceId);
        expect(task.payload.workingDirectory).toBe(targetRoot);

        sdkMocks.mockTransform.mockResolvedValue({
            success: true, text: 'AI generated title', effectiveModel: 'gpt-5.4-mini',
        });
        const titles = new TitleGenerationService({
            store,
            aiService: sdkMocks.service,
            queueManager: bridge.registry.getQueueForRepo(targetRoot),
        });
        const runner = new ProcessLifecycleRunner(store, tempDir,
            (processId, turns) => titles.generateIfNeeded(processId, turns));
        expect((await runner.run(task, {
            cancelledTasks: new Set(),
            executeFollowUpFn: vi.fn(),
            executeByTypeFn: vi.fn().mockResolvedValue({ response: 'Investigation completed' }),
            getWorkingDirectoryFn: () => targetRoot,
        })).success).toBe(true);
        await vi.waitFor(async () => {
            expect((await store.getProcess(result.processId))?.title).toBe('AI generated title');
            expect(bridge.getTask(taskId)?.displayName).toBe('Delegated investigation');
            expect(serializeTaskSummary(bridge.getTask(taskId)!).customTitle).toBe('Delegated investigation');
        });
        persistence.dispose();
        bridge.dispose();
        store.close();
        store = new SqliteProcessStore({ dbPath: path.join(tempDir, 'processes.db') });
        const process = await store.getProcess(result.processId);
        expect(process).toMatchObject({
            customTitle: 'Delegated investigation',
            title: 'AI generated title',
            parentProcessId: PARENT_PID,
            workingDirectory: targetRoot,
            metadata: { workspaceId: targetWorkspaceId, provider: 'copilot' },
        });
        const targetProcesses = await store.getAllProcesses({ workspaceId: targetWorkspaceId });
        expect(targetProcesses.some(proc => proc.id === result.processId)).toBe(true);
        const otherWorkspaceId = targetWorkspaceId === 'ws-caller' ? 'ws-other' : 'ws-caller';
        const otherProcesses = await store.getAllProcesses({ workspaceId: otherWorkspaceId });
        expect(otherProcesses.some(proc => proc.id === result.processId)).toBe(false);
        expect((await store.getProcess(PARENT_PID))?.customTitle).toBeUndefined();
    });
});
