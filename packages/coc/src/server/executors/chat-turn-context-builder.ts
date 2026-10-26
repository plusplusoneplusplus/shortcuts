/**
 * Chat Turn Context Builder
 *
 * Centralizes common addon assembly for all chat-mode executor paths:
 * ask and autopilot (both `ChatBaseExecutor.buildStandardModeOptions`), Ralph
 * (RalphExecutor.buildModeOptions), and follow-up
 * (FollowUpExecutor.executeFollowUp).
 *
 * Returns one cohesive context object so callers do not need to
 * independently coordinate Memory V2 tools, Memory V2 prompt context,
 * SDK built-in exclusions, ask-user handles, and resource disposal.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Tool, ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import type { LaunchRalphFn } from '../ralph/ralph-launch-service';
import type { AskUserToolDeps } from '../llm-tools/ask-user-tool';
import type { WakeupToolDeps, CronToolDeps } from '../llm-tools/cron-tools';
import type { CreatePullRequestToolDeps } from '../llm-tools/create-pull-request-tool';
import type { SentinelTodosToolDeps } from '../llm-tools/sentinel-todos-tool';
import type { SentinelRefrainsToolDeps } from '../llm-tools/sentinel-refrains-tool';
import type { MemoryV2Addon } from './memory-v2-addon';
import type { SystemOneAddonDeps } from './prompt-builder';
import { buildMemoryV2Addon } from './memory-v2-addon';
import { buildChatToolBundle, isToolScriptingMcpEnabled } from './chat-tool-builder';
import { resolveChatMcpServersForWorkspace } from './mcp-tool-enforcement';
import type { LlmToolApprovalRecord } from './llm-tool-approval-gate';
import type { ChatToolBundle } from './chat-tool-builder';
import type { KustoToolsRuntime } from '../kusto/kusto-client-runtime';
import type { OwnerScriptRunner } from './owner-script-runner';
import type { BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';
import type { BrowserToolStateStore } from '../llm-tools/browser-tools';
import { processOperationAdmission } from '../processes/process-operation-admission';

// ============================================================================
// Types
// ============================================================================

export interface ChatTurnContextInput {
    sentinelPrOutcomeReview?: boolean;
    /** Background scripts omit questions and automatically deny approval-gated tools. */
    unattendedScript?: boolean;
    dataDir?: string;
    store: ProcessStore;
    workspaceId?: string;
    processId?: string;
    /**
     * The current prompt/query text — used for per-turn memory recall.
     * Pass undefined to skip per-turn recall (frozen snapshot only).
     */
    query?: string;
    followUpSuggestions?: { enabled: boolean; count: number };
    sentinelNextSteps?: boolean;
    /**
     * Bound in-process enqueue capability. When present (and the opt-in
     * `send_to_conversation` tool is enabled by preferences), an agent can spawn a
     * brand-new chat. Absent → the addon no-ops and the tool is not offered.
     */
    enqueueChat?: EnqueueChatFn;
    /**
     * Bound in-process follow-up delivery capability. Enables the post mode of
     * `send_to_conversation` (posting `content` into an existing conversation).
     * Absent → post mode reports the capability is unavailable.
     */
    sendMessage?: SendMessageFn;
    /** Bound in-process Ralph launch for `send_to_conversation` mode "ralph". */
    launchRalph?: LaunchRalphFn;
    /** Runtime provider/tier helpers used by send_to_conversation. */
    sendToConversationRuntime?: SendToConversationRuntimeOptions;
    scheduleWakeup?: WakeupToolDeps;
    cronTools?: CronToolDeps;
    askUser?: {
        enabled: boolean;
        deps: AskUserToolDeps;
    };
    /** Decision service + ledger wiring for `system_one`; absent → the tool is not offered. */
    systemOne?: SystemOneAddonDeps;
    kustoRuntime?: KustoToolsRuntime;
    /** Owner-bound script runner behind canvas `host.runScript`. */
    ownerScriptRunner?: OwnerScriptRunner;
    browserRuntime?: BrowserControlRuntime;
    browserState?: BrowserToolStateStore;
    browserSignal?: AbortSignal;
    browserActivation?: boolean;
    browserOnly?: boolean;
    /**
     * `create_pull_request` wiring. Autopilot-only: pass it for write-capable
     * turns and omit it in ask mode so read-only chats never see the tool.
     */
    createPullRequest?: CreatePullRequestToolDeps;
    /** `sentinel_todos` wiring; Sentinel chats only. */
    sentinelTodos?: SentinelTodosToolDeps;
    /** `sentinel_jobs` wiring; the owning Sentinel chat's attended turns only. */
    sentinelRefrains?: SentinelRefrainsToolDeps;
    /** A scrubber child chat's only tool; also skips Memory V2. */
    codaFindings?: Tool<any>;
    /** Additional tool names to exclude beyond workspace preferences. */
    excludeTools?: string[];
    /** Told how each approval-gated LLM tool call was settled (timeline badge). */
    onLlmToolApprovalDecision?: (record: LlmToolApprovalRecord) => void;
    /** False leaves out `run_tool_script` (Codex code-mode models already have `functions.exec`). */
    includeToolScripting?: boolean;
    /** Receives `run_tool_script` inner-call events so the timeline nests them under the script. */
    onNestedToolEvent?: (event: ToolEvent) => void;
    /**
     * Turn working directory, the fallback root when resolving the workspace's
     * MCP servers for `run_tool_script` (`features.toolScriptingMcp`).
     */
    workingDirectory?: string;
    /**
     * Whether to include Memory V2 tools and context in this turn.
     * Defaults to true. No chat path opts out today — autopilot used to, which
     * made its tool block differ from ask mode's and cost the conversation's
     * prefix cache on a mid-chat mode toggle.
     */
    includeMemoryV2?: boolean;
}

