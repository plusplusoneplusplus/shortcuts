/**
 * Executor runtime capability wiring (contract test)
 *
 * The capability object built by the server composition layer crosses two
 * constructor boundaries before it reaches the code that uses it:
 *
 *     runtime → CLITaskExecutor → ExecutorRegistry → chat executor / runner
 *
 * Every capability inside it is optional, so a dropped forwarding assignment
 * would still compile and would only show up at execution time as a missing
 * tool or a silently skipped telemetry path. These tests supply a distinct
 * sentinel for EVERY capability at the outermost boundary and assert that the
 * intended final consumer receives that exact reference.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import {
    EMPTY_EXECUTOR_RUNTIME,
    type ExecutorRuntimeCapabilities,
} from '../../../src/server/executors/executor-runtime-contracts';
import type { SendToConversationRuntimeOptions } from '../../../src/server/llm-tools/send-to-conversation-tool';
import type { DashboardDiscoveryRuntime } from '@plusplusoneplusplus/coc-client';

// ============================================================================
// Sentinels — one distinguishable value per capability
// ============================================================================

/** Every key of the capability contract, with a sentinel we can identify. */
function makeSentinelRuntime() {
    const sentinels = {
        getWsServer: vi.fn(() => undefined),
        getKustoRuntime: vi.fn(() => undefined),
        getOwnerScriptRunner: vi.fn(() => undefined),
        getBrowserControlRuntime: vi.fn(() => undefined),
        getBrowserToolState: vi.fn(() => undefined),
        getCronInfra: vi.fn(() => undefined),
        getTriggerInfra: vi.fn(() => undefined),
        getRegisterPrOutcome: vi.fn(() => undefined),
        getEnqueueChat: vi.fn(() => undefined),
        getSendMessage: vi.fn(() => undefined),
        getLaunchRalph: vi.fn(() => undefined),
        getSendToConversationRuntime: vi.fn(() => undefined),
        getSentinelTodos: vi.fn(() => undefined),
        getSentinelCoda: vi.fn(() => undefined),
        getSentinelRefrainCommands: vi.fn(() => undefined),
        getMcpOauthManager: vi.fn(() => undefined),
        getTurnPerformanceStore: vi.fn(() => undefined),
        getToolInventoryStore: vi.fn(() => undefined),
        getGlobalSystemPrompt: vi.fn(() => undefined),
        getChatStyleSelectorEnabled: vi.fn(() => false),
        getDefaultChatStyle: vi.fn(() => 'default'),
        resolveAiServiceForProvider: vi.fn(() => sdkMocks.service),
        getAskUserQuestionRelay: vi.fn(() => undefined),
    };
    return sentinels as unknown as ExecutorRuntimeCapabilities & typeof sentinels;
}

function makeBridge(runtime: ExecutorRuntimeCapabilities) {
    const store = createMockProcessStore();
    const executor = new CLITaskExecutor(store, {
        aiService: sdkMocks.service as any,
        runtime,
    });
    return { store, executor };
}

/** Private-field access: this test deliberately inspects the composed graph. */
function internals(executor: CLITaskExecutor) {
    const registry = (executor as any).executors;
    return {
        bridgeRuntime: (executor as any).runtime as ExecutorRuntimeCapabilities,
        registry,
        chatExecutor: registry.chatExecutor,
        followUpExecutor: registry.followUpExecutor,
        autopilotExecutor: registry.autopilotExecutor,
        ralphExecutor: registry.ralphExecutor,
        taskGenerationExecutor: registry.taskGenerationExecutor,
        resolveCommentsExecutor: registry.resolveCommentsExecutor,
        commitChatExecutor: registry.commitChatExecutor,
        noteChatExecutor: registry.noteChatExecutor,
        noteCreateExecutor: registry.noteCreateExecutor,
        classificationExecutor: registry.classificationExecutor,
        dreamTaskExecutor: registry.dreamTaskExecutor,
        runner: registry.runner,
    };
}

/** Names of the ten chat executors the registry composes. */
const CHAT_EXECUTOR_NAMES = [
    'chatExecutor',
    'followUpExecutor',
    'autopilotExecutor',
    'ralphExecutor',
    'taskGenerationExecutor',
    'resolveCommentsExecutor',
    'commitChatExecutor',
    'noteChatExecutor',
    'noteCreateExecutor',
    'classificationExecutor',
] as const;

