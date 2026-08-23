/**
 * Native (Rust/N-API) capabilities for the CoC server.
 *
 * The addon is optional by construction: {@link loadNativeAddon} returns `null`
 * on a platform with no prebuilt binary, and every capability accessor returns
 * `null` when the binary lacks it, so callers fall back to JavaScript. Loading
 * is capability-agnostic — a new capability adds a module beside `file-index`
 * and nothing else.
 */

export {
    loadNativeAddon,
    nativeAddonStatus,
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
