/**
 * The file-index capability: an in-memory, gitignore-aware index of one
 * repository's paths, answering fuzzy searches without an `rg` subprocess.
 *
 * One capability of the addon, not the whole of it. The loader resolves the
 * binary; this module narrows the loaded module to the exports it needs and
 * reports the capability unavailable when a binary predates it.
 */

import { loadNativeAddon, nativeAddonStatus } from './loader';
import type { NativeAddonStatus } from './types';

/** Options for building or refreshing a native file index. */
export interface NativeBuildOptions {
    /** Include gitignored files — the explorer's `showIgnored` flag. */
    includeIgnored?: boolean;
    /** Safety cap on indexed paths. Omit for no cap. */
    maxEntries?: number;
}

/** A scored path returned by {@link NativeFileIndex.search}. */
export interface NativeFileMatch {
    path: string;
    score: number;
    /**
     * Matched positions within `path`, ascending, as JavaScript string indices.
     * The client highlights exactly these characters, so highlight and score
     * can never disagree.
     */
    indices: number[];
}

/** An in-memory, gitignore-aware index of one repository's file paths. */
export interface NativeFileIndex {
    /** Number of indexed paths. */
    len(): number;
    /** True when the walk hit the configured `maxEntries` cap. */
    truncated(): boolean;
    /** A window of the raw path list, in index order. */
    files(offset: number, limit: number): string[];
    /** Best `limit` matches for `query`, best first. */
    search(query: string, limit: number): Promise<NativeFileMatch[]>;
    /** Re-walk the root and atomically swap in the new path list. */
    refresh(): Promise<void>;
}

/** The slice of the addon that this capability needs. */
export interface NativeFileIndexAddon {
    buildFileIndex(root: string, options?: NativeBuildOptions): Promise<NativeFileIndex>;
}

/** Whether the loaded module actually exposes the file index. */
function isFileIndexAddon(addon: unknown): addon is NativeFileIndexAddon {
    return typeof (addon as NativeFileIndexAddon | null)?.buildFileIndex === 'function';
}

/** The file-index capability, or `null` when it is unavailable. */
export function loadNativeFileIndex(): NativeFileIndexAddon | null {
    const addon = loadNativeAddon();
    return isFileIndexAddon(addon) ? addon : null;
}

/**
 * Whether the file index is usable, and why not when it is not.
 *
 * A binary that loaded but does not export `buildFileIndex` is not usable, so
 * this reports `loaded: false` where {@link nativeAddonStatus} reports the
 * binary itself as loaded.
 */
export function nativeFileIndexStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded || isFileIndexAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export a file index`,
    };
}
