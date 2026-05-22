/**
 * CodexAuthManager — orchestrates the ChatGPT OAuth 2.0 PKCE flow.
 *
 * Flow:
 *  1. `startFlow()` — generate PKCE params, start local callback HTTP server,
 *     return the authorization URL and a request ID.
 *  2. The caller opens the URL in the user's browser (e.g. via the admin panel
 *     or the server's `POST /api/codex-auth/start` route).
 *  3. After the user approves, the provider redirects to
 *     `http://localhost:<callbackPort>/callback?code=<code>&state=<state>`.
 *  4. The local server receives the callback, exchanges the code for tokens
 *     (via `tokenExchanger`), and stores them in the `CodexAuthStore`.
 *  5. The pending flow resolves and the local callback server shuts down.
 *
 * `tokenExchanger` is injectable so tests can mock the HTTP exchange without
 * a real network. In production the server passes the default HTTP-based
 * exchanger (see `createHttpTokenExchanger`).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { getLogger, LogCategory } from '@plusplusoneplusplus/forge';
import type { CodexAuthStore, CodexAuthTokens, CodexAuthInfo } from './codex-auth-store';

// ============================================================================
// Constants / defaults
// ============================================================================

/** Default ChatGPT OAuth authorization endpoint. Configurable for staging/testing. */
export const CHATGPT_AUTH_URL = 'https://chatgpt.com/oauth/authorize';

/** Default ChatGPT token exchange endpoint. */
export const CHATGPT_TOKEN_URL = 'https://chatgpt.com/oauth/token';

/** Application client_id registered for the Codex SDK integration. */
export const CODEX_CLIENT_ID = 'coc-codex-integration';

/** Maximum time (ms) to wait for the user to complete the OAuth flow. */
const DEFAULT_FLOW_TTL_MS = 10 * 60 * 1000;

// ============================================================================
// Types
// ============================================================================

export interface CodexAuthFlowResult {
    /** Unique ID for this auth flow. */
    requestId: string;
    /** Authorization URL the user must open in a browser. */
    authUrl: string;
    /** Port the local callback server is listening on. */
    callbackPort: number;
}

export interface CodexAuthFlowStatus {
    requestId: string;
    status: 'pending' | 'completed' | 'failed' | 'expired';
    error?: string;
    completedAt?: number;
}

export interface TokenExchangeParams {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    clientId: string;
    tokenUrl: string;
}

export interface TokenExchangeResult {
    accessToken: string;
    refreshToken?: string;
    /** Seconds from now until expiry. */
    expiresIn: number;
}

/** Injectable token exchanger — replaces the HTTP call in tests. */
export type TokenExchanger = (params: TokenExchangeParams) => Promise<TokenExchangeResult>;

export interface CodexAuthManagerOptions {
    store: CodexAuthStore;
    /** Override the authorization endpoint URL. */
    authUrl?: string;
    /** Override the token exchange URL. */
    tokenUrl?: string;
    /** Override the OAuth client_id. */
    clientId?: string;
    /** Override the flow TTL. */
    flowTtlMs?: number;
    /** Override the HTTP token exchanger (for testing). */
    tokenExchanger?: TokenExchanger;
}

// ============================================================================
// Internal pending-flow record
// ============================================================================

interface PendingFlow {
    requestId: string;
    codeVerifier: string;
    state: string;
    callbackPort: number;
    redirectUri: string;
    server: http.Server;
    /** Wall-clock ms when this flow was created. */
    createdAt: number;
    resolve: (result: { code: string }) => void;
    reject: (err: Error) => void;
}

// ============================================================================
// PKCE helpers
// ============================================================================

function generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ============================================================================
// Default HTTP token exchanger
// ============================================================================

/**
 * Exchange an authorization code for tokens over HTTPS.
 * Uses Node's built-in `https` module — no third-party HTTP client.
 */
