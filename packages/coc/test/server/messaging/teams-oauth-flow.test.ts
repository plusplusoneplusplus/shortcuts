import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { TeamsOAuthFlow } from '../../../src/server/messaging/teams-oauth-flow';
import { saveMcpOAuthTokens } from '@plusplusoneplusplus/coc-connector/teams';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { readMcpServerAuthInfo } from '../../../src/server/mcp-oauth/mcp-oauth-token-cache';

vi.mock('@plusplusoneplusplus/coc-connector/teams', () => ({
    getOAuthConfig: vi.fn(() => ({
        clientId: 'test-public-client',
        scope: 'https://example.test/teams/.default offline_access',
        authorizeUrl: 'https://login.example.test/oauth2/v2.0/authorize',
    })),
    saveMcpOAuthTokens: vi.fn(),
}));
vi.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
    auth: vi.fn(async (provider, options) => {
        if (options.authorizationCode) {
            await provider.saveTokens({
                access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600,
                refresh_token: 'test-refresh-token',
            });
            return 'AUTHORIZED';
        }
        await provider.saveDiscoveryState({ authorizationServerUrl: 'https://login.example.test/organizations/v2.0' });
        await provider.saveCodeVerifier('test-verifier');
        const authorizationUrl = new URL('https://login.example.test/oauth2/v2.0/authorize');
        authorizationUrl.searchParams.set('state', await provider.state());
        authorizationUrl.searchParams.set('redirect_uri', String(provider.redirectUrl));
        authorizationUrl.searchParams.set('code_challenge_method', 'S256');
        authorizationUrl.searchParams.set('code_challenge', 'test-challenge');
        authorizationUrl.searchParams.set('client_id', (await provider.clientInformation()).client_id);
        await provider.redirectToAuthorization(authorizationUrl);
        return 'REDIRECT';
    }),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn().mockImplementation(function () {
        return { connect: vi.fn().mockResolvedValue(undefined), listTools: vi.fn().mockResolvedValue({ tools: [] }), close: vi.fn().mockResolvedValue(undefined) };
    }),
}));
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
    StreamableHTTPClientTransport: vi.fn().mockImplementation(function () { return {}; }),
}));
vi.mock('../../../src/server/mcp-oauth/mcp-oauth-token-cache', () => ({
    readMcpServerAuthInfo: vi.fn(() => ({ status: 'authenticated' })),
}));

const endpoint = 'https://example.test/teams';

