/**
 * Native file index for CoC's quick-open search.
 *
 * The Rust addon keeps a repository's whole path list in server memory and
 * answers fuzzy searches from it, so no `rg` subprocess runs per open and no
 * multi-megabyte path list crosses the network. Callers must handle the addon
 * being absent — {@link loadNativeFileIndex} returns `null` on platforms with no
 * prebuilt binary and the JavaScript path takes over.
 */

export {
    loadNativeFileIndex,
    nativeBinaryCandidates,
    nativeBinaryName,
    nativeFileIndexStatus,
    nativeTriple,
    resetNativeFileIndexCache,
} from './loader';
export type {
    NativeBuildOptions,
    NativeFileIndex,
    NativeFileIndexAddon,
    NativeFileIndexStatus,
    NativeFileMatch,
} from './types';
