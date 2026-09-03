// @vitest-environment jsdom
/**
 * AC-04 of repo-content-search — the Explorer Search view's behaviour:
 * every UX state (idle / loading / success / truncated / empty / error), the
 * 250 ms as-you-type debounce, immediate re-run on a toggle, and the
 * stale-response-discard guard that keeps a slow early answer from painting over
 * a fast later one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';

const searchContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
    },
}));

import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
    classifySearchError,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

const WS = 'ws-1';

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

/** A promise plus the handles to settle it later, for ordering tests. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

/** Advance fake timers and let the resulting promise chains settle. */
async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Let already-resolved promise chains settle without moving the clock. */
async function settle(): Promise<void> {
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function type(value: string): void {
    fireEvent.change(screen.getByTestId('content-search-input'), { target: { value } });
}

function renderPanel(props: Partial<React.ComponentProps<typeof ContentSearchPanel>> = {}) {
    return render(
        <ContentSearchPanel workspaceId={WS} onOpenMatch={props.onOpenMatch ?? vi.fn()} {...props} />,
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    clearExplorerContentResults();
    searchContentSpy.mockReset();
    searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('ContentSearchPanel — UX states', () => {
    it('idle: shows the hint and issues no request until something is typed', async () => {
        renderPanel();
        expect(screen.getByTestId('content-search-idle')).toBeDefined();
        await advance(SEARCH_DEBOUNCE_MS * 4);
        expect(searchContentSpy).not.toHaveBeenCalled();
    });

    it('idle: a whitespace-only query is not a query', async () => {
        renderPanel();
        type('   ');
        await advance(SEARCH_DEBOUNCE_MS * 4);
        expect(searchContentSpy).not.toHaveBeenCalled();
        expect(screen.getByTestId('content-search-idle')).toBeDefined();
    });

    it('loading: shows the spinner while the request is in flight', async () => {
        const d = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValue(d.promise);
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-loading')).toBeDefined();

        await act(async () => { d.resolve({ matches: [match()], truncated: false }); });
        expect(screen.queryByTestId('content-search-loading')).toBeNull();
    });

    it('success: renders grouped results with a total and file count', async () => {
        searchContentSpy.mockResolvedValue({
            matches: [match({ line: 4 }), match({ line: 8 }), match({ path: 'README.md', line: 1 })],
            truncated: false,
        });
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-summary').textContent).toBe('3 results in 2 files');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
        expect(screen.queryByTestId('content-search-truncated')).toBeNull();
    });

    it('success: singularises the summary for one result in one file', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-summary').textContent).toBe('1 result in 1 file');
    });

    it('truncated: shows the cap notice alongside the results', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: true });
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-truncated').textContent).toContain('truncated');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
    });

    it('empty: a query that ran and matched nothing is not an error', async () => {
        searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
        renderPanel();
        type('nothing-here');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-empty').textContent).toContain('nothing-here');
        expect(screen.queryByTestId('content-search-error')).toBeNull();
        expect(screen.queryByTestId('content-search-results')).toBeNull();
    });

    it('error (regex): a 400 in regex mode shows the parse message inline', async () => {
        searchContentSpy.mockRejectedValue(
            Object.assign(new Error('invalid regular expression: unclosed group'), { status: 400 }),
        );
        renderPanel();
        fireEvent.click(screen.getByTestId('content-search-toggle-regex'));
        type('(unclosed');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-regex-error').textContent)
            .toContain('invalid regular expression: unclosed group');
        expect(screen.queryByTestId('content-search-empty')).toBeNull();
    });

    it('error (glob): a malformed include glob shows the server message inline', async () => {
        searchContentSpy.mockRejectedValue(
            Object.assign(new Error('invalid glob: unclosed character class'), { status: 400 }),
        );
        renderPanel();
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        fireEvent.change(screen.getByTestId('content-search-include'), {
            target: { value: '[unclosed' },
        });
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-glob-error').textContent)
            .toContain('invalid glob: unclosed character class');
        expect(screen.queryByTestId('content-search-error')).toBeNull();
        expect(screen.queryByTestId('content-search-regex-error')).toBeNull();
    });

    it('error (request): a server failure is generic, not a regex complaint', async () => {
        searchContentSpy.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(screen.getByTestId('content-search-error').textContent).toBe('boom');
        expect(screen.queryByTestId('content-search-regex-error')).toBeNull();
    });

    it('clearing the query returns to idle', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);

        fireEvent.click(screen.getByTestId('content-search-clear'));
        await settle();
        expect(screen.getByTestId('content-search-idle')).toBeDefined();
        expect(screen.queryByTestId('content-search-results')).toBeNull();
    });
});

