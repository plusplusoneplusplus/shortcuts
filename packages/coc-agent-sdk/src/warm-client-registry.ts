/**
 * WarmClientRegistry — keeps provider SDK client processes alive between turns.
 *
 * Background
 * ──────────
 * Historically every chat turn spun up a fresh provider SDK client (child
 * process + MCP connections), ran the turn, then tore it down. The next message
 * paid the full cold-start cost again. This registry keeps the *client process*
 * alive after a turn finishes — keyed per `(provider, scopeKey)` — for a short
 * idle TTL, so the next turn in the same warm scope can reuse a warm process.
 *
 * A fresh session is still created (or resumed) per turn on the warm client, so
 * conversation continuity (via `sdkSessionId`/resume) is unaffected; only the
 * client-process lifecycle changes here. Because a single client can create and
 * resume many sessions, model/mode/skill switches between turns do **not** force
 * a teardown — only a provider/scope change, an abort/error, or TTL expiry does.
 *
 * Provider-agnostic by design
 * ───────────────────────────
 * The registry never touches a provider client directly. It stores an opaque
 * {@link WarmClientHandle} (`{ client, stop }`) so the Copilot and Codex services
 * can share one implementation. Providers that cannot stay warm (Claude, whose
 * `query()` spawns per-turn) simply never call into the registry and fall back
 * to cold-start transparently.
 *
 * Lifecycle states per key
 * ────────────────────────
 *   - (absent)  — no warm client; next {@link acquire} cold-starts one.
 *   - warming   — a factory() call is in flight (from {@link prewarm} or a
 *                 concurrent {@link acquire}); later callers attach to it.
 *   - ready     — a handle is parked, idle TTL ticking toward teardown.
 *   - active    — one or more turns are in flight (refcounted); the idle TTL is
 *                 paused and {@link prewarm} no-ops.
 *
 * TTL semantics
 * ─────────────
 * `ttlMs <= 0` disables warming entirely: {@link prewarm} no-ops and
 * {@link release} tears the client down immediately even on clean completion.
 */

export interface WarmClientHandle {
    /** The provider client kept alive (opaque to the registry). */
    client: unknown;
    /**
     * Stop the underlying client process. Called on eviction, TTL expiry, and
     * {@link WarmClientRegistry.evictAll}. Implementations must not throw — the
     * registry swallows rejections defensively, but a throwing `stop` still
     * risks leaking a child process.
     */
    stop(): Promise<void>;
}

/** Lazily creates and starts a warm client handle (e.g. createClient + start). */
export type WarmClientFactory = () => Promise<WarmClientHandle>;

/**
 * Externally-visible lifecycle status of a key, pushed to {@link
 * WarmClientRegistryOptions.onStateChange} on every transition. This is the
 * registry's public state vocabulary (the internal `ready` state surfaces as
 * `warm`, and an absent key surfaces as `cold`):
 *   - `warming` — a factory() call is in flight and no turn holds the key;
 *   - `warm`    — a handle is parked and idle, ready for the next acquire;
 *   - `active`  — one or more turns are in flight on the key;
 *   - `cold`    — no warm client exists for the key (absent / torn down).
 */
export type WarmStatus = 'warming' | 'warm' | 'active' | 'cold';

/**
 * Listener invoked on every key state transition. Must not throw — the registry
 * wraps the call defensively, but a misbehaving listener still risks dropping a
 * notification. Fired synchronously from the mutating call, after registry state
 * is already updated, so `isWarm`/`isActive` inside the listener are consistent
 * with `status`.
 */
export type WarmStateChangeListener = (key: string, status: WarmStatus) => void;

/** Result of {@link WarmClientRegistry.acquire}. */
export interface WarmAcquireResult {
    /** The warm (or freshly cold-started) client handle for this turn. */
    handle: WarmClientHandle;
    /**
     * `true` when the handle was reused from a parked client or an in-flight
     * warm (a warm hit); `false` when this call cold-started the client (a cold
     * miss). Callers log this as the per-turn warm-hit/cold-miss signal.
     */
    warmHit: boolean;
}

/** Minimal structured-logger shape (pino-compatible). */
interface WarmRegistryLogger {
    debug(obj: unknown, msg?: string): void;
}

