/**
 * Azure AD Device Code Flow for Teams MCP server authentication.
 *
 * Uses the Microsoft identity platform device code flow to interactively
 * authenticate the user and obtain a bearer token.
 *
 * Also supports reading cached OAuth tokens from ~/.copilot/mcp-oauth-config/
 * (obtained via Copilot CLI's OAuth flow) and refreshing them when expired.
 */

import type { TeamsAuthConfig, DeviceCodeInfo } from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Default client ID — Azure CLI public client (works for Graph API). */
const DEFAULT_CLIENT_ID = '04b07795-8ddb-461a-bbee-02f9e1bf7b46';

/**
 * Build the default scope for the Agent365 Teams MCP server.
 * Pattern: https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/servers/mcp_TeamsServer/.default
 */
function buildDefaultScope(mcpServerUrl: string): string {
    // The scope is the MCP server URL itself with /.default appended
    const base = mcpServerUrl.replace(/\/$/, '');
    return `${base}/.default`;
}

interface DeviceCodeResponse {
    device_code: string;
    user_code: string;
    verification_uri: string;
    expires_in: number;
    interval: number;
    message: string;
}

interface TokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
}

/**
 * Extract tenant ID from the MCP server URL.
 * URL pattern: https://agent365.svc.cloud.microsoft/agents/tenants/{tenantId}/...
 */
export function extractTenantId(mcpServerUrl: string): string | undefined {
    const match = mcpServerUrl.match(/\/tenants\/([^/]+)/);
    return match?.[1];
}

/**
 * Initiate device code flow and acquire a token.
 * Returns the access token once the user completes the interactive login.
 */
export async function acquireTokenWithDeviceCode(
    config: TeamsAuthConfig & { mcpServerUrl?: string },
    onDeviceCode: (info: DeviceCodeInfo) => void,
): Promise<string> {
    const clientId = config.clientId ?? DEFAULT_CLIENT_ID;
    const scope = config.scope
        ?? (config.mcpServerUrl ? buildDefaultScope(config.mcpServerUrl) : undefined);
    if (!scope) {
        throw new Error('No scope configured and no mcpServerUrl to derive one from');
    }

    // Use tenant from config, extract from MCP URL, or fall back to 'organizations'
    const tenantId = config.tenantId
        ?? (config.mcpServerUrl ? extractTenantId(config.mcpServerUrl) : undefined)
        ?? 'organizations';
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

    // Step 1: Request device code
    const dcResponse = await fetch(`${tokenEndpoint}/devicecode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, scope }),
    });

    if (!dcResponse.ok) {
        const errorText = await dcResponse.text();
        throw new Error(`Device code request failed: ${dcResponse.status} ${errorText}`);
    }

    const dcData = await dcResponse.json() as DeviceCodeResponse;

    // Notify the caller to show the device code to the user
    onDeviceCode({
        userCode: dcData.user_code,
        verificationUri: dcData.verification_uri,
        message: dcData.message,
        expiresIn: dcData.expires_in,
    });

    // Step 2: Poll for token until user completes login
    const pollInterval = (dcData.interval || 5) * 1000;
    const expiresAt = Date.now() + dcData.expires_in * 1000;

    while (Date.now() < expiresAt) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));

        const tokenResponse = await fetch(`${tokenEndpoint}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                device_code: dcData.device_code,
            }),
        });

        if (tokenResponse.ok) {
            const tokenData = await tokenResponse.json() as TokenResponse;
            return tokenData.access_token;
        }

        const errorBody = await tokenResponse.json() as { error?: string; error_description?: string };

        if (errorBody.error === 'authorization_pending') {
            continue; // User hasn't completed login yet
        }
        if (errorBody.error === 'slow_down') {
            await new Promise(resolve => setTimeout(resolve, 5000));
            continue;
        }

        // Any other error is fatal
        throw new Error(errorBody.error_description ?? errorBody.error ?? 'Token acquisition failed');
    }

    throw new Error('Device code flow expired — user did not complete login in time');
}

/**
 * Acquire a token via PKCE authorization code flow (browser-based).
 * Opens the user's browser to the login page, starts a local HTTP server
 * to receive the redirect, exchanges the auth code for tokens, and saves
 * them to ~/.copilot/mcp-oauth-config/.
 */