export function createHttpTokenExchanger(): TokenExchanger {
    return async (params: TokenExchangeParams): Promise<TokenExchangeResult> => {
        const https = await import('https');
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            code: params.code,
            redirect_uri: params.redirectUri,
            client_id: params.clientId,
            code_verifier: params.codeVerifier,
        });
        const bodyStr = body.toString();
        const url = new URL(params.tokenUrl);

        return new Promise<TokenExchangeResult>((resolve, reject) => {
            const req = https.request(
                {
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Content-Length': Buffer.byteLength(bodyStr),
                    },
                },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => { data += chunk; });
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(data) as {
                                access_token?: string;
                                refresh_token?: string;
                                expires_in?: number;
                                error?: string;
                                error_description?: string;
                            };
                            if (parsed.error) {
                                reject(new Error(`Token exchange failed: ${parsed.error} — ${parsed.error_description ?? ''}`));
                                return;
                            }
                            if (!parsed.access_token) {
                                reject(new Error('Token exchange response missing access_token'));
                                return;
                            }
                            resolve({
                                accessToken: parsed.access_token,
                                refreshToken: parsed.refresh_token,
                                expiresIn: typeof parsed.expires_in === 'number' ? parsed.expires_in : 3600,
                            });
                        } catch (err) {
                            reject(new Error(`Failed to parse token response: ${err instanceof Error ? err.message : String(err)}`));
                        }
                    });
                },
            );
            req.on('error', reject);
            req.write(bodyStr);
            req.end();
        });
    };
}

// ============================================================================
// CodexAuthManager
// ============================================================================

export class CodexAuthManager {
    private readonly store: CodexAuthStore;
    private readonly authUrl: string;
    private readonly tokenUrl: string;
    private readonly clientId: string;
    private readonly flowTtlMs: number;
    private readonly exchanger: TokenExchanger;
    private readonly flows = new Map<string, PendingFlow>();
    private readonly flowStatuses = new Map<string, CodexAuthFlowStatus>();

    constructor(options: CodexAuthManagerOptions) {
        this.store = options.store;
        this.authUrl = options.authUrl ?? CHATGPT_AUTH_URL;
        this.tokenUrl = options.tokenUrl ?? CHATGPT_TOKEN_URL;
        this.clientId = options.clientId ?? CODEX_CLIENT_ID;
        this.flowTtlMs = options.flowTtlMs ?? DEFAULT_FLOW_TTL_MS;
        this.exchanger = options.tokenExchanger ?? createHttpTokenExchanger();
    }

    /** Return current auth status from the token store. */
    getAuthInfo(): CodexAuthInfo {
        return this.store.readInfo();
    }

    /**
     * Start an OAuth PKCE flow.
     *
     * Starts a local HTTP server on an ephemeral port and returns the
     * authorization URL to open in the user's browser. The flow resolves
     * automatically when the callback arrives; call `waitForFlow` to await
     * completion.
     */
    async startFlow(): Promise<CodexAuthFlowResult> {
        const requestId = randomUUID();
        const codeVerifier = generateCodeVerifier();
        const codeChallenge = generateCodeChallenge(codeVerifier);
        const state = randomUUID();
        const log = getLogger();

        let pendingResolve!: (result: { code: string }) => void;
        let pendingReject!: (err: Error) => void;

        const callbackPromise = new Promise<{ code: string }>((resolve, reject) => {
            pendingResolve = resolve;
            pendingReject = reject;
        });

        // Create the local callback server and listen on port 0 to get an
        // OS-assigned ephemeral port — avoids a race-prone two-step allocation.
        const callbackServer = http.createServer((req, res) => {
            const port = (callbackServer.address() as { port: number } | null)?.port ?? 0;
            const reqUrl = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
            if (reqUrl.pathname !== '/callback') {
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            const code = reqUrl.searchParams.get('code');
            const returnedState = reqUrl.searchParams.get('state');
            const error = reqUrl.searchParams.get('error');

            if (error) {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`<html><body><h2>Authentication failed: ${error}</h2><p>You may close this tab.</p></body></html>`);
                pendingReject(new Error(`OAuth error: ${error}`));
                return;
            }

            if (!code || returnedState !== state) {
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end('<html><body><h2>Invalid callback</h2><p>You may close this tab.</p></body></html>');
                pendingReject(new Error('Invalid OAuth callback: missing code or state mismatch'));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('<html><body><h2>Authenticated successfully!</h2><p>You may close this tab and return to CoC.</p></body></html>');
            pendingResolve({ code });
        });

        // Unref the server so it does not keep the Node.js event loop alive
        // when only tests or server-shutdown are waiting for it.
        callbackServer.unref();

        const callbackPort = await new Promise<number>((resolve, reject) => {
            callbackServer.listen(0, '127.0.0.1', () => {
                const addr = callbackServer.address() as { port: number } | null;
                if (!addr) { reject(new Error('Could not bind local callback server')); return; }
                resolve(addr.port);
            });
            callbackServer.on('error', reject);
        });

        const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: this.clientId,
            redirect_uri: redirectUri,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            scope: 'openid profile',
        });
        const fullAuthUrl = `${this.authUrl}?${params.toString()}`;

