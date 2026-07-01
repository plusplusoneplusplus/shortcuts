/**
 * OAuth polling lifecycle for the MCP servers panel.
 *
 * OAuth setup is security-sensitive and long-running: a flow can complete after
 * the user has navigated to a different workspace. This registry owns the
 * `setInterval` pollers so completion/failure/timeout handling, self-cleanup,
 * and stale-guarding live in one framework-free place that can be unit-tested
 * with fake timers and a mocked `fetch`.
 *
 * Each poller checks its `isStale` guard on every tick (and again after the
 * network round-trip) so a result that arrives after a workspace switch is
 * dropped and the poller stops itself instead of refreshing the wrong panel.
 */

export const AUTH_POLL_INTERVAL_MS = 2_000;
export const AUTH_POLL_TIMEOUT_MS = 10 * 60 * 1_000;

export interface McpOAuthPollHandlers {
    /** Fired once when the server reports the flow completed (and not stale). */
    onCompleted: () => void;
    /** Fired once on server-reported failure or timeout (and not stale). */
    onFailed: (error: string) => void;
}

export interface McpOAuthStartOptions {
    /** Unique key for this poller (typically the server name). */
    key: string;
    /** OAuth request id returned by `POST /mcp-oauth/start`. */
    requestId: string;
    /** API base, e.g. the result of `getApiBase()`. */
    apiBase: string;
    intervalMs?: number;
    timeoutMs?: number;
    /**
     * Returns true when the flow that started this poller is no longer current
     * (e.g. the workspace changed). When it returns true the poller stops
     * silently without firing either handler.
     */
    isStale?: () => boolean;
}

interface PendingEntry {
    status?: string;
    error?: string;
}

/**
 * Manages the active OAuth pollers for a panel instance. One poller per key;
 * starting a second poller for the same key replaces the first.
 */
export class McpOAuthFlowController {
    private readonly pollers = new Map<string, ReturnType<typeof setInterval>>();

    /** Begin polling `mcp-oauth/pending/:requestId` until it settles or times out. */
    startPolling(options: McpOAuthStartOptions, handlers: McpOAuthPollHandlers): void {
        const {
            key,
            requestId,
            apiBase,
            intervalMs = AUTH_POLL_INTERVAL_MS,
            timeoutMs = AUTH_POLL_TIMEOUT_MS,
            isStale,
        } = options;

        // Replace any existing poller for this key.
        this.stop(key);

        const url = `${apiBase}/mcp-oauth/pending/${encodeURIComponent(requestId)}`;
        const startedAt = Date.now();

        const tick = async (): Promise<void> => {
            if (isStale?.()) { this.stop(key); return; }
            try {
                const r = await fetch(url);
                // The workspace may have switched during the round-trip.
                if (isStale?.()) { this.stop(key); return; }
                if (r.ok) {
                    const entry = await r.json() as PendingEntry;
                    if (isStale?.()) { this.stop(key); return; }
                    if (entry.status === 'completed') {
                        this.stop(key);
                        handlers.onCompleted();
                        return;
                    }
                    if (entry.status === 'failed') {
                        this.stop(key);
                        handlers.onFailed(entry.error ?? 'Authorization failed');
                        return;
                    }
                }
            } catch {
                // Transient network error — keep polling until timeout.
            }
            // Always check the timeout so a stuck/gone entry never polls forever.
            if (Date.now() - startedAt > timeoutMs) {
                this.stop(key);
                handlers.onFailed('Authorization timed out');
            }
        };

        this.pollers.set(key, setInterval(() => { void tick(); }, intervalMs));
    }

    /** Stop and forget the poller for `key`, if any. */
    stop(key: string): void {
        const existing = this.pollers.get(key);
        if (existing !== undefined) {
            clearInterval(existing);
            this.pollers.delete(key);
        }
    }

    /** Stop every poller — call on unmount and on workspace change. */
    stopAll(): void {
        for (const timer of this.pollers.values()) clearInterval(timer);
        this.pollers.clear();
    }

    /** Whether a poller is currently active for `key`. */
    isPolling(key: string): boolean {
        return this.pollers.has(key);
    }

    /** Keys with an active poller (test/debug helper). */
    activeKeys(): string[] {
        return [...this.pollers.keys()];
    }
}
