/**
 * The repository-file capability: the Explorer's file backend for one resolved
 * repository root. Shapes are aliases of the generated `native-bindings.ts`
 * (from `rust/napi/src/repo_files.rs`).
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';

export type NativeRepoFiles = Bindings.RepoFiles;
export type NativeRepoBlob = Bindings.RepoBlob;

/** The slice of the addon that this capability needs. */
export interface NativeRepoFilesAddon {
    openRepoFiles: typeof Bindings.openRepoFiles;
}

/**
 * The repository-file capability. Throws {@link NativeAddonLoadError} when no
 * binary loaded or the loaded binary predates the capability.
 */
export function loadNativeRepoFiles(): NativeRepoFilesAddon {
    const addon = loadNativeAddon() as Partial<NativeRepoFilesAddon> | null;
    if (typeof addon?.openRepoFiles === 'function') return addon as NativeRepoFilesAddon;
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${nativeAddonStatus().binaryPath} loaded but does not export repo files.\n` +
            'Rebuild it with `npm run build:native -w packages/coc-native`.',
    );
}
