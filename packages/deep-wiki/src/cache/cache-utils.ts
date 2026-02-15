/**
 * Cache Layer — Shared Utilities
 *
 * Provides low-level read/write/clear/scan primitives used by all cache modules
 * (graph, consolidation, analysis, article, discovery). Eliminates code duplication
 * across cache operations while keeping phase-specific validation logic inline.
 *
 * Key features:
 * - Atomic writes (write to temp file, then rename) to prevent partial writes on crash
 * - Generic read with optional validation predicate
 * - Generic scan for batch cache lookups
 * - Unified error handling (return null / false on any error)
 *
 * Internal-only: not exported from the package.
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Read Primitives
// ============================================================================

/**
 * Read and parse a JSON cache file.
 * Returns null on missing file, corrupted JSON, or any I/O error.
 *
 * @param cachePath - Absolute path to the cache file
 * @returns Parsed data of type T, or null on error
 */
export function readCacheFile<T>(cachePath: string): T | null {
    try {
        if (!fs.existsSync(cachePath)) {
            return null;
        }
        const content = fs.readFileSync(cachePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch {
        return null; // Graceful degradation
    }
}

/**
 * Read a cache file and validate with a custom predicate.
 * Returns null if the file is missing, corrupted, or fails validation.
 *
 * @param cachePath - Absolute path to the cache file
 * @param validate - Predicate that returns true if the data is valid
 * @returns Parsed and validated data of type T, or null
 */
export function readCacheFileIf<T>(
    cachePath: string,
    validate: (data: T) => boolean
): T | null {
    const data = readCacheFile<T>(cachePath);
    if (data === null) {
        return null;
    }
    return validate(data) ? data : null;
}

// ============================================================================
// Write Primitives
// ============================================================================

/**
 * Write a JSON cache file atomically, creating parent directories as needed.
 *
 * Uses atomic write pattern (write to .tmp, then rename) to prevent
 * partial writes on crash. This is strictly safer than direct writeFileSync.
 *
 * @param cachePath - Absolute path to the cache file
 * @param data - Data to serialize and write
 */
export function writeCacheFile<T>(cachePath: string, data: T): void {
    const dir = path.dirname(cachePath);
    fs.mkdirSync(dir, { recursive: true });

    const tempPath = cachePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempPath, cachePath);
}

// ============================================================================
// Clear Primitives
// ============================================================================

/**
 * Delete a single cache file.
 *
 * @param cachePath - Absolute path to the file to delete
 * @returns True if the file was deleted, false if it didn't exist or on error
 */
export function clearCacheFile(cachePath: string): boolean {
    if (!fs.existsSync(cachePath)) {
        return false;
    }
    try {
        fs.unlinkSync(cachePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Delete a cache directory recursively.
 *
 * @param dirPath - Absolute path to the directory to delete
 * @returns True if the directory was deleted, false if it didn't exist or on error
 */
export function clearCacheDir(dirPath: string): boolean {
    if (!fs.existsSync(dirPath)) {
        return false;
    }
    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// Scan Primitives
// ============================================================================

/**
 * Scan for individually cached items by ID.
 *
 * Generic scanner that covers all scan/scanAny variants:
 * - Resolves each ID to a file path via `pathResolver`
 * - Reads and validates via `validator`
 * - Extracts the inner data via `extractor`
 *
 * @param ids - IDs to look up in the cache
 * @param pathResolver - Maps an ID to a cache file path (or null if not found)
 * @param validator - Returns true if the cached data is valid
 * @param extractor - Extracts the inner result from the cached wrapper
 * @returns Object with `found` (valid results) and `missing` (IDs not in cache or invalid)
 */
export function scanCacheItems<TCache, TResult>(
    ids: string[],
    pathResolver: (id: string) => string | null,
    validator: (cached: TCache) => boolean,
    extractor: (cached: TCache) => TResult
): { found: TResult[]; missing: string[] } {
    const found: TResult[] = [];
    const missing: string[] = [];

    for (const id of ids) {
        const cachePath = pathResolver(id);
        if (!cachePath) {
            missing.push(id);
            continue;
        }

        const cached = readCacheFile<TCache>(cachePath);
        if (cached && validator(cached)) {
            found.push(extractor(cached));
        } else {
            missing.push(id);
        }
    }

    return { found, missing };
}

/**
 * Scan for individually cached items by ID, returning results as a Map.
 *
 * Similar to `scanCacheItems` but returns a Map<string, TResult> instead of an array.
 * Used by discovery cache functions that return Map-based results (probes, domains).
 *
 * @param ids - IDs to look up in the cache
 * @param pathResolver - Maps an ID to a cache file path (or null if not found)
 * @param validator - Returns true if the cached data is valid
 * @param extractor - Extracts the inner result from the cached wrapper
 * @returns Object with `found` (Map of valid results) and `missing` (IDs not in cache or invalid)
 */
export function scanCacheItemsMap<TCache, TResult>(
    ids: string[],
    pathResolver: (id: string) => string | null,
    validator: (cached: TCache) => boolean,
    extractor: (cached: TCache) => TResult
): { found: Map<string, TResult>; missing: string[] } {
    const found = new Map<string, TResult>();
    const missing: string[] = [];

    for (const id of ids) {
        const cachePath = pathResolver(id);
        if (!cachePath) {
            missing.push(id);
            continue;
        }

        const cached = readCacheFile<TCache>(cachePath);
        if (cached && validator(cached)) {
            found.set(id, extractor(cached));
        } else {
            missing.push(id);
        }
    }

    return { found, missing };
}