describe('ContentSearchPanel — request behaviour', () => {
    it('debounces as-you-type: rapid keystrokes collapse into one request', async () => {
        renderPanel();
        type('n');
        await advance(SEARCH_DEBOUNCE_MS - 50);
        type('ne');
        await advance(SEARCH_DEBOUNCE_MS - 50);
        type('needle');
        expect(searchContentSpy).not.toHaveBeenCalled();

        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(searchContentSpy.mock.calls[0][1]).toBe('needle');
    });

    it('sends the default modes and no scope for a whole-repo search', async () => {
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        const [workspaceId, query, options] = searchContentSpy.mock.calls[0];
        expect(workspaceId).toBe(WS);
        expect(query).toBe('needle');
        expect(options.path).toBeUndefined();
        expect(options).toMatchObject({
            caseSensitive: false,
            wholeWord: false,
            regex: false,
        });
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    // §2.6: the panel has no scope of its own any more — the include glob is the
    // only scope, so the request never carries a `path` and there is no caption.
    it('never sends a scope path and shows no scope caption', async () => {
        renderPanel();
        expect(screen.queryByTestId('content-search-scope')).toBeNull();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy.mock.calls[0][2].path).toBeUndefined();
    });

    it('focuses the query box when the host bumps focusQueryToken', async () => {
        const { rerender } = renderPanel({ focusQueryToken: 0 });
        const input = screen.getByTestId('content-search-input');
        expect(document.activeElement).not.toBe(input);

        rerender(<ContentSearchPanel workspaceId={WS} focusQueryToken={1} onOpenMatch={vi.fn()} />);
        expect(document.activeElement).toBe(input);
    });

    it.each([
        ['case', 'caseSensitive'],
        ['word', 'wholeWord'],
        ['regex', 'regex'],
    ])('toggling %s re-runs the current query immediately with %s on', async (toggleId, flag) => {
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId(`content-search-toggle-${toggleId}`));
        // No debounce: the toggle IS the intent, there is no keystroke coming.
        await advance(0);
        expect(searchContentSpy).toHaveBeenCalledTimes(2);
        expect(searchContentSpy.mock.calls[1][2]).toMatchObject({ [flag]: true });
    });

    it('marks an active toggle as pressed and toggles it back off', async () => {
        renderPanel();
        const button = screen.getByTestId('content-search-toggle-case');
        expect(button.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(button);
        await settle();
        expect(screen.getByTestId('content-search-toggle-case').getAttribute('aria-pressed')).toBe('true');

        fireEvent.click(screen.getByTestId('content-search-toggle-case'));
        await settle();
        expect(screen.getByTestId('content-search-toggle-case').getAttribute('aria-pressed')).toBe('false');
    });

    it('discards a superseded response: a slow first answer never paints over a fast second', async () => {
        const slow = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        const fast = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

        renderPanel();
        type('need');
        await advance(SEARCH_DEBOUNCE_MS);
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(2);

        // The newer request answers first…
        await act(async () => { fast.resolve({ matches: [match({ line: 42 })], truncated: false }); });
        expect(screen.getByTestId('content-search-match').getAttribute('data-line')).toBe('42');

        // …then the stale one comes back and must be ignored entirely.
        await act(async () => { slow.resolve({ matches: [match({ line: 7 }), match({ line: 8 })], truncated: true }); });
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
        expect(screen.getByTestId('content-search-match').getAttribute('data-line')).toBe('42');
        expect(screen.queryByTestId('content-search-truncated')).toBeNull();
    });

    it('discards a superseded failure so a stale error cannot replace fresh results', async () => {
        const slow = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        const fast = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);

        renderPanel();
        type('need');
        await advance(SEARCH_DEBOUNCE_MS);
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);

        await act(async () => { fast.resolve({ matches: [match()], truncated: false }); });
        await act(async () => { slow.reject(Object.assign(new Error('stale boom'), { status: 500 })); });

        expect(screen.queryByTestId('content-search-error')).toBeNull();
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
    });

    it('aborts the in-flight request when superseded', async () => {
        const first = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValueOnce(first.promise);
        renderPanel();
        type('need');
        await advance(SEARCH_DEBOUNCE_MS);
        const signal: AbortSignal = searchContentSpy.mock.calls[0][2].signal;
        expect(signal.aborted).toBe(false);

        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(signal.aborted).toBe(true);
    });

    it('an aborted rejection is swallowed rather than shown as an error', async () => {
        const first = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValueOnce(first.promise);
        renderPanel();
        type('need');
        await advance(SEARCH_DEBOUNCE_MS);

        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        await act(async () => {
            first.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        expect(screen.queryByTestId('content-search-error')).toBeNull();
    });

    it('unmounting mid-request aborts it and discards the answer', async () => {
        const pending = deferred<{ matches: ExplorerContentMatch[]; truncated: boolean }>();
        searchContentSpy.mockReturnValue(pending.promise);
        const { unmount } = renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        const signal: AbortSignal = searchContentSpy.mock.calls[0][2].signal;

        unmount();
        expect(signal.aborted).toBe(true);

        // Settling afterwards must not throw or warn about an unmounted component.
        await act(async () => { pending.resolve({ matches: [match()], truncated: false }); });
        expect(screen.queryByTestId('content-search-match')).toBeNull();
    });

    it('a keystroke during the debounce window cancels the pending request entirely', async () => {
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS - 10);
        fireEvent.click(screen.getByTestId('content-search-clear'));
        await advance(SEARCH_DEBOUNCE_MS * 3);
        expect(searchContentSpy).not.toHaveBeenCalled();
    });
});

