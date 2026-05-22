/**
 * Read-only inspector for the Copilot SDK's MCP OAuth token cache at
 * `~/.copilot/mcp-oauth-config/`.
 *
 * The SDK (and our PKCE helper in `teams-bot/src/auth.ts`) writes two files per
 * server, keyed by a hash:
 *   - `<hash>.json`         metadata: { serverUrl, authorizationServerUrl, clientId, ... }
 *   - `<hash>.tokens.json`  tokens:   { accessToken, expiresAt, scope, refreshToken? }
 *
 * This module never writes — it only reports whether a token exists for a
 * given MCP server URL and whether it is still valid. The MCP servers panel
 * uses it to render the green/yellow/red status dot, and the new
 * "Authenticate" flow uses it to wait for completion.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Auth status for a single MCP server.
 *
 * - `authenticated`: A non-expired access token is present in the cache.
 * - `expired`:       A token exists but `expiresAt` has passed.
 * - `required`:      No token cached for this server URL.
 * - `not-required`:  The server is not a remote (HTTP/SSE) MCP server, so no
 *                    OAuth flow applies.
 * - `unknown`:       The cache directory or files are unreadable.
 */
export type McpServerAuthStatus =
    | 'authenticated'
    | 'expired'
    | 'required'
    | 'not-required'
    | 'unknown';

export interface McpServerAuthInfo {
    status: McpServerAuthStatus;
    /** Wall-clock seconds at which the cached access token expires, if known. */
    expiresAt?: number;
    /** True when a refresh token is available alongside the access token. */
    hasRefreshToken?: boolean;
}

/** Default cache directory: `~/.copilot/mcp-oauth-config/`. */
export function getMcpOauthCacheDir(homeDir?: string): string {
    return path.join(homeDir ?? os.homedir(), '.copilot', 'mcp-oauth-config');
}

interface MetadataFile {
    serverUrl?: string;
    clientId?: string;
    authorizationServerUrl?: string;
}

interface TokensFile {
    accessToken?: string;
    expiresAt?: number;
    refreshToken?: string;
    scope?: string;
}

/**
 * Find the metadata file in the cache directory whose `serverUrl` matches the
 * requested URL. Returns `null` if not found or the directory is missing.
 *
 * `serverUrl` comparison is exact; trailing slashes are not normalised. Tokens
 * are keyed by the URL the SDK saw, so callers must pass the same string they
 * configured for the server.
 */
function findMetadataFile(cacheDir: string, serverUrl: string): { hash: string; metadata: MetadataFile } | null {
    if (!fs.existsSync(cacheDir)) return null;
    let files: string[];
    try {
        files = fs.readdirSync(cacheDir);
    } catch {
        return null;
    }
    for (const file of files) {
        if (!file.endsWith('.json') || file.includes('.tokens.')) continue;
        try {
            const raw = fs.readFileSync(path.join(cacheDir, file), 'utf-8');
            const parsed = JSON.parse(raw) as MetadataFile;
            if (parsed.serverUrl === serverUrl) {
                return { hash: file.replace(/\.json$/, ''), metadata: parsed };
            }
        } catch {
            // Skip unreadable / malformed entries
        }
    }
    return null;
}

/**
 * Read auth status for a single remote MCP server URL.
 *
 * `serverType` lets stdio servers short-circuit to `not-required` without
 * touching the filesystem. Pass `undefined` to force a lookup.
 */
export function readMcpServerAuthInfo(
    serverUrl: string | undefined,
    serverType?: string,
    homeDir?: string,
): McpServerAuthInfo {
    if (!serverUrl || (serverType && serverType !== 'http' && serverType !== 'sse')) {
        return { status: 'not-required' };
    }

    const cacheDir = getMcpOauthCacheDir(homeDir);
    let found: { hash: string; metadata: MetadataFile } | null;
    try {
        found = findMetadataFile(cacheDir, serverUrl);
    } catch {
        return { status: 'unknown' };
    }

    if (!found) {
        return { status: 'required' };
    }

    const tokensPath = path.join(cacheDir, `${found.hash}.tokens.json`);
    if (!fs.existsSync(tokensPath)) {
        return { status: 'required' };
    }

    let tokens: TokensFile;
    try {
        tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8')) as TokensFile;
    } catch {
        return { status: 'unknown' };
    }

    if (!tokens.accessToken) {
        return { status: 'required' };
    }

    const expiresAt = typeof tokens.expiresAt === 'number' ? tokens.expiresAt : undefined;
    const hasRefreshToken = typeof tokens.refreshToken === 'string' && tokens.refreshToken.length > 0;

    // 60-second skew so a near-expired token is reported as expired rather
    // than "authenticated but about to fail". A refresh token can still pull
    // us out, but the UI cue is more accurate this way.
    if (expiresAt !== undefined && expiresAt <= Math.floor(Date.now() / 1000) + 60) {
        return { status: 'expired', expiresAt, hasRefreshToken };
    }

    return { status: 'authenticated', expiresAt, hasRefreshToken };
}

/**
 * Delete the cached tokens for a server URL. Returns `true` when files were
 * removed. Used to force a fresh OAuth flow ("Re-authenticate" in the UI).
 */
export function clearMcpServerAuth(serverUrl: string, homeDir?: string): boolean {
    const cacheDir = getMcpOauthCacheDir(homeDir);
    const found = findMetadataFile(cacheDir, serverUrl);
    if (!found) return false;
    const metaPath = path.join(cacheDir, `${found.hash}.json`);
    const tokensPath = path.join(cacheDir, `${found.hash}.tokens.json`);
    let removed = false;
    try { fs.unlinkSync(metaPath); removed = true; } catch { /* ignore */ }
    try { fs.unlinkSync(tokensPath); removed = true; } catch { /* ignore */ }
    return removed;
}
