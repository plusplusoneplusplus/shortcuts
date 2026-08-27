/**
 * Executor Runtime Contracts
 *
 * Single source of truth for the late-bound capabilities that the server
 * composition layer hands to the executor graph.
 *
 * The executor graph is built in three nested steps
 * (`MultiRepoQueueRouter` → `CLITaskExecutor` → `ExecutorRegistry` → chat
 * executors) but most of the infrastructure it needs — cron, the WebSocket
 * server, the MCP OAuth manager, the Dreams runner, the turn-performance
 * store — is created *after* that graph exists. Those capabilities are
 * therefore exposed as getters and collected in one object,
 * {@link ExecutorRuntimeCapabilities}, that is passed by identity down the
 * chain. Nothing is copied field by field, so a newly added capability cannot
 * be silently dropped at one hop and leave a tool or telemetry path disabled
 * at execution time.
 *
 * Classification used here:
 * - **Runtime capability** — late-bound, shared by more than one consumer,
 *   lives in {@link ExecutorRuntimeCapabilities}.
 * - **Static configuration** (timeouts, provider default, feature toggles,
 *   `dataDir`, working directory) — stays on each layer's own option bag.
 * - **Consumer view** — a narrow `Pick` of the capability object
 *   ({@link ChatExecutorRuntime}, {@link LifecycleRuntime},
 *   {@link DreamRuntime}) so each consumer receives only what it uses.
 *
 * Types are declared here rather than imported from concrete executors so the
 * queue layer never has to reach into an executor implementation for a
 * contract.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { ChatStyle } from '@plusplusoneplusplus/coc-client';
import type { ISDKService } from '@plusplusoneplusplus/forge';
import type { ChatProvider } from '../tasks/task-types';
import type { CronEventEmit, CronExecutor } from '../cron/cron-executor';
import type { CronStore } from '../cron/cron-store';
import type { DreamRunExecutor } from '../dreams/dream-runner';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import type { McpOauthManager } from '../mcp-oauth';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import type { TriggerManager } from '../triggers/trigger-manager';
import type { TurnPerformanceRecorder } from './turn-performance-tracker';

// ============================================================================
// Feature dependency bundles
// ============================================================================

/** Late-bound cron infrastructure deps (created after the executor registry). */
export interface CronInfraDeps {
    store: CronStore;
    executor: CronExecutor;
    /** Cron event emitter (used by LLM tools to broadcast state changes). */
    emit?: CronEventEmit;
    resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    enqueueWakeup: (opts: {
        processId: string;
        prompt: string;
        delayMs: number;
        wakeupId: string;
        model?: string;
        workspaceId?: string;
    }) => void;
}

/** Late-bound trigger infrastructure deps (created after the executor registry). */
export interface TriggerInfraDeps {
    manager: TriggerManager;
}

// ============================================================================
// Shared capability object
// ============================================================================

/**
 * Every late-bound capability the executor graph can be given.
 *
 * Each member stays individually optional — infrastructure genuinely is
 * absent in tests and during early startup — but the object itself is passed
 * by identity, so no layer can drop a member it does not know about. Members
 * are getters (not captured values) so a capability created after the graph is
 * built is still visible at execution time.
 *
 * Treat instances as immutable: build one in the composition layer and share
 * it. Keep this capability-only — server configuration and stores that
 * executors do not need must not be added here, or it degenerates into a
 * service locator.
 */
