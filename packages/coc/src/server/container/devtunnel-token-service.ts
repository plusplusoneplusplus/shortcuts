/**
 * DevTunnel Token Service — acquires and caches access tokens for devtunnel agents.
 *
 * Runs `devtunnel token <tunnelId> --scope connect -j` to get JWT tokens
 * that allow the container proxy to access devtunnel URLs without browser auth.
 * Tokens are cached in memory and refreshed 1 hour before expiry.
 */

import { execFile } from 'child_process';

export interface DevTunnelTokenResult {
    token: string;
    expiresAt: number;
}

export type DevTunnelTokenCommandRunner = (
    tunnelId: string,
) => Promise<{ stdout: string; stderr: string }>;

interface CachedToken {
    token: string;
    expiresAt: number;
    tunnelId: string;
}

const REFRESH_BUFFER_MS = 60 * 60 * 1000; // 1 hour before expiry

function defaultCommandRunner(tunnelId: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            'devtunnel',
            ['token', tunnelId, '--scope', 'connect', '-j'],
            { windowsHide: true, timeout: 30_000 },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }
                resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
            },
        );
    });
}

function parseTokenResponse(stdout: string): DevTunnelTokenResult {
    let json: Record<string, unknown>;
    try {
        json = JSON.parse(stdout);
    } catch {
        throw new Error('Failed to parse devtunnel token output as JSON');
    }
    const token = json.token;
    if (typeof token !== 'string' || !token) {
        throw new Error('devtunnel token output missing "token" field');
    }
    let expiresAt: number;
    if (typeof json.expiration === 'string') {
        const parsed = Date.parse(json.expiration.replace(' UTC', 'Z').replace(' ', 'T'));
        expiresAt = isNaN(parsed) ? Date.now() + 24 * 60 * 60 * 1000 : parsed;
    } else {
        // Default to 24h from now
        expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    }
    return { token, expiresAt };
}

export class DevTunnelTokenService {
    private readonly cache = new Map<string, CachedToken>();
    private readonly pending = new Map<string, Promise<DevTunnelTokenResult | undefined>>();
    private readonly commandRunner: DevTunnelTokenCommandRunner;

    constructor(commandRunner?: DevTunnelTokenCommandRunner) {
        this.commandRunner = commandRunner ?? defaultCommandRunner;
    }

    /**
     * Get a valid access token for the given tunnel ID.
     * Returns undefined if token acquisition fails (CLI not available, not logged in, etc).
     */
    async getToken(tunnelId: string): Promise<DevTunnelTokenResult | undefined> {
        const cached = this.cache.get(tunnelId);
        if (cached && !this.isExpiringSoon(cached)) {
            return { token: cached.token, expiresAt: cached.expiresAt };
        }

        // Deduplicate concurrent requests for the same tunnel
        const existing = this.pending.get(tunnelId);
        if (existing) {
            return existing;
        }

        const promise = this.acquireToken(tunnelId);
        this.pending.set(tunnelId, promise);
        try {
            return await promise;
        } finally {
            this.pending.delete(tunnelId);
        }
    }

    /** Invalidate cached token for a tunnel (e.g. on 401 from agent). */
    invalidate(tunnelId: string): void {
        this.cache.delete(tunnelId);
    }

    /** Clear all cached tokens. */
    clear(): void {
        this.cache.clear();
    }

    private isExpiringSoon(cached: CachedToken): boolean {
        return Date.now() >= cached.expiresAt - REFRESH_BUFFER_MS;
    }

    private async acquireToken(tunnelId: string): Promise<DevTunnelTokenResult | undefined> {
        try {
            const { stdout } = await this.commandRunner(tunnelId);
            const result = parseTokenResponse(stdout);
            this.cache.set(tunnelId, {
                token: result.token,
                expiresAt: result.expiresAt,
                tunnelId,
            });
            return result;
        } catch (error) {
            // Non-fatal: token acquisition failure should not crash the server.
            // The relay popup fallback still works client-side.
            const msg = error instanceof Error ? error.message : String(error);
            process.stderr.write(`[container] Failed to acquire devtunnel token for ${tunnelId}: ${msg}\n`);
            return undefined;
        }
    }
}

export { parseTokenResponse };
