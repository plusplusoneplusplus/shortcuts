/**
 * Chat Turn Runner
 *
 * The `sendMessage` payload shared by the first-turn path
 * (`ChatBaseExecutor.execute`) and the continuation path
 * (`FollowUpExecutor.executeFollowUp`).
 *
 * The two paths still own their final options object — a first turn carries
 * attachments and a Ralph grill plan, a follow-up carries a session id, a
 * delivery mode, and strict-resume enforcement — but everything that is *not*
 * path-specific now comes from one place:
 *
 * - `buildChatTurnSendOptions` — the ~20 invariant fields: prompt, agent mode,
 *   the resolved model/effort/context tier, infinite sessions, keep-warm,
 *   directories, budgets, tools and exclusions, the system message, skills, the
 *   MCP allow-list, and the full streaming/tool/token/background/OAuth callback
 *   set. Callers spread their extras on top.
 * - `buildMcpOAuthHandler` — pending-entry registration and the
 *   `mcp-oauth-required` process event.
 *
 * The point is that a new turn-level option or callback lands once and reaches
 * both paths. It is also why the paths cannot silently drift the way
 * `onMcpOAuthRequired` did — it was wired on first turns only, so an MCP server
 * that demanded OAuth mid-conversation went untracked.
 */

import type { ProcessStore, SendMessageOptions, SystemMessageConfig } from '@plusplusoneplusplus/forge';
import { approveAllPermissions, getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { AgentMode, ReasoningEffort, Tool } from '@plusplusoneplusplus/coc-agent-sdk';
import type { McpOauthManager } from '../mcp-oauth';

// ============================================================================
// MCP OAuth
// ============================================================================

/** Event shape the SDK reports when an MCP server needs interactive OAuth. */
export interface McpOAuthRequiredEvent {
    serverName: string;
    serverUrl: string;
    authorizationUrl?: string;
    requestId: string;
}

export interface McpOAuthHandlerInput {
    store: ProcessStore;
    processId: string;
    workspaceId?: string;
    /** The user message that triggered the turn, replayed after authorization. */
    originalMessage: string;
    /** Late-bound OAuth manager; `undefined` disables tracking for this turn. */
    manager: McpOauthManager | undefined;
    /** Log prefix so each path keeps its existing wording. */
    logLabel: string;
}

/**
 * Build the `onMcpOAuthRequired` callback for a turn.
 *
 * Registers a pending OAuth entry and emits an `mcp-oauth-required` process
 * event so the dashboard can prompt the user. Returns `undefined` when no
 * manager is wired, which tells the SDK not to track OAuth for this turn.
 *
 * Non-fatal by contract at every step: neither registration nor SSE emission
 * may interrupt the in-flight session.
 */
export function buildMcpOAuthHandler(
    input: McpOAuthHandlerInput,
): ((event: McpOAuthRequiredEvent) => void) | undefined {
    const { store, processId, workspaceId, originalMessage, manager, logLabel } = input;
    if (!manager) {
        getLogger().debug(
            LogCategory.AI,
            `${logLabel} No McpOauthManager wired — MCP OAuth events will not be tracked for process ${processId}`,
        );
        return undefined;
    }

    return (event: McpOAuthRequiredEvent) => {
        getLogger().info(
            LogCategory.MCP,
            `${logLabel} MCP OAuth event received: server=${event.serverName} url=${event.serverUrl} requestId=${event.requestId} hasAuthUrl=${!!event.authorizationUrl} processId=${processId} workspaceId=${workspaceId ?? '(none)'}`,
        );
        try {
            const entry = manager.addPending({
                requestId: event.requestId,
                serverName: event.serverName,
                serverUrl: event.serverUrl,
                authorizationUrl: event.authorizationUrl,
                processId,
                workspaceId,
                originalMessage,
            });
            getLogger().debug(
                LogCategory.MCP,
                `${logLabel} MCP OAuth entry registered: id=${entry.id} server=${event.serverName} status=${entry.status}`,
            );
            try {
                store.emitProcessEvent(processId, {
                    type: 'mcp-oauth-required',
                    mcpOAuth: {
                        requestId: entry.id,
                        serverName: event.serverName,
                        serverUrl: event.serverUrl,
                        authorizationUrl: event.authorizationUrl,
                    },
                });
            } catch {
                // Non-fatal: SSE emission must not interrupt the session
            }
        } catch (oauthErr) {
            // Non-fatal: OAuth dispatch must not interrupt the session.
            getLogger().warn(
                LogCategory.MCP,
                `${logLabel} Failed to register MCP OAuth entry for server=${event.serverName} requestId=${event.requestId}: ${oauthErr instanceof Error ? oauthErr.message : String(oauthErr)}`,
            );
        }
    };
}


// ============================================================================
// Shared sendMessage options
// ============================================================================

/**
 * Everything a chat turn needs that does not depend on whether it opens a
 * session or resumes one.
 *
 * Fields that genuinely differ per path are deliberately absent — the caller
 * spreads them over the result: `sessionId` / `strictSessionResume` /
 * `deliveryMode` (follow-up only) and `attachments` (first turn only).
 */
export interface ChatTurnSendOptionsInput {
    /** Final outgoing prompt, after every directive and context block. */
    prompt: string;
    /** Protocol-level write enforcement for the turn. */
    agentMode: AgentMode | undefined;
    /** Output of `resolveChatTurnPolicy` — the model/effort/tier triple. */
    policy: {
        modelId?: string;
        reasoningEffort?: ReasoningEffort;
        contextTier?: 'default' | 'long_context';
    };
    workingDirectory: string | undefined;
    /** Repo-group member roots, when the workspace is a group. */
    additionalDirectories?: string[];
    signal: AbortSignal;
    /**
     * Wall-clock budget. A first turn prefers its task's own `timeoutMs`; a
     * follow-up has no task config and always takes the admin default. Both
     * pass the already-resolved number so the difference is declared at the
     * call site rather than hidden here.
     */
    timeoutMs: number;
    idleTimeoutMs: number;
    /** `keepClientWarm()` — chat-process turns warm, one-shot jobs cold. */
    keepWarm: boolean;
    /** Warm scope key; ignored unless `keepWarm`. CoC scopes by process id. */
    warmKey: string;
    systemMessage: SystemMessageConfig | undefined;
    /** Final tool bundle. Empty means "send no `tools` field at all". */
    tools: Tool[];
    /** Builtin tools Memory V2 shadows. Empty means omit the field. */
    excludedTools?: string[];
    skillDirectories?: string[];
    disabledSkills?: string[];
    /**
     * Resolved per-repo MCP allow-list. When present it is sent with
     * `loadDefaultMcpConfig: false` so disabled servers/tools never reach the
     * agent; `undefined` preserves the SDK's default config load.
     */
    mcpServers?: SendMessageOptions['mcpServers'];
    /** Whether the executor auto-approves permission requests. */
    approvePermissions: boolean;
    onSessionCreated: (sessionId: string) => void;
    onStreamingChunk: SendMessageOptions['onStreamingChunk'];
    onToolEvent: SendMessageOptions['onToolEvent'];
    onTokenUsage: SendMessageOptions['onTokenUsage'];
    onBackgroundTasksChanged: SendMessageOptions['onBackgroundTasksChanged'];
    /** From `buildMcpOAuthHandler`; `undefined` disables OAuth tracking. */
    onMcpOAuthRequired: SendMessageOptions['onMcpOAuthRequired'];
}

/**
 * Build the path-invariant core of a chat turn's `sendMessage` options.
 *
 * Callers spread their path-specific extras over the result:
 *
 * ```ts
 * const sendOptions = {
 *     ...buildChatTurnSendOptions({ ... }),
 *     sessionId,
 *     deliveryMode,
 * };
 * ```
 *
 * Optional fields are omitted rather than set to `undefined` so the payload
 * stays byte-comparable between the two paths.
 */
export function buildChatTurnSendOptions(input: ChatTurnSendOptionsInput): SendMessageOptions {
    return {
        prompt: input.prompt,
        mode: input.agentMode,
        ...(input.policy.modelId ? { model: input.policy.modelId } : {}),
        ...(input.policy.reasoningEffort ? { reasoningEffort: input.policy.reasoningEffort } : {}),
        ...(input.policy.contextTier ? { contextTier: input.policy.contextTier } : {}),
        infiniteSessions: { enabled: true },
        ...(input.keepWarm ? { keepWarm: true as const, warmKey: input.warmKey } : {}),
        workingDirectory: input.workingDirectory,
        ...(input.additionalDirectories ? { additionalDirectories: input.additionalDirectories } : {}),
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        idleTimeoutMs: input.idleTimeoutMs,
        systemMessage: input.systemMessage,
        tools: input.tools.length > 0 ? input.tools : undefined,
        ...(input.excludedTools && input.excludedTools.length > 0
            ? { excludedTools: input.excludedTools }
            : {}),
        skillDirectories: input.skillDirectories,
        disabledSkills: input.disabledSkills,
        ...(input.mcpServers ? { mcpServers: input.mcpServers, loadDefaultMcpConfig: false } : {}),
        onPermissionRequest: input.approvePermissions ? approveAllPermissions : undefined,
        onSessionCreated: input.onSessionCreated,
        onStreamingChunk: input.onStreamingChunk,
        onToolEvent: input.onToolEvent,
        onTokenUsage: input.onTokenUsage,
        onBackgroundTasksChanged: input.onBackgroundTasksChanged,
        onMcpOAuthRequired: input.onMcpOAuthRequired,
    };
}
