/**
 * DevTunnel Token Service
 *
 * Acquires and caches access tokens for devtunnel connections.
 * Runs `devtunnel token <tunnelId> --scope connect -j` to get a JWT token.
 */

import { execFile } from 'child_process';

export interface TunnelToken {
    token: string;
    expiresAt: Date;
}

interface TokenCacheEntry {
    token: string;
    expiresAt: Date;
    promise?: Promise<TunnelToken | undefined>;
}

const TOKEN_REFRESH_BUFFER_MS = 60 * 60 * 1000; // Refresh 1h before expiry

export class DevTunnelTokenService {
    private cache = new Map<string, TokenCacheEntry>();

    async getToken(tunnelId: string): Promise<string | undefined> {
        const cached = this.cache.get(tunnelId);
        if (cached && !cached.promise && cached.expiresAt.getTime() - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
            return cached.token;
        }

        // Deduplicate concurrent requests
        if (cached?.promise) {
            const result = await cached.promise;
            return result?.token;
        }

        const promise = this.fetchToken(tunnelId);
        if (cached) {
            cached.promise = promise;
        } else {
            this.cache.set(tunnelId, { token: '', expiresAt: new Date(0), promise });
        }

        try {
            const result = await promise;
            if (result) {
                this.cache.set(tunnelId, { token: result.token, expiresAt: result.expiresAt });
                return result.token;
            }
            this.cache.delete(tunnelId);
            return undefined;
        } catch {
            this.cache.delete(tunnelId);
            return undefined;
        }
    }

    private fetchToken(tunnelId: string): Promise<TunnelToken | undefined> {
        return new Promise((resolve) => {
            execFile('devtunnel', ['token', tunnelId, '--scope', 'connect', '-j'], {
                timeout: 30_000,
            }, (error, stdout) => {
                if (error) {
                    resolve(undefined);
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout);
                    const token = parsed.token as string;
                    const expiration = parsed.expiration as string;
                    if (!token || !expiration) {
                        resolve(undefined);
                        return;
                    }
                    // Parse expiration like "2026-05-15 15:49:56 UTC"
                    const expiresAt = new Date(expiration.replace(' UTC', 'Z').replace(' ', 'T'));
                    resolve({ token, expiresAt });
                } catch {
                    resolve(undefined);
                }
            });
        });
    }

    clearCache(tunnelId?: string): void {
        if (tunnelId) {
            this.cache.delete(tunnelId);
        } else {
            this.cache.clear();
        }
    }

    /**
     * Ensure anonymous access is configured on the tunnel so token auth works.
     * Runs `devtunnel access create <tunnelId> --anonymous` (idempotent).
     */
    async ensureAnonymousAccess(tunnelId: string): Promise<boolean> {
        return new Promise((resolve) => {
            execFile('devtunnel', ['access', 'create', tunnelId, '--anonymous'], {
                timeout: 15_000,
            }, (error) => {
                resolve(!error);
            });
        });
    }
}
