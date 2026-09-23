/**
 * The overlay's search request model (AC-02).
 *
 * Two rules shape everything here:
 *
 *  1. **Only Enter searches.** Typing in the query, flipping match-case /
 *     whole-word / regex, editing a glob or toggling "Include untracked files"
 *     changes the controls and nothing else. `submit()` is the single place a
 *     request is ever issued, so a control change can never cost a round trip.
 *     That is why the controls are plain state and not a request effect
 *     dependency the way the Explorer panel's are.
 *  2. **A newer submission always wins.** Every submission takes the next run
 *     id and aborts the previous controller, and a late response whose run id
 *     is stale is dropped rather than written over newer results.
 *
 * The scope is always Git-tracked: the overlay sends `fileScope: 'tracked'`
 * and lets the server derive the candidate set, with `includeUntracked` as the
 * only opt-in. A workspace that is not a usable Git repository answers 409,
 * which becomes the distinct `unavailable` state instead of a generic failure —
 * the overlay must never look like it silently searched the filesystem.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { explorerApi } from '../explorer/explorerApi';
import type { ContentSearchOverlayMatch } from './ContentSearchOverlay';
import {
    DEFAULT_CONTENT_SEARCH_CONTROLS,
    buildTrackedSearchOptions,
    validateQuery,
    type ContentSearchControls,
} from './contentSearchControls';

export type { ContentSearchControls } from './contentSearchControls';
export {
    DEFAULT_CONTENT_SEARCH_CONTROLS,
    buildTrackedSearchOptions,
    validateQuery,
} from './contentSearchControls';

export type ContentSearchOverlayStatus =
    | 'idle'
    | 'loading'
    | 'success'
    | 'empty'
    | 'error'
    | 'unavailable';

/** Which input an error belongs against. `request` is the retryable catch-all. */
export type ContentSearchOverlayErrorKind = 'regex' | 'glob' | 'request' | 'unavailable';

export interface ContentSearchResultState {
    status: ContentSearchOverlayStatus;
    matches: ContentSearchOverlayMatch[];
    truncated: boolean;
    error: string | null;
    errorKind: ContentSearchOverlayErrorKind | null;
    /** The query the current results came from — not what is typed now. */
    query: string;
}

export const EMPTY_CONTENT_SEARCH_RESULTS: ContentSearchResultState = {
    status: 'idle',
    matches: [],
    truncated: false,
    error: null,
    errorKind: null,
    query: '',
};

/**
 * The one-line status under the query. Each result state gets a distinct
 * sentence so an empty query, a search that matched nothing, a capped result
 * set and an unusable repository never read the same.
 */
export function describeContentSearchResults(results: ContentSearchResultState): string {
    switch (results.status) {
        case 'idle':
            return 'Type a query and press Enter to search tracked files.';
        case 'loading':
            return 'Searching\u2026';
        case 'empty':
            return 'No results.';
        case 'error':
        case 'unavailable':
            return results.error ?? 'Search failed';
        case 'success': {
            const files = new Set(results.matches.map(match => match.path)).size;
            const matches = results.matches.length;
            const summary = `${matches} ${matches === 1 ? 'result' : 'results'}`
                + ` in ${files} ${files === 1 ? 'file' : 'files'}`;
            return results.truncated ? `${summary} (showing the first results)` : summary;
        }
    }
}

