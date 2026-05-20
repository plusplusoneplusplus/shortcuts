/**
 * Azure AD Device Code Flow for Teams MCP server authentication.
 *
 * Uses the Microsoft identity platform device code flow to interactively
 * authenticate the user and obtain a bearer token.
 */

import type { TeamsAuthConfig, DeviceCodeInfo } from './types';

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

    // Resolve the az CLI executable — search common install paths on Windows
    let azCmd = 'az';
    if (process.platform === 'win32') {
        const candidates = [
            'C:\\Program Files\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
            'C:\\Program Files (x86)\\Microsoft SDKs\\Azure\\CLI2\\wbin\\az.cmd',
        ];
        for (const candidate of candidates) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                azCmd = candidate;
                break;
            } catch { /* try next */ }
        }
    }

    try {
        const { stdout } = await execFileAsync(azCmd, [
            'account', 'get-access-token',
            '--resource', targetResource,
            '--query', 'accessToken',
            '-o', 'tsv',
        ], { timeout: 15000, shell: process.platform === 'win32' });
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
