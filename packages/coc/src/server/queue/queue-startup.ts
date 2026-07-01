/**
 * Queue Startup Module
 *
 * Encapsulates shared queue initialization: provider resolution, global state,
 * and enqueue capability wiring. Created at server startup to set up the
 * machinery for task enqueueing used by both HTTP routes and in-process tools.
 */

import type { CreateTaskInput } from '@plusplusoneplusplus/forge';
import type { MultiRepoQueueRouter } from './multi-repo-queue-router';
import { prepareTaskForEnqueue } from '../routes/queue-enqueue';
import { enqueueViaBridge, type QueueGlobalState } from '../routes/queue-shared';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { DefaultProviderResolver } from '../providers/default-provider-resolver';
import type { DefaultProviderResolverOptions } from '../providers/default-provider-resolver';
import type { EnqueueChatFn } from '../llm-tools/send-to-conversation-tool';
import type { AgentProvidersQuotaCache } from '../agent-providers/quota-cache';

export interface QueueStartupOptions extends DefaultProviderResolverOptions {
    bridge: MultiRepoQueueRouter;
    dataDir: string;
    globalWorkspaceRootPath: string;
    processStore: ProcessStore;
    quotaCache?: AgentProvidersQuotaCache;
    setEnqueueChat?: (fn: EnqueueChatFn) => void;
}

export interface QueueStartupResult {
    /** Shared mutable global queue state (pause flags, resume tracking). */
    globalState: QueueGlobalState;
    /** Bridge wrapper with resolved default provider in enqueue. */
    bridgeWithResolvedDefaults: MultiRepoQueueRouter;
    /** Prepare a task for enqueueing (resolves defaults, validates). */
    prepareEnqueueTask: (input: CreateTaskInput) => Promise<void>;
    /** Enqueue a task with resolved default provider. */
    enqueueWithResolvedDefaults: (input: CreateTaskInput) => Promise<string>;
    /** Provider resolver for querying provider state. */
    providerResolver: DefaultProviderResolver;
}

/**
 * Initialize queue infrastructure at server startup.
 *
 * Creates shared mutable state (pause flags, resume tracking) and wires up
 * provider resolution so tasks are prepared consistently whether enqueued via
 * HTTP routes or the in-process `send_to_conversation` tool.
 *
 * Also publishes the enqueue-chat capability to executors so they can offer
 * the opt-in task-creation tool.
 */
export function initializeQueueStartup(options: QueueStartupOptions): QueueStartupResult {
    const {
        bridge,
        dataDir,
        globalWorkspaceRootPath,
        processStore,
        quotaCache,
        setEnqueueChat,
    } = options;

    // Create provider resolver with quota cache reference
    const providerResolver = new DefaultProviderResolver({
        runtimeConfigService: options.runtimeConfigService,
        resolvedConfig: options.resolvedConfig,
        configPath: options.configPath,
        quotaCache,
    });

    // Shared mutable global queue state — passed to both HTTP routes and
    // in-process enqueue tool so they observe the same pause flags.
    const globalState: QueueGlobalState = {
        globalPaused: false,
        globalPausedUntil: undefined,
        globalAutopilotPaused: false,
        globalAutopilotPausedUntil: undefined,
        resumeInProgress: new Set(),
    };

    // Prepare task for enqueueing: resolve provider/effort defaults, validate
    const prepareEnqueueTask = async (input: CreateTaskInput): Promise<void> => {
        await prepareTaskForEnqueue(input, {
            getDefaultProvider: () => providerResolver.getConcreteDefaultProvider(),
            resolveDefaultProvider: (opts) => providerResolver.resolveDefaultProvider(opts),
            isAutoProviderRoutingActive: () => providerResolver.isAutoProviderRoutingActive(),
            getEffortTiersForProvider: (provider) => providerResolver.getEffortTiersForProvider(provider),
        });
    };

    // Enqueue with resolved defaults
    const enqueueWithResolvedDefaults = async (input: CreateTaskInput): Promise<string> => {
        await prepareEnqueueTask(input);
        return bridge.enqueue(input);
    };

    // Create bridge wrapper with resolved defaults
    const bridgeWithResolvedDefaults = Object.create(bridge) as MultiRepoQueueRouter;
    Object.defineProperty(bridgeWithResolvedDefaults, 'enqueue', {
        value: enqueueWithResolvedDefaults,
        configurable: true,
        writable: true,
    });

    // Set provider resolver on bridge so queue routes can access it
    bridge.setResolveDefaultProvider((opts) => providerResolver.resolveDefaultProvider(opts));

    // Publish the enqueue-chat capability for executors
    setEnqueueChat?.(async (input: CreateTaskInput): Promise<string> => {
        await prepareEnqueueTask(input);
        return enqueueViaBridge(input, bridge, globalState, globalWorkspaceRootPath, processStore);
    });

    return {
        globalState,
        bridgeWithResolvedDefaults,
        prepareEnqueueTask,
        enqueueWithResolvedDefaults,
        providerResolver,
    };
}
