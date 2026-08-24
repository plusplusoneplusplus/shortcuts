/**
 * The Notes content-index capability: one immutable, memory-only snapshot per
 * already-authorized Notes root, with bounded filename and line matching.
 *
 * The loader resolves the binary; this module narrows the loaded module to the
 * Notes exports and treats every unavailable state as fatal. Production Notes
 * search has no JavaScript fallback, including when `COC_NATIVE=0` is set.
 *
 * These shapes alias `native-bindings.ts`, generated from the `#[napi]` items
 * in `rust/napi/src/notes_index.rs`.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/** Filesystem policy for one resolved Notes root. */
export type NativeNotesIndexBuildOptions = Bindings.NotesIndexBuildOptions;

/** One filename or content-line match. */
export type NativeNotesMatch = Bindings.NotesMatch;

/** All matches for one root-relative Markdown path. */
export type NativeNotesSearchResult = Bindings.NotesSearchResult;

/** The bounded response from one Notes index search. */
export type NativeNotesSearchResponse = Bindings.NotesSearchResponse;

/**
 * An in-memory content index for one already-authorized Notes root.
 *
 * Initial build and search both resolve real promises backed by N-API
 * `AsyncTask` operations, so recursive filesystem work and in-memory scans run
 * on libuv workers rather than Node's event-loop thread.
 */
export type NativeNotesIndex = Bindings.NotesIndex;

/** The exact addon slice required by production Notes search. */
export interface NativeNotesIndexAddon {
    buildNotesIndex: typeof Bindings.buildNotesIndex;
}

/** Whether the loaded module actually exposes the Notes content index. */
function isNotesIndexAddon(addon: unknown): addon is NativeNotesIndexAddon {
    return typeof (addon as NativeNotesIndexAddon | null)?.buildNotesIndex === 'function';
}

/**
 * Load the required Notes content-index capability.
 *
 * Throws {@link NativeAddonLoadError} for a missing, unloadable, disabled, or
 * capability-stale binary. Unlike the quick-open file index, Notes content
 * search has no production JavaScript path, so `COC_NATIVE=0` is an actionable
 * startup error rather than an opt-out for this capability.
 */
export function loadNativeNotesIndex(): NativeNotesIndexAddon {
    const addon = loadNativeAddon();
    if (addon === null) {
        throw new NativeAddonLoadError(
            '@plusplusoneplusplus/coc-native: Notes content search requires the native Notes index, ' +
                'but the addon is disabled by COC_NATIVE=0. Unset COC_NATIVE and provide a current ' +
                'binary built with `npm run build:native -w packages/coc-native`.',
        );
    }
    if (isNotesIndexAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export a Notes content index.\n` +
            'The binary predates the Notes-index capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether the Notes content index is usable, and why not when it is not.
 *
 * Never throws so startup diagnostics and health reporting can describe every
 * unusable state, including `COC_NATIVE=0` and a capability-stale binary.
 */
export function nativeNotesIndexStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    if (isNotesIndexAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export a Notes content index`,
    };
}
