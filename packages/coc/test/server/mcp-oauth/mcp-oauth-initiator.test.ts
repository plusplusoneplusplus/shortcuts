/**
 * Tests for the generic MCP OAuth initiator.
 *
 * The flow under test:
 *   1. Validate transport / URL.
 *   2. Spawn a one-off SDK session via `aiService.createClient().createSession`.
 *   3. Call `session.rpc.mcp.oauth.login({ serverName })`.
 *   4. Register a pending entry in `McpOauthManager` and return the URL.
 *
 * We stub the SDK service with a minimal mock — just enough to exercise each
 * branch. The unit under test never talks to the real Copilot SDK.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { initiateMcpOAuth } from '../../../src/server/mcp-oauth/mcp-oauth-initiator';

// Mock the token cache so scheduleSessionRelease can be tested without
// touching the filesystem.
const mockReadMcpServerAuthInfo = vi.hoisted(() => vi.fn());
vi.mock('../../../src/server/mcp-oauth/mcp-oauth-token-cache', () => ({
    readMcpServerAuthInfo: mockReadMcpServerAuthInfo,
}));

interface FakeSession {
    sessionId: string;
    rpc: {
        mcp?: {
            list?: () => Promise<{ servers: Array<{ name: string; status: string }> }>;
            oauth?: {
                login?: (params: { serverName: string; forceReauth?: boolean }) => Promise<{ authorizationUrl?: string } | undefined>;
            };
        };
    };
    on: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
}

function makeFakeAiService(opts: {
    available?: boolean;
    error?: string;
    loginResult?: { authorizationUrl?: string } | undefined;
    loginThrows?: Error;
    omitLoginRpc?: boolean;
    serverStatus?: string;
}): { service: any; session: FakeSession } {
    const session: FakeSession = {
        sessionId: 'sess-test',
        rpc: {
            mcp: {
                list: vi.fn().mockResolvedValue({ servers: ['s', 'remote', 'local'].map(name => ({ name, status: opts.serverStatus ?? 'needs-auth' })) }),
                oauth: opts.omitLoginRpc ? undefined : {
                    login: opts.loginThrows
                        ? vi.fn().mockRejectedValue(opts.loginThrows)
                        : vi.fn().mockResolvedValue(opts.loginResult),
                },
            },
        },
        on: vi.fn(),
        disconnect: vi.fn().mockResolvedValue(undefined),
    };

    const client = {
        createSession: vi.fn().mockResolvedValue(session),
    };

    const service = {
        isAvailable: vi.fn().mockResolvedValue({
            available: opts.available !== false,
            error: opts.error,
        }),
        createClient: vi.fn().mockResolvedValue(client),
    };

    return { service, session };
}

describe('initiateMcpOAuth', () => {
    let manager: McpOauthManager;

    beforeEach(() => {
        manager = new McpOauthManager();
        // Default: no cached token (auth required).
        mockReadMcpServerAuthInfo.mockReturnValue({ status: 'required' });
    });

    it('rejects stdio transports', async () => {
        const { service } = makeFakeAiService({});
        await expect(initiateMcpOAuth({
            serverName: 'local',
            serverConfig: { command: 'npx', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/OAuth flow only applies to HTTP\/SSE/);
    });

    it('rejects remote servers without a URL', async () => {
        const { service } = makeFakeAiService({});
        await expect(initiateMcpOAuth({
            serverName: 'noUrl',
            serverConfig: { type: 'http', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/no URL configured/);
    });

    it('rejects when the SDK is unavailable', async () => {
        const { service } = makeFakeAiService({ available: false, error: 'sdk missing' });
        await expect(initiateMcpOAuth({
            serverName: 's',
            serverConfig: { type: 'http', url: 'https://x', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/sdk missing/);
    });

    it('rejects when the SDK build lacks mcp.oauth.login', async () => {
        const { service, session } = makeFakeAiService({ omitLoginRpc: true });
        await expect(initiateMcpOAuth({
            serverName: 's',
            serverConfig: { type: 'http', url: 'https://x', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/mcp\.oauth\.login RPC/);
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('reports alreadyAuthenticated when login returns no URL and the token is cached', async () => {
        mockReadMcpServerAuthInfo.mockReturnValue({ status: 'authenticated' });
        const { service, session } = makeFakeAiService({ loginResult: {} });
        const result = await initiateMcpOAuth({
            serverName: 's',
            serverConfig: { type: 'http', url: 'https://x', tools: ['*'] } as any,
            aiService: service,
            manager,
        });
        expect(result.alreadyAuthenticated).toBe(true);
        expect(result.requestId).toBe('');
        // Session is released eagerly when no flow is needed
        expect(session.disconnect).toHaveBeenCalled();
        expect(manager.listPending()).toHaveLength(0);
    });

    it.each(['required', 'expired', 'unknown'])('rejects an empty login result with %s cache status (regression)', async status => {
        mockReadMcpServerAuthInfo.mockReturnValue({ status });
        const { service, session } = makeFakeAiService({ loginResult: {} });
        await expect(initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote' } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/no authorization URL.*no valid token is cached/);
        expect(mockReadMcpServerAuthInfo).toHaveBeenCalledWith('https://remote', 'http');
        expect(session.disconnect).toHaveBeenCalled();
        expect(manager.listPending()).toHaveLength(0);
    });

    it('rejects an undefined login result when the cache is empty', async () => {
        const { service, session } = makeFakeAiService({});
        await expect(initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'sse', url: 'https://remote' } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/no authorization URL/);
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('registers a pending entry and returns the authorization URL on success', async () => {
        const authUrl = 'https://login.example.com/oauth?state=xyz';
        const { service } = makeFakeAiService({ loginResult: { authorizationUrl: authUrl } });
        const result = await initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote', tools: ['*'] } as any,
            workspaceId: 'ws-1',
            aiService: service,
            manager,
        });
        expect(result.alreadyAuthenticated).toBe(false);
        expect(result.authorizationUrl).toBe(authUrl);
        expect(result.requestId).toBeTruthy();

        const pending = manager.getPending(result.requestId);
        expect(pending?.serverName).toBe('remote');
        expect(pending?.serverUrl).toBe('https://remote');
        expect(pending?.authorizationUrl).toBe(authUrl);
        expect(pending?.workspaceId).toBe('ws-1');
        expect(pending?.status).toBe('pending');
    });

    it('passes forced re-authentication through to the SDK only when requested', async () => {
        const { service, session } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://login.example.com' } });
        const config = { type: 'http', url: 'https://remote' } as any;
        await initiateMcpOAuth({
            serverName: 'remote', serverConfig: config, aiService: service, manager, forceReauth: true,
        });
        expect(session.rpc.mcp?.oauth?.login).toHaveBeenCalledWith({ serverName: 'remote', forceReauth: true });

        const other = makeFakeAiService({ loginResult: { authorizationUrl: 'https://login.example.com' } });
        await initiateMcpOAuth({
            serverName: 'remote', serverConfig: config, aiService: other.service, manager,
        });
        expect(other.session.rpc.mcp?.oauth?.login).toHaveBeenCalledWith({ serverName: 'remote' });
    });

    it('waits until the SDK has loaded the server before requesting OAuth', async () => {
        vi.useFakeTimers();
        try {
            const { service, session } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://login.example.com' } });
            const list = session.rpc.mcp!.list as ReturnType<typeof vi.fn>;
            list.mockResolvedValueOnce({ servers: [{ name: 'remote', status: 'pending' }] });
            const login = session.rpc.mcp!.oauth!.login as ReturnType<typeof vi.fn>;
            const start = initiateMcpOAuth({
                serverName: 'remote', serverConfig: { type: 'http', url: 'https://remote' } as any,
                aiService: service, manager,
            });
            await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1));
            expect(login).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(250);
            await expect(start).resolves.toMatchObject({ authorizationUrl: 'https://login.example.com' });
            expect(list).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['failed', 'disabled', 'stopped', 'not_configured'])('does not request OAuth when the SDK server is %s', async serverStatus => {
        const { service, session } = makeFakeAiService({ serverStatus });
        await expect(initiateMcpOAuth({
            serverName: 'remote', serverConfig: { type: 'http', url: 'https://remote' } as any,
            aiService: service, manager,
        })).rejects.toThrow(`cannot start OAuth in state "${serverStatus}"`);
        expect(session.rpc.mcp?.oauth?.login).not.toHaveBeenCalled();
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('times out and releases the session when SDK login never returns', async () => {
        vi.useFakeTimers();
        try {
            const { service, session } = makeFakeAiService({});
            (session.rpc.mcp!.oauth!.login as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => {}));
            const start = initiateMcpOAuth({
                serverName: 'remote', serverConfig: { type: 'http', url: 'https://remote' } as any,
                aiService: service, manager,
            });
            const outcome = expect(start).rejects.toThrow(/timed out waiting for the SDK OAuth login response/);
            await vi.advanceTimersByTimeAsync(30_000);
            await outcome;
            expect(session.disconnect).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('surfaces login RPC failures with context', async () => {
        const { service, session } = makeFakeAiService({ loginThrows: new Error('network down') });
        await expect(initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/OAuth login request failed: network down/);
        expect(session.disconnect).toHaveBeenCalled();
    });

    it('passes the server config through to createSession with tools defaulted', async () => {
        const { service } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://u' } });
        await initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote' } as any,
            aiService: service,
            manager,
        });

        const client = await service.createClient.mock.results[0].value;
        const sessionOptions = client.createSession.mock.calls[0][0];
        expect(sessionOptions.mcpServers).toBeDefined();
        expect(sessionOptions.mcpServers.remote).toMatchObject({
            type: 'http',
            url: 'https://remote',
            tools: ['*'],
        });
    });

    it('always includes onPermissionRequest in createSession options (regression: SDK requires it)', async () => {
        const { service } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://u' } });
        await initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote' } as any,
            aiService: service,
            manager,
        });

        const client = await service.createClient.mock.results[0].value;
        const sessionOptions = client.createSession.mock.calls[0][0];
        expect(typeof sessionOptions.onPermissionRequest).toBe('function');
    });

    describe('scheduleSessionRelease auto-resolution', () => {
        it('auto-resolves the pending entry to completed when the token cache becomes authenticated', async () => {
            vi.useFakeTimers();
            // Token cache starts as 'required' (set in beforeEach).
            const { service, session } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://auth.example.com' } });

            const result = await initiateMcpOAuth({
                serverName: 'remote',
                serverConfig: { type: 'http', url: 'https://remote' } as any,
                aiService: service,
                manager,
            });

            expect(manager.getPending(result.requestId)?.status).toBe('pending');

            // Simulate SDK writing the token to its cache.
            mockReadMcpServerAuthInfo.mockReturnValue({ status: 'authenticated' });

            // Advance past the poll interval so the session-release watcher fires.
            await vi.advanceTimersByTimeAsync(2_000);

            // Entry should now be resolved and the session disconnected.
            expect(manager.getPending(result.requestId)?.status).toBe('completed');
            expect(session.disconnect).toHaveBeenCalled();

            vi.useRealTimers();
        });

        it('does not resolve before the token cache is authenticated', async () => {
            vi.useFakeTimers();
            const { service, session } = makeFakeAiService({ loginResult: { authorizationUrl: 'https://auth.example.com' } });

            const result = await initiateMcpOAuth({
                serverName: 'remote',
                serverConfig: { type: 'http', url: 'https://remote' } as any,
                aiService: service,
                manager,
            });

            // Token still 'required' — advance a couple of intervals.
            await vi.advanceTimersByTimeAsync(4_000);

            expect(manager.getPending(result.requestId)?.status).toBe('pending');
            expect(session.disconnect).not.toHaveBeenCalled();

            vi.useRealTimers();
        });
    });
});