describe('TeamsOAuthFlow', () => {
    let manager: McpOauthManager;
    let flow: TeamsOAuthFlow;

    beforeEach(() => {
        manager = new McpOauthManager();
        flow = new TeamsOAuthFlow(manager);
        vi.mocked(readMcpServerAuthInfo).mockReturnValue({ status: 'authenticated' });
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('returns a PKCE authorization link and completes only after MCP handshake', async () => {
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        expect(authorize.searchParams.get('client_id')).toBe('test-public-client');
        expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
        expect(authorize.searchParams.get('code_verifier')).toBeNull();
        expect(callback.hostname).toBe('localhost');
        expect(manager.getPending(requestId)?.status).toBe('pending');
        expect(auth).toHaveBeenCalledWith(expect.objectContaining({
            clientMetadata: expect.objectContaining({ scope: 'https://example.test/teams/.default offline_access' }),
        }), { serverUrl: endpoint, scope: 'https://example.test/teams/.default offline_access' });

        callback.searchParams.set('code', 'test-code');
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        const response = await fetch(callback.href.replace('localhost', '127.0.0.1'));
        expect(response.status).toBe(200);
        expect(auth).toHaveBeenLastCalledWith(expect.anything(), {
            serverUrl: endpoint, authorizationCode: 'test-code',
            scope: 'https://example.test/teams/.default offline_access',
        });
        expect(vi.mocked(Client).mock.results[0]?.value.connect).toHaveBeenCalled();
        expect(vi.mocked(Client).mock.results[0]?.value.listTools).toHaveBeenCalled();
        expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(new URL(endpoint), {
            requestInit: { headers: { Authorization: 'Bearer test-access-token' } },
        });
        expect(saveMcpOAuthTokens).toHaveBeenCalledWith(endpoint, expect.objectContaining({
            clientId: 'test-public-client',
            redirectUri: authorize.searchParams.get('redirect_uri'),
            authorizationServerUrl: 'https://login.example.test/organizations/v2.0',
            accessToken: 'test-access-token', expiresIn: 3600,
        }));
        expect(manager.getPending(requestId)?.status).toBe('completed');
    });

    it('rejects forged callback state and does not exchange a token', async () => {
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('code', 'forged-code');
        callback.searchParams.set('state', 'invalid');
        const response = await fetch(callback.href.replace('localhost', '127.0.0.1'));
        expect(response.status).toBe(400);
        expect(auth).toHaveBeenCalledTimes(1);
        expect(manager.getPending(requestId)?.status).toBe('pending');

        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('error', 'access_denied');
        await fetch(callback.href.replace('localhost', '127.0.0.1'));
        expect(manager.getPending(requestId)?.status).toBe('failed');
        expect(saveMcpOAuthTokens).not.toHaveBeenCalled();
    });

    it('rejects concurrent attempts and allows a new attempt after failure', async () => {
        const starting = flow.start(endpoint);
        await expect(flow.start(endpoint)).rejects.toThrow('already in progress');
        const first = await starting;
        await expect(flow.start(endpoint)).rejects.toThrow('already in progress');
        const authorize = new URL(first.authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('error', 'access_denied');
        await fetch(callback.href.replace('localhost', '127.0.0.1'));
        const next = await flow.start(endpoint);
        expect(next.requestId).not.toBe(first.requestId);
        const nextUrl = new URL(next.authorizationUrl);
        const nextCallback = new URL(nextUrl.searchParams.get('redirect_uri')!);
        nextCallback.searchParams.set('state', nextUrl.searchParams.get('state')!);
        nextCallback.searchParams.set('error', 'access_denied');
        await fetch(nextCallback.href.replace('localhost', '127.0.0.1'));
    });

    it('fails without caching a token when MCP rejects it', async () => {
        vi.mocked(Client).mockImplementationOnce(function () {
            return { connect: vi.fn().mockRejectedValue(new Error('HTTP 401')), listTools: vi.fn(), close: vi.fn().mockResolvedValue(undefined) } as unknown as Client;
        });
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('code', 'test-code');
        expect((await fetch(callback.href.replace('localhost', '127.0.0.1'))).status).toBe(400);
        expect(manager.getPending(requestId)?.status).toBe('failed');
        expect(manager.getPending(requestId)?.error).toContain('MCP rejected the token');
        expect(saveMcpOAuthTokens).not.toHaveBeenCalled();
    });

    it('reports token exchange errors without exposing the provider response', async () => {
        vi.mocked(auth).mockImplementationOnce(async (provider, options) => {
            await provider.saveDiscoveryState?.({ authorizationServerUrl: 'https://login.example.test/organizations/v2.0' });
            await provider.saveCodeVerifier('test-verifier');
            const url = new URL('https://login.example.test/authorize');
            url.searchParams.set('state', await provider.state!());
            url.searchParams.set('redirect_uri', String(provider.redirectUrl));
            await provider.redirectToAuthorization(url);
            return 'REDIRECT';
        }).mockRejectedValueOnce(new Error('provider response with secret'));
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('code', 'test-code');
        expect((await fetch(callback.href.replace('localhost', '127.0.0.1'))).status).toBe(400);
        expect(manager.getPending(requestId)?.error).toContain('token exchange failed');
        expect(manager.getPending(requestId)?.error).not.toContain('provider response');
        expect(saveMcpOAuthTokens).not.toHaveBeenCalled();
    });

    it('releases the callback listener when OAuth discovery fails', async () => {
        vi.mocked(auth).mockRejectedValueOnce(new Error('OAuth metadata unavailable'));
        await expect(flow.start(endpoint)).rejects.toThrow('OAuth metadata unavailable');
        const next = await flow.start(endpoint);
        expect(manager.getPending(next.requestId)?.status).toBe('pending');
        flow.cancel();
    });

    it('reports an invalid token cache without claiming authentication', async () => {
        vi.mocked(readMcpServerAuthInfo).mockReturnValue({ status: 'required' });
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!.replace('localhost', '127.0.0.1'));
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('code', 'test-code');
        expect((await fetch(callback)).status).toBe(400);
        expect(manager.getPending(requestId)).toMatchObject({
            status: 'failed', error: 'The MCP token was not saved to the shared OAuth cache.',
        });
    });

    it('expires an abandoned sign-in and releases the callback listener', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        try {
            const { requestId } = await flow.start(endpoint);
            await vi.advanceTimersByTimeAsync(8 * 60_000);
            expect(manager.getPending(requestId)).toMatchObject({
                status: 'failed', error: 'Microsoft sign-in timed out',
            });
        } finally {
            vi.useRealTimers();
        }
        const next = await flow.start(endpoint);
        const authorize = new URL(next.authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!.replace('localhost', '127.0.0.1'));
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('error', 'access_denied');
        await fetch(callback);
    });

    it('does not return a sign-in link if discovery finishes after the flow timed out', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let finishDiscovery!: () => void;
        vi.mocked(auth).mockImplementationOnce(async (provider) => {
            await new Promise<void>(resolve => { finishDiscovery = resolve; });
            await provider.redirectToAuthorization(new URL('https://login.example.test/authorize'));
            return 'REDIRECT';
        });
        try {
            const starting = flow.start(endpoint);
            await vi.waitFor(() => expect(finishDiscovery).toBeDefined());
            const rejected = expect(starting).rejects.toThrow('authorization was interrupted');
            await vi.advanceTimersByTimeAsync(8 * 60_000);
            finishDiscovery();
            await rejected;
            expect(manager.listPending()).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels an in-progress sign-in when its owner shuts down', async () => {
        const { requestId } = await flow.start(endpoint);
        flow.cancel();
        expect(manager.getPending(requestId)).toMatchObject({
            status: 'failed', error: 'Microsoft sign-in was interrupted',
        });
        expect((await flow.start(endpoint)).requestId).not.toBe(requestId);
        flow.cancel();
    });
});
