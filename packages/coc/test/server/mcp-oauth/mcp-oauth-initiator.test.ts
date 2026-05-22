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

interface FakeSession {
    sessionId: string;
    rpc: {
        mcp?: {
            oauth?: {
                login?: (params: { serverName: string }) => Promise<{ authorizationUrl?: string } | undefined>;
            };
        };
    };
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
}

function makeFakeAiService(opts: {
    available?: boolean;
    error?: string;
    loginResult?: { authorizationUrl?: string } | undefined;
    loginThrows?: Error;
    omitLoginRpc?: boolean;
}): { service: any; session: FakeSession } {
    const session: FakeSession = {
        sessionId: 'sess-test',
        rpc: opts.omitLoginRpc
            ? {}
            : {
                  mcp: {
                      oauth: {
                          login: opts.loginThrows
                              ? vi.fn().mockRejectedValue(opts.loginThrows)
                              : vi.fn().mockResolvedValue(opts.loginResult),
                      },
                  },
              },
        on: vi.fn(),
        destroy: vi.fn().mockResolvedValue(undefined),
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
        expect(session.destroy).toHaveBeenCalled();
    });

    it('reports alreadyAuthenticated when login returns no URL', async () => {
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
        expect(session.destroy).toHaveBeenCalled();
        expect(manager.listPending()).toHaveLength(0);
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

    it('surfaces login RPC failures with context', async () => {
        const { service, session } = makeFakeAiService({ loginThrows: new Error('network down') });
        await expect(initiateMcpOAuth({
            serverName: 'remote',
            serverConfig: { type: 'http', url: 'https://remote', tools: ['*'] } as any,
            aiService: service,
            manager,
        })).rejects.toThrow(/OAuth login request failed: network down/);
        expect(session.destroy).toHaveBeenCalled();
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
});
