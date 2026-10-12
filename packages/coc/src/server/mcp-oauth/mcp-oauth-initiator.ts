/**
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

import { getLogger, LogCategory, denyAllPermissions } from '@plusplusoneplusplus/forge';
import type { ISDKService, MCPServerConfig } from '@plusplusoneplusplus/forge';
import type { McpOauthManager } from './mcp-oauth-manager';
import type { PendingMcpOAuth } from './mcp-oauth-types';
import { readMcpServerAuthInfo } from './mcp-oauth-token-cache';

/**
 * Maximum lifetime of the holder session. The SDK redirect listener should
 * complete well within this; if not, we tear it down to avoid leaking
 * background processes. Matches the manager's default pending-entry TTL.
 */
const SESSION_HOLD_TIMEOUT_MS = 10 * 60 * 1000;

/** Poll interval for noticing that the manager has resolved the pending entry. */
const SESSION_HOLD_POLL_INTERVAL_MS = 1_500;
const MCP_LOAD_TIMEOUT_MS = 10_000;
const MCP_LOGIN_TIMEOUT_MS = 30_000;

export interface InitiateMcpOAuthOptions {
    /** Logical server name as keyed in the MCP config (used by the SDK). */
    serverName: string;
    /** Full server config (transport, URL, headers). Must be HTTP or SSE. */
    serverConfig: MCPServerConfig;
    /** Workspace id, for logging + filtering pending entries. */
    workspaceId?: string;
    /** Working directory passed to the transient SDK session. */
    workingDirectory?: string;
    /** Request a fresh authorization even if the SDK has other cached credentials. */
    forceReauth?: boolean;
    /** The SDK facade used to spawn the session. */
    aiService: McpOauthSdkService;
    /** Manager that records the pending OAuth entry. */
    manager: McpOauthManager;
}

export interface InitiateMcpOAuthResult {
    requestId: string;
    /** Authorization URL the user must open. Undefined if SDK is already authenticated. */
    authorizationUrl?: string;
    /** True when the runtime confirms a connection or the shared cache contains a valid token. */
    alreadyAuthenticated: boolean;
}

interface RpcShape {
    mcp?: {
        list?: () => Promise<{ servers: Array<{ name: string; status: string }> }>;
        oauth?: {
            login?: (params: { serverName: string; forceReauth?: boolean }) => Promise<{ authorizationUrl?: string } | undefined>;
        };
    };
}

