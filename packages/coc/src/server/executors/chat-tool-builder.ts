import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import type { Tool, ToolEvent } from '@plusplusoneplusplus/coc-agent-sdk';
import { CONFIG_FILE_NAME, resolveConfig } from '../../config';
import type { EnqueueChatFn, SendMessageFn, SendToConversationRuntimeOptions } from '../llm-tools/send-to-conversation-tool';
import type { LaunchRalphFn } from '../ralph/ralph-launch-service';
import type { AskUserToolDeps } from '../llm-tools/ask-user-tool';
import type { WakeupToolDeps, CronToolDeps } from '../llm-tools/cron-tools';
import type { CreatePullRequestToolDeps } from '../llm-tools/create-pull-request-tool';
import type { SentinelTodosToolDeps } from '../llm-tools/sentinel-todos-tool';
import type { KustoToolsRuntime } from '../kusto/kusto-client-runtime';
import type { BrowserControlRuntime } from '@plusplusoneplusplus/coc-client';
import { createBrowserTool, type BrowserToolStateStore } from '../llm-tools/browser-tools';
import { DEFAULT_DISABLED_LLM_TOOLS, filterDisabledLlmTools, isScriptableLlmTool } from '../llm-tools/llm-tool-registry';
import { createRunToolScriptTool } from '../llm-tools/run-tool-script-tool';
import { readApprovalRequiredLlmTools, readEffectiveDisabledLlmTools } from '../preferences-handler';
import { applyLlmToolApprovalGate, type LlmToolApprovalRecord } from './llm-tool-approval-gate';
import type { MemoryV2Addon } from './memory-v2-addon';
import {
    applyLlmToolPreferences,
    buildAskUserAddon,
    buildCanvasToolsAddon,
    buildKustoToolsAddon,
    buildSystemOneToolsAddon,
    type SystemOneAddonDeps,
    buildSendToConversationAddon,
    buildFollowUpSuggestionsAddon,
    buildCronToolsAddon,
    buildCreatePullRequestAddon,
    buildSentinelTodosAddon,
    buildScheduleWakeupAddon,
    buildSearchConversationsAddon,
    buildTavilyWebSearchAddon,
} from './prompt-builder';

type ToolAddon = { tools: Tool<any>[]; suffix: string };
type AskUserAddon = ReturnType<typeof buildAskUserAddon>;

export interface ChatToolBundleOptions {
    /** Trusted native outcome turns retain evidence reads and verdict bookkeeping only. */
    sentinelPrOutcomeReview?: boolean;
    dataDir?: string;
    store: ProcessStore;
    workspaceId?: string;
    /**
     * Bound in-process enqueue capability. When present (and the tool is enabled
     * by preferences), the `send_to_conversation` tool is included so an
     * agent can spawn a brand-new chat. Absent → the addon no-ops.
     */
    enqueueChat?: EnqueueChatFn;
    /**
     * Bound in-process follow-up delivery capability. Enables the post mode of
     * `send_to_conversation` (posting into an existing conversation). Optional.
     */
    sendMessage?: SendMessageFn;
    /** Bound in-process Ralph launch for `send_to_conversation` mode "ralph". */
    launchRalph?: LaunchRalphFn;
    /** Runtime provider/tier helpers used by send_to_conversation. */
    sendToConversationRuntime?: SendToConversationRuntimeOptions;
    processId?: string;
    followUpSuggestions?: { enabled: boolean; count: number };
    askUser?: {
        enabled: boolean;
        deps: AskUserToolDeps;
    };
    /** Memory V2 addon (redesigned coc-memory system). */
    memoryV2?: MemoryV2Addon;
    scheduleWakeup?: WakeupToolDeps;
    cronTools?: CronToolDeps;
    includeFollowUpSuggestions?: boolean;
    includeSearchConversations?: boolean;
    includeTavilyWebSearch?: boolean;
    includeScheduleWakeup?: boolean;
    includeCanvasTools?: boolean;
    /** Overrides the `canvas.enabled` config flag (used by tests). */
    canvasToolsEnabled?: boolean;
    includeKustoTools?: boolean;
    /** Overrides the `kusto.enabled` config flag (used by tests). */
    kustoToolsEnabled?: boolean;
    kustoRuntime?: KustoToolsRuntime;
    browserRuntime?: BrowserControlRuntime;
    browserState?: BrowserToolStateStore;
    /** Turn abort signal, shared by `browser` and `run_tool_script`. */
    browserSignal?: AbortSignal;
    /** Decision service + ledger wiring for `system_one`; absent → the tool is not offered. */
    systemOne?: SystemOneAddonDeps;
    includeSystemOneTool?: boolean;
    /** Overrides the `LLMToolSystemOne.enabled` config flag (used by tests). */
    systemOneToolEnabled?: boolean;
    /**
     * `create_pull_request` wiring. Pass it only for write-capable (autopilot /
     * Ralph) turns — absent → the tool is not offered (ask mode).
     */
    createPullRequest?: CreatePullRequestToolDeps;
    /**
     * `sentinel_todos` wiring for a Sentinel chat; absent in other modes
     * or standalone executors without the server capability.
     */
    sentinelTodos?: SentinelTodosToolDeps;
    /**
     * A Sentinel To-do Scrubber child chat: its findings tool replaces every
     * other LLM tool, so the chat can neither write the ledger nor message
     * other chats.
     */
    scrubFindings?: Tool<any>;
    excludeTools?: string[];
    /** Told how each approval-gated LLM tool call was settled (timeline badge). */
    onLlmToolApprovalDecision?: (record: LlmToolApprovalRecord) => void;
    /** False leaves out `run_tool_script` (browser-only bundles, Codex code mode). */
    includeToolScripting?: boolean;
    /** Overrides the `features.toolScripting` config flag (used by tests). */
    toolScriptingEnabled?: boolean;
    /** Receives `run_tool_script` inner-call events so the timeline nests them under the script. */
    onNestedToolEvent?: (event: ToolEvent) => void;
}

