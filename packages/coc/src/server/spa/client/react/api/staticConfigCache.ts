/**
 * staticConfigCache — session-scoped, in-memory cache for static
 * provider/workspace configuration that the dashboard SPA otherwise refetches
 * on every conversation switch.
 *
 * Today, opening a single conversation fans out ~11 RPCs. Several of those are
 * provider-scoped (`models`, `reasoning-efforts`, `effort-tiers`) or
 * workspace-scoped (`llm-tools-config`) static config that is identical across
 * conversations. This module caches each response keyed by provider/workspace
 * so the second-and-later reads in the same app session resolve without a
 * network round-trip.
 *
 * Pattern: this mirrors the AppContext conversation cache
 * (`ConversationCacheEntry` — a `{ value, cachedAt }` entry behind a TTL) but
 * lives at module scope rather than in the reducer. The provider hooks that
 * consume this (`useModels`, `useProviderReasoningEfforts`,
 * `useProviderEffortTiers`, and the llm-tools-config call sites) are mounted in
 * many places across the app — chat picker, queue/schedule dialogs, admin
 * panels — so a module singleton is shared by all of them without threading
 * `appDispatch`/`appState` through every call site. The established in-repo
 * precedent for this is `features/git/hooks/useCommitsCache.ts`. No new
 * data-fetching library (React-Query/SWR) is introduced.
 *
 * Two maps back the cache:
 *  - `cache`     — resolved values with a `cachedAt` timestamp for TTL expiry.
 *  - `inflight`  — in-flight fetch promises so concurrent reads of the same key
 *                  (e.g. the chat picker and a queue dialog both mounting and
 *                  calling `useModels`) dedupe to a single network call. A
 *                  rejected fetch drops its in-flight entry so the next read
 *                  retries instead of caching the failure.
 *
 * Invalidation (AC-05) is invalidate-on-mutate: a mutating settings call drops
 * the specific key via `invalidateConfig(...)` so the next read refetches.
 */

/** A cached config value plus the time it was stored. Mirrors `ConversationCacheEntry`. */
export interface ConfigCacheEntry<T = unknown> {
    value: T;
    /** `Date.now()` when the value was stored; drives TTL expiry. */
    cachedAt: number;
}

/**
 * Default time-to-live for a cached config entry. Matches the 60-minute TTL of
 * the AppContext conversation cache. Static config changes rarely and is also
 * dropped client-side on mutation (AC-05), so this is a backstop against
 * unbounded staleness rather than the primary freshness mechanism — within a
 * single session, reuse-for-the-session is the intended behaviour.
 */
export const DEFAULT_CONFIG_TTL_MS = 60 * 60 * 1000;

/**
 * Prefix a cache key with an injection-safe server-identity segment so two
 * server identities never share a cache entry (AC-07 DoD #4). A remote clone
 * and the local origin — or two distinct remote clones — can use the same
 * provider or workspace id; their static config, reasoning efforts and effort
 * tiers must NOT be read from one server and served to the other.
 *
 * The server id (a clone `baseUrl`) is URI-encoded, so it can never forge the
 * `|` delimiter or the type/provider portion that follows it. When no server id
 * is given (or it is empty), the caller is the local origin and the key is the
 * legacy bare key — byte-for-byte identical, so existing local reads keep their
 * cache entries and behaviour is unchanged.
 */
function serverScope(serverId?: string): string {
    return serverId ? `srv:${encodeURIComponent(serverId)}|` : '';
}

/**
 * Builders for the cache keys so every call site keys consistently. Static
 * config is per-provider (`models`/`reasoning-efforts`/`effort-tiers`) and
 * per-workspace (`llm-tools-config`); keying MUST follow that so a conversation
 * using a different provider/workspace still sees the correct config.
 *
 * Every builder accepts an optional trailing `serverId` (the owning clone's
 * remote `baseUrl`). Omit it for the local origin — the resulting key is the
 * legacy bare key. Pass a remote clone's baseUrl so the same provider/workspace
 * on a different server resolves to a distinct entry (AC-07 DoD #4).
 */
export const configCacheKey = {
    models: (provider: string, serverId?: string): string => `${serverScope(serverId)}models:${provider}`,
    reasoningEfforts: (provider: string, serverId?: string): string => `${serverScope(serverId)}reasoning-efforts:${provider}`,
    effortTiers: (provider: string, serverId?: string): string => `${serverScope(serverId)}effort-tiers:${provider}`,
    llmToolsConfig: (workspaceId: string, serverId?: string): string => `${serverScope(serverId)}llm-tools-config:${workspaceId}`,
} as const;

const cache = new Map<string, ConfigCacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

/**
 * Returns the cached value for `key` if present and not past `ttlMs`, otherwise
 * invokes `fetcher` exactly once (deduping concurrent callers) and caches the
 * resolved value. A second read of an already-cached key returns from cache
 * with no call to `fetcher`.
 *
 * @param key     Stable cache key — build with `configCacheKey`.
 * @param fetcher Performs the network read when the cache misses.
 * @param ttlMs   Entry lifetime; defaults to {@link DEFAULT_CONFIG_TTL_MS}.
 */
export function getOrFetchConfig<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = DEFAULT_CONFIG_TTL_MS,
): Promise<T> {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.cachedAt < ttlMs) {
        return Promise.resolve(entry.value as T);
    }
    // Stale entry — drop it so a slow refetch never serves the old value below.
    if (entry) cache.delete(key);

    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const promise = fetcher().then(
        (value) => {
            cache.set(key, { value, cachedAt: Date.now() });
            inflight.delete(key);
            return value;
        },
        (err) => {
            // Do not cache failures — drop the in-flight entry so the next read retries.
            inflight.delete(key);
            throw err;
        },
    );
    inflight.set(key, promise);
    return promise as Promise<T>;
}

/**
 * Synchronously returns the cached value for `key` if present and fresh,
 * otherwise `undefined`. Does not trigger a fetch. Useful for seeding a hook's
 * initial state so a cache hit paints without a loading flash.
 */
export function peekConfig<T>(key: string, ttlMs: number = DEFAULT_CONFIG_TTL_MS): T | undefined {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.cachedAt < ttlMs) {
        return entry.value as T;
    }
    return undefined;
}

/**
 * Drops the cached value and any in-flight fetch for `key` so the next read
 * refetches. Call this right after a mutating settings call (AC-05).
 */
export function invalidateConfig(key: string): void {
    cache.delete(key);
    inflight.delete(key);
}

/** Test/reset helper: empties the entire cache (values and in-flight promises). */
export function _clearConfigCache(): void {
    cache.clear();
    inflight.clear();
}

/** Test helper: number of resolved entries currently cached. */
export function _getConfigCacheSize(): number {
    return cache.size;
}