export interface WarmClientRegistryOptions {
    /**
     * Idle TTL in milliseconds. After a turn releases the client cleanly, the
     * client is parked for this long before being stopped. `<= 0` disables
     * warming entirely (immediate teardown on release; {@link prewarm} no-ops).
     */
    ttlMs: number;
    /** Optional structured logger for diagnostics. */
    logger?: WarmRegistryLogger;
    /**
     * Optional listener fired on every key state transition (absent/cold →
     * warming → warm → active → cold). Used to push warm state to interested
     * observers (e.g. the SPA warm indicator via SSE). Only emitted on an actual
     * change of {@link WarmStatus}; redundant same-status mutations are coalesced.
     */
    onStateChange?: WarmStateChangeListener;
}

/** Internal per-key record. */
interface WarmEntry {
    readonly key: string;
    /** Parked, ready-to-reuse handle (set once warming resolves). */
    handle?: WarmClientHandle;
    /** In-flight warm — present from prewarm or a cold-miss acquire until it settles. */
    warming?: Promise<WarmClientHandle>;
    /** Idle TTL timer; runs only while the entry is parked (no active turns). */
    idleTimer?: ReturnType<typeof setTimeout>;
    /** Number of in-flight turns using this entry. Idle TTL runs only at 0. */
    activeCount: number;
}

/**
 * Separator joining `(provider, scopeKey)` into a single map key.
 */
const WARM_KEY_SEPARATOR = '\0';

/**
 * Build the registry key for a `(provider, scopeKey)` pair.
 *
 * The scope key is matched exactly (not normalized). CoC supplies the
 * conversation process id so two conversations in the same cwd do not share a
 * warm client; other hosts may choose an equivalent provider-neutral scope.
 */
export function makeWarmKey(provider: string, scopeKey?: string): string {
    return `${provider}${WARM_KEY_SEPARATOR}${scopeKey ?? ''}`;
}

/**
 * Registry of warm provider clients keyed by `(provider, scopeKey)`.
 *
 * One warm client per key (no hard cap beyond TTL). Instantiate one registry per
 * provider service (or share a singleton); the key already namespaces by
 * provider, so a single shared instance is also safe.
 */
export class WarmClientRegistry {
    private readonly entries = new Map<string, WarmEntry>();
    private readonly ttlMs: number;
    private readonly logger?: WarmRegistryLogger;
    private readonly onStateChange?: WarmStateChangeListener;
    /**
     * Last status emitted per key, used to coalesce notifications so the listener
     * only sees real transitions. A key absent here is implicitly `cold`; the
     * entry is deleted when its status returns to `cold` so the map does not grow
     * unbounded.
     */
    private readonly lastStatus = new Map<string, WarmStatus>();

    constructor(options: WarmClientRegistryOptions) {
        this.ttlMs = options.ttlMs;
        this.logger = options.logger;
        this.onStateChange = options.onStateChange;
    }

    /** Whether warming is enabled (TTL configured above zero). */
    get warmingEnabled(): boolean {
        return this.ttlMs > 0;
    }

    /** The configured idle TTL in milliseconds. */
    get idleTtlMs(): number {
        return this.ttlMs;
    }

    /**
     * Acquire a client for an in-flight turn, reusing a warm one when possible.
     *
     * Marks the entry active (pausing its idle TTL) and:
     *   - returns the parked handle immediately on a warm hit, or
     *   - attaches to an in-flight warm (from prewarm or a concurrent acquire), or
     *   - cold-starts a new client via `factory` on a cold miss.
     *
     * The caller MUST pair every successful `acquire` with exactly one
     * {@link release}. If `factory` rejects, the entry is rolled back so no
     * registry leak remains and the rejection propagates — the caller should
     * fall back to a cold-start path.
     */
    async acquire(key: string, factory: WarmClientFactory): Promise<WarmAcquireResult> {
        let entry = this.entries.get(key);
        if (!entry) {
            entry = { key, activeCount: 0 };
            this.entries.set(key, entry);
        }
        entry.activeCount += 1;
        this.clearIdleTimer(entry);
        // The key is now active regardless of which path resolves below; signal
        // it before any await so observers see the turn start immediately.
        this.notify(key);

        // Warm hit: a parked client is ready for reuse.
        if (entry.handle) {
            return { handle: entry.handle, warmHit: true };
        }

        // Attach to an in-flight warm started by prewarm or another acquire.
        if (entry.warming) {
            try {
                const handle = await entry.warming;
                return { handle, warmHit: true };
            } catch (err) {
                // The warm we attached to failed (e.g. prewarm's factory
                // rejected). Roll back the refcount we took above so the entry
                // does not leak `activeCount` — otherwise prewarm would no-op
                // forever and the idle TTL could never reclaim this key. Mirror
                // the cold-miss rollback below, then propagate so the caller
                // cold-falls-back.
                if (this.entries.get(key) === entry) {
                    if (entry.activeCount > 0) entry.activeCount -= 1;
                    if (!entry.handle && !entry.warming && entry.activeCount === 0) {
                        this.entries.delete(key);
                    }
                }
                this.notify(key);
                throw err;
            }
        }

        // Cold miss: cold-start the client now and park it on success.
        const warming = factory();
        entry.warming = warming;
        try {
            const handle = await warming;
            if (this.entries.get(key) === entry) {
                entry.handle = handle;
                entry.warming = undefined;
            }
            return { handle, warmHit: false };
        } catch (err) {
            // Roll back so a failed cold-start leaves no orphan entry.
            if (this.entries.get(key) === entry) {
                entry.warming = undefined;
                if (entry.activeCount > 0) entry.activeCount -= 1;
                if (!entry.handle && entry.activeCount === 0) this.entries.delete(key);
            }
            this.notify(key);
            throw err;
        }
    }

