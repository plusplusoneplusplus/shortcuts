/**
 * The overlay's controls: what the user can set before pressing Enter, and the
 * two pure functions that turn them into a request.
 *
 * These live apart from the request hook so the presentational overlay can take
 * a controls object without importing the hook that imports the overlay.
 */
import type { ExplorerContentSearchOptions } from '@plusplusoneplusplus/coc-client';
import { parseGlobList, type ContentSearchModes } from '../explorer/types';

/** Everything the user can set before pressing Enter. */
export interface ContentSearchControls {
    query: string;
    modes: ContentSearchModes;
    /** Comma-separated whitelist globs. */
    include: string;
    /** Comma-separated globs whose matches are skipped. */
    exclude: string;
    /**
     * Adds ordinary untracked files. Git-ignored untracked files stay excluded
     * either way — that exclusion is the server's, not a control.
     */
    includeUntracked: boolean;
}

export const DEFAULT_CONTENT_SEARCH_CONTROLS: ContentSearchControls = {
    query: '',
    modes: { caseSensitive: false, wholeWord: false, regex: false },
    include: '',
    exclude: '',
    includeUntracked: false,
};

/**
 * Turn the controls into the request options. Always tracked scope; the glob
 * fields are omitted entirely when empty so the query string stays clean.
 */
export function buildTrackedSearchOptions(
    controls: ContentSearchControls,
): ExplorerContentSearchOptions {
    return {
        fileScope: 'tracked',
        includeUntracked: controls.includeUntracked,
        caseSensitive: controls.modes.caseSensitive,
        wholeWord: controls.modes.wholeWord,
        regex: controls.modes.regex,
        include: parseGlobList(controls.include),
        exclude: parseGlobList(controls.exclude),
    };
}

/**
 * Client-side check for the one thing worth catching before a round trip: a
 * pattern the browser's own engine cannot parse. Globs are left to the server,
 * which owns the matcher the search actually uses, so we never disagree with it.
 */
export function validateQuery(controls: ContentSearchControls): string | null {
    if (!controls.modes.regex) return null;
    try {
        new RegExp(controls.query);
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : 'Invalid regular expression';
    }
}
