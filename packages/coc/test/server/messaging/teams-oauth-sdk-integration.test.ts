import * as http from 'http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamsOAuthFlow } from '../../../src/server/messaging/teams-oauth-flow';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';
import { saveMcpOAuthTokens } from '@plusplusoneplusplus/coc-connector/teams';

vi.mock('@plusplusoneplusplus/coc-connector/teams', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-connector/teams')>(),
    saveMcpOAuthTokens: vi.fn(),
}));
vi.mock('../../../src/server/mcp-oauth/mcp-oauth-token-cache', () => ({
    readMcpServerAuthInfo: vi.fn(() => ({ status: 'authenticated' })),
}));

describe('Teams OAuth with official MCP SDK', () => {
    let server: http.Server | undefined;
    let flow: TeamsOAuthFlow | undefined;

    afterEach(async () => {
        flow?.cancel();
        if (server?.listening) {
            await new Promise<void>((resolve, reject) => server!.close(err => err ? reject(err) : resolve()));
        }
        vi.clearAllMocks();
    });

    it('discovers OAuth, exchanges a PKCE code, and lists tools through Streamable HTTP', async () => {
        let base = '';
        const methods: string[] = [];
        server = http.createServer(async (req, res) => {
            const url = new URL(req.url ?? '/', base);
            if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: [`${base}/mcp/.default`] }));
            } else if (url.pathname === '/.well-known/oauth-authorization-server') {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    issuer: base,
                    authorization_endpoint: `${base}/authorize`,
                    token_endpoint: `${base}/token`,
                    response_types_supported: ['code'],
                    code_challenge_methods_supported: ['S256'],
                }));
            } else if (url.pathname === '/token') {
                const body = await new Promise<string>(resolve => {
                    let content = '';
                    req.on('data', chunk => { content += String(chunk); });
                    req.on('end', () => resolve(content));
                });
                const params = new URLSearchParams(body);
                if (params.get('code') !== 'approved' || !params.get('code_verifier')) {
                    res.writeHead(400).end();
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ access_token: 'local-test-token', token_type: 'Bearer', expires_in: 3600 }));
            } else if (url.pathname === '/mcp') {
                if (req.headers.authorization !== 'Bearer local-test-token') {
                    res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
                    res.writeHead(401).end();
                    return;
                }
                if (req.method === 'GET') {
                    res.writeHead(405).end();
                    return;
                }
                const body = await new Promise<string>(resolve => {
                    let content = '';
                    req.on('data', chunk => { content += String(chunk); });
                    req.on('end', () => resolve(content));
                });
                const message = JSON.parse(body);
                methods.push(message.method);
                if (message.method === 'notifications/initialized') {
                    res.writeHead(202).end();
                    return;
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    jsonrpc: '2.0', id: message.id,
                    result: message.method === 'initialize'
                        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'local-test', version: '1.0' } }
                        : { tools: [] },
                }));
            } else {
                res.writeHead(404).end();
            }
        });
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Expected TCP listener');
        base = `http://127.0.0.1:${address.port}`;

        const manager = new McpOauthManager();
        flow = new TeamsOAuthFlow(manager);
        const { requestId, authorizationUrl } = await flow.start(`${base}/mcp`);
        const authorization = new URL(authorizationUrl);
        expect(authorization.searchParams.get('resource')).toBe(`${base}/mcp`);
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
        const callback = new URL(authorization.searchParams.get('redirect_uri')!);
        callback.hostname = '127.0.0.1';
        callback.searchParams.set('code', 'approved');
        callback.searchParams.set('state', authorization.searchParams.get('state')!);
        expect((await fetch(callback)).status).toBe(200);
        expect(manager.getPending(requestId)?.status).toBe('completed');
        expect(methods).toEqual(expect.arrayContaining(['initialize', 'notifications/initialized', 'tools/list']));
        expect(saveMcpOAuthTokens).toHaveBeenCalledWith(`${base}/mcp`, expect.objectContaining({
            accessToken: 'local-test-token', expiresIn: 3600, resourceUrl: `${base}/mcp`,
        }));
    }, 20_000);
});
