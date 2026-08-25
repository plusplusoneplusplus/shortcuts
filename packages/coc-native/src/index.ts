/**
 * Native (Rust/N-API) capabilities for the CoC server.
 *
 * The addon is required, not optional: {@link loadNativeAddon} and every
 * capability accessor throw {@link NativeAddonLoadError} when a binary is
 * missing, will not load, or lacks the capability, so a packaging mistake
 * surfaces at startup instead of as a silently slower server.
 *
 * There is no opt-out. The `*Status` accessors never throw and report every one
 * of these states, which is what startup diagnostics and `/api/health` can
 * surface.
 *
 * Loading is capability-agnostic — a new capability adds a module beside
 * `file-index` and nothing else.
 */

export {
    loadNativeAddon,
    nativeAddonStatus,
    NativeAddonLoadError,
    nativeBinaryCandidates,
    nativeBinaryName,
    nativeTriple,
    resetNativeAddonCache,
} from './loader';
export type { NativeAddon, NativeAddonStatus } from './types';

export { loadNativeFileIndex, nativeFileIndexStatus } from './file-index';
export type {
    NativeBuildOptions,
    NativeFileIndex,
    NativeFileIndexAddon,
    NativeFileMatch,
} from './file-index';

export { loadNativeContentSearch, nativeContentSearchStatus } from './content-search';
export type {
    NativeContentMatch,
    NativeContentSearchAddon,
    NativeContentSearchOptions,
    NativeContentSearchResult,
} from './content-search';

export { loadNativeNotesIndex, nativeNotesIndexStatus } from './notes-index';
export type {
    NativeNotesIndex,
    NativeNotesIndexAddon,
    NativeNotesIndexBuildOptions,
    NativeNotesMatch,
    NativeNotesSearchResponse,
    NativeNotesSearchResult,
} from './notes-index';
