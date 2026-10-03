import type {
    ExplorerContentSearchOptions, ExplorerSearchResponse, RepoInfo as ClientRepoInfo,
} from '@plusplusoneplusplus/coc-client';
import type {
    NativeContentMatch,
    NativeContentSearchResult,
    NativeFileMatch,
    NativeRepoTreeEntry,
    NativeRepoTreeListing,
} from '@plusplusoneplusplus/coc-native';

/** Registered workspace metadata uses the shared REST contract. */
export type RepoInfo = ClientRepoInfo;

/** Directory and search results use the Rust-generated wire shapes. */
export type TreeEntry = NativeRepoTreeEntry;
export type TreeListResult = NativeRepoTreeListing;
export type FileSearchResult = NativeFileMatch;
export type ContentMatch = NativeContentMatch;
export type ContentSearchResult = NativeContentSearchResult;

/** HTTP envelope for native fuzzy file matches. */
export type SearchFilesResult = ExplorerSearchResponse;

/**
 * The hard cap on matches one content search may return.
 *
 * The engine has no cancellation, so the caps are the only bound on what a
 * single query costs. A client asking for more is clamped to this, never
 * honoured.
 */
export const CONTENT_SEARCH_MAX_RESULTS = 500;

/** HTTP query modes, scoping and caps use the shared REST contract. */
export type ContentSearchOptions = ExplorerContentSearchOptions;
