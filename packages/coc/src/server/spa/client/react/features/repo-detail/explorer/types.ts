/** Re-export tree types for use by explorer components. */
export interface TreeEntry {
    name: string;
    type: 'file' | 'dir';
    size?: number;
    path: string;
    children?: TreeEntry[];
}

/**
 * Which of the Explorer sidebar's two views is showing. They are separate views,
 * not modes: switching to 'search' leaves the tree's expansion/selection intact,
 * and switching back to 'tree' leaves the search query and results intact.
 */
export type ExplorerView = 'tree' | 'search';

/** The three independent content-search query modes, all off by default. */
export interface ContentSearchModes {
    caseSensitive: boolean;
    wholeWord: boolean;
    /** When false the query is a literal, regex metacharacters and all. */
    regex: boolean;
}

/** Default mode state: case-insensitive, not whole-word, literal. */
export const DEFAULT_CONTENT_SEARCH_MODES: ContentSearchModes = {
    caseSensitive: false,
    wholeWord: false,
    regex: false,
};

/**
 * Content-search UX state.
 * - `idle` — no query typed.
 * - `loading` — a request is in flight.
 * - `success` — results came back (check `truncated` for the cap notice).
 * - `empty` — the query ran and matched nothing.
 * - `error` — an invalid regex, or a failed request.
 */
export type ContentSearchStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error';

/**
 * An invalid regex is reported inline against the query box with the engine's
 * own parse message; anything else is a generic, retryable request failure.
 */
export type ContentSearchErrorKind = 'regex' | 'request';
