/**
 * Teams OAuth controller (client-side PKCE flow).
 *
 * Owns the four auth flows previously inlined in the server root:
 *  - start:    spin up a temporary localhost callback server and return OAuth params
 *  - exchange: swap the auth code for tokens, then reconnect/start the Teams bridge
 *  - status:   report whether a valid cached token exists
 *  - logout:   delete cached MCP OAuth token files and stop the bridge
 *
 * The token cache directory and callback-server factory are injectable so the
 * timeout, missing-config, exchange-failure, and logout paths are testable
 * against temp directories without a full container server.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ResolvedContainerConfig, ResolvedTeamsConfig } from '../config';
import type { ContainerRuntime } from './runtime';
import type { MessagingConfigService } from './messaging-config';

/** HTML served on the temporary OAuth callback server; posts the code back to the opener. */
const CALLBACK_HTML = `<!DOCTYPE html><html><head><title>Teams Auth</title></head><body>
<h2>Processing login...</h2>
<script>
(function() {
    var params = new URLSearchParams(window.location.search);
    var code = params.get('code');
    var error = params.get('error');
    var errorDesc = params.get('error_description');
    if (window.opener) {
        window.opener.postMessage({ type: 'teams-auth-callback', code: code, error: error, errorDescription: errorDesc }, '*');
        document.querySelector('h2').textContent = code ? '\\u2713 Login successful' : '\\u2717 Login failed';
        document.body.innerHTML += '<p>You can close this window.</p>';
        setTimeout(function() { window.close(); }, 2000);
    } else {
        document.querySelector('h2').textContent = 'Error: no opener window';
    }
})();
</script></body></html>`;

export interface TeamsAuthControllerDeps {
    config: ResolvedContainerConfig;
    runtime: ContainerRuntime;
    messagingConfig: MessagingConfigService;
    /** Directory holding cached MCP OAuth tokens (defaults to ~/.copilot/mcp-oauth-config). */
    oauthConfigDir?: string;
    /** HTTP server factory for the temporary callback server (defaults to node http). */
    createServer?: typeof http.createServer;
}

export class TeamsAuthController {
    private readonly config: ResolvedContainerConfig;
    private readonly runtime: ContainerRuntime;
    private readonly messagingConfig: MessagingConfigService;
    private readonly oauthConfigDir: string;
    private readonly createServer: typeof http.createServer;

    constructor(deps: TeamsAuthControllerDeps) {
        this.config = deps.config;
        this.runtime = deps.runtime;
        this.messagingConfig = deps.messagingConfig;
        this.oauthConfigDir = deps.oauthConfigDir ?? path.join(os.homedir(), '.copilot', 'mcp-oauth-config');
        this.createServer = deps.createServer ?? http.createServer;
    }

    private get teamsConfig() {
        return this.config.messaging?.teams;
    }

    /**
     * Start the OAuth flow: launch a temporary callback server on a random port
     * and return the OAuth config plus the localhost redirect URI.
     */
    async start(): Promise<Record<string, unknown>> {
        const mcpServerUrl = this.teamsConfig?.mcpServerUrl;
        if (!mcpServerUrl) {
            return { ok: false, error: 'No mcpServerUrl configured' };
        }
        const { getOAuthConfig } = await import('@plusplusoneplusplus/coc-connector/teams');
        const oauthConfig = getOAuthConfig(mcpServerUrl, {
            clientId: this.teamsConfig?.clientId,
            scope: this.teamsConfig?.scope,
            mode: this.teamsConfig?.mode ?? 'graph',
        });

        // Start temporary HTTP server on random port to receive the OAuth callback
        const tempServer = this.createServer((_cbReq, cbRes) => {
            cbRes.writeHead(200, { 'Content-Type': 'text/html' });
            cbRes.end(CALLBACK_HTML);
            // Auto-close temp server after serving the callback
            setTimeout(() => tempServer.close(), 2000);
        });

        await new Promise<void>((resolve) => {
            tempServer.listen(0, '127.0.0.1', () => resolve());
        });
        const callbackPort = (tempServer.address() as { port: number }).port;
        const redirectUri = `http://localhost:${callbackPort}/`;

        // Auto-close after 2 minutes if no callback received
        setTimeout(() => { try { tempServer.close(); } catch { /* already closed */ } }, 120000);

        return { ok: true, ...oauthConfig, redirectUri };
    }