export async function acquireTokenViaBrowser(
    mcpServerUrl: string,
    opts?: { clientId?: string; scope?: string; homeDir?: string },
): Promise<string> {
    const http = await import('http');
    const crypto = await import('crypto');
    const { exec } = await import('child_process');

    const clientId = opts?.clientId ?? 'aebc6443-996d-45c2-90f0-388ff96faa56';
    const tenantId = extractTenantId(mcpServerUrl) ?? 'organizations';
    const scope = opts?.scope ?? `${mcpServerUrl}/.default offline_access`;
    const authorizeUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    // Generate PKCE code verifier + challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Start local server on a random port (use 'localhost' for Azure AD redirect URI compatibility)
    return new Promise<string>((resolve, reject) => {
        const server = http.createServer();
        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const redirectUri = `http://localhost:${port}/`;

            // Build authorization URL
            const params = new URLSearchParams({
                client_id: clientId,
                response_type: 'code',
                redirect_uri: redirectUri,
                scope,
                code_challenge: codeChallenge,
                code_challenge_method: 'S256',
                response_mode: 'query',
            });
            const authUrl = `${authorizeUrl}?${params.toString()}`;

            // Open browser
            const openCmd = process.platform === 'win32' ? `start "" "${authUrl}"`
                : process.platform === 'darwin' ? `open "${authUrl}"`
                : `xdg-open "${authUrl}"`;
            exec(openCmd);
            console.log(`[teams-auth] Opening browser for login...`);

            // Set timeout
            const timeout = setTimeout(() => {
                server.close();
                reject(new Error('OAuth login timed out (120s)'));
            }, 120000);

            server.on('request', async (req, res) => {
                const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');

                if (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h2>Login failed</h2><p>You can close this window.</p></body></html>');
                    clearTimeout(timeout);
                    server.close();
                    reject(new Error(`OAuth error: ${error} - ${url.searchParams.get('error_description') ?? ''}`));
                    return;
                }

                if (!code) {
                    res.writeHead(400);
                    res.end('Missing code');
                    return;
                }

                // Exchange code for tokens
                try {
                    const tokenRes = await fetch(tokenUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: clientId,
                            grant_type: 'authorization_code',
                            code,
                            redirect_uri: redirectUri,
                            code_verifier: codeVerifier,
                            scope,
                        }),
                    });

                    if (!tokenRes.ok) {
                        const errText = await tokenRes.text();
                        throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`);
                    }

                    const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

                    // Save to ~/.copilot/mcp-oauth-config/
                    saveMcpOAuthTokens(mcpServerUrl, {
                        clientId,
                        redirectUri,
                        authorizationServerUrl: `https://login.microsoftonline.com/${tenantId}/v2.0`,
                        resourceUrl: mcpServerUrl,
                        accessToken: tokenData.access_token,
                        refreshToken: tokenData.refresh_token,
                        expiresIn: tokenData.expires_in,
                        scope: tokenData.scope ?? scope,
                    }, opts?.homeDir);

                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h2>\u2713 Logged in successfully</h2><p>You can close this window and return to CoC.</p></body></html>');
                    clearTimeout(timeout);
                    server.close();
                    resolve(tokenData.access_token);
                } catch (err) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<html><body><h2>Login failed</h2><p>Check server logs.</p></body></html>');
                    clearTimeout(timeout);
                    server.close();
                    reject(err);
                }
            });
        });
    });
}

/** Save OAuth tokens to the Copilot CLI cache format. */
function saveMcpOAuthTokens(
    serverUrl: string,
    data: {
        clientId: string;
        redirectUri: string;
        authorizationServerUrl: string;
        resourceUrl: string;
        accessToken: string;
        refreshToken?: string;
        expiresIn: number;
        scope: string;
    },
    homeDir?: string,
): void {
    const crypto = require('crypto') as typeof import('crypto');
    const configDir = path.join(homeDir ?? os.homedir(), '.copilot', 'mcp-oauth-config');

    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    // Find existing metadata file for this server, or create new hash
    const files = fs.readdirSync(configDir).filter((f: string) => f.endsWith('.json') && !f.includes('.tokens.'));
    let hash: string | undefined;

    for (const file of files) {
        try {
            const meta = JSON.parse(fs.readFileSync(path.join(configDir, file), 'utf-8'));
            if (meta.serverUrl === serverUrl) {
                hash = file.replace('.json', '');
                break;
            }
        } catch { /* skip */ }
    }

    if (!hash) {
        hash = crypto.createHash('sha256').update(serverUrl + data.clientId).digest('hex');
    }

    // Write metadata
    const metadata = {
        serverUrl,
        authorizationServerUrl: data.authorizationServerUrl,
        clientId: data.clientId,
        redirectUri: data.redirectUri,
        resourceUrl: data.resourceUrl,
        issuedAt: Math.floor(Date.now() / 1000),
        isStatic: false,
    };
    fs.writeFileSync(path.join(configDir, `${hash}.json`), JSON.stringify(metadata, null, 2));

    // Write tokens
    const tokens = {
        accessToken: data.accessToken,
        expiresAt: Math.floor(Date.now() / 1000) + data.expiresIn,
        scope: data.scope,
        refreshToken: data.refreshToken,
    };
    fs.writeFileSync(path.join(configDir, `${hash}.tokens.json`), JSON.stringify(tokens));

    console.log(`[teams-auth] Saved OAuth tokens to ${configDir}/${hash}.tokens.json`);
}