    /**
     * Release a turn's hold on a warm client.
     *
     * On clean completion (`keep: true`) with warming enabled, the client is
     * parked and the idle TTL (re)started. On abort/interrupt/error
     * (`keep: false`), or when warming is disabled (`ttlMs <= 0`), the client is
     * torn down immediately. When other turns are still in flight on the same
     * key, only the refcount is decremented.
     */
    async release(key: string, options: { keep: boolean }): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry) return;

        if (entry.activeCount > 0) entry.activeCount -= 1;
        if (entry.activeCount > 0) return; // other turns still using this client

        if (options.keep && this.ttlMs > 0 && entry.handle) {
            this.startIdleTimer(entry);
            this.notify(key); // active → warm (parked)
            this.logger?.debug({ key, ttlMs: this.ttlMs }, 'Warm client parked; idle TTL started');
            return;
        }

        // Abort/error, warming disabled, or nothing parked — tear down now.
        await this.evict(key);
    }

    /**
     * Pre-warm the client for a key without creating a session (AC-04).
     *
     * Idempotent and side-effect-light:
     *   - no-op when warming is disabled (`ttlMs <= 0`),
     *   - no-op during an active turn,
     *   - no-op (returns the in-flight warm) when already warm or warming.
     *
     * On success the client is parked with the idle TTL started, ready for the
     * next {@link acquire}. A real send arriving mid-warm will attach to the same
     * in-flight warming via {@link acquire}.
     *
     * The returned promise resolves when warming settles (success or failure);
     * callers may ignore it (fire-and-forget) or await it for idempotency.
     */
    prewarm(key: string, factory: WarmClientFactory): Promise<void> {
        if (this.ttlMs <= 0) return Promise.resolve(); // warming disabled

        const existing = this.entries.get(key);
        if (existing) {
            if (existing.activeCount > 0 || existing.handle) {
                return Promise.resolve(); // active turn or already warm
            }
            if (existing.warming) {
                return existing.warming.then(() => undefined, () => undefined); // already warming
            }
        }

        const entry: WarmEntry = existing ?? { key, activeCount: 0 };
        if (!existing) this.entries.set(key, entry);

        const warming = factory();
        entry.warming = warming;
        this.notify(key); // absent → warming
        return warming.then(
            (handle) => {
                if (this.entries.get(key) !== entry) {
                    // Evicted mid-warm — stop the freshly created client.
                    handle.stop().catch(() => undefined);
                    return;
                }
                entry.handle = handle;
                entry.warming = undefined;
                if (entry.activeCount === 0) this.startIdleTimer(entry);
                this.notify(key); // warming → warm
                this.logger?.debug({ key }, 'Prewarm complete; client parked');
            },
            (err) => {
                if (this.entries.get(key) === entry && !entry.handle) {
                    entry.warming = undefined;
                    if (entry.activeCount === 0) this.entries.delete(key);
                }
                this.notify(key); // warming → cold (rolled back)
                this.logger?.debug({ key, err: err instanceof Error ? err.message : String(err) }, 'Prewarm failed');
            },
        );
    }

    /**
     * Evict a key: cancel its idle TTL, remove the entry, and stop its client
     * (awaiting an in-flight warm first so a mid-warm eviction never leaks).
     */
    async evict(key: string): Promise<void> {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key);
        this.clearIdleTimer(entry);
        this.notify(key); // any → cold (entry removed)

        let handle = entry.handle;
        if (!handle && entry.warming) {
            handle = await entry.warming.catch(() => undefined);
        }
        if (handle) {
            try {
                await handle.stop();
            } catch {
                /* stop() must not throw; ignore defensively */
            }
        }
    }

    /**
     * Evict every warm client. Used by the SDK service's `cleanup()`/`dispose()`
     * so no child process outlives the service.
     */
    async evictAll(): Promise<void> {
        const keys = [...this.entries.keys()];
        await Promise.allSettled(keys.map((key) => this.evict(key)));
    }

    /** Whether an entry (warming, ready, or active) exists for the key. */
    has(key: string): boolean {
        return this.entries.has(key);
    }

    /** Whether a parked, ready-to-reuse handle exists for the key. */
    isWarm(key: string): boolean {
        return this.entries.get(key)?.handle !== undefined;
    }

    /**
     * Borrow a parked, idle warm handle for a one-off out-of-band operation
     * (e.g. history compaction) without taking a turn ref or disturbing the idle
     * TTL — the pool is left exactly as it was. Returns the first ready handle
     * whose key has no in-flight turn (`activeCount === 0`), or `undefined` when
     * nothing is parked.
     *
     * Out-of-band callers (such as `compactSession`) receive a session id but no
     * warm scope key, so this scans rather than taking a key: a warm client is a
     * generic live process that can resume any session, and only idle entries are
     * returned so a borrow never collides with an in-flight turn. The caller MUST
     * NOT call `stop()` on the returned handle — it stays owned by the registry
     * and parked for its normal next {@link acquire}.
     */
    peekIdleWarmHandle(): WarmClientHandle | undefined {
        for (const entry of this.entries.values()) {
            if (entry.handle && entry.activeCount === 0) return entry.handle;
        }
        return undefined;
    }

    /** Whether one or more turns are currently in flight on the key. */
    isActive(key: string): boolean {
        return (this.entries.get(key)?.activeCount ?? 0) > 0;
    }

    /** Number of tracked entries (warming, ready, or active). */
    size(): number {
        return this.entries.size;
    }

    /**
     * Externally-visible {@link WarmStatus} for a key — the synchronous read side
     * of warm state, complementing the push-based {@link
     * WarmClientRegistryOptions.onStateChange}. Returns `cold` for an absent key.
     * Reuses the same canonical {@link currentStatus} calculation the change
     * notifications use, so a snapshot read and a streamed transition never
     * disagree (e.g. `warming` is never misclassified as `warm`).
     */
    getStatus(key: string): WarmStatus {
        return this.currentStatus(key);
    }

    /**
     * Compute the externally-visible {@link WarmStatus} for a key from its
     * current entry. `active` takes precedence over `warm`/`warming` because an
     * in-flight turn is the most salient state for the indicator.
     */
    private currentStatus(key: string): WarmStatus {
        const entry = this.entries.get(key);
        if (!entry) return 'cold';
        if (entry.activeCount > 0) return 'active';
        if (entry.handle) return 'warm';
        if (entry.warming) return 'warming';
        return 'cold';
    }

    /**
     * Emit a state-change notification for a key if (and only if) its status
     * changed since the last emit. Safe to call liberally after any mutation —
     * redundant calls coalesce. The listener is wrapped so it can never corrupt
     * registry state or interrupt a lifecycle operation.
     */
    private notify(key: string): void {
        if (!this.onStateChange) return;
        const status = this.currentStatus(key);
        const prev = this.lastStatus.get(key) ?? 'cold';
        if (prev === status) return;
        if (status === 'cold') this.lastStatus.delete(key);
        else this.lastStatus.set(key, status);
        try {
            this.onStateChange(key, status);
        } catch {
            /* a throwing listener must never break the registry */
        }
    }

    private startIdleTimer(entry: WarmEntry): void {
        this.clearIdleTimer(entry);
        entry.idleTimer = setTimeout(() => {
            entry.idleTimer = undefined;
            this.evict(entry.key).catch(() => undefined);
        }, this.ttlMs);
        // Never let a parked warm client keep the host process alive.
        entry.idleTimer.unref?.();
    }

    private clearIdleTimer(entry: WarmEntry): void {
        if (entry.idleTimer !== undefined) {
            clearTimeout(entry.idleTimer);
            entry.idleTimer = undefined;
        }
    }
}