export interface ExecutorRuntimeCapabilities {
    /** WebSocket server for process/git broadcasts. */
    readonly getWsServer?: () => ProcessWebSocketServer | undefined;
    /** Cron infrastructure powering the `cron` and `scheduleWakeup` tools. */
    readonly getCronInfra?: () => CronInfraDeps | undefined;
    /** Trigger infrastructure; consumed by the bridge's action-completion hook. */
    readonly getTriggerInfra?: () => TriggerInfraDeps | undefined;
    /**
     * In-process enqueue capability bound at the route layer (where the queue
     * router and global state live). Powers the create mode of
     * `send_to_conversation`; absent → the tool is not offered.
     */
    readonly getEnqueueChat?: () => EnqueueChatFn | undefined;
    /**
     * In-process follow-up delivery bound at the route layer. Powers the post
     * mode of `send_to_conversation` — posting into an existing conversation.
     */
    readonly getSendMessage?: () => SendMessageFn | undefined;
    /** Provider/tier helpers for `send_to_conversation`. */
    readonly getSendToConversationRuntime?: () => SendToConversationRuntimeOptions | undefined;
    /** MCP OAuth manager used to surface an interactive authorization prompt. */
    readonly getMcpOauthManager?: () => McpOauthManager | undefined;
    /**
     * Turn-performance metric store. Executors record one TTFT/TPS event per
     * settled turn through it; recording is skipped when unset.
     */
    readonly getTurnPerformanceStore?: () => TurnPerformanceRecorder | undefined;
    /**
     * Live read of the admin-configured global system prompt
     * (`chat.globalSystemPrompt`), backed by RuntimeConfigService so edits take
     * effect without a restart. Injected into user-facing sessions only.
     */
    readonly getGlobalSystemPrompt?: () => string | undefined;
    /**
     * Live read of the `features.chatStyleSelector` admin flag, checked as each
     * new conversation starts so disabling the feature stops style injection
     * even for an older client or an already-open composer.
     */
    readonly getChatStyleSelectorEnabled?: () => boolean;
    /**
     * Live read of the `features.defaultChatStyle` admin setting — the style a
     * brand-new conversation starts on when the request carries no explicit
     * `chatStyle` (API callers, older clients, buffered or restarted tasks).
     */
    readonly getDefaultChatStyle?: () => ChatStyle;
    /**
     * Resolve an ISDKService for a provider, checking enablement and
     * availability. Lets executors route per chat without holding a
     * RuntimeConfigService reference. Throws with a user-facing message when
     * the provider is disabled or unavailable.
     */
    readonly resolveAiServiceForProvider?: (provider: ChatProvider) => ISDKService;
    /** Dreams runner, created during route composition. */
    readonly getDreamRunExecutor?: () => DreamRunExecutor | undefined;
    /**
     * Shared per-process AbortController registry owned by the queue bridge.
     * Chat executors register a controller per turn so the bridge's cancel path
     * can abort an in-flight `sendMessage` before an `sdkSessionId` is
     * persisted.
     */
    readonly processAbortControllers?: Map<string, AbortController>;
}

// ============================================================================
// Consumer views
// ============================================================================

/**
 * Capabilities visible to the chat-mode executors. Deliberately excludes
 * trigger infrastructure, the Dreams runner and the chat-style flag, which
 * belong to the bridge, the Dreams executor and the lifecycle runner.
 */
export type ChatExecutorRuntime = Pick<
    ExecutorRuntimeCapabilities,
    | 'getWsServer'
    | 'getCronInfra'
    | 'getEnqueueChat'
    | 'getSendMessage'
    | 'getSendToConversationRuntime'
    | 'getMcpOauthManager'
    | 'getTurnPerformanceStore'
    | 'getGlobalSystemPrompt'
    | 'resolveAiServiceForProvider'
    | 'processAbortControllers'
>;

/** Capabilities visible to {@link ProcessLifecycleRunner}. */
export type LifecycleRuntime = Pick<ExecutorRuntimeCapabilities, 'getChatStyleSelectorEnabled' | 'getDefaultChatStyle'>;

/** Capabilities visible to the Dreams task executor. */
export type DreamRuntime = Pick<ExecutorRuntimeCapabilities, 'getDreamRunExecutor'>;

/**
 * Shared empty capability set, used when a caller supplies no runtime at all
 * (tests, CLI-only paths). Frozen so it can be safely aliased.
 */
export const EMPTY_EXECUTOR_RUNTIME: ExecutorRuntimeCapabilities = Object.freeze({});