export interface ChatTurnContext {
    browserPrompt: string;
    /** AI-callable tool definitions. */
    tools: Tool<any>[];
    /** Aggregated tool-guidance prose — route into system message via `appendToolGuidance`. */
    toolGuidance: string;
    /**
     * The resolved Memory V2 addon.
     * Use `.appendMemoryV2(ctx.memoryV2)` on the system message builder.
     * When Memory V2 is not enabled or opted out, this is a no-op empty addon.
     */
    memoryV2: MemoryV2Addon;
    /**
     * Built-in Copilot tool names to suppress for this session.
     * Pass as `excludedTools` to `aiService.sendMessage(...)` when non-empty.
     */
    excludedTools: string[];
    /** Ask-user addon handles (defined when askUser.enabled is true). */
    askUser?: ChatToolBundle['askUser'];
    /** Dispose all open resources (memory DB handles, script MCP clients). Safe to call multiple times. */
    dispose: () => void;
}

// ============================================================================
// Empty addon — returned when Memory V2 is opted out or unavailable
// ============================================================================

const EMPTY_MEM_V2: MemoryV2Addon = Object.freeze({
    systemMessageSuffix: undefined,
    tools: [],
    suffix: '',
    excludedBuiltinTools: [],
    dispose: () => {},
});

// ============================================================================
// Builder
// ============================================================================

/**
 * Assemble the common chat-turn capability context for any executor path.
 *
 * This is the single source-of-truth for wiring Memory V2 tools, Memory V2
 * prompt context, SDK built-in exclusions, ask-user handles, and cron/work-item
 * tools into one cohesive object. Callers pass the returned `ChatTurnContext`
 * into their system message builder and `sendMessage` options rather than
 * assembling these artifacts individually.
 *
 * @example
 * ```typescript
 * const ctx = await buildChatTurnContext({
 *     dataDir: this.dataDir,
 *     store: this.store,
 *     workspaceId: payload.workspaceId,
 *     processId,
 *     query: prompt,
 *     followUpSuggestions: this.followUpSuggestions,
 *     scheduleWakeup: cronDeps.scheduleWakeup,
 *     cronTools: cronDeps.cronTools,
 * });
 *
 * try {
 *     const systemMessage = await systemMessageBuilder()
 *         .append(modePrompt)
 *         .appendMemoryV2(ctx.memoryV2)
 *         .appendToolGuidance(ctx.toolGuidance)
 *         .build();
 *
 *     await aiService.sendMessage({
 *         tools: ctx.tools,
 *         excludedTools: ctx.excludedTools,
 *         systemMessage,
 *         ...
 *     });
 * } finally {
 *     ctx.dispose();
 * }
 * ```
 */
