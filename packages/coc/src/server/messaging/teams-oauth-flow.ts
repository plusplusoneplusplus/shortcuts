import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as http from 'http';
import {
    exchangeCodeForToken,
    getOAuthConfig,
    McpClient,
} from '@plusplusoneplusplus/coc-connector/teams';
import { readMcpServerAuthInfo, clearMcpServerAuth } from '../mcp-oauth/mcp-oauth-token-cache';
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
        const verifier = randomBytes(32).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const requestId = randomUUID();
        const generation = this.generation;
        let redirectUri = '';
        let processing = false;
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
            let tokenSaved = false;
            let stage: 'sign-in' | 'token exchange' | 'MCP verification' | 'token cache' = 'sign-in';
            try {
                if (error || !code) {
                    throw new Error('Microsoft sign-in was cancelled or did not return an authorization code');
                }
                stage = 'token exchange';
                const token = await exchangeCodeForToken(serverUrl, {
                    code, codeVerifier: verifier, redirectUri, clientId: config.clientId,
                    scope: config.scope, mode: 'mcp',
                });
                tokenSaved = true;
                stage = 'MCP verification';
                const client = new McpClient({ serverUrl, bearerToken: token });
                await client.initialize();
                await client.listTools();
                if (this.pending.getPending(requestId)?.status !== 'pending') {
                    throw new Error('Microsoft sign-in expired during MCP verification');
                }
                stage = 'token cache';
                if (readMcpServerAuthInfo(serverUrl, 'http').status !== 'authenticated') {
                    throw new Error('Microsoft sign-in did not save an MCP token');
                }
                this.pending.resolve(requestId, 'completed');
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.writeHead(200).end('Microsoft Teams authenticated. Return to CoC.');
            } catch {
                if (tokenSaved) {
                    clearMcpServerAuth(serverUrl);
                }
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
        const timer = setTimeout(() => {
            this.pending.resolve(requestId, 'failed', 'Microsoft sign-in timed out');
            this.close();
        }, FLOW_TIMEOUT_MS);
        this.active = { server, timer, requestId };
        const authorization = new URL(config.authorizeUrl);
        authorization.search = new URLSearchParams([
            ['client_id', config.clientId],
            ['response_type', 'code'],
            ['redirect_uri', redirectUri],
            ['scope', config.scope],
            ['state', state],
            ['code_challenge', challenge],
            ['code_challenge_method', 'S256'],
            ['response_mode', 'query'],
        ]).toString();
        this.pending.addPending({ requestId, serverName: 'Microsoft Teams', serverUrl });
        return { requestId, authorizationUrl: authorization.href };
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