export interface ChatToolBundle {
    tools: Tool<any>[];
    /**
     * Aggregated LLM-tool-guidance prose. Callers route this into the
     * system message via `systemMessageBuilder().appendToolGuidance(...)`
     * rather than appending it to the user prompt.
     */
    toolGuidance: string;
    askUser?: AskUserAddon;
}

/**
 * Low-level tool assembly for a single chat turn.
 *
 * **Prefer `buildChatTurnContext()` for executor code.** That wrapper calls
 * this function internally and additionally wires Memory V2 tools, Memory V2
 * prompt context, SDK built-in exclusions, and resource disposal into one
 * cohesive object so callers do not have to coordinate those artifacts manually.
 *
 * Use `buildChatToolBundle` directly only in `buildChatTurnContext` itself and
 * in its unit tests.
 */
export function buildChatToolBundle(options: ChatToolBundleOptions): ChatToolBundle {
    if (options.scrubFindings && !options.sentinelPrOutcomeReview) {
        // Approval handles stay wired for the dangerous-command guard; the tool is not offered.
        const askUser = options.askUser ? buildAskUserAddon(options.askUser.enabled, options.askUser.deps) : undefined;
        return { tools: [options.scrubFindings], toolGuidance: '', askUser };
    }
    const addons: ToolAddon[] = [];
    if (!options.sentinelPrOutcomeReview && options.browserRuntime?.getEnabled() && options.browserState && options.workspaceId && options.processId) {
        const deps = { workspaceId: options.workspaceId, processId: options.processId,
            runtime: options.browserRuntime, stateStore: options.browserState };
        const tool = createBrowserTool({ ...deps, signal: options.browserSignal });
        addons.push({
            tools: [tool],
            suffix: '',
        });
    }

    if (options.includeFollowUpSuggestions !== false && options.followUpSuggestions) {
        addons.push(buildFollowUpSuggestionsAddon(
            options.followUpSuggestions.enabled,
            options.followUpSuggestions.count,
        ));
    }

    if (options.includeSearchConversations !== false) {
        addons.push(buildSearchConversationsAddon(
            options.store,
            options.workspaceId,
            options.processId,
            options.sendToConversationRuntime?.workspaceDirectory,
            options.sendToConversationRuntime?.getDashboardDiscovery,
        ));
    }

    if (options.enqueueChat && !options.sentinelPrOutcomeReview) {
        addons.push(buildSendToConversationAddon(
            options.store,
            options.workspaceId,
            options.enqueueChat,
            options.processId,
            options.sendMessage,
            options.sendToConversationRuntime,
            options.launchRalph,
            options.sentinelTodos,
        ));
    }

    const askUser = options.askUser
        ? buildAskUserAddon(options.askUser.enabled, options.askUser.deps)
        : undefined;
    if (askUser) {
        addons.push(askUser);
    }

    if (options.includeTavilyWebSearch !== false) {
        addons.push(buildTavilyWebSearchAddon(options.dataDir));
    }

    if (options.includeScheduleWakeup !== false && !options.sentinelPrOutcomeReview) {
        addons.push(buildScheduleWakeupAddon(options.scheduleWakeup));
    }

    if (options.cronTools && !options.sentinelPrOutcomeReview) {
        addons.push(buildCronToolsAddon(options.cronTools));
    }

    if (options.includeCanvasTools !== false && !options.sentinelPrOutcomeReview) {
        addons.push(buildCanvasToolsAddon(
            options.dataDir,
            options.store,
            options.workspaceId,
            options.processId,
            options.canvasToolsEnabled !== undefined ? { enabled: options.canvasToolsEnabled } : undefined,
        ));
    }

    if (options.includeKustoTools !== false && !options.sentinelPrOutcomeReview) {
        addons.push(buildKustoToolsAddon(
            options.dataDir,
            options.store,
            options.workspaceId,
            options.processId,
            {
                enabled: options.kustoToolsEnabled ?? options.kustoRuntime?.getEnabled(),
                runtime: options.kustoRuntime,
            },
        ));
    }

    if (options.includeSystemOneTool !== false) {
        addons.push(buildSystemOneToolsAddon(
            options.dataDir,
            options.workspaceId,
            options.processId,
            options.systemOne,
            options.systemOneToolEnabled !== undefined ? { enabled: options.systemOneToolEnabled } : undefined,
        ));
    }

    if (options.createPullRequest && !options.sentinelPrOutcomeReview) {
        addons.push(buildCreatePullRequestAddon(options.createPullRequest));
    }

    if (options.sentinelTodos) {
        addons.push(buildSentinelTodosAddon(options.sentinelPrOutcomeReview
            ? { ...options.sentinelTodos, reviewOnly: true, triggers: undefined } : options.sentinelTodos));
    }

    if (options.memoryV2 && !options.sentinelPrOutcomeReview) {
        addons.push(options.memoryV2);
    }

    const disabledLlmTools = options.dataDir && options.workspaceId
        ? readEffectiveDisabledLlmTools(options.dataDir, options.workspaceId)
        : undefined;
    const disabledWithContextExclusions = mergeDisabledTools(disabledLlmTools, options.excludeTools);
    const { tools: enabledTools, toolGuidance } = applyLlmToolPreferences(addons, disabledWithContextExclusions);
    const reviewTools = new Set(['sentinel_todos', 'search_conversations', 'get_conversation',
        'tavily_web_search', 'ask_user', 'system_one', 'suggest_follow_ups']);

    const approvalRequired = options.dataDir && options.workspaceId
        ? readApprovalRequiredLlmTools(options.dataDir, options.workspaceId)
        : [];
    const askUserDeps = options.askUser?.deps;
    const approvalGate = {
        processId: options.processId,
        approvalRequired,
        // Same signal ask_user uses: unset means a person is watching.
        isInteractive: () => askUserDeps?.isInteractive?.() !== false,
        // No ask-user wiring (workflows, unattended paths) → nobody to ask.
        getAskApproval: () => (askUserDeps ? askUser?.askApproval : undefined),
        onDecision: options.onLlmToolApprovalDecision,
    };
    const tools = applyLlmToolApprovalGate(options.sentinelPrOutcomeReview
        ? enabledTools.filter(tool => reviewTools.has(tool.name)) : enabledTools, approvalGate);

    // Built last, over the filtered and gated list: a script reaches only the
    // tools this turn already offers, and gated tools still ask the user.
    if (options.includeToolScripting !== false && !options.sentinelPrOutcomeReview
        && isToolScriptingEnabled(options)
        && filterDisabledLlmTools([{ name: 'run_tool_script' }], disabledWithContextExclusions).length > 0) {
        const { tool } = createRunToolScriptTool({
            tools: tools.filter(t => isScriptableLlmTool(t.name)),
            workspaceId: options.workspaceId,
            processId: options.processId,
            signal: options.browserSignal,
            onNestedToolEvent: options.onNestedToolEvent,
        });
        tools.push(...applyLlmToolApprovalGate([tool], approvalGate));
    }

    return { tools, toolGuidance, askUser };
}

function isToolScriptingEnabled(options: ChatToolBundleOptions): boolean {
    if (options.toolScriptingEnabled !== undefined) return options.toolScriptingEnabled;
    return !!options.dataDir
        && resolveConfig(path.join(options.dataDir, CONFIG_FILE_NAME)).features.toolScripting === true;
}

function mergeDisabledTools(
    disabledLlmTools: string[] | undefined,
    excludeTools: string[] | undefined,
): string[] | undefined {
    if (!excludeTools || excludeTools.length === 0) {
        return disabledLlmTools;
    }

    return Array.from(new Set([
        ...(disabledLlmTools ?? DEFAULT_DISABLED_LLM_TOOLS),
        ...excludeTools,
    ]));
}
