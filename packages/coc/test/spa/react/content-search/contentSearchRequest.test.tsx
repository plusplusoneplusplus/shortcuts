/**
 * The overlay's Enter-only request model (AC-02 DoD 2).
 *
 * The behavioural tests drive the real host through the real shortcut, so what
 * they assert about requests is what a user pressing keys would cause: typing
 * and flipping controls must be free, Enter must cost exactly one request with
 * the values currently on screen, and a newer Enter must win over an older
 * answer that is still in flight.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

const searchContent = vi.fn();
vi.mock(
    '../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi',
    () => ({ explorerApi: { searchContent: (...args: unknown[]) => searchContent(...args) } }),
);

import { ContentSearchOverlayHost } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlayHost';
import {
    DEFAULT_CONTENT_SEARCH_CONTROLS,
    buildTrackedSearchOptions,
    validateQuery,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchControls';
import {
    EMPTY_CONTENT_SEARCH_RESULTS,
    classifyOverlaySearchError,
    describeContentSearchResults,
    toOverlayMatches,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchRequest';
import { resetContentSearchMemoryForTests } from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchStateStore';

beforeEach(() => {
    localStorage.clear();
    resetContentSearchMemoryForTests();
    searchContent.mockReset();
    searchContent.mockResolvedValue({ matches: [], truncated: false });
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

function pressShortcut(): void {
    act(() => {
        document.dispatchEvent(
            new KeyboardEvent('keydown', {
                key: 'F',
                ctrlKey: true,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
            }),
        );
    });
}

function type(testId: string, value: string): void {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function submit(): void {
    fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Enter' });
}

/** A match shaped like the route's, minus the fields the overlay ignores. */
function serverMatch(path: string, line: number, text: string) {
    return { path, line, text, startColumn: 0, endColumn: text.length, before: [], after: [] };
}

describe('buildTrackedSearchOptions', () => {
    it('always asks for the tracked scope and carries the modes', () => {
        expect(
            buildTrackedSearchOptions({
                ...DEFAULT_CONTENT_SEARCH_CONTROLS,
                query: 'needle',
                modes: { caseSensitive: true, wholeWord: true, regex: true },
                includeUntracked: true,
            }),
        ).toEqual({
            fileScope: 'tracked',
            includeUntracked: true,
            caseSensitive: true,
            wholeWord: true,
            regex: true,
            include: undefined,
            exclude: undefined,
        });
    });

    it('omits empty glob lists and trims the ones that are set', () => {
        const options = buildTrackedSearchOptions({
            ...DEFAULT_CONTENT_SEARCH_CONTROLS,
            include: ' src/**, *.ts ',
            exclude: '   ',
        });
        expect(options.include).toEqual(['src/**', '*.ts']);
        expect(options.exclude).toBeUndefined();
    });
});

describe('validateQuery', () => {
    it('passes a literal query that would be an invalid pattern', () => {
        expect(validateQuery({ ...DEFAULT_CONTENT_SEARCH_CONTROLS, query: '[unclosed' })).toBeNull();
    });

    it('reports an unparseable pattern in regex mode', () => {
        const message = validateQuery({
            ...DEFAULT_CONTENT_SEARCH_CONTROLS,
            query: '[unclosed',
            modes: { caseSensitive: false, wholeWord: false, regex: true },
        });
        expect(message).toBeTruthy();
    });
});

describe('classifyOverlaySearchError', () => {
    it('maps 409 to the unavailable state rather than a failure', () => {
        const error = Object.assign(new Error('Not a Git repository'), { status: 409 });
        expect(classifyOverlaySearchError(error, false)).toEqual({
            status: 'unavailable',
            error: 'Not a Git repository',
            errorKind: 'unavailable',
        });
    });

    it('blames the glob boxes for an invalid glob even without regex mode', () => {
        const error = Object.assign(new Error('Invalid glob: src/**['), { status: 400 });
        expect(classifyOverlaySearchError(error, false).errorKind).toBe('glob');
    });

    it('blames the query for a 400 in regex mode', () => {
        const error = Object.assign(new Error('bad pattern'), { status: 400 });
        expect(classifyOverlaySearchError(error, true).errorKind).toBe('regex');
    });

    it('treats anything else as retryable', () => {
        const error = Object.assign(new Error('boom'), { status: 500 });
        expect(classifyOverlaySearchError(error, true)).toEqual({
            status: 'error',
            error: 'boom',
            errorKind: 'request',
        });
    });
});

describe('toOverlayMatches', () => {
    it('carries owner identity, exact offsets, and gives duplicate lines distinct ids', () => {
        const rows = toOverlayMatches('coc', 'clone-a', [
            { ...serverMatch('src/a.ts', 3, 'before hit after'), startColumn: 7, endColumn: 10 },
            serverMatch('src/a.ts', 3, 'hit'),
        ]);
        expect(rows[0].workspaceId).toBe('coc');
        expect(rows[0].routingRef).toBe('clone-a');
        expect(rows[0].path).toBe('src/a.ts');
        expect(rows[0].line).toBe(3);
        expect(rows[0].startColumn).toBe(7);
        expect(rows[0].endColumn).toBe(10);
        expect(rows[0].id).not.toBe(rows[1].id);
    });
});