describe('ContentSearchPanel — state survives the tree round trip', () => {
    it('re-mounting the panel for the same workspace shows the previous results', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match({ line: 12 })], truncated: false });
        const { unmount } = renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);

        unmount();
        renderPanel();
        // Rendered straight from the store — before any new request could land.
        expect(screen.getByTestId('content-search-match').getAttribute('data-line')).toBe('12');
        expect((screen.getByTestId('content-search-input') as HTMLInputElement).value).toBe('needle');
    });

    it('a different workspace starts from an empty, idle state', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
        const { unmount } = renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        unmount();

        render(<ContentSearchPanel workspaceId="ws-2" onOpenMatch={vi.fn()} />);
        expect(screen.getByTestId('content-search-idle')).toBeDefined();
        expect((screen.getByTestId('content-search-input') as HTMLInputElement).value).toBe('');
    });
});

describe('ContentSearchPanel — collapsible result groups', () => {
    beforeEach(() => {
        searchContentSpy.mockResolvedValue({
            matches: [match({ line: 4 }), match({ line: 8 }), match({ path: 'README.md', line: 1 })],
            truncated: false,
        });
    });

    async function search(term = 'needle'): Promise<void> {
        type(term);
        await advance(SEARCH_DEBOUNCE_MS);
    }

    function collapse(index: number): void {
        fireEvent.click(screen.getAllByTestId('content-search-file-header')[index]);
    }

    it('clicking a file header hides its matches and keeps the count', async () => {
        renderPanel();
        await search();
        collapse(0);

        expect(screen.getAllByTestId('content-search-match').map(r => r.getAttribute('data-path')))
            .toEqual(['README.md']);
        expect(screen.getAllByTestId('content-search-file-count').map(c => c.textContent))
            .toEqual(['2', '1']);
        // The summary reports the search, not the visible rows.
        expect(screen.getByTestId('content-search-summary').textContent).toBe('3 results in 2 files');
    });

    it('clicking the header again expands the group', async () => {
        renderPanel();
        await search();
        collapse(0);
        collapse(0);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
    });

    it('keeps the collapse state across a switch to the tree view and back', async () => {
        const view = renderPanel();
        await search();
        collapse(0);

        // Switching views unmounts the panel; the results (and the collapse
        // state) live in the store, so remounting shows the same thing.
        view.unmount();
        renderPanel();
        expect(screen.getAllByTestId('content-search-match').map(r => r.getAttribute('data-path')))
            .toEqual(['README.md']);

        // A remount re-runs the same query. Its answer must not silently
        // re-expand what the user closed.
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(2);
        expect(screen.getAllByTestId('content-search-match').map(r => r.getAttribute('data-path')))
            .toEqual(['README.md']);
    });

    it('drops a collapsed path that the re-run no longer matches', async () => {
        renderPanel();
        await search();
        collapse(0);

        searchContentSpy.mockResolvedValue({ matches: [match({ path: 'README.md', line: 1 })], truncated: false });
        fireEvent.click(screen.getByTestId('content-search-toggle-case'));
        await advance(0);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
        expect(screen.getAllByTestId('content-search-file-header')).toHaveLength(1);

        // 'src/app.ts' is gone from the results, so its collapse must not linger:
        // when it comes back it is expanded again.
        searchContentSpy.mockResolvedValue({
            matches: [match({ line: 4 }), match({ path: 'README.md', line: 1 })],
            truncated: false,
        });
        fireEvent.click(screen.getByTestId('content-search-toggle-case'));
        await advance(0);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(2);
    });

    it('resets the collapse state when a new query brings new results', async () => {
        renderPanel();
        await search();
        collapse(0);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);

        await search('needle2');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
    });
});

describe('classifySearchError', () => {
    it('treats a 400 in regex mode as an inline regex error', () => {
        const state = classifySearchError(
            Object.assign(new Error('invalid regular expression: x'), { status: 400 }), true);
        expect(state).toMatchObject({ status: 'error', errorKind: 'regex' });
    });

    it('recognises a regex 400 by its message even outside regex mode', () => {
        const state = classifySearchError(
            Object.assign(new Error('invalid regular expression: x'), { status: 400 }), false);
        expect(state.errorKind).toBe('regex');
    });

    it('blames the glob, not the query, when a 400 names a bad glob in regex mode', () => {
        const state = classifySearchError(
            Object.assign(new Error('invalid glob: unclosed character class'), { status: 400 }),
            true,
        );
        expect(state.errorKind).toBe('glob');
    });

    it('recognises a glob 400 outside regex mode too', () => {
        const state = classifySearchError(
            Object.assign(new Error('invalid glob: x'), { status: 400 }), false);
        expect(state.errorKind).toBe('glob');
    });

    it('treats a non-400 failure as a generic request error even in regex mode', () => {
        const state = classifySearchError(
            Object.assign(new Error('boom'), { status: 500 }), true);
        expect(state.errorKind).toBe('request');
    });

    it('falls back to a generic message when the failure carries none', () => {
        expect(classifySearchError(new Error(''), false).error).toBe('Search failed');
        expect(classifySearchError('not an error', false).error).toBe('Search failed');
    });
});
