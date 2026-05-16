/**
 * In-memory manager for pending MCP OAuth requests.
 *
 * Tracks pending OAuth flows initiated by the Copilot SDK's
 * `mcp.oauth_required` event. Entries auto-expire after `ttlMs` so stale
 * PKCE windows don't accumulate forever.
 *
 * No persistence: OAuth handshakes are short-lived and don't survive a
 * server restart. Pending requests are cleared on shutdown.
 */

import { randomUUID } from 'crypto';
import type {
    PendingMcpOAuth,
    PendingMcpOAuthStatus,
    RegisterMcpOAuthInput,
} from './mcp-oauth-types';

/** Default TTL for a pending PKCE flow (10 minutes). */
export const DEFAULT_MCP_OAUTH_TTL_MS = 10 * 60 * 1000;

export interface McpOauthManagerOptions {
    /** Override the auto-expiry window. */
    ttlMs?: number;
    /** Test seam for the current wall-clock time. */
    now?: () => number;
}

export class McpOauthManager {
    private readonly entries = new Map<string, PendingMcpOAuth>();
    private readonly ttlMs: number;
    private readonly now: () => number;

    constructor(options: McpOauthManagerOptions = {}) {
        this.ttlMs = options.ttlMs ?? DEFAULT_MCP_OAUTH_TTL_MS;
        this.now = options.now ?? (() => Date.now());
    }

    /** Register (or refresh) a pending OAuth request. */
    addPending(input: RegisterMcpOAuthInput): PendingMcpOAuth {
        this.sweepExpired();
        const id = input.requestId && input.requestId.length > 0 ? input.requestId : randomUUID();
        const now = this.now();
        const existing = this.entries.get(id);
        const entry: PendingMcpOAuth = {
            id,
            serverName: input.serverName,
            serverUrl: input.serverUrl,
            authorizationUrl: input.authorizationUrl ?? existing?.authorizationUrl,
            processId: input.processId ?? existing?.processId,
            workspaceId: input.workspaceId ?? existing?.workspaceId,
            status: 'pending',
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            error: undefined,
        };
        this.entries.set(id, entry);
        return entry;
    }

    /** Get a pending OAuth request by id. */
    getPending(id: string): PendingMcpOAuth | undefined {
        this.sweepExpired();
        return this.entries.get(id);
    }

    /** List all known OAuth requests (including resolved ones still in the TTL window). */
    listPending(filter?: { status?: PendingMcpOAuthStatus; processId?: string; workspaceId?: string }): PendingMcpOAuth[] {
        this.sweepExpired();
        const all = Array.from(this.entries.values()).sort((a, b) => a.createdAt - b.createdAt);
        if (!filter) return all;
        return all.filter(entry => {
            if (filter.status && entry.status !== filter.status) return false;
            if (filter.processId && entry.processId !== filter.processId) return false;
            if (filter.workspaceId && entry.workspaceId !== filter.workspaceId) return false;
            return true;
        });
    }

    /** Mark a request as resolved. */
    resolve(id: string, status: 'completed' | 'failed', error?: string): PendingMcpOAuth | undefined {
        const entry = this.entries.get(id);
        if (!entry) return undefined;
        entry.status = status;
        entry.updatedAt = this.now();
        if (status === 'failed') entry.error = error;
        return entry;
    }

    /** Remove a request by id. Returns true if it existed. */
    remove(id: string): boolean {
        return this.entries.delete(id);
    }

    /** Drop everything (used at shutdown). */
    clear(): void {
        this.entries.clear();
    }

    /** Drop entries older than the TTL. */
    sweepExpired(): void {
        const cutoff = this.now() - this.ttlMs;
        for (const [id, entry] of this.entries) {
            if (entry.updatedAt < cutoff) {
                this.entries.delete(id);
            }
        }
    }
}