// ============================================================================
// Tests
// ============================================================================

describe('Executor runtime capability wiring', () => {
    beforeEach(() => {
        sdkMocks.resetAll();
    });

    // ------------------------------------------------------------------
    // Table-driven: one row per capability supplied at the queue bridge
    // ------------------------------------------------------------------

    describe('a capability supplied to CLITaskExecutor reaches its consumer', () => {
        /**
         * capability → the consumer that must end up holding the exact
         * reference supplied at the bridge.
         */
        const CAPABILITY_CONSUMERS: Array<[
            keyof ExecutorRuntimeCapabilities,
            string,
            (parts: ReturnType<typeof internals>) => unknown,
        ]> = [
            ['getSentinelCoda', 'chat executors', p => p.chatExecutor.runtime.getSentinelCoda],
            ['getSentinelRefrainCommands', 'chat executors', p => p.chatExecutor.runtime.getSentinelRefrainCommands],
            ['getWsServer', 'chat executors', p => p.chatExecutor.runtime.getWsServer],
            ['getKustoRuntime', 'chat executors', p => p.chatExecutor.runtime.getKustoRuntime],
            ['getOwnerScriptRunner', 'chat executors', p => p.chatExecutor.runtime.getOwnerScriptRunner],
            ['getOwnerScriptRunner', 'follow-up executor', p => p.followUpExecutor.runtime.getOwnerScriptRunner],
            ['getOwnerScriptRunner', 'ralph executor', p => p.ralphExecutor.runtime.getOwnerScriptRunner],
            ['getCronInfra', 'chat executors', p => p.chatExecutor.runtime.getCronInfra],
            ['getTriggerInfra', 'chat executors', p => p.chatExecutor.runtime.getTriggerInfra],
            ['getEnqueueChat', 'chat executors', p => p.chatExecutor.runtime.getEnqueueChat],
            ['getSendMessage', 'chat executors', p => p.chatExecutor.runtime.getSendMessage],
            ['getLaunchRalph', 'chat executors', p => p.chatExecutor.runtime.getLaunchRalph],
            ['getSendToConversationRuntime', 'chat executors', p => p.chatExecutor.runtime.getSendToConversationRuntime],
            ['getMcpOauthManager', 'chat executors', p => p.chatExecutor.runtime.getMcpOauthManager],
            ['getToolInventoryStore', 'chat executors', p => p.chatExecutor.runtime.getToolInventoryStore],
            ['getGlobalSystemPrompt', 'chat executors', p => p.chatExecutor.runtime.getGlobalSystemPrompt],
            ['resolveAiServiceForProvider', 'chat executors', p => p.chatExecutor.runtime.resolveAiServiceForProvider],
            ['getAskUserQuestionRelay', 'chat executors', p => p.chatExecutor.runtime.getAskUserQuestionRelay],
            // The base executor keeps its own alias for the recorder accessor.
            ['getTurnPerformanceStore', 'base executor recorder', p => p.chatExecutor.getTurnPerformanceRecorder],
            ['getChatStyleSelectorEnabled', 'lifecycle runner', p => p.runner.runtime.getChatStyleSelectorEnabled],
            ['getDefaultChatStyle', 'lifecycle runner', p => p.runner.runtime.getDefaultChatStyle],
            ['getTriggerInfra', 'queue bridge', p => p.bridgeRuntime.getTriggerInfra],
        ];

        it.each(CAPABILITY_CONSUMERS)(
            '%s survives both constructor boundaries and reaches the %s',
            (capability, _consumer, read) => {
                const runtime = makeSentinelRuntime();
                const { executor } = makeBridge(runtime);

                expect(read(internals(executor))).toBe(runtime[capability]);
            },
        );

        it('forwards runOwnerScript from the queue bridge through the registry to the chat executor', async () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const { chatExecutor } = internals(executor);
            const outcome = { ok: true, logs: [], calls: [], callCount: 0, result: 1 };
            const spy = vi.spyOn(chatExecutor, 'runOwnerScript', 'get').mockReturnValue(vi.fn(async () => outcome));
            const request = { workspaceId: 'ws', processId: 'p', code: 'return 1;', allowTools: [] };
            await expect(executor.runOwnerScript(request)).resolves.toBe(outcome);
            expect(spy.mock.results[0].value).toHaveBeenCalledWith(request);
        });

        it('keeps scrubber child chats from receiving ordinary tools when the feature is disabled', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const { chatExecutor } = internals(executor);
            const task = { payload: { context: { sentinelScrub: {
                workspaceId: 'ws', processId: 'parent', runId: 'run',
            } } } };
            expect(() => chatExecutor.buildCodaFindingsTool(task)).toThrow('Sentinel Coda is disabled');
            const markRunning = vi.fn();
            runtime.getSentinelCoda.mockReturnValue({ markRunning } as any);
            expect(chatExecutor.buildCodaFindingsTool(task)?.name).toBe('submit_scrub_findings');
            expect(markRunning).toHaveBeenCalledWith(task.payload.context.sentinelScrub);
            expect(chatExecutor.buildCodaFindingsTool({ payload: {} })).toBeUndefined();
        });

        it('passes the late-bound trigger creation capability to the PR tool', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const { chatExecutor } = internals(executor);
            const deps = chatExecutor.buildCreatePullRequestDeps('process', 'workspace', undefined);
            expect(deps.getCreateTrigger()).toBeUndefined();
            const createTrigger = vi.fn();
            runtime.getTriggerInfra.mockReturnValue({ createTrigger } as any);
            expect(deps.getCreateTrigger()).toBe(createTrigger);
        });

        it('passes owner-bound rule authoring to Sentinel first turns and follow-ups only when available', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const parts = internals(executor);
            const service = { list: vi.fn() };
            const triggers = { create: vi.fn() };
            runtime.getSentinelTodos.mockReturnValue(service as any);
            runtime.getTriggerInfra.mockReturnValue({ sentinelOvertures: triggers } as any);
            for (const chat of [parts.chatExecutor, parts.followUpExecutor]) {
                expect(chat.buildSentinelTodoDeps('owner-chat', 'owner-workspace', 'sentinel'))
                    .toEqual({ service, triggers, getRefrains: expect.any(Function), owner: { processId: 'owner-chat', workspaceId: 'owner-workspace' } });
                const deps = chat.buildSentinelTodoDeps('owner-chat', 'owner-workspace', 'sentinel');
                expect(deps.getRefrains()).toBeUndefined();
                const jobs = { list: vi.fn() };
                runtime.getSentinelRefrainCommands.mockReturnValue({ jobs } as any);
                expect(deps.getRefrains()).toBe(jobs);
                runtime.getSentinelRefrainCommands.mockReturnValue(undefined);
                expect(deps.getRefrains()).toBeUndefined();
                expect(chat.buildSentinelTodoDeps('owner-chat', 'owner-workspace', 'ask')).toBeUndefined();
                runtime.getTriggerInfra.mockReturnValue(undefined);
                expect(chat.buildSentinelTodoDeps('owner-chat', 'owner-workspace', 'sentinel')?.triggers).toBeUndefined();
                runtime.getTriggerInfra.mockReturnValue({ sentinelOvertures: triggers } as any);
            }
        });

        it('shares one capability object with every chat executor, by identity', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const parts = internals(executor);

            for (const name of CHAT_EXECUTOR_NAMES) {
                expect((parts as any)[name].runtime).toBe(parts.bridgeRuntime);
            }
        });

        it('carries every contract capability through to the chat executors', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const shared = internals(executor).chatExecutor.runtime;

            // No capability is dropped in transit: the sentinel object's keys
            // are all present downstream with the same references.
            for (const key of Object.keys(runtime) as Array<keyof ExecutorRuntimeCapabilities>) {
                expect(shared[key]).toBe(runtime[key]);
            }
        });
    });

    // ------------------------------------------------------------------
    // Bridge-owned capabilities
    // ------------------------------------------------------------------

    describe('bridge-owned capabilities', () => {
        it('adds the shared abort registry without disturbing supplied capabilities', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const parts = internals(executor);

            expect(parts.bridgeRuntime.inFlightTurns).toBeInstanceOf(Map);
            expect(parts.chatExecutor.runtime.inFlightTurns)
                .toBe((executor as any).inFlightTurns);
            expect(parts.chatExecutor.runtime.getCronInfra).toBe(runtime.getCronInfra);
        });

        it('routes the Dreams runner to the dream executor through the same object', () => {
            const runtime = makeSentinelRuntime();
            const { executor } = makeBridge(runtime);
            const parts = internals(executor);
            const dreamRunner = { runQueued: vi.fn() } as any;

            // Late-bound: the Dreams runner is created during route composition,
            // after the executor graph exists.
            expect(parts.bridgeRuntime.getDreamRunExecutor?.()).toBeUndefined();
            expect(parts.dreamTaskExecutor.getRunner()).toBeUndefined();

            executor.setDreamRunExecutor(dreamRunner);

            expect(parts.bridgeRuntime.getDreamRunExecutor?.()).toBe(dreamRunner);
            expect(parts.dreamTaskExecutor.getRunner()).toBe(dreamRunner);
        });
    });

    // ------------------------------------------------------------------
    // Getter semantics — capabilities created after the graph is built
    // ------------------------------------------------------------------

    describe('late-bound getter semantics', () => {
        it('sees a capability that only becomes available after construction', () => {
            let cronInfra: unknown;
            const runtime: ExecutorRuntimeCapabilities = {
                getCronInfra: () => cronInfra as any,
            };
            const { executor } = makeBridge(runtime);
            const chatExecutor = internals(executor).chatExecutor;

            // Before infrastructure initialization.
            expect(chatExecutor.runtime.getCronInfra?.()).toBeUndefined();
            expect(chatExecutor.buildCronToolDeps('proc-1')).toEqual({});

            // …and after.
            cronInfra = {
                store: {} as any,
                executor: {} as any,
                resolveWorkspaceId: vi.fn(),
                enqueueWakeup: vi.fn(),
            };
            expect(chatExecutor.runtime.getCronInfra?.()).toBe(cronInfra);
            const deps = chatExecutor.buildCronToolDeps('proc-1');
            expect(deps.scheduleWakeup).toBeDefined();
            expect(deps.cronTools).toBeDefined();
        });

        it('sees the route-layer workspace directory (list_workspaces / remote targets) bound after construction', () => {
            let sendRuntime: SendToConversationRuntimeOptions | undefined;
            const runtime: ExecutorRuntimeCapabilities = {
                getSendToConversationRuntime: () => sendRuntime,
            };
            const { executor } = makeBridge(runtime);
            const chatExecutor = internals(executor).chatExecutor;

            // Remote servers are composed during route registration, after the graph.
            expect(chatExecutor.runtime.getSendToConversationRuntime?.()).toBeUndefined();

            const workspaceDirectory = { list: vi.fn(), startRemoteChat: vi.fn() };
            sendRuntime = { workspaceDirectory };
            expect(chatExecutor.runtime.getSendToConversationRuntime?.()?.workspaceDirectory).toBe(workspaceDirectory);
        });

        it('retains the dashboard discovery getter until WebSocket infrastructure is available', () => {
            let discovery: DashboardDiscoveryRuntime | undefined;
            const getDashboardDiscovery = () => discovery;
            const runtime: ExecutorRuntimeCapabilities = {
                getSendToConversationRuntime: () => ({ getDashboardDiscovery }),
            };
            const { executor } = makeBridge(runtime);
            const parts = internals(executor);
            for (const name of CHAT_EXECUTOR_NAMES) {
                const received = parts[name].runtime.getSendToConversationRuntime().getDashboardDiscovery;
                expect(received).toBe(getDashboardDiscovery);
                expect(received()).toBeUndefined();
            }
            discovery = { listWorkspaces: vi.fn() };
            for (const name of CHAT_EXECUTOR_NAMES) {
                expect(parts[name].runtime.getSendToConversationRuntime().getDashboardDiscovery()).toBe(discovery);
            }
        });
    });

    // ------------------------------------------------------------------
    // Absent runtime
    // ------------------------------------------------------------------

    describe('no runtime supplied', () => {
        it('falls back to the empty capability set instead of throwing', () => {
            const store = createMockProcessStore();
            const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service as any });
            const parts = internals(executor);

            expect(parts.chatExecutor.runtime.getCronInfra).toBeUndefined();
            expect(parts.chatExecutor.runtime.getEnqueueChat).toBeUndefined();
            expect(parts.chatExecutor.buildCronToolDeps('proc-1')).toEqual({});
        });

        it('keeps EMPTY_EXECUTOR_RUNTIME immutable so it can be safely aliased', () => {
            expect(Object.isFrozen(EMPTY_EXECUTOR_RUNTIME)).toBe(true);
        });
    });
});
