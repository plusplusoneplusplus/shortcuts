/**
 * Chat Turn Runner
 *
 * SDK-facing callbacks shared by the first-turn path
 * (`ChatBaseExecutor.execute`) and the continuation path
 * (`FollowUpExecutor.executeFollowUp`).
 *
 * The two paths build genuinely different `sendMessage` option sets — a first
 * turn carries attachments and a Ralph grill plan, a follow-up carries a
 * session id, a delivery mode, and strict-resume enforcement — so the options
 * object stays at the call site. What is shared is the *callback* behavior,
 * which is what actually drives live UI: streaming output, and MCP OAuth
 * dispatch. Those live here so a change to either lands on both paths at once.
 */

import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
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