export async function buildChatTurnContext(input: ChatTurnContextInput): Promise<ChatTurnContext> {
    const includeMemoryV2 = input.includeMemoryV2 !== false && !input.codaFindings && !input.browserOnly
        && !input.sentinelPrOutcomeReview;

    const memoryV2: MemoryV2Addon = includeMemoryV2
        ? await buildMemoryV2Addon(input.dataDir, input.workspaceId, input.query, input.processId)
        : EMPTY_MEM_V2;

    // Scripts reach the same MCP servers the turn resolves for its workspace;
    // nothing is started until a script uses one.
    const scriptsMayUseMcp = input.includeToolScripting !== false && !input.browserOnly && !input.codaFindings
        && !input.sentinelPrOutcomeReview && isToolScriptingMcpEnabled(input.dataDir);
    const mcpServers = scriptsMayUseMcp
        ? await resolveChatMcpServersForWorkspace({
            store: input.store, dataDir: input.dataDir, workspaceId: input.workspaceId, workingDirectory: input.workingDirectory,
        })
        : undefined;

    const toolBundle = buildChatToolBundle({
        sentinelPrOutcomeReview: input.sentinelPrOutcomeReview,
        unattendedScript: input.unattendedScript,
        dataDir: input.dataDir,
        store: input.store,
        workspaceId: input.workspaceId,
        processId: input.processId,
        followUpSuggestions: input.followUpSuggestions,
        sentinelNextSteps: input.sentinelNextSteps,
        enqueueChat: input.enqueueChat,
        sendMessage: input.sendMessage,
        launchRalph: input.launchRalph,
        sendToConversationRuntime: input.sendToConversationRuntime,
        memoryV2: includeMemoryV2 ? memoryV2 : undefined,
        scheduleWakeup: input.scheduleWakeup,
        cronTools: input.cronTools,
        askUser: input.askUser,
        systemOne: input.systemOne,
        kustoRuntime: input.kustoRuntime,
        ownerScriptRunner: input.ownerScriptRunner,
        browserRuntime: input.browserRuntime,
        browserState: input.browserState,
        browserSignal: input.browserSignal,
        createPullRequest: input.createPullRequest,
        sentinelTodos: input.sentinelTodos,
        sentinelRefrains: input.sentinelRefrains,
        codaFindings: input.codaFindings,
        excludeTools: input.excludeTools,
        onLlmToolApprovalDecision: input.onLlmToolApprovalDecision,
        includeToolScripting: input.includeToolScripting,
        onNestedToolEvent: input.onNestedToolEvent,
        mcpServers,
        ...(input.browserOnly ? {
            includeFollowUpSuggestions: false, includeSearchConversations: false,
            includeTavilyWebSearch: false, includeScheduleWakeup: false,
            includeCanvasTools: false, includeKustoTools: false, includeSystemOneTool: false,
            includeToolScripting: false,
        } : {}),
    });

    let browserPrompt = '';
    if (toolBundle.tools.some(tool => tool.name === 'browser') && input.processId) {
        const processId = input.processId;
        browserPrompt = await processOperationAdmission.runExclusive(processId, async () => {
            const process = await input.store.getProcess(processId, input.workspaceId);
            const activated = input.browserActivation ?? /(?:^|\s)\/browser(?=\s|$)/i.test(input.query ?? '');
            if (activated && process && process.metadata?.browserMode !== true) {
                await input.store.updateProcess(processId, {
                    metadata: { type: process.metadata?.type ?? 'chat', ...process.metadata, browserMode: true },
                });
            }
            return activated || process?.metadata?.browserMode === true
                ? 'Browser mode is active. Use the browser tool to browse and interact with the desktop browser.'
                : '';
        });
    }
    return {
        browserPrompt,
        tools: toolBundle.tools,
        toolGuidance: toolBundle.toolGuidance,
        memoryV2,
        excludedTools: input.sentinelPrOutcomeReview ? [...new Set([
            ...memoryV2.excludedBuiltinTools,
            'bash', 'powershell', 'create', 'edit', 'write', 'apply_patch', 'task',
            'Bash', 'Write', 'Edit', 'NotebookEdit', 'Task', 'Agent',
            'run_in_terminal', 'terminal', 'execute', 'run_subagent',
            'create_pull_request', 'send_to_conversation', 'cron', 'scheduleWakeup',
            'store_memory', 'vote_memory', 'save_memory', 'skill',
        ])] : memoryV2.excludedBuiltinTools,
        askUser: toolBundle.askUser,
        dispose: () => {
            memoryV2.dispose();
            void toolBundle.mcpScope?.close();
        },
    };
}
