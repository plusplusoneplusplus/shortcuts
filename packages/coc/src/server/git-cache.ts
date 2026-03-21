/**
 * In-memory cache for git API responses.
 *
 * Commit-specific data (files, diff) is immutable by hash and cached forever.
 * Mutable data (commits list, branch-range) is cached until an explicit refresh
 * wipes it via `invalidateMutable(workspaceId)`.
 */

const IMMUTABLE_PREFIXES = ['commit-files:', 'commit-diff:'];

function isImmutableKey(key: string): boolean {
    // Keys are formatted as `{wsId}:{type}:{rest}`.
    // Extract the segment after the first colon.
    const firstColon = key.indexOf(':');
    if (firstColon === -1) return false;
    const rest = key.substring(firstColon + 1);
    return IMMUTABLE_PREFIXES.some(prefix => rest.startsWith(prefix));
}

export class GitCacheService {
    private cache = new Map<string, unknown>();

    get<T>(key: string): T | undefined {
        return this.cache.get(key) as T | undefined;
    }

    set(key: string, value: unknown): void {
        this.cache.set(key, value);
    }

    /** Delete all mutable keys for a workspace. Immutable (hash-keyed) entries are preserved. */
    invalidateMutable(workspaceId: string): void {
        const prefix = `${workspaceId}:`;
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(prefix) && !isImmutableKey(key)) {
                this.cache.delete(key);
            }
        }
    }

    /** Delete ALL keys for a workspace (including immutable). */
    invalidateWorkspace(workspaceId: string): void {
        const prefix = `${workspaceId}:`;
        for (const key of [...this.cache.keys()]) {
            if (key.startsWith(prefix)) {
                this.cache.delete(key);
            }
        }
    }

    /** Number of cached entries — mainly useful for tests. */
    get size(): number {
        return this.cache.size;
    }

    clear(): void {
        this.cache.clear();
    }
}

export const gitCache = new GitCacheService();
