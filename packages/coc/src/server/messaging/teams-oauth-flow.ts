import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as http from 'http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { getOAuthConfig, saveMcpOAuthTokens } from '@plusplusoneplusplus/coc-connector/teams';
import { readMcpServerAuthInfo } from '../mcp-oauth/mcp-oauth-token-cache';
import type { McpOauthManager } from '../mcp-oauth/mcp-oauth-manager';

const FLOW_TIMEOUT_MS = 8 * 60 * 1000;

export class TeamsOAuthFlow {
    private active: { server: http.Server; timer: ReturnType<typeof setTimeout>; requestId: string } | null = null;
    private starting = false;
    private generation = 0;

    constructor(private readonly pending: McpOauthManager) {}

    async start(serverUrl: string): Promise<{ requestId: string; authorizationUrl: string }> {
        if (this.active || this.starting) {
            throw new Error('Microsoft Teams authorization is already in progress');
        }
        const config = getOAuthConfig(serverUrl, { mode: 'mcp' });
        const state = randomBytes(32).toString('base64url');
        const requestId = randomUUID();
        const generation = this.generation;
        let redirectUri = '';
        let processing = false;
        let verifier: string | undefined;
        let authorizationUrl: URL | undefined;
        let discovery: OAuthDiscoveryState | undefined;
        let tokens: OAuthTokens | undefined;
        const provider: OAuthClientProvider = {
            get redirectUrl() { return redirectUri; },
            clientMetadata: {
                client_name: 'CoC',
                redirect_uris: [],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
                scope: config.scope,
            },
            state: () => state,
            clientInformation: () => ({ client_id: config.clientId }),
            tokens: () => tokens,
            saveTokens: value => { tokens = value; },
            redirectToAuthorization: url => { authorizationUrl = url; },
            saveCodeVerifier: value => { verifier = value; },
            codeVerifier: () => {
                if (!verifier) {
                    throw new Error('Microsoft Teams PKCE verifier is missing');
                }
                return verifier;
            },
            saveDiscoveryState: value => { discovery = value; },
            discoveryState: () => discovery,
        };
        const server = http.createServer(async (req, res) => {
            const callback = new URL(req.url ?? '/', 'http://localhost');
            const receivedState = callback.searchParams.get('state') ?? '';
            const expected = Buffer.from(state);
            const actual = Buffer.from(receivedState);
            if (req.method !== 'GET' || callback.pathname !== '/' || actual.length !== expected.length
                || !timingSafeEqual(actual, expected) || processing) {
                res.writeHead(400).end('Invalid authorization callback');
                return;
            }
            processing = true;
            const code = callback.searchParams.get('code');
            const error = callback.searchParams.get('error');
            let stage: 'sign-in' | 'token exchange' | 'MCP verification' | 'token cache' = 'sign-in';
            try {
                if (error || !code) {
                    throw new Error('Microsoft sign-in was cancelled or did not return an authorization code');
                }
                stage = 'token exchange';
                const outcome = await auth(provider, { serverUrl, authorizationCode: code, scope: config.scope });
                if (outcome !== 'AUTHORIZED' || !tokens?.access_token) {
                    throw new Error('Microsoft Teams did not return an access token');
                }
                stage = 'MCP verification';
                const client = new Client({ name: 'coc-teams', version: '1.0.0' });
                try {
                    await client.connect(new StreamableHTTPClientTransport(new URL(serverUrl), {
                        requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } },
                    }));
                    await client.listTools();
                } finally {
                    await client.close();
                }
                if (this.pending.getPending(requestId)?.status !== 'pending') {
                    throw new Error('Microsoft sign-in expired during MCP verification');
                }
                stage = 'token cache';
                if (typeof tokens.expires_in !== 'number' || tokens.expires_in <= 0) {
                    throw new Error('Microsoft Teams token has no valid expiry');
                }
                if (!discovery?.authorizationServerUrl) {
                    throw new Error('Microsoft Teams authorization server metadata is missing');
                }
                saveMcpOAuthTokens(serverUrl, {
                    clientId: config.clientId,
                    redirectUri,
                    authorizationServerUrl: discovery.authorizationServerUrl,
                    resourceUrl: serverUrl,
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiresIn: tokens.expires_in,
                    scope: tokens.scope ?? config.scope,
                });
                if (readMcpServerAuthInfo(serverUrl, 'http').status !== 'authenticated') {
                    throw new Error('Microsoft sign-in did not save an MCP token');
                }
                this.pending.resolve(requestId, 'completed');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.writeHead(200).end('Microsoft Teams authenticated. Return to CoC.');
            } catch {
                let reason: string;
                switch (stage) {
                    case 'sign-in':
                        reason = 'Microsoft sign-in was cancelled or did not return an authorization code';
                        break;
                    case 'token exchange':
                        reason = 'Microsoft token exchange failed. Check the Entra app registration, account access, and MCP scopes.';
                        break;
                    case 'MCP verification':
                        reason = 'Microsoft Teams MCP rejected the token or tool discovery failed. Check account access and token audience.';
                        break;
                    case 'token cache':
                        reason = 'The MCP token was not saved to the shared OAuth cache.';
                        break;
                }
                this.pending.resolve(requestId, 'failed', reason);
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.writeHead(400).end('Microsoft Teams authentication failed. Return to CoC for details.');
            } finally {
                this.close();
            }
        });
        this.starting = true;
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', () => {
                    server.off('error', reject);
                    resolve();
                });
            });
        } finally {
            this.starting = false;
        }
        const address = server.address();
        if (!address || typeof address === 'string') {
            server.close();
            throw new Error('Cannot bind the Microsoft Teams authorization callback');
        }
        if (this.generation !== generation) {
            server.close();
            throw new Error('Microsoft Teams authorization was interrupted');
        }
        redirectUri = `http://localhost:${address.port}/`;
        provider.clientMetadata.redirect_uris = [redirectUri];
        const timer = setTimeout(() => {
            this.generation++;
            this.pending.resolve(requestId, 'failed', 'Microsoft sign-in timed out');
            this.close();
        }, FLOW_TIMEOUT_MS);
        this.active = { server, timer, requestId };
        try {
            const result = await auth(provider, { serverUrl, scope: config.scope });
            if (result !== 'REDIRECT' || !authorizationUrl) {
                throw new Error('Microsoft Teams OAuth did not return a sign-in link');
            }
        } catch (err) {
            this.pending.resolve(requestId, 'failed', 'Microsoft Teams OAuth discovery failed');
            this.close();
            throw err;
        }
        if (this.generation !== generation) {
            throw new Error('Microsoft Teams authorization was interrupted');
        }
        this.pending.addPending({ requestId, serverName: 'Microsoft Teams', serverUrl });
        return { requestId, authorizationUrl: authorizationUrl.href };
    }

    cancel(): void {
        this.generation++;
        if (!this.active) {
            return;
        }
        this.pending.resolve(this.active.requestId, 'failed', 'Microsoft sign-in was interrupted');
        this.close();
    }

    private close(): void {
        if (!this.active) {
            return;
        }
        clearTimeout(this.active.timer);
        this.active.server.close();
        this.active = null;
    }
}
