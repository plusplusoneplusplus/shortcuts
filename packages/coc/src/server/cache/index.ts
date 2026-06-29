/**
 * Unified in-memory cache module.
 *
 * Public entry point for the shared, hand-rolled namespaced cache primitive.
 * Domains import {@link createCache} to obtain a typed handle; cross-namespace
 * workspace invalidation goes through {@link invalidateWorkspaceForAll}.
 */

export {
    createCache,
    invalidateWorkspaceForAll,
    registeredCacheCount,
} from './in-memory-cache';
export type {
    CacheHandle,
    CacheWriteOptions,
    CreateCacheOptions,
} from './in-memory-cache';