/** True for the rejection an aborted (superseded or unmounted) request produces. */
function isAbortError(error: unknown): boolean {
    return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/**
 * Classify a failed search. 409 is the tracked-scope unavailable answer and
 * gets its own state; a 400 blames the glob boxes when the message says so and
 * the query box otherwise; anything else is generic and retryable.
 */
export function classifyOverlaySearchError(
    error: unknown,
    regexMode: boolean,
): Pick<ContentSearchResultState, 'status' | 'error' | 'errorKind'> {
    const message = error instanceof Error ? error.message : '';
    const status = (error as { status?: unknown } | null)?.status;
    if (status === 409) {
        return {
            status: 'unavailable',
            error: message || 'This workspace is not a Git repository.',
            errorKind: 'unavailable',
        };
    }
    const isGlobError = status === 400 && /invalid glob/i.test(message);
    const isRegexError =
        !isGlobError && status === 400 && (regexMode || /regular expression/i.test(message));
    return {
        status: 'error',
        error: message || 'Search failed',
        errorKind: isGlobError ? 'glob' : isRegexError ? 'regex' : 'request',
    };
}

/** Rows carry the owner identity the AC-04 open path needs, never a filesystem root. */
export function toOverlayMatches(
    workspaceId: string,
    routingRef: string | null | undefined,
    matches: readonly { path: string; line: number; text: string }[],
): ContentSearchOverlayMatch[] {
    return matches.map((match, index) => ({
        id: `${workspaceId} ${match.path} ${match.line} ${index}`,
        workspaceId,
        routingRef: routingRef ?? null,
        path: match.path,
        line: match.line,
        preview: match.text,
    }));
}

export interface UseContentSearchRequestOptions {
    workspaceId: string;
    routingRef?: string | null;
}

export interface ContentSearchRequest {
    controls: ContentSearchControls;
    setControls: (update: (current: ContentSearchControls) => ContentSearchControls) => void;
    results: ContentSearchResultState;
    /** The only thing that issues a request. Safe to call repeatedly. */
    submit: () => void;
}

export function useContentSearchRequest(
    options: UseContentSearchRequestOptions,
): ContentSearchRequest {
    const { workspaceId, routingRef } = options;
    const [controls, setControlsState] = useState(DEFAULT_CONTENT_SEARCH_CONTROLS);
    const [results, setResults] = useState(EMPTY_CONTENT_SEARCH_RESULTS);
    // Submitting reads the controls through a ref so `submit` stays stable
    // across keystrokes; a callback that changed identity per character would
    // make every control re-render the dialog's key handler.
    const controlsRef = useRef(controls);
    controlsRef.current = controls;
    const runIdRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);

    // Leaving the page must not let a late response write into an unmounted
    // tree: bump the run id so any in-flight answer is stale, then abort.
    useEffect(
        () => () => {
            runIdRef.current += 1;
            abortRef.current?.abort();
            abortRef.current = null;
        },
        [],
    );

    const setControls = useCallback(
        (update: (current: ContentSearchControls) => ContentSearchControls) => {
            setControlsState(current => update(current));
        },
        [],
    );

    const submit = useCallback(() => {
        const current = controlsRef.current;
        const query = current.query;
        // Supersede first, so even the paths that never reach the network
        // (empty query, bad regex) cannot be overwritten by an older answer.
        const runId = ++runIdRef.current;
        abortRef.current?.abort();
        abortRef.current = null;

        if (query.trim().length === 0) {
            setResults({ ...EMPTY_CONTENT_SEARCH_RESULTS });
            return;
        }
        const invalidRegex = validateQuery(current);
        if (invalidRegex !== null) {
            setResults({
                ...EMPTY_CONTENT_SEARCH_RESULTS,
                status: 'error',
                error: invalidRegex,
                errorKind: 'regex',
                query,
            });
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setResults(previous => ({
            ...previous,
            status: 'loading',
            error: null,
            errorKind: null,
            query,
        }));

        explorerApi
            .searchContent(
                workspaceId,
                query,
                { ...buildTrackedSearchOptions(current), signal: controller.signal },
                routingRef,
            )
            .then(response => {
                if (runId !== runIdRef.current) return;
                const overlayMatches = toOverlayMatches(workspaceId, routingRef, response.matches);
                setResults({
                    status: overlayMatches.length > 0 ? 'success' : 'empty',
                    matches: overlayMatches,
                    truncated: response.truncated,
                    error: null,
                    errorKind: null,
                    query,
                });
            })
            .catch(error => {
                if (runId !== runIdRef.current || isAbortError(error)) return;
                setResults({
                    ...EMPTY_CONTENT_SEARCH_RESULTS,
                    ...classifyOverlaySearchError(error, current.modes.regex),
                    query,
                });
            });
    }, [routingRef, workspaceId]);

    return useMemo(
        () => ({ controls, setControls, results, submit }),
        [controls, results, setControls, submit],
    );
}
