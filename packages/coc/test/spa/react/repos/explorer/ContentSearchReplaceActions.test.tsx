// @vitest-environment jsdom
/**
 * §2.2 of the Explorer Search parity goal, phase 5 part b — the replace
 * *actions*: the hover Replace on a match row and a file header, and the
 * toolbar's Replace All.
 *
 * Three things are worth proving here beyond "the button calls the API":
 *  - the request only ever lists spans that are on screen (dismissed rows are
 *    excluded), which is what makes §2.2's "nothing outside the current result
 *    set is ever written" true;
 *  - a skipped file is reported rather than swallowed;
 *  - a replace makes the results stale, so it re-runs the search.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';

const searchContentSpy = vi.fn();
const replaceContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
        replaceContent: (...args: unknown[]) => replaceContentSpy(...args),
    },
}));

import { ContentSearchResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchResults';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import {
    buildReplaceFiles,
    countReplaceTargets,
    describeReplaceResult,
    replaceConfirmMessage,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/contentReplaceRequest';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

const WS = 'ws-replace-actions';

function match(overrides: Partial<ExplorerContentMatch> = {}): ExplorerContentMatch {
    return {
        path: 'src/app.ts',
        line: 4,
        text: 'const needle = 1;',
        startColumn: 6,
        endColumn: 12,
        before: [],
        after: [],
        ...overrides,
    };
}

const MATCHES: ExplorerContentMatch[] = [
    match(),
    match({ line: 9, text: 'log(needle);', startColumn: 4, endColumn: 10 }),
    match({ path: 'src/other.ts', line: 2, text: 'needle', startColumn: 0, endColumn: 6 }),
];

describe('buildReplaceFiles', () => {
    it('groups matches per file and echoes each line as the search returned it', () => {
        expect(buildReplaceFiles(MATCHES)).toEqual([
            {
                path: 'src/app.ts',
                targets: [
                    { line: 4, text: 'const needle = 1;', startColumn: 6, endColumn: 12 },
                    { line: 9, text: 'log(needle);', startColumn: 4, endColumn: 10 },
                ],
            },
            { path: 'src/other.ts', targets: [{ line: 2, text: 'needle', startColumn: 0, endColumn: 6 }] },
        ]);
    });

    it('is empty for no matches, so nothing is ever sent for an empty selection', () => {
        expect(buildReplaceFiles([])).toEqual([]);
        expect(countReplaceTargets(buildReplaceFiles(MATCHES))).toBe(3);
    });
});

describe('replaceConfirmMessage', () => {
    it('names the file when there is only one', () => {
        const message = replaceConfirmMessage(buildReplaceFiles([MATCHES[0], MATCHES[1]]));
        expect(message).toContain('2 matches');
        expect(message).toContain('src/app.ts');
    });

    it('counts the files when there is more than one', () => {
        expect(replaceConfirmMessage(buildReplaceFiles(MATCHES))).toContain('3 matches in 2 files');
    });
});

describe('describeReplaceResult', () => {
    it('reports how many matches in how many files', () => {
        expect(describeReplaceResult({ replacedMatches: 3, replacedFiles: 2, skipped: [] }))
            .toBe('Replaced 3 matches in 2 files.');
        expect(describeReplaceResult({ replacedMatches: 1, replacedFiles: 1, skipped: [] }))
            .toBe('Replaced 1 match in 1 file.');
    });

    it('names every skipped file and why', () => {
        const text = describeReplaceResult({
            replacedMatches: 1,
            replacedFiles: 1,
            skipped: [{ path: 'src/other.ts', reason: 'stale', message: 'changed since the search' }],
        });
        expect(text).toContain('Skipped 1 file: src/other.ts (changed since the search)');
    });
});

describe('ContentSearchResults replace actions', () => {
    afterEach(cleanup);

    const groups = [
        { path: 'src/app.ts', matches: [MATCHES[0], MATCHES[1]] },
        { path: 'src/other.ts', matches: [MATCHES[2]] },
    ];

    function renderResults(onReplace?: (matches: readonly ExplorerContentMatch[]) => void) {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} onReplace={onReplace} />);
    }

    it('offers no replace affordance without a handler', () => {
        renderResults(undefined);
        expect(screen.queryByTestId('content-search-replace-action')).toBeNull();
    });

    it('adds one action per file header and per match row', () => {
        renderResults(vi.fn());
        // 2 headers + 3 matches.
        expect(screen.getAllByTestId('content-search-replace-action')).toHaveLength(5);
    });

    it('sends the whole group from a header and just one match from a row', () => {
        const onReplace = vi.fn();
        renderResults(onReplace);
        fireEvent.click(screen.getByLabelText('Replace in src/app.ts'));
        expect(onReplace).toHaveBeenLastCalledWith([MATCHES[0], MATCHES[1]]);
        fireEvent.click(screen.getByLabelText('Replace match at line 9'));
        expect(onReplace).toHaveBeenLastCalledWith([MATCHES[1]]);
    });

    it('keeps the action outside the row button, so a click does not also open the file', () => {
        const onOpenMatch = vi.fn();
        const onReplace = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={onOpenMatch} onReplace={onReplace} />);
        fireEvent.click(screen.getByLabelText('Replace match at line 9'));
        expect(onReplace).toHaveBeenCalledTimes(1);
        expect(onOpenMatch).not.toHaveBeenCalled();
    });
});

describe('ContentSearchPanel replace wiring', () => {
    let confirmSpy: ReturnType<typeof vi.spyOn>;

    async function advance(ms: number): Promise<void> {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }

    function type(testId: string, value: string): void {
        fireEvent.change(screen.getByTestId(testId), { target: { value } });
    }

    /** Type a query, let the debounce and the response land. */
    async function searchFor(query: string): Promise<void> {
        type('content-search-input', query);
        await advance(SEARCH_DEBOUNCE_MS);
    }

    /** Open the replace row and put a replacement in it. */
    function openReplace(replacement: string): void {
        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        type('content-search-replace-input', replacement);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        clearExplorerContentResults();
        searchContentSpy.mockReset();
        searchContentSpy.mockResolvedValue({ matches: MATCHES, truncated: false });
        replaceContentSpy.mockReset();
        replaceContentSpy.mockResolvedValue({ replacedMatches: 3, replacedFiles: 2, skipped: [] });
        confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
    });

    afterEach(() => {
        cleanup();
        confirmSpy.mockRestore();
        vi.useRealTimers();
    });

    it('hides the row actions and disables Replace All until the replace row is open', async () => {
        await searchFor('needle');
        expect(screen.queryByTestId('content-search-replace-action')).toBeNull();
        expect(screen.getByTestId('content-search-replace-all')).toBeDisabled();

        openReplace('thread');
        expect(screen.getAllByTestId('content-search-replace-action').length).toBeGreaterThan(0);
        expect(screen.getByTestId('content-search-replace-all')).toBeEnabled();
    });

    it('disables Replace All on a query with no results', async () => {
        searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
        await searchFor('nothing');
        openReplace('thread');
        expect(screen.getByTestId('content-search-replace-all')).toBeDisabled();
    });

    it('disables Replace All for a multi-line query the endpoint would reject', async () => {
        await searchFor('needle');
        openReplace('thread');
        type('content-search-input', 'needle\nthread');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-replace-all')).toBeDisabled();
        expect(screen.queryByTestId('content-search-replace-action')).toBeNull();
    });

    it('confirms, sends every visible match with the query modes, and reports the result', async () => {
        await searchFor('needle');
        openReplace('thread');
        fireEvent.click(screen.getByTestId('content-search-preserve-case'));
        fireEvent.click(screen.getByTestId('content-search-toggle-case'));
        await advance(0);

        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });

        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(String(confirmSpy.mock.calls[0][0])).toContain('3 matches in 2 files');
        const [workspaceId, query, replacement, files, options] = replaceContentSpy.mock.calls[0];
        expect(workspaceId).toBe(WS);
        expect(query).toBe('needle');
        expect(replacement).toBe('thread');
        expect(files).toEqual(buildReplaceFiles(MATCHES));
        expect(options).toMatchObject({ caseSensitive: true, preserveCase: true, regex: false });
        expect(screen.getByTestId('content-search-replace-status'))
            .toHaveTextContent('Replaced 3 matches in 2 files.');
    });

    it('writes nothing when the confirmation is declined', async () => {
        confirmSpy.mockReturnValue(false);
        await searchFor('needle');
        openReplace('thread');
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });
        expect(replaceContentSpy).not.toHaveBeenCalled();
    });

    it('never sends a dismissed row', async () => {
        await searchFor('needle');
        openReplace('thread');
        fireEvent.click(screen.getByLabelText('Dismiss src/other.ts'));
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });

        const files = replaceContentSpy.mock.calls[0][3] as { path: string }[];
        expect(files.map(file => file.path)).toEqual(['src/app.ts']);
    });

    it('re-runs the search after a replace, because the results now describe stale text', async () => {
        await searchFor('needle');
        openReplace('thread');
        const before = searchContentSpy.mock.calls.length;
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });
        await advance(0);
        expect(searchContentSpy.mock.calls.length).toBe(before + 1);
        // The re-run must not erase the report of what was just written.
        expect(screen.getByTestId('content-search-replace-status')).toBeInTheDocument();
    });

    it('applies a single match straight from its row, without a confirmation', async () => {
        replaceContentSpy.mockResolvedValue({ replacedMatches: 1, replacedFiles: 1, skipped: [] });
        await searchFor('needle');
        openReplace('thread');
        await act(async () => { fireEvent.click(screen.getByLabelText('Replace match at line 9')); });

        expect(confirmSpy).not.toHaveBeenCalled();
        expect(replaceContentSpy.mock.calls[0][3]).toEqual([
            { path: 'src/app.ts', targets: [{ line: 9, text: 'log(needle);', startColumn: 4, endColumn: 10 }] },
        ]);
        expect(screen.getByTestId('content-search-replace-status'))
            .toHaveTextContent('Replaced 1 match in 1 file.');
    });

    it('reports a file the server skipped rather than hiding it', async () => {
        replaceContentSpy.mockResolvedValue({
            replacedMatches: 2,
            replacedFiles: 1,
            skipped: [{ path: 'src/other.ts', reason: 'stale', message: 'changed since the search' }],
        });
        await searchFor('needle');
        openReplace('thread');
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });
        expect(screen.getByTestId('content-search-replace-status'))
            .toHaveTextContent('Skipped 1 file: src/other.ts (changed since the search)');
    });

    it('surfaces a failed request instead of claiming a write happened', async () => {
        replaceContentSpy.mockRejectedValue(new Error('Replace does not support multi-line queries'));
        await searchFor('needle');
        openReplace('thread');
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });
        expect(screen.getByTestId('content-search-replace-status'))
            .toHaveTextContent('Replace does not support multi-line queries');
    });

    it('drops the report once the query changes, since it described a gone result set', async () => {
        await searchFor('needle');
        openReplace('thread');
        await act(async () => { screen.getByTestId('content-search-replace-all').click(); });
        expect(screen.getByTestId('content-search-replace-status')).toBeInTheDocument();
        await searchFor('other');
        expect(screen.queryByTestId('content-search-replace-status')).toBeNull();
    });
});