/**
 * Get OAuth configuration for client-side PKCE flow.
 * Returns the parameters needed to build an authorize URL in the browser.
 */
export function getOAuthConfig(
    mcpServerUrl: string,
    opts?: { clientId?: string; scope?: string },
): { clientId: string; tenantId: string; scope: string; authorizeUrl: string; tokenUrl: string } {
    const clientId = opts?.clientId ?? 'aebc6443-996d-45c2-90f0-388ff96faa56';
    const tenantId = extractTenantId(mcpServerUrl) ?? 'organizations';
    const scope = opts?.scope ?? `${mcpServerUrl}/.default offline_access`;
    return {
        clientId,
        tenantId,
        scope,
        authorizeUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
        tokenUrl: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    };
}

/**
 * Exchange an authorization code for tokens (server-side step of client-initiated PKCE flow).
 * The client generates PKCE, opens the browser, receives the auth code, then sends it here.
 */
export async function exchangeCodeForToken(
    mcpServerUrl: string,
    params: { code: string; codeVerifier: string; redirectUri: string; clientId?: string; scope?: string },
    homeDir?: string,
): Promise<string> {
    const config = getOAuthConfig(mcpServerUrl, { clientId: params.clientId, scope: params.scope });
    const clientId = params.clientId ?? config.clientId;
    const scope = params.scope ?? config.scope;

    const tokenRes = await fetch(config.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            grant_type: 'authorization_code',
            code: params.code,
            redirect_uri: params.redirectUri,
            code_verifier: params.codeVerifier,
            scope,
        }),
    });

    if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        throw new Error(`Token exchange failed: ${tokenRes.status} ${errText}`);
    }

    const tokenData = await tokenRes.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };

    // Save to ~/.copilot/mcp-oauth-config/
    saveMcpOAuthTokens(mcpServerUrl, {
        clientId,
        redirectUri: params.redirectUri,
        authorizationServerUrl: `https://login.microsoftonline.com/${config.tenantId}/v2.0`,
        resourceUrl: mcpServerUrl,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        scope: tokenData.scope ?? scope,
    }, homeDir);

    return tokenData.access_token;
}

/**
 * Acquire a Graph API token using the Azure CLI (`az account get-access-token`).
 * Requires user to have previously run `az login`.
 * Returns the access token string.
 */
export async function acquireTokenViaAzCli(resource?: string): Promise<string> {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const fs = await import('fs');
    const execFileAsync = promisify(execFile);

    const targetResource = resource ?? 'https://graph.microsoft.com';
    const args = ['account', 'get-access-token', '--resource', targetResource, '--query', 'accessToken', '-o', 'tsv'];

    // Resolve the az CLI executable — search common install paths on Windows
    if (process.platform === 'win32') {
        const candidates = [
            'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
            'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
        ];
        let azPath: string | undefined;
        for (const candidate of candidates) {
            try {
                fs.accessSync(candidate);
                azPath = candidate;
                break;
            } catch { /* try next */ }
        }

        if (azPath) {
            try {
                // Use cmd.exe /c to handle .cmd files with spaces in path
                const { stdout } = await execFileAsync('cmd.exe', ['/c', azPath, ...args], { timeout: 15000 });
                const token = stdout.trim();
                if (!token) throw new Error('az CLI returned empty token — run `az login` first');
                return token;
            } catch (err: any) {
                throw new Error(`az CLI token acquisition failed: ${err.message ?? err}`);
            }
        }
    }

    // Unix or az in PATH
    try {
        const { stdout } = await execFileAsync('az', args, { timeout: 15000 });
        const token = stdout.trim();
        if (!token) {
            throw new Error('az CLI returned empty token — run `az login` first');
        }
        return token;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            throw new Error('Azure CLI (az) not found — install it or provide a bearerToken');
        }
        throw new Error(`az CLI token acquisition failed: ${err.message ?? err}`);
    }
}

