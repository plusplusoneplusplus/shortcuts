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
    // Derive token endpoint from authorizationServerUrl
    // e.g. "https://login.microsoftonline.com/organizations/v2.0" → ".../token"
    const tokenUrl = metadata.authorizationServerUrl.replace(/\/?$/, '') + '/token';
    // But the format is v2.0, token endpoint is under the same path
    // Actually AAD token endpoints: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
    const tokenEndpoint = tokenUrl.includes('/oauth2/') ? tokenUrl : tokenUrl.replace('/v2.0', '/oauth2/v2.0/token');

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
