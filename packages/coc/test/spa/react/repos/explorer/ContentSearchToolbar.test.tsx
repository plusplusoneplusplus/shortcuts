// @vitest-environment jsdom
/**
 * §2.7 of the Explorer Search parity goal — the Search view's own header strip:
 * Refresh, Clear and Collapse All, all disabled until there is a query.
 *
 * Split in two: the presentational ContentSearchToolbar on its own, then the
 * wiring through ContentSearchPanel, where each button has to prove it did the
 * thing (a refresh really issues a request; clear really wipes the filters;
 * collapse all really closes every group).
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

import { ContentSearchToolbar } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchToolbar';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

const WS = 'ws-toolbar';

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

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function type(value: string): void {
    fireEvent.change(screen.getByTestId('content-search-input'), { target: { value } });
}

function setFilter(testId: string, value: string): void {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

/** Type a query and let the debounce and the response land. */
async function searchFor(query: string): Promise<void> {
    type(query);
    await advance(SEARCH_DEBOUNCE_MS);
}

describe('ContentSearchToolbar (presentational)', () => {
    afterEach(cleanup);

    const handlers = () => ({
        onRefresh: vi.fn(),
        onClear: vi.fn(),
        onCollapseAll: vi.fn(),
        onToggleResultView: vi.fn(),
        onOpenInEditor: vi.fn(),
        onReplaceAll: vi.fn(),
        resultView: 'list' as const,
    });

    it('renders refresh, clear, view-mode and collapse-all', () => {
        render(<ContentSearchToolbar enabled {...handlers()} />);
        expect(screen.getByTestId('content-search-toolbar')).toBeInTheDocument();
        expect(screen.getByTestId('content-search-refresh')).toBeInTheDocument();
        expect(screen.getByTestId('content-search-clear-results')).toBeInTheDocument();
        expect(screen.getByTestId('content-search-view-mode')).toBeInTheDocument();
        expect(screen.getByTestId('content-search-collapse-all')).toBeInTheDocument();
    });

    it('disables every button when not enabled', () => {
        render(<ContentSearchToolbar enabled={false} {...handlers()} />);
        for (const id of ['refresh', 'clear-results', 'view-mode', 'collapse-all', 'open-in-editor', 'replace-all']) {
            expect(screen.getByTestId(`content-search-${id}`)).toBeDisabled();
        }
    });

    it('calls the matching handler on click', () => {
        const props = handlers();
        render(<ContentSearchToolbar enabled {...props} />);
        screen.getByTestId('content-search-refresh').click();
        screen.getByTestId('content-search-clear-results').click();
        screen.getByTestId('content-search-collapse-all').click();
        screen.getByTestId('content-search-view-mode').click();
        expect(props.onToggleResultView).toHaveBeenCalledTimes(1);
        expect(props.onRefresh).toHaveBeenCalledTimes(1);
        expect(props.onClear).toHaveBeenCalledTimes(1);
        expect(props.onCollapseAll).toHaveBeenCalledTimes(1);
    });

    it('labels each button for the keyboard and for screen readers', () => {
        render(<ContentSearchToolbar enabled {...handlers()} />);
        expect(screen.getByTestId('content-search-refresh')).toHaveAttribute('aria-label', 'Refresh');
        expect(screen.getByTestId('content-search-clear-results'))
            .toHaveAttribute('aria-label', 'Clear search results');
        expect(screen.getByTestId('content-search-collapse-all'))
            .toHaveAttribute('aria-label', 'Collapse all');
    });
});

describe('ContentSearchPanel toolbar wiring', () => {
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

    function renderPanel() {
        return render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
    }

    it('disables the whole strip until a query is typed', async () => {
        renderPanel();
        expect(screen.getByTestId('content-search-refresh')).toBeDisabled();

        await searchFor('needle');
        expect(screen.getByTestId('content-search-refresh')).not.toBeDisabled();
        expect(screen.getByTestId('content-search-clear-results')).not.toBeDisabled();
        expect(screen.getByTestId('content-search-collapse-all')).not.toBeDisabled();
    });

    it('treats a whitespace-only query as no query', async () => {
        renderPanel();
        type('   ');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-refresh')).toBeDisabled();
    });

    it('re-runs the unchanged query on Refresh, without waiting for the debounce', async () => {
        renderPanel();
        await searchFor('needle');
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        await act(async () => { screen.getByTestId('content-search-refresh').click(); });
        await advance(0);

        expect(searchContentSpy).toHaveBeenCalledTimes(2);
        expect(searchContentSpy.mock.calls[1][1]).toBe('needle');
    });

    it('keeps collapsed groups across a Refresh', async () => {
        searchContentSpy.mockResolvedValue({
            matches: [match(), match({ path: 'src/other.ts', line: 9 })],
            truncated: false,
        });
        renderPanel();
        await searchFor('needle');

        await act(async () => { screen.getAllByTestId('content-search-file-header')[0].click(); });
        expect(screen.getAllByTestId('content-search-file-header')[0])
            .toHaveAttribute('data-collapsed', 'true');

        await act(async () => { screen.getByTestId('content-search-refresh').click(); });
        await advance(0);

        expect(screen.getAllByTestId('content-search-file-header')[0])
            .toHaveAttribute('data-collapsed', 'true');
    });

    it('collapses every group on Collapse All', async () => {
        searchContentSpy.mockResolvedValue({
            matches: [match(), match({ path: 'src/other.ts', line: 9 })],
            truncated: false,
        });
        renderPanel();
        await searchFor('needle');
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(2);

        await act(async () => { screen.getByTestId('content-search-collapse-all').click(); });

        const headers = screen.getAllByTestId('content-search-file-header');
        expect(headers).toHaveLength(2);
        for (const header of headers) expect(header).toHaveAttribute('data-collapsed', 'true');
        expect(screen.queryAllByTestId('content-search-match')).toHaveLength(0);
        // The count badge survives a collapse — that is what makes it useful.
        expect(screen.getAllByTestId('content-search-file-count')).toHaveLength(2);
    });

    it('clears the query, the filters and the results together', async () => {
        searchContentSpy.mockResolvedValue({ matches: [match()], truncated: false });
        renderPanel();
        await searchFor('needle');
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        setFilter('content-search-include', '*.ts');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy.mock.calls.at(-1)?.[2].include).toEqual(['*.ts']);

        await act(async () => { screen.getByTestId('content-search-clear-results').click(); });

        expect(screen.getByTestId('content-search-input')).toHaveValue('');
        expect(screen.getByTestId('content-search-include')).toHaveValue('');
        expect(screen.getByTestId('content-search-idle')).toBeInTheDocument();
        expect(screen.queryByTestId('content-search-results')).not.toBeInTheDocument();
        expect(screen.getByTestId('content-search-refresh')).toBeDisabled();
    });

    it('does not leave a cleared filter behind for the next query', async () => {
        renderPanel();
        await searchFor('needle');
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        setFilter('content-search-include', '*.ts');
        await advance(SEARCH_DEBOUNCE_MS);

        await act(async () => { screen.getByTestId('content-search-clear-results').click(); });
        await searchFor('other');

        expect(searchContentSpy.mock.calls.at(-1)?.[1]).toBe('other');
        expect(searchContentSpy.mock.calls.at(-1)?.[2].include).toBeUndefined();
    });
});
