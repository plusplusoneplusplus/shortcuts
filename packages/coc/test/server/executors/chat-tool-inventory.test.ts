import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess, QueuedTask, SendMessageOptions } from '@plusplusoneplusplus/forge';
import { initializeDatabase, toQueueProcessId } from '@plusplusoneplusplus/forge';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { unavailableToolInventory, createRuntimeToolInventory } from '@plusplusoneplusplus/coc-agent-sdk';
import { ChatExecutor } from '../../../src/server/executors/chat-executor';
import { AutopilotExecutor } from '../../../src/server/executors/autopilot-executor';
import { FollowUpExecutor } from '../../../src/server/executors/follow-up-executor';
import type { ChatModeAIOptions, ChatModeExecutorOptions } from '../../../src/server/executors/chat-base-executor';
import type { ChatProvider } from '../../../src/server/tasks/task-types';
import { ConversationToolInventoryStore } from '../../../src/server/storage/conversation-tool-inventory-store';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

vi.mock('../../../src/server/processes/output-file-manager', () => ({
    OutputFileManager: { saveOutput: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../../src/server/executors/chat-tool-builder', () => ({
    buildChatToolBundle: () => ({
        tools: [], toolGuidance: '',
        askUser: { cancelAll: vi.fn(), hasPending: () => false, answerQuestion: () => false, skipQuestion: () => false },
    }),
}));
vi.mock('../../../src/server/executors/memory-v2-addon', () => ({
    buildMemoryV2Addon: async () => ({ tools: [], suffix: '', excludedBuiltinTools: [], dispose: vi.fn() }),
}));

function modeOptions(prompt: string): ChatModeAIOptions {
    return { agentMode: 'interactive', systemMessage: undefined, tools: [], effectivePrompt: prompt };
}
class InventoryChatExecutor extends ChatExecutor {
    readonly assembled = vi.fn();
    protected override async buildModeOptions(_task: QueuedTask, prompt: string) {
        this.assembled();
        return modeOptions(prompt);
    }
}
class InventoryAutopilotExecutor extends AutopilotExecutor {
    protected override async buildModeOptions(_task: QueuedTask, prompt: string) {
        return { ...modeOptions(prompt), agentMode: 'autopilot' as const };
    }
}

describe('chat startup tool inventory persistence', () => {
    let db: NativeDatabase;
    let inventoryStore: ConversationToolInventoryStore;
    let processes: ReturnType<typeof createMockProcessStore>;
    const sdk = createMockSDKService();
    let sentOptions: SendMessageOptions | undefined;
    const processId = toQueueProcessId('inventory-task');

    function processFixture(): AIProcess {
        return {
            id: processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'hello', metadata: { workspaceId: 'owner', provider: 'copilot', mode: 'ask' },
            sdkSessionId: 'prior-session',
            conversationTurns: [
                { role: 'user', content: 'hello', timestamp: new Date(), turnIndex: 0 },
                { role: 'assistant', content: 'hi', timestamp: new Date(), turnIndex: 1 },
                { role: 'user', content: 'next', timestamp: new Date(), turnIndex: 2 },
            ],
        };
    }
    function options(provider: ChatProvider = 'copilot'): ChatModeExecutorOptions {
        return {
            provider, aiService: sdk.service,
            resolveSkillConfig: async () => ({}),
            runtime: {
                getToolInventoryStore: () => inventoryStore,
                resolveAiServiceForProvider: () => sdk.service,
            },
        };
    }
    function task(provider: ChatProvider = 'copilot', mode: 'ask' | 'autopilot' = 'ask'): QueuedTask {
        return {
            id: 'inventory-task', type: 'chat', priority: 'normal', status: 'running',
            createdAt: Date.now(), config: {},
            payload: { kind: 'chat', mode, provider, workspaceId: 'owner', prompt: 'next' },
        };
    }
    function previousSnapshot() {
        const turn = inventoryStore.beginTurn('owner', processId, 'copilot', 1);
        inventoryStore.record(turn, createRuntimeToolInventory('copilot', [
            { name: 'previous_turn_tool', source: 'builtin' },
        ], [
            { source: 'builtin', status: 'partial' },
            { source: 'coc', status: 'unavailable' },
            { source: 'mcp', status: 'unavailable' },
        ]));
    }

    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        db.prepare('INSERT INTO processes (id, workspace_id, status, start_time) VALUES (?, ?, ?, ?)')
            .run(processId, 'owner', 'completed', new Date().toISOString());
        inventoryStore = new ConversationToolInventoryStore(db);
        processes = createMockProcessStore({ initialProcesses: [processFixture()] });
        sdk.resetAll();
        sdk.mockIsAvailable.mockResolvedValue({ available: true });
        sentOptions = undefined;
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            sentOptions = sendOptions;
            expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'pending' });
            await sendOptions.onToolInventory?.(unavailableToolInventory(taskProvider()));
            return { success: true, response: 'done' };
        });
    });
    function taskProvider(): string {
        const inventory = inventoryStore.get('owner', processId);
        if (inventory.state !== 'pending') throw new Error('Expected pending inventory');
        return inventory.turn.provider;
    }
    afterEach(() => db.close());

    it.each(['copilot', 'codex', 'claude', 'opencode'] as const)(
        'replaces the preceding snapshot before first-turn %s initialization and retains capture after settlement',
        async provider => {
            previousSnapshot();
            sdk.mockIsAvailable.mockImplementation(async () => {
                expect(inventoryStore.get('owner', processId)).toMatchObject({
                    state: 'pending', turn: { provider, turnIndex: 3 },
                });
                return { available: true };
            });
            await new InventoryChatExecutor(processes, options(provider)).execute(task(provider), 'next');
            expect(inventoryStore.get('owner', processId)).toMatchObject({
                state: 'captured', turn: { provider, turnIndex: 3 },
                snapshot: { provider, tools: [] },
            });
            expect(inventoryStore.get('different-owner', processId)).toEqual({ state: 'unavailable' });
            expect(sentOptions?.prompt).not.toContain('previous_turn_tool');
            expect(JSON.stringify(processes.processes.get(processId))).not.toContain('snapshot');
            expect(processes.emitProcessEvent).not.toHaveBeenCalledWith(processId,
                expect.objectContaining({ snapshot: expect.anything() }));
        },
    );

    it('captures unused advertised tools in autopilot without adding them to the sent tool bundle', async () => {
        const snapshot = createRuntimeToolInventory('copilot', [
            { name: 'unused_native_tool', source: 'builtin', description: 'Runtime descriptor' },
        ], [
            { source: 'builtin', status: 'partial' },
            { source: 'coc', status: 'unavailable' },
            { source: 'mcp', status: 'unavailable' },
        ]);
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            expect(sendOptions.tools).toBeUndefined();
            await sendOptions.onToolInventory?.(snapshot);
            return { success: true, response: 'done' };
        });
        await new InventoryAutopilotExecutor(processes, options()).execute(task('copilot', 'autopilot'), 'next');
        expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'captured', snapshot });
    });

    it.each(['copilot', 'codex', 'claude', 'opencode'] as const)(
        'captures a fresh follow-up for %s with the actual continuation provider',
        async provider => {
            previousSnapshot();
            await new FollowUpExecutor(processes, options()).executeFollowUp(
                processId, 'next', undefined, 'ask', undefined, undefined, undefined, undefined,
                undefined, undefined, undefined,
                { requestedProvider: provider },
            );
            expect(sentOptions?.onToolInventory).toBeTypeOf('function');
            expect(sentOptions?.sessionId).toBe(provider === 'copilot' ? 'prior-session' : undefined);
            expect(inventoryStore.get('owner', processId)).toMatchObject({
                state: 'captured', turn: { provider, turnIndex: 3 }, snapshot: { provider },
            });
        },
    );

    it('allocates the correct inventory turn index for an automated follow-up that appends its user turn', async () => {
        processes.processes.set(processId, {
            ...processFixture(), conversationTurns: processFixture().conversationTurns?.slice(0, 2),
        });
        await new FollowUpExecutor(processes, options()).executeFollowUp(
            processId, 'wake', undefined, 'autopilot', undefined, undefined, undefined, undefined,
            { source: 'cron' },
        );
        expect(inventoryStore.get('owner', processId)).toMatchObject({
            state: 'captured', turn: { turnIndex: 3 },
        });
    });

    it.each(['first', 'follow-up'] as const)('keeps %s initialization errors pending and ignores late callbacks', async path => {
        previousSnapshot();
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            sentOptions = sendOptions;
            throw new Error('Runtime initialization failed');
        });
        if (path === 'first') {
            await expect(new InventoryChatExecutor(processes, options()).execute(task(), 'next'))
                .rejects.toThrow('Runtime initialization failed');
        } else {
            await new FollowUpExecutor(processes, options()).executeFollowUp(processId, 'next', undefined, 'ask');
            expect(processes.processes.get(processId)?.status).toBe('failed');
        }
        await sentOptions?.onToolInventory?.(unavailableToolInventory('copilot'));
        expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'pending' });
    });

    it.each(['first', 'follow-up'] as const)('suppresses a cancelled %s startup callback', async path => {
        const opts = options();
        opts.runtime = { ...opts.runtime, inFlightTurns: new Map() };
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            opts.runtime?.inFlightTurns?.get(processId)?.controller.abort();
            expect(sendOptions.signal?.aborted).toBe(true);
            await sendOptions.onToolInventory?.(unavailableToolInventory('copilot'));
            return { success: false, error: 'cancelled' };
        });
        if (path === 'first') {
            await expect(new InventoryChatExecutor(processes, opts).execute(task(), 'next')).rejects.toThrow('cancelled');
        } else {
            await new FollowUpExecutor(processes, opts).executeFollowUp(processId, 'next', undefined, 'ask');
            expect(processes.processes.get(processId)?.status).toBe('cancelled');
        }
        expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'pending' });
    });

    it.each(['first', 'follow-up'] as const)('surfaces %s write errors rather than delivering a successful turn', async path => {
        vi.spyOn(inventoryStore, 'record').mockImplementation(() => { throw new Error('Inventory write failed'); });
        if (path === 'first') {
            await expect(new InventoryChatExecutor(processes, options()).execute(task(), 'next'))
                .rejects.toThrow('Inventory write failed');
        } else {
            await new FollowUpExecutor(processes, options()).executeFollowUp(processId, 'next', undefined, 'ask');
            expect(processes.processes.get(processId)).toMatchObject({
                status: 'failed', error: 'Inventory write failed',
            });
        }
        expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'pending' });
    });

    it('rejects an old settled callback after the latest turn begins, including the same transcript index', async () => {
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            sentOptions = sendOptions;
            return { success: true, response: 'no catalog' };
        });
        const executor = new InventoryChatExecutor(processes, options());
        await executor.execute(task(), 'first');
        const staleCallback = sentOptions?.onToolInventory;
        const stale = inventoryStore.get('owner', processId);
        await executor.execute(task(), 'second');
        const latest = inventoryStore.get('owner', processId);
        expect(latest).toMatchObject({ state: 'pending', turn: { turnIndex: 3 } });
        expect(latest).not.toEqual(stale);
        await staleCallback?.(unavailableToolInventory('copilot'));
        expect(inventoryStore.get('owner', processId)).toEqual(latest);
    });

    it('keeps the captured startup snapshot when inference fails later', async () => {
        const snapshot = unavailableToolInventory('copilot');
        sdk.mockSendMessage.mockImplementation(async (sendOptions: SendMessageOptions) => {
            sentOptions = sendOptions;
            await sendOptions.onToolInventory?.(snapshot);
            return { success: false, error: 'Inference failed' };
        });
        await expect(new InventoryChatExecutor(processes, options()).execute(task(), 'next'))
            .rejects.toThrow('Inference failed');
        await sentOptions?.onToolInventory?.(createRuntimeToolInventory('copilot', [], [
            { source: 'builtin', status: 'complete' },
            { source: 'coc', status: 'complete' },
            { source: 'mcp', status: 'complete' },
        ]));
        expect(inventoryStore.get('owner', processId)).toMatchObject({ state: 'captured', snapshot });
    });

    it('surfaces pending-write failure before tool assembly or provider initialization', async () => {
        vi.spyOn(inventoryStore, 'beginTurn').mockImplementation(() => { throw new Error('Pending write failed'); });
        const executor = new InventoryChatExecutor(processes, options());
        await expect(executor.execute(task(), 'next')).rejects.toThrow('Pending write failed');
        expect(executor.assembled).not.toHaveBeenCalled();
        expect(sdk.mockIsAvailable).not.toHaveBeenCalled();
        expect(sdk.mockSendMessage).not.toHaveBeenCalled();
    });

    it('fails closed before provider calls for a mismatched owner', async () => {
        const wrongTask = task();
        wrongTask.payload = { ...wrongTask.payload, workspaceId: 'different-owner' };
        await expect(new InventoryChatExecutor(processes, options()).execute(wrongTask, 'next'))
            .rejects.toThrow('owner not found');
        expect(sdk.mockIsAvailable).not.toHaveBeenCalled();
        expect(sdk.mockSendMessage).not.toHaveBeenCalled();
        expect(inventoryStore.get('owner', processId)).toEqual({ state: 'unavailable' });
    });
});
