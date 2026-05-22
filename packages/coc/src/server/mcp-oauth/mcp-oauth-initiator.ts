/**
 * Generic MCP OAuth flow initiator.
 *
 * Today, OAuth for an MCP server only kicks off as a side-effect of a chat
 * session: the Copilot SDK emits `mcp.oauth_required`, and the chat executor
 * registers a pending entry. That's good when the user is mid-message, but it
 * means the *only* way to authenticate is to start a chat. This module makes
 * the same flow available standalone — pick a server, hit the route, follow
 * the URL.
 *
 * Implementation: spin up a transient SDK session containing just the one
 * MCP server config, call the experimental `session.rpc.mcp.oauth.login`
 * RPC (the same one the proactive probe uses), and return the authorization
 * URL back to the dashboard. The SDK keeps the redirect listener alive on its
 * side; we keep the session alive on ours until the pending entry resolves so
 * its token cache write finishes.
 *
 * The flow is generic by design — it works for any MCP server the SDK can
 * reach. Server-specific quirks (which AAD tenant, which scope) are owned by
 * the SDK and its registered OAuth metadata discovery.
 */

import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { ISDKService, MCPServerConfig } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from './mcp-oauth-manager';
import type { PendingMcpOAuth } from './mcp-oauth-types';

/**
 * Maximum lifetime of the holder session. The SDK redirect listener should
 * complete well within this; if not, we tear it down to avoid leaking
 * background processes. Matches the manager's default pending-entry TTL.
 */
const SESSION_HOLD_TIMEOUT_MS = 10 * 60 * 1000;

/** Poll interval for noticing that the manager has resolved the pending entry. */
const SESSION_HOLD_POLL_INTERVAL_MS = 1_500;

export interface InitiateMcpOAuthOptions {
    /** Logical server name as keyed in the MCP config (used by the SDK). */
    serverName: string;
    /** Full server config (transport, URL, headers). Must be HTTP or SSE. */
    serverConfig: MCPServerConfig;
    /** Workspace id, for logging + filtering pending entries. */
    workspaceId?: string;
    /** Working directory passed to the transient SDK session. */
    workingDirectory?: string;
    /** The SDK facade used to spawn the session. */
    aiService: McpOauthSdkService;
    /** Manager that records the pending OAuth entry. */
    manager: McpOauthManager;
}

export interface InitiateMcpOAuthResult {
    requestId: string;
    /** Authorization URL the user must open. Undefined if SDK is already authenticated. */
    authorizationUrl?: string;
    /** True when the SDK reported no OAuth was required (already authenticated). */
    alreadyAuthenticated: boolean;
}

interface RpcShape {
    mcp?: {
        oauth?: {
            login?: (params: { serverName: string }) => Promise<{ authorizationUrl?: string } | undefined>;
        };
    };
}

interface SessionShape {
    sessionId: string;
    on?: (event: string, handler: (event: unknown) => void) => void;
    destroy?: () => Promise<void>;
}

interface ClientShape {
    createSession(options: unknown): Promise<unknown>;
}

export interface McpOauthSdkService extends ISDKService {
    createClient(workingDirectory?: string): Promise<ClientShape>;
}

/**
 * Kick off an OAuth flow for one MCP server.
 *
 * Throws when:
 *  - The SDK is not available.
 *  - The server is not an HTTP/SSE transport.
 *  - The SDK build does not expose the `mcp.oauth.login` RPC.
 *  - The SDK rejects the login call (network, invalid config).
 *
 * Caller is expected to register a route and surface the result to the
 * dashboard, which polls `/api/mcp-oauth/pending/:id` until completion.
 */