describe('describeContentSearchResults', () => {
    it('gives each state its own sentence', () => {
        expect(describeContentSearchResults(EMPTY_CONTENT_SEARCH_RESULTS)).toMatch(/press Enter/i);
        expect(
            describeContentSearchResults({ ...EMPTY_CONTENT_SEARCH_RESULTS, status: 'empty' }),
        ).toBe('No results.');
        expect(
            describeContentSearchResults({
                ...EMPTY_CONTENT_SEARCH_RESULTS,
                status: 'unavailable',
                error: 'Not a Git repository',
            }),
        ).toBe('Not a Git repository');
    });

    it('counts matches and files, and says so when the set is capped', () => {
        const matches = toOverlayMatches('coc', null, [
            serverMatch('src/a.ts', 1, 'hit'),
            serverMatch('src/a.ts', 5, 'hit'),
            serverMatch('src/b.ts', 2, 'hit'),
        ]);
        expect(
            describeContentSearchResults({
                ...EMPTY_CONTENT_SEARCH_RESULTS,
                status: 'success',
                matches,
            }),
        ).toBe('3 results in 2 files');
        expect(
            describeContentSearchResults({
                ...EMPTY_CONTENT_SEARCH_RESULTS,
                status: 'success',
                matches,
                truncated: true,
            }),
        ).toMatch(/^3 results in 2 files \(/);
    });
});

describe('ContentSearchOverlayHost requests', () => {
    it('issues nothing while the user types or changes controls', () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();

        type('content-search-overlay-query', 'needle');
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-regex'));
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-caseSensitive'));
        type('content-search-overlay-include', 'src/**');
        type('content-search-overlay-exclude', 'dist/**');
        fireEvent.click(screen.getByTestId('content-search-overlay-untracked'));

        expect(searchContent).not.toHaveBeenCalled();
    });

    it('submits exactly one tracked request with the values on screen', async () => {
        render(<ContentSearchOverlayHost workspaceId="coc" routingRef="clone-a" />);
        pressShortcut();

        type('content-search-overlay-query', 'needle');
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-wholeWord'));
        type('content-search-overlay-include', 'src/**');
        fireEvent.click(screen.getByTestId('content-search-overlay-untracked'));
        submit();

        expect(searchContent).toHaveBeenCalledTimes(1);
        const [workspaceId, query, options, routingRef] = searchContent.mock.calls[0];
        expect(workspaceId).toBe('coc');
        expect(query).toBe('needle');
        expect(routingRef).toBe('clone-a');
        expect(options).toMatchObject({
            fileScope: 'tracked',
            includeUntracked: true,
            wholeWord: true,
            include: ['src/**'],
        });
        expect(options.signal).toBeInstanceOf(AbortSignal);
        await waitFor(() =>
            expect(screen.getByTestId('content-search-overlay-status').textContent).toBe(
                'No results.',
            ),
        );
    });

    it('refreshes on a repeated Enter with the controls as they now stand', async () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();
        await waitFor(() => expect(searchContent).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByTestId('content-search-overlay-mode-caseSensitive'));
        expect(searchContent).toHaveBeenCalledTimes(1);
        submit();

        expect(searchContent).toHaveBeenCalledTimes(2);
        expect(searchContent.mock.calls[0][2].caseSensitive).toBe(false);
        expect(searchContent.mock.calls[1][2].caseSensitive).toBe(true);
    });

    it('lets the newer submission win and aborts the older request', async () => {
        const resolvers: Array<(value: unknown) => void> = [];
        searchContent.mockImplementation(
            () => new Promise(resolve => { resolvers.push(resolve); }),
        );
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();

        type('content-search-overlay-query', 'first');
        submit();
        const firstSignal: AbortSignal = searchContent.mock.calls[0][2].signal;
        type('content-search-overlay-query', 'second');
        submit();
        expect(firstSignal.aborted).toBe(true);

        // The stale answer lands last and must not replace the newer one.
        await act(async () => {
            resolvers[1]({ matches: [serverMatch('src/new.ts', 2, 'new hit')], truncated: false });
            resolvers[0]({ matches: [serverMatch('src/old.ts', 1, 'old hit')], truncated: false });
        });

        expect(screen.getByTestId('content-search-overlay-results').textContent).toContain(
            'src/new.ts',
        );
        expect(screen.getByTestId('content-search-overlay-results').textContent).not.toContain(
            'src/old.ts',
        );
    });

    it('never asks the server about an empty query', () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        type('content-search-overlay-query', '   ');
        submit();
        expect(searchContent).not.toHaveBeenCalled();
    });

    it('reports an unparseable pattern inline without a round trip', () => {
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        fireEvent.click(screen.getByTestId('content-search-overlay-mode-regex'));
        type('content-search-overlay-query', '[unclosed');
        submit();

        expect(searchContent).not.toHaveBeenCalled();
        expect(screen.getByTestId('content-search-overlay-status').textContent).toMatch(
            /invalid|unterminated/i,
        );
    });

    it('shows the unavailable state for a workspace that is not a Git repository', async () => {
        searchContent.mockRejectedValue(
            Object.assign(new Error('Not a Git repository'), { status: 409 }),
        );
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        await waitFor(() =>
            expect(screen.getByTestId('content-search-overlay-status').textContent).toBe(
                'Not a Git repository',
            ),
        );
    });

    it('shows matches returned by the server', async () => {
        searchContent.mockResolvedValue({
            matches: [serverMatch('src/a.ts', 12, 'const needle = 1')],
            truncated: false,
        });
        render(<ContentSearchOverlayHost workspaceId="coc" />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();

        // The path is the file group's heading; the match row carries the line.
        await waitFor(() =>
            expect(screen.getByTestId('content-search-overlay-file-coc src/a.ts')).toBeTruthy(),
        );
        const row = screen.getByTestId('content-search-overlay-results').querySelector(
            '[role="treeitem"][aria-selected]',
        );
        expect(row?.textContent).toContain('12');
        expect(row?.textContent).toContain('const needle = 1');
        expect(screen.getByTestId('content-search-overlay-status').textContent).toBe(
            '1 result in 1 file',
        );
    });

    it('closes only after the selected match opens successfully', async () => {
        searchContent.mockResolvedValue({
            matches: [serverMatch('src/a.ts', 12, 'const needle = 1')],
            truncated: false,
        });
        const onOpenMatch = vi.fn().mockResolvedValue({ opened: true });
        render(<ContentSearchOverlayHost workspaceId="coc" onOpenMatch={onOpenMatch} />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();
        await waitFor(() => expect(
            screen.getByTestId('content-search-overlay-match-coc src/a.ts 12 0'),
        ).toBeTruthy());

        fireEvent.click(screen.getByTestId('content-search-overlay-match-coc src/a.ts 12 0'));

        await waitFor(() => expect(screen.queryByTestId('content-search-overlay')).toBeNull());
        expect(onOpenMatch).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceId: 'coc',
                path: 'src/a.ts',
                line: 12,
            }),
            expect.any(AbortSignal),
        );
    });

    it('keeps results intact and announces an owner-resolution failure', async () => {
        searchContent.mockResolvedValue({
            matches: [serverMatch('src/a.ts', 12, 'const needle = 1')],
            truncated: false,
        });
        const onOpenMatch = vi.fn().mockResolvedValue({
            opened: false,
            error: 'This repository is no longer available. Run the search again.',
        });
        render(<ContentSearchOverlayHost workspaceId="coc" onOpenMatch={onOpenMatch} />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();
        const row = await screen.findByTestId('content-search-overlay-match-coc src/a.ts 12 0');

        fireEvent.click(row);

        await waitFor(() => expect(screen.getByTestId('content-search-overlay-status').textContent)
            .toBe('This repository is no longer available. Run the search again.'));
        expect(screen.getByTestId('content-search-overlay')).toBeTruthy();
        expect(screen.getByTestId('content-search-overlay-match-coc src/a.ts 12 0')).toBe(row);
    });

    it('cancels a pending activation when Escape closes the overlay', async () => {
        searchContent.mockResolvedValue({
            matches: [serverMatch('src/a.ts', 12, 'const needle = 1')],
            truncated: false,
        });
        let resolveOpen!: (value: { opened: false; error: string }) => void;
        const onOpenMatch = vi.fn((_match, signal: AbortSignal) =>
            new Promise<{ opened: false; error: string }>(resolve => { resolveOpen = resolve; })
                .finally(() => expect(signal.aborted).toBe(true)),
        );
        render(<ContentSearchOverlayHost workspaceId="coc" onOpenMatch={onOpenMatch} />);
        pressShortcut();
        type('content-search-overlay-query', 'needle');
        submit();
        const row = await screen.findByTestId('content-search-overlay-match-coc src/a.ts 12 0');

        fireEvent.click(row);
        const signal = onOpenMatch.mock.calls[0][1] as AbortSignal;
        fireEvent.keyDown(screen.getByTestId('content-search-overlay'), { key: 'Escape' });

        expect(signal.aborted).toBe(true);
        expect(screen.queryByTestId('content-search-overlay')).toBeNull();
        resolveOpen({ opened: false, error: 'cancelled' });
        await act(async () => Promise.resolve());
    });
});