// ── MCP OAuth Token Cache ────────────────────────────────────────────

interface McpOAuthMetadata {
    serverUrl: string;
    authorizationServerUrl: string;
    clientId: string;
    redirectUri: string;
    resourceUrl: string;
}

interface McpOAuthTokens {
    accessToken: string;
    expiresAt: number;
    scope: string;
    refreshToken?: string;
}

/**
 * Acquire an access token for an MCP server by reading the cached OAuth tokens
 * from `~/.copilot/mcp-oauth-config/`. These tokens are obtained through the
 * Copilot CLI's OAuth flow (triggered on first use of an MCP server).
 *
 * If the token is expired and a refresh token is available, refreshes it automatically.
 * Throws if no cached token exists (user must use Copilot CLI to authenticate first).
 */
export async function acquireMcpOAuthToken(mcpServerUrl: string, homeDir?: string): Promise<string> {
    const configDir = path.join(homeDir ?? os.homedir(), '.copilot', 'mcp-oauth-config');

    if (!fs.existsSync(configDir)) {
        throw new Error('No MCP OAuth config found — use Copilot CLI to authenticate to the Teams MCP server first');
    }

    // Scan *.json (excluding *.tokens.json) to find metadata matching this server URL
    const files = fs.readdirSync(configDir).filter(f => f.endsWith('.json') && !f.includes('.tokens.'));
    let metadataFile: string | undefined;
    let metadata: McpOAuthMetadata | undefined;

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(configDir, file), 'utf-8');
            const parsed = JSON.parse(raw) as McpOAuthMetadata;
            if (parsed.serverUrl === mcpServerUrl) {
                metadataFile = file;
                metadata = parsed;
                break;
            }
        } catch { /* skip unreadable files */ }
    }

    if (!metadataFile || !metadata) {
        throw new Error(`No OAuth config found for MCP server "${mcpServerUrl}" — use Copilot CLI to authenticate first`);
    }

    // Read the tokens file
    const tokensFileName = metadataFile.replace('.json', '.tokens.json');
    const tokensFilePath = path.join(configDir, tokensFileName);

    if (!fs.existsSync(tokensFilePath)) {
        throw new Error(`OAuth tokens file missing for MCP server — use Copilot CLI to re-authenticate`);
    }

    let tokens: McpOAuthTokens;
    try {
        tokens = JSON.parse(fs.readFileSync(tokensFilePath, 'utf-8'));
    } catch {
        throw new Error('Failed to parse OAuth tokens file');
    }

    // Check if token is still valid (with 5-minute buffer)
    const now = Math.floor(Date.now() / 1000);
    if (tokens.expiresAt && tokens.expiresAt > now + 300) {
        return tokens.accessToken;
    }

    // Token expired — try to refresh
    if (!tokens.refreshToken) {
        throw new Error('MCP OAuth token expired and no refresh token available — use Copilot CLI to re-authenticate');
    }

    const refreshed = await refreshMcpToken(metadata, tokens.refreshToken);

    // Persist refreshed tokens
    const updatedTokens: McpOAuthTokens = {
        accessToken: refreshed.access_token,
        expiresAt: Math.floor(Date.now() / 1000) + refreshed.expires_in,
        scope: refreshed.scope ?? tokens.scope,
        refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    };

    try {
        fs.writeFileSync(tokensFilePath, JSON.stringify(updatedTokens));
    } catch { /* best effort */ }

    return updatedTokens.accessToken;
}

async function refreshMcpToken(
    metadata: McpOAuthMetadata,
    refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }> {
    // AAD token endpoint: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    // authorizationServerUrl is typically "https://login.microsoftonline.com/organizations/v2.0"
    let tokenEndpoint: string;
    if (metadata.authorizationServerUrl.includes('/oauth2/v2.0')) {
        tokenEndpoint = metadata.authorizationServerUrl.replace(/\/?$/, '') + '/token';
    } else {
        // Convert ".../organizations/v2.0" → ".../organizations/oauth2/v2.0/token"
        tokenEndpoint = metadata.authorizationServerUrl.replace(/\/v2\.0\/?$/, '/oauth2/v2.0/token');
    }

    const body = new URLSearchParams({
        client_id: metadata.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: `${metadata.resourceUrl}/.default offline_access`,
    });

    const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }>;
}
