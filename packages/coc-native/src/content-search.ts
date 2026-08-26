/**
 * The content-search capability: full-text search across one repository's
 * non-ignored files, answering a query with a fresh parallel walk rather than
 * from a persistent index.
 *
 * One capability of the addon, not the whole of it. The loader resolves the
 * binary; this module narrows the loaded module to the exports it needs and
 * fails when a binary predates it.
 *
 * The shapes below are aliases of `native-bindings.ts`, which is generated from
 * the `#[napi]` items in `rust/napi/src/content_search.rs`. Restating them by
 * hand is what let them drift; anything a reader needs to know beyond what the
 * Rust says belongs in the doc comments here.
 */

import { loadNativeAddon, nativeAddonStatus, NativeAddonLoadError } from './loader';
import type * as Bindings from './native-bindings';
import type { NativeAddonStatus } from './types';

/**
 * Query modes, scoping and caps for one content search.
 *
 * Every field is optional. The caps are the only bound on how much work one
 * query costs — there is no cancellation — so raising them raises the ceiling
 * on a single request's cost.
 */
export type NativeContentSearchOptions = Bindings.SearchContentOptions;

/**
 * One matching line returned by {@link NativeContentSearchAddon.searchContent}.
 *
 * `startColumn` and `endColumn` are UTF-16 offsets — JavaScript string indices
 * — into `text`, so `text.slice(startColumn, endColumn)` is exactly what
 * matched and a highlight cannot disagree with the match. `text` may be
 * truncated for a very long line, but never before `endColumn`.
 */
export type NativeContentMatch = Bindings.ContentMatch;

/**
 * The bounded response from one content search.
 *
 * `truncated` is a single flag for three different caps — total matches, per
 * file matches, and files skipped for size — because a caller can do nothing
 * different about any of them beyond telling the user the list is partial.
 */
export type NativeContentSearchResult = Bindings.ContentSearchResult;

/**
 * The slice of the addon that this capability needs.
 *
 * A structural slice rather than the whole module: the loader is
 * capability-agnostic, so this is what distinguishes a binary that can search
 * content from one that merely loaded.
 */
export interface NativeContentSearchAddon {
    searchContent: typeof Bindings.searchContent;
}

/** Whether the loaded module actually exposes content search. */
function isContentSearchAddon(addon: unknown): addon is NativeContentSearchAddon {
    return typeof (addon as NativeContentSearchAddon | null)?.searchContent === 'function';
}

/**
 * The content-search capability.
 *
 * Throws {@link NativeAddonLoadError} when no binary could be loaded, and when
 * a binary loaded but predates the capability — from a caller's point of view
 * both are the same unusable state, and both are a build or packaging problem
 * rather than a platform the addon does not cover.
 *
 * There is no opt-out: the addon is mandatory, so this never returns `null`.
 */
export function loadNativeContentSearch(): NativeContentSearchAddon {
    const addon = loadNativeAddon();
    if (isContentSearchAddon(addon)) return addon;
    const { binaryPath } = nativeAddonStatus();
    throw new NativeAddonLoadError(
        `@plusplusoneplusplus/coc-native: ${binaryPath} loaded but does not export content search.\n` +
            'The binary predates the content-search capability — rebuild it with ' +
            '`npm run build:native -w packages/coc-native`.',
    );
}

/**
 * Whether content search is usable, and why not when it is not.
 *
 * Never throws, unlike {@link loadNativeContentSearch} — `/api/health` reports
 * this verbatim, so it has to survive exactly the failures it needs to
 * describe. `loaded: false` covers every unusable state: no binary, a binary
 * that would not load, and a binary that loaded without this capability.
 */
export function nativeContentSearchStatus(): NativeAddonStatus {
    const status = nativeAddonStatus();
    if (!status.loaded) return status;
    // The addon resolved, so this cannot throw; it only re-reads the cache.
    if (isContentSearchAddon(loadNativeAddon())) return status;
    return {
        loaded: false,
        binaryPath: status.binaryPath,
        reason: `${status.binaryPath} does not export content search`,
    };
}
