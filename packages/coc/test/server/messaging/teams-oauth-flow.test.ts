import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { TeamsOAuthFlow } from '../../../src/server/messaging/teams-oauth-flow';
import { exchangeCodeForToken, McpClient } from '@plusplusoneplusplus/coc-connector/teams';
import { clearMcpServerAuth, readMcpServerAuthInfo } from '../../../src/server/mcp-oauth/mcp-oauth-token-cache';

vi.mock('@plusplusoneplusplus/coc-connector/teams', () => ({
    getOAuthConfig: vi.fn(() => ({
        clientId: 'test-public-client',
        scope: 'https://example.test/teams/.default offline_access',
        authorizeUrl: 'https://login.example.test/oauth2/v2.0/authorize',
    })),
    exchangeCodeForToken: vi.fn(async () => 'test-access-token'),
    McpClient: vi.fn().mockImplementation(function () {
        return { initialize: vi.fn().mockResolvedValue(undefined), listTools: vi.fn().mockResolvedValue({ tools: [] }) };
    }),
}));
vi.mock('../../../src/server/mcp-oauth/mcp-oauth-token-cache', () => ({
    readMcpServerAuthInfo: vi.fn(() => ({ status: 'authenticated' })),
    clearMcpServerAuth: vi.fn(),
}));

const endpoint = 'https://example.test/teams';

describe('TeamsOAuthFlow', () => {
    let manager: McpOauthManager;
    let flow: TeamsOAuthFlow;

    beforeEach(() => {
        manager = new McpOauthManager();
        flow = new TeamsOAuthFlow(manager);
        vi.mocked(readMcpServerAuthInfo).mockReturnValue({ status: 'authenticated' });
        vi.mocked(exchangeCodeForToken).mockResolvedValue('test-access-token');
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

        callback.searchParams.set('code', 'test-code');
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        const response = await fetch(callback.href.replace('localhost', '127.0.0.1'));
        expect(response.status).toBe(200);
        expect(exchangeCodeForToken).toHaveBeenCalledWith(endpoint, expect.objectContaining({
            code: 'test-code', redirectUri: authorize.searchParams.get('redirect_uri'),
            clientId: 'test-public-client', mode: 'mcp',
        }));
        expect(vi.mocked(McpClient).mock.results[0]?.value.initialize).toHaveBeenCalled();
        expect(vi.mocked(McpClient).mock.results[0]?.value.listTools).toHaveBeenCalled();
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
        expect(exchangeCodeForToken).not.toHaveBeenCalled();
        expect(manager.getPending(requestId)?.status).toBe('pending');

        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('error', 'access_denied');
        await fetch(callback.href.replace('localhost', '127.0.0.1'));
        expect(manager.getPending(requestId)?.status).toBe('failed');
        expect(clearMcpServerAuth).not.toHaveBeenCalled();
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

    it('fails and clears an unusable saved token when MCP initialization rejects it', async () => {
        vi.mocked(McpClient).mockImplementationOnce(function () {
            return { initialize: vi.fn().mockRejectedValue(new Error('HTTP 401')), listTools: vi.fn() } as unknown as McpClient;
        });
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('code', 'test-code');
        expect((await fetch(callback.href.replace('localhost', '127.0.0.1'))).status).toBe(400);
        expect(manager.getPending(requestId)?.status).toBe('failed');
        expect(manager.getPending(requestId)?.error).toContain('MCP rejected the token');
        expect(clearMcpServerAuth).toHaveBeenCalledWith(endpoint);
    });

    it('reports token exchange errors without exposing the provider response', async () => {
        vi.mocked(exchangeCodeForToken).mockRejectedValueOnce(new Error('provider response with secret'));
        const { requestId, authorizationUrl } = await flow.start(endpoint);
        const authorize = new URL(authorizationUrl);
        const callback = new URL(authorize.searchParams.get('redirect_uri')!);
        callback.searchParams.set('state', authorize.searchParams.get('state')!);
        callback.searchParams.set('code', 'test-code');
        expect((await fetch(callback.href.replace('localhost', '127.0.0.1'))).status).toBe(400);
        expect(manager.getPending(requestId)?.error).toContain('token exchange failed');
        expect(manager.getPending(requestId)?.error).not.toContain('provider response');
        expect(clearMcpServerAuth).not.toHaveBeenCalled();
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
