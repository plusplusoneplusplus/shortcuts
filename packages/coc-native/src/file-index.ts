/**
 * The file-index capability: an in-memory, gitignore-aware index of one
 * repository's paths, answering fuzzy searches without an `rg` subprocess.
 *
 * One capability of the addon, not the whole of it. The loader resolves the
 * binary; this module narrows the loaded module to the exports it needs and
 * fails when a binary predates it.
 *
 * The shapes below are aliases of `native-bindings.ts`, which is generated from
 * the `#[napi]` items in `rust/napi/src/file_index.rs`. Restating them by hand
 * is what let them drift; anything a reader needs to know beyond what the Rust
 * says belongs in the doc comments here.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/** Options for building or refreshing a native file index. */
export type NativeBuildOptions = Bindings.BuildOptions;

/**
 * A scored path returned by {@link NativeFileIndex.search}.
 *
 * `indices` are UTF-16 offsets — JavaScript string indices — into `path`,
 * ascending. The client highlights exactly those characters, so highlight and
 * score can never disagree. That is also why the Rust scorer folds case as
 * ASCII rather than with full Unicode rules, which can change a string's
 * length and misalign these offsets.
 */
export type NativeFileMatch = Bindings.FileMatch;

/**
 * An in-memory, gitignore-aware index of one repository's file paths.
 *
 * Every method that walks the tree or scans the path list resolves a real
 * promise backed by an `AsyncTask`, so the work lands on a libuv worker and
 * never blocks the event loop. `search` returns the best `limit` matches,
 * best first.
 */
export type NativeFileIndex = Bindings.FileIndex;

/**
 * The slice of the addon that this capability needs.
 *
 * A structural slice rather than the whole module: the loader is
 * capability-agnostic, so this is what distinguishes a binary that can serve
 * the file index from one that merely loaded.
 */
export interface NativeFileIndexAddon {
    buildFileIndex: typeof Bindings.buildFileIndex;
}

/** Whether the loaded module actually exposes the file index. */
function isFileIndexAddon(addon: unknown): addon is NativeFileIndexAddon {
    return typeof (addon as NativeFileIndexAddon | null)?.buildFileIndex === 'function';
}

/**
 * The file-index capability.
 *
 * Throws {@link NativeAddonLoadError} when no binary could be loaded, and when
 * a binary loaded but predates the capability — from a caller's point of view
 * both are the same unusable state, and both are a build or packaging problem
 * rather than a platform the addon does not cover.
 *
 * There is no opt-out: the addon is mandatory, so this never returns `null`.
 */
export function loadNativeFileIndex(): NativeFileIndexAddon {
    const addon = loadNativeAddon();
    if (isFileIndexAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export a file index.\n` +
            'The binary predates the file-index capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether the file index is usable, and why not when it is not.
 *
 * Never throws, unlike {@link loadNativeFileIndex} — `/api/health` reports this
 * verbatim, so it has to survive exactly the failures it needs to describe.
 * `loaded: false` covers every unusable state: no binary, a binary that would
 * not load, and a binary that loaded without this capability.
 */
export function nativeFileIndexStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    // The addon resolved, so this cannot throw; it only re-reads the cache.
    if (isFileIndexAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export a file index`,
    };
}
