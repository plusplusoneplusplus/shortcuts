/**
 * The repository-file capability: the Explorer's file backend for one resolved
 * repository root. Shapes are aliases of the generated `native-bindings.ts`
 * (from `rust/napi/src/repo_files.rs`).
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/** Content columns are UTF-16 offsets into the returned line text. */
export type NativeContentMatch = Bindings.ContentMatch;
export type NativeContentSearchOptions = Bindings.SearchContentOptions;
/** Partial results report total, per-file and file-size caps through `truncated`. */
export type NativeContentSearchResult = Bindings.ContentSearchResult;

export type NativeRepoFiles = Bindings.RepoFiles;
export type NativeRepoBlob = Bindings.RepoBlob;
export type NativeRepoTreeEntry = Bindings.RepoTreeEntry;
export type NativeRepoTreeListing = Bindings.RepoTreeListing;
export type NativeRepoReplaceFile = Bindings.RepoReplaceFile;
export type NativeRepoReplaceOptions = Bindings.RepoReplaceOptions;
export type NativeRepoReplaceResult = Bindings.RepoReplaceResult;

/**
 * A scored path from `RepoFiles.searchFiles`. `indices` are UTF-16 offsets —
 * JavaScript string indices — into `path`, ascending, so the client highlights
 * exactly what was scored. That is why the Rust scorer folds case as ASCII:
 * full Unicode folding can change a string's length and misalign the offsets.
 */
export type NativeFileMatch = Bindings.FileMatch;

/**
 * A match plus the complete native ordering tuple, for merging results across
 * repositories server-side. REST responses expose only {@link NativeFileMatch}.
 */
export type NativeRankedFileMatch = Bindings.RankedFileMatch;

/** The slice of the addon that this capability needs. */
export interface NativeRepoFilesAddon {
    openRepoFiles: typeof Bindings.openRepoFiles;
}

/** Every `RepoFiles` method the server calls; an older binary lacks some. */
const METHODS = [
    'readBlob', 'writeBlob', 'listDirectory', 'listFiles', 'replaceContent',
    'indexFiles', 'searchFiles', 'searchFilesRanked', 'searchContent', 'prepareContentCandidates', 'invalidate', 'dispose',
] as const;

function isRepoFilesAddon(addon: unknown): addon is NativeRepoFilesAddon {
    const candidate = addon as (Partial<NativeRepoFilesAddon> & { RepoFiles?: Function }) | null;
    const proto = candidate?.RepoFiles?.prototype;
    return typeof candidate?.openRepoFiles === 'function' && METHODS.every((m) => typeof proto?.[m] === 'function');
}

/**
 * The repository-file capability. Throws {@link NativeAddonLoadError} when no
 * binary loaded or the loaded binary predates the capability.
 */
export function loadNativeRepoFiles(): NativeRepoFilesAddon {
    const addon = loadNativeAddon();
    if (isRepoFilesAddon(addon)) return addon;
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${nativeAddonStatus().binaryPath} loaded but does not export repo files.\n` +
            'Rebuild it with `npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether the capability is usable, and why not. Never throws: `/api/health`
 * reports it verbatim (as `nativeFileIndex`), including a binary that loaded
 * without this capability.
 */
export function nativeRepoFilesStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded || isRepoFilesAddon(loadNativeAddon())) return status;
    return { loaded: false, binaryPath: status.binaryPath, reason: `${status.binaryPath} does not export repo files` };
}
