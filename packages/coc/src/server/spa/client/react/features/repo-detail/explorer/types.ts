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

/**
 * How the result set is laid out — VS Code's "View as List" / "View as Tree"
 * toolbar toggle. `list` is a flat sequence of file groups; `tree` nests those
 * groups under their directories.
 */
export type ContentSearchResultView = 'list' | 'tree';

/** Default result layout: the flat, VS Code-default list. */
export const DEFAULT_CONTENT_SEARCH_RESULT_VIEW: ContentSearchResultView = 'list';

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

/**
 * The Search view's file filters — the `…` section under the query box.
 *
 * `include` / `exclude` are held verbatim as the user typed them (a
 * comma-separated glob list) rather than pre-split, so a half-typed glob round
 * trips through persistence unchanged. `parseGlobList` turns either into the
 * array the request wants.
 */
export interface ContentSearchFilters {
    /** Comma-separated whitelist globs. Empty searches every file. */
    include: string;
    /** Comma-separated globs whose matches are skipped. */
    exclude: string;
    /**
     * VS Code's "Use Exclude Settings and Ignore Files" gear, on by default.
     * Off sends `showIgnored: true`, so `.gitignore`d files are searched too.
     */
    useIgnoreFiles: boolean;
}

/** Default filter state: no globs, ignore files honoured. */
export const DEFAULT_CONTENT_SEARCH_FILTERS: ContentSearchFilters = {
    include: '',
    exclude: '',
    useIgnoreFiles: true,
};

/**
 * Split a comma-separated glob list into the array the search request takes.
 * Returns undefined for an empty list so the field is omitted entirely — the
 * route treats an empty array and an absent parameter the same, but omitting it
 * keeps the query string clean.
 */
export function parseGlobList(value: string): string[] | undefined {
    const globs = value.split(',').map(glob => glob.trim()).filter(glob => glob.length > 0);
    return globs.length > 0 ? globs : undefined;
}

/**
 * True when any filter differs from its default — what the `…` toggle's dot
 * reports, so a filtered search is never invisible with the section collapsed.
 */
export function contentSearchFiltersActive(filters: ContentSearchFilters): boolean {
    return parseGlobList(filters.include) !== undefined
        || parseGlobList(filters.exclude) !== undefined
        || !filters.useIgnoreFiles;
}