export async function initiateMcpOAuth(opts: InitiateMcpOAuthOptions): Promise<InitiateMcpOAuthResult> {
    const log = getLogger();
    const { serverName, serverConfig, workspaceId, workingDirectory, aiService, manager } = opts;

    const transport = serverConfig.type;
    if (transport !== 'http' && transport !== 'sse') {
        throw new Error(`OAuth flow only applies to HTTP/SSE MCP servers (got "${transport ?? 'stdio'}")`);
    }

    const remoteUrl = 'url' in serverConfig ? serverConfig.url : undefined;
    if (!remoteUrl) {
        throw new Error(`MCP server "${serverName}" has no URL configured`);
    }

    const availability = await aiService.isAvailable();
    if (!availability.available) {
        throw new Error(availability.error ?? 'Copilot SDK is not available');
    }

    log.info(
        LogCategory.MCP,
        `[McpOAuthInitiator] Starting OAuth flow for server="${serverName}" url=${remoteUrl} workspaceId=${workspaceId ?? '(none)'}`,
    );

    const client = await aiService.createClient(workingDirectory);

    let session: SessionShape | undefined;
    let earlyAuthEvent: { requestId?: string; authorizationUrl?: string } | undefined;

    try {
        // Pass exactly one server. `tools: ['*']` ensures the SDK actually
        // connects to it during session init (an empty `tools` list would
        // skip the connection and the OAuth probe wouldn't fire).
        const sessionOptions = {
            mcpServers: {
                [serverName]: { ...serverConfig, tools: serverConfig.tools ?? ['*'] },
            },
        } as unknown as Parameters<typeof client.createSession>[0];

        session = (await client.createSession(sessionOptions)) as unknown as SessionShape;

        // Subscribe BEFORE calling login so we don't miss a reactive event
        // for very quick flows.
        if (typeof session.on === 'function') {
            try {
                session.on('mcp.oauth_required', (raw: unknown) => {
                    const evt = raw as { id?: string; data?: { requestId?: string; serverName?: string } };
                    if (evt?.data?.serverName !== serverName) return;
                    earlyAuthEvent = { requestId: evt.data?.requestId };
                });
            } catch (subErr) {
                log.debug(
                    LogCategory.MCP,
                    `[McpOAuthInitiator] Failed to subscribe to mcp.oauth_required: ${subErr instanceof Error ? subErr.message : String(subErr)}`,
                );
            }
        }

        const rpc = (session as unknown as { rpc?: RpcShape }).rpc;
        const loginFn = rpc?.mcp?.oauth?.login;
        if (typeof loginFn !== 'function') {
            throw new Error('SDK build does not expose mcp.oauth.login RPC — upgrade @github/copilot-sdk to enable in-app OAuth');
        }

        let loginResult: { authorizationUrl?: string } | undefined;
        try {
            loginResult = await loginFn.call(rpc!.mcp!.oauth, { serverName });
        } catch (loginErr) {
            const msg = loginErr instanceof Error ? loginErr.message : String(loginErr);
            log.warn(LogCategory.MCP, `[McpOAuthInitiator] mcp.oauth.login RPC failed for server="${serverName}": ${msg}`);
            throw new Error(`OAuth login request failed: ${msg}`);
        }

        const authorizationUrl = loginResult?.authorizationUrl;

        // If no URL was returned and no reactive event fired, the SDK considers
        // the server already authenticated. Don't register a pending entry —
        // the UI just refreshes status and shows green.
        if (!authorizationUrl && !earlyAuthEvent) {
            log.info(
                LogCategory.MCP,
                `[McpOAuthInitiator] Server "${serverName}" already authenticated — no flow required`,
            );
            await safeDestroy(session);
            return { requestId: '', alreadyAuthenticated: true };
        }

        const requestId = earlyAuthEvent?.requestId ?? `oauth-${serverName}-${Date.now()}`;
        const entry: PendingMcpOAuth = manager.addPending({
            requestId,
            serverName,
            serverUrl: remoteUrl,
            authorizationUrl,
            workspaceId,
        });

        // Hold the session until the manager resolves the entry, so the SDK's
        // redirect listener stays alive long enough to complete the exchange.
        scheduleSessionRelease(session, entry.id, manager);

        log.info(
            LogCategory.MCP,
            `[McpOAuthInitiator] OAuth flow registered: requestId=${entry.id} hasUrl=${!!authorizationUrl} server="${serverName}"`,
        );

        return { requestId: entry.id, authorizationUrl, alreadyAuthenticated: false };
    } catch (err) {
        // Best-effort cleanup on failure paths
        if (session) await safeDestroy(session);
        throw err;
    }
}

function scheduleSessionRelease(
    session: SessionShape,
    requestId: string,
    manager: McpOauthManager,
): void {
    const log = getLogger();
    const startedAt = Date.now();

    const interval = setInterval(() => {
        const entry = manager.getPending(requestId);
        const elapsed = Date.now() - startedAt;
        const resolved = entry?.status === 'completed' || entry?.status === 'failed';
        const missing = !entry; // swept out by TTL
        const timedOut = elapsed >= SESSION_HOLD_TIMEOUT_MS;

        if (resolved || missing || timedOut) {
            clearInterval(interval);
            log.debug(
                LogCategory.MCP,
                `[McpOAuthInitiator] Releasing OAuth holder session for requestId=${requestId} reason=${
                    resolved ? entry?.status : missing ? 'manager-evicted' : 'timeout'
                }`,
            );
            void safeDestroy(session);
        }
    }, SESSION_HOLD_POLL_INTERVAL_MS);

    // Don't keep the node event loop alive solely on this timer
    if (typeof interval.unref === 'function') interval.unref();
}

async function safeDestroy(session: SessionShape): Promise<void> {
    try {
        await session.destroy?.();
    } catch {
        // Non-fatal — best-effort cleanup.
    }
}
