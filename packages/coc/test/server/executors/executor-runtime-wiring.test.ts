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

// ============================================================================
// Sentinels — one distinguishable value per capability
// ============================================================================

/** Every key of the capability contract, with a sentinel we can identify. */
function makeSentinelRuntime() {
    const sentinels = {
        getWsServer: vi.fn(() => undefined),
        getCronInfra: vi.fn(() => undefined),
        getTriggerInfra: vi.fn(() => undefined),
        getEnqueueChat: vi.fn(() => undefined),
        getSendMessage: vi.fn(() => undefined),
        getSendToConversationRuntime: vi.fn(() => undefined),
        getMcpOauthManager: vi.fn(() => undefined),
        getTurnPerformanceStore: vi.fn(() => undefined),
        getGlobalSystemPrompt: vi.fn(() => undefined),
        getChatStyleSelectorEnabled: vi.fn(() => false),
        getDefaultChatStyle: vi.fn(() => 'default'),
        resolveAiServiceForProvider: vi.fn(() => sdkMocks.service),
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
            ['getWsServer', 'chat executors', p => p.chatExecutor.runtime.getWsServer],
            ['getCronInfra', 'chat executors', p => p.chatExecutor.runtime.getCronInfra],
            ['getEnqueueChat', 'chat executors', p => p.chatExecutor.runtime.getEnqueueChat],
            ['getSendMessage', 'chat executors', p => p.chatExecutor.runtime.getSendMessage],
            ['getSendToConversationRuntime', 'chat executors', p => p.chatExecutor.runtime.getSendToConversationRuntime],
            ['getMcpOauthManager', 'chat executors', p => p.chatExecutor.runtime.getMcpOauthManager],
            ['getGlobalSystemPrompt', 'chat executors', p => p.chatExecutor.runtime.getGlobalSystemPrompt],
            ['resolveAiServiceForProvider', 'chat executors', p => p.chatExecutor.runtime.resolveAiServiceForProvider],
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

            expect(parts.bridgeRuntime.processAbortControllers).toBeInstanceOf(Map);
            expect(parts.chatExecutor.runtime.processAbortControllers)
                .toBe((executor as any).processAbortControllers);
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