interface SessionShape {
    sessionId: string;
    rpc?: RpcShape;
    on?: (event: string, handler: (event: unknown) => void) => void;
    disconnect?: () => Promise<void>;
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
    const { serverName, serverConfig, workspaceId, workingDirectory, forceReauth, aiService, manager } = opts;

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
        // `onPermissionRequest` is required by the SDK for any session; deny
        // all since this session only calls the mcp.oauth.login RPC — no
        // tools are ever invoked.
        const sessionOptions = {
            mcpServers: {
                [serverName]: { ...serverConfig, tools: serverConfig.tools ?? ['*'] },
            },
            onPermissionRequest: denyAllPermissions,
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
        const listFn = rpc?.mcp?.list;
        const loginFn = rpc?.mcp?.oauth?.login;
        if (typeof listFn !== 'function') {
            throw new Error('SDK build does not expose mcp.list RPC — upgrade @github/copilot-sdk to enable in-app OAuth');
        }
        if (typeof loginFn !== 'function') {
            throw new Error('SDK build does not expose mcp.oauth.login RPC — upgrade @github/copilot-sdk to enable in-app OAuth');
        }

        const loadDeadline = Date.now() + MCP_LOAD_TIMEOUT_MS;
        let serverStatus: string | undefined;
        do {
            const result = await listFn.call(rpc!.mcp);
            serverStatus = result.servers.find(server => server.name === serverName)?.status;
            if (serverStatus && serverStatus !== 'pending') break;
            if (Date.now() >= loadDeadline) {
                throw new Error(`MCP server "${serverName}" did not finish loading before OAuth login`);
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        } while (true);
        if (serverStatus !== 'connected' && serverStatus !== 'needs-auth') {
            throw new Error(`MCP server "${serverName}" cannot start OAuth in state "${serverStatus}"`);
        }

        let loginResult: { authorizationUrl?: string } | undefined;
        let loginTimer: ReturnType<typeof setTimeout> | undefined;
        try {
            loginResult = await Promise.race([
                loginFn.call(rpc!.mcp!.oauth, { serverName, ...(forceReauth ? { forceReauth: true } : {}) }),
                new Promise<never>((_, reject) => {
                    loginTimer = setTimeout(() => reject(new Error('timed out waiting for the SDK OAuth login response')), MCP_LOGIN_TIMEOUT_MS);
                }),
            ]);
        } catch (loginErr) {
            const msg = loginErr instanceof Error ? loginErr.message : String(loginErr);
            log.warn(LogCategory.MCP, `[McpOAuthInitiator] mcp.oauth.login RPC failed for server="${serverName}": ${msg}`);
            throw new Error(`OAuth login request failed: ${msg}`);
        } finally {
            if (loginTimer) clearTimeout(loginTimer);
        }

        const authorizationUrl = loginResult?.authorizationUrl;

        // Broker sign-in can complete without a URL or token JSON file.
        // An empty login result alone is not proof of authentication.
        if (!authorizationUrl && await isRuntimeConnected(session, serverName)) {
            log.info(
                LogCategory.MCP,
                `[McpOAuthInitiator] Runtime connected server="${serverName}" after OAuth login`,
            );
            await safeDisconnect(session);
            return { requestId: '', alreadyAuthenticated: true };
        }
        if (!authorizationUrl && !earlyAuthEvent) {
            if (readMcpServerAuthInfo(remoteUrl, transport).status !== 'authenticated') {
                throw new Error(`MCP OAuth login returned no authorization URL for "${serverName}", the runtime is not connected, and no valid token is cached. Check the SDK OAuth configuration and server authorization metadata.`);
            }
            await safeDisconnect(session);
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
        scheduleSessionRelease(session, entry.id, manager, remoteUrl);

        log.info(
            LogCategory.MCP,
            `[McpOAuthInitiator] OAuth flow registered: requestId=${entry.id} hasUrl=${!!authorizationUrl} server="${serverName}"`,
        );

        return { requestId: entry.id, authorizationUrl, alreadyAuthenticated: false };
    } catch (err) {
        // Best-effort cleanup on failure paths
        if (session) await safeDisconnect(session);
        throw err;
    }
}

async function isRuntimeConnected(session: SessionShape, serverName: string): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const result = await Promise.race([
            session.rpc?.mcp?.list?.(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`MCP OAuth status check timed out for "${serverName}"`)), MCP_LOAD_TIMEOUT_MS);
            }),
        ]);
        return result?.servers.some(server => server.name === serverName && server.status === 'connected') ?? false;
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}

function scheduleSessionRelease(
    session: SessionShape,
    requestId: string,
    manager: McpOauthManager,
    remoteUrl: string,
): void {
    const log = getLogger();
    const startedAt = Date.now();
    let polling = false;

    const interval = setInterval(async () => {
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
            void safeDisconnect(session);
            return;
        }
        if (polling || !entry || entry.status !== 'pending') {
            return;
        }
        polling = true;
        try {
            const connected = await isRuntimeConnected(session, entry.serverName);
            if (manager.getPending(requestId)?.status !== 'pending'
                || Date.now() - startedAt >= SESSION_HOLD_TIMEOUT_MS) {
                return;
            }
            if (connected || readMcpServerAuthInfo(remoteUrl).status === 'authenticated') {
                log.info(
                    LogCategory.MCP,
                    `[McpOAuthInitiator] OAuth authenticated — auto-resolving requestId=${requestId} server=${entry.serverName}`,
                );
                manager.resolve(requestId, 'completed');
                clearInterval(interval);
                void safeDisconnect(session);
            }
        } catch (error) {
            log.warn(
                LogCategory.MCP,
                `[McpOAuthInitiator] OAuth status check failed for requestId=${requestId}: ${error instanceof Error ? error.message : String(error)}`,
            );
        } finally {
            polling = false;
        }
    }, SESSION_HOLD_POLL_INTERVAL_MS);

    // Don't keep the node event loop alive solely on this timer
    if (typeof interval.unref === 'function') interval.unref();
}

async function safeDisconnect(session: SessionShape): Promise<void> {
    try {
        await session.disconnect?.();
    } catch {
        // Non-fatal — best-effort cleanup.
    }
}