    /** Exchange the auth code for tokens, then reconnect or start the Teams bridge. */
    async exchange(body: { code?: string; codeVerifier?: string; redirectUri?: string }): Promise<Record<string, unknown>> {
        const { code, codeVerifier, redirectUri } = body;
        if (!code || !codeVerifier || !redirectUri) {
            return { ok: false, error: 'Missing required fields: code, codeVerifier, redirectUri' };
        }
        const mcpServerUrl = this.teamsConfig?.mcpServerUrl;
        if (!mcpServerUrl) {
            return { ok: false, error: 'No mcpServerUrl configured' };
        }
        try {
            const { exchangeCodeForToken } = await import('@plusplusoneplusplus/coc-connector/teams');
            await exchangeCodeForToken(mcpServerUrl, {
                code,
                codeVerifier,
                redirectUri,
                clientId: this.teamsConfig?.clientId,
                scope: this.teamsConfig?.scope,
                mode: this.teamsConfig?.mode ?? 'graph',
            });
            console.log('[container] Teams OAuth code exchange succeeded');
            // Auto-start or reconnect the bridge
            if (this.runtime.teamsBridge) {
                await this.runtime.teamsBridge.reconnect();
            } else {
                try {
                    this.messagingConfig.enableTeams(mcpServerUrl);
                } catch { /* best effort */ }
                try {
                    const resolvedTeamsConfig = {
                        ...(this.teamsConfig ?? {}),
                        enabled: true,
                        mode: (this.teamsConfig?.mode ?? 'graph') as 'graph' | 'mcp',
                        mcpServerUrl,
                        botName: this.teamsConfig?.botName ?? 'CoC',
                        pollIntervalMs: this.teamsConfig?.pollIntervalMs ?? 3000,
                    } as ResolvedTeamsConfig;
                    await this.runtime.startTeamsBridge(resolvedTeamsConfig);
                } catch (err: any) {
                    console.error('[container] Failed to start Teams bridge after login:', err.message);
                }
            }
            return { ok: true, message: 'Token exchange successful, bridge started' };
        } catch (err: any) {
            console.error('[container] Teams OAuth exchange failed:', err.message);
            return { ok: false, error: err.message };
        }
    }

    /** Report whether a valid cached OAuth token exists. */
    async status(): Promise<Record<string, unknown>> {
        try {
            const mcpServerUrl = this.teamsConfig?.mcpServerUrl;
            if (!mcpServerUrl) {
                return { authenticated: false, error: 'No mcpServerUrl configured' };
            }
            const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/coc-connector/teams');
            await acquireMcpOAuthToken(mcpServerUrl);
            return { authenticated: true };
        } catch {
            return { authenticated: false };
        }
    }

    /** Delete cached OAuth token files for the configured MCP server and stop the bridge. */
    async logout(): Promise<Record<string, unknown>> {
        try {
            const mcpServerUrl = this.teamsConfig?.mcpServerUrl;
            if (mcpServerUrl) {
                const configDir = this.oauthConfigDir;
                if (fs.existsSync(configDir)) {
                    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json') && !f.includes('.tokens.'));
                    for (const file of files) {
                        try {
                            const meta = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf-8'));
                            if (meta.serverUrl === mcpServerUrl) {
                                const hash = file.replace('.json', '');
                                fs.unlinkSync(path.join(configDir, file));
                                const tokensFile = path.join(configDir, `${hash}.tokens.json`);
                                if (fs.existsSync(tokensFile)) fs.unlinkSync(tokensFile);
                                break;
                            }
                        } catch { /* skip */ }
                    }
                }
            }
            // Stop bridge
            if (this.runtime.teamsBridge) {
                await this.runtime.teamsBridge.stop();
                this.runtime.teamsBridge = undefined;
            }
            return { ok: true, message: 'Logged out and tokens cleared' };
        } catch (err: any) {
            return { ok: false, error: err.message };
        }
    }
}