        const flow: PendingFlow = {
            requestId,
            codeVerifier,
            state,
            callbackPort,
            redirectUri,
            server: callbackServer,
            createdAt: Date.now(),
            resolve: pendingResolve,
            reject: pendingReject,
        };
        this.flows.set(requestId, flow);
        this.flowStatuses.set(requestId, { requestId, status: 'pending' });

        // TTL guard — auto-cancel the flow if the user never completes it
        const ttlTimer = setTimeout(() => {
            const f = this.flows.get(requestId);
            if (f) {
                f.reject(new Error('OAuth flow timed out'));
            }
        }, this.flowTtlMs);
        if (typeof ttlTimer.unref === 'function') ttlTimer.unref();

        // Drive the background token exchange once the callback arrives
        callbackPromise.then(
            async ({ code }) => {
                clearTimeout(ttlTimer);
                const f = this.flows.get(requestId);
                if (!f) return; // already cleaned up
                try {
                    const result = await this.exchanger({
                        code,
                        codeVerifier: f.codeVerifier,
                        redirectUri: f.redirectUri,
                        clientId: this.clientId,
                        tokenUrl: this.tokenUrl,
                    });
                    const nowSec = Math.floor(Date.now() / 1000);
                    this.store.write({
                        accessToken: result.accessToken,
                        refreshToken: result.refreshToken,
                        expiresAt: nowSec + result.expiresIn,
                        createdAt: nowSec,
                    });
                    this.flowStatuses.set(requestId, {
                        requestId,
                        status: 'completed',
                        completedAt: Date.now(),
                    });
                    log.info(LogCategory.AI, `[CodexAuth] OAuth flow completed for requestId=${requestId}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.flowStatuses.set(requestId, { requestId, status: 'failed', error: msg });
                    log.warn(LogCategory.AI, `[CodexAuth] Token exchange failed for requestId=${requestId}: ${msg}`);
                } finally {
                    this.flows.delete(requestId);
                    f.server.close();
                }
            },
            (err: Error) => {
                clearTimeout(ttlTimer);
                const f = this.flows.get(requestId);
                if (f) {
                    const nowMs = Date.now();
                    const elapsed = nowMs - f.createdAt;
                    const timedOut = elapsed >= this.flowTtlMs;
                    this.flowStatuses.set(requestId, {
                        requestId,
                        status: timedOut ? 'expired' : 'failed',
                        error: err.message,
                    });
                    this.flows.delete(requestId);
                    f.server.close();
                }
                log.warn(LogCategory.AI, `[CodexAuth] OAuth flow failed for requestId=${requestId}: ${err.message}`);
            },
        );

        return { requestId, authUrl: fullAuthUrl, callbackPort };
    }

    /** Get the current status of a previously started flow. */
    getFlowStatus(requestId: string): CodexAuthFlowStatus | undefined {
        return this.flowStatuses.get(requestId);
    }

    /** List all flow statuses (most recent first by createdAt). */
    listFlowStatuses(): CodexAuthFlowStatus[] {
        return Array.from(this.flowStatuses.values());
    }

    /** Remove stored auth tokens. */
    clearAuth(): boolean {
        return this.store.clear();
    }

    /** Abort all pending flows and close their callback servers. */
    dispose(): void {
        for (const [, flow] of this.flows) {
            try {
                flow.reject(new Error('CodexAuthManager disposed'));
                flow.server.close();
            } catch { /* best-effort */ }
        }
        this.flows.clear();
    }
}
