/**
 * Native (Rust/N-API) capabilities for the CoC server.
 *
 * The addon is required, not optional: {@link loadNativeAddon} and every
 * capability accessor throw {@link NativeAddonLoadError} when a binary is
 * missing, will not load, or lacks the capability, so a packaging mistake
 * surfaces at startup instead of as a silently slower server.
 *
 * `COC_NATIVE=0` is the one exception — the accessors return `null` for it, so
 * an operator can deliberately run the JavaScript path on a machine with no
 * Rust toolchain. The `*Status` accessors never throw and report every one of
 * these states, which is what `/api/health` surfaces.
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
