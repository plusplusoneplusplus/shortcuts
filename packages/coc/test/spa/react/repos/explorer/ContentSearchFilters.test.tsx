// @vitest-environment jsdom
/**
 * The Search view's `…` filters section (goal §2.3): the two glob boxes, the
 * "use ignore files" gear, the dot that keeps a collapsed-but-filtering section
 * visible, per-workspace persistence, and how each of the three reaches the
 * search request.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const searchContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
    },
}));

import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { SearchFilters } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/SearchFilters';
import {
    clearExplorerContentResults,
    explorerContentFiltersStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import {
    DEFAULT_CONTENT_SEARCH_FILTERS,
    contentSearchFiltersActive,
    parseGlobList,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-filters';

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function type(testId: string, value: string): void {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function renderPanel() {
    return render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
}

/** The options object of the most recent searchContent call. */
function lastOptions(): Record<string, unknown> {
    const call = searchContentSpy.mock.calls.at(-1);
    return (call?.[2] ?? {}) as Record<string, unknown>;
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

describe('parseGlobList', () => {
    it('splits on commas, trims, and drops empties', () => {
        expect(parseGlobList('*.ts, *.tsx')).toEqual(['*.ts', '*.tsx']);
        expect(parseGlobList('  src/**  ')).toEqual(['src/**']);
        expect(parseGlobList('a,,b,')).toEqual(['a', 'b']);
    });

    it('returns undefined for an empty or whitespace-only list', () => {
        expect(parseGlobList('')).toBeUndefined();
        expect(parseGlobList('   ')).toBeUndefined();
        expect(parseGlobList(' , , ')).toBeUndefined();
    });
});

describe('contentSearchFiltersActive', () => {
    it('is false for the defaults', () => {
        expect(contentSearchFiltersActive(DEFAULT_CONTENT_SEARCH_FILTERS)).toBe(false);
    });

    it('is true when any of the three is off its default', () => {
        expect(contentSearchFiltersActive({ ...DEFAULT_CONTENT_SEARCH_FILTERS, include: '*.ts' })).toBe(true);
        expect(contentSearchFiltersActive({ ...DEFAULT_CONTENT_SEARCH_FILTERS, exclude: 'dist/**' })).toBe(true);
        expect(contentSearchFiltersActive({ ...DEFAULT_CONTENT_SEARCH_FILTERS, useIgnoreFiles: false })).toBe(true);
    });

    it('ignores whitespace-only glob text', () => {
        expect(contentSearchFiltersActive({ ...DEFAULT_CONTENT_SEARCH_FILTERS, include: '  ' })).toBe(false);
    });
});

describe('SearchFilters', () => {
    it('hides the boxes until expanded', () => {
        const { rerender } = render(
            <SearchFilters
                filters={DEFAULT_CONTENT_SEARCH_FILTERS}
                onChange={vi.fn()}
                expanded={false}
                onToggleExpanded={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('content-search-filters-fields')).toBeNull();

        rerender(
            <SearchFilters
                filters={DEFAULT_CONTENT_SEARCH_FILTERS}
                onChange={vi.fn()}
                expanded
                onToggleExpanded={vi.fn()}
            />,
        );
        expect(screen.getByTestId('content-search-include')).toBeDefined();
        expect(screen.getByTestId('content-search-exclude')).toBeDefined();
        expect(screen.getByTestId('content-search-ignore-toggle')).toBeDefined();
    });

    it('shows the dot only when a filter is active, collapsed or not', () => {
        const { rerender } = render(
            <SearchFilters
                filters={DEFAULT_CONTENT_SEARCH_FILTERS}
                onChange={vi.fn()}
                expanded={false}
                onToggleExpanded={vi.fn()}
            />,
        );
        expect(screen.queryByTestId('content-search-filters-dot')).toBeNull();

        rerender(
            <SearchFilters
                filters={{ ...DEFAULT_CONTENT_SEARCH_FILTERS, exclude: '**/dist/**' }}
                onChange={vi.fn()}
                expanded={false}
                onToggleExpanded={vi.fn()}
            />,
        );
        expect(screen.getByTestId('content-search-filters-dot')).toBeDefined();
    });

    it('reports the gear as pressed by default and edits through onChange', () => {
        const onChange = vi.fn();
        render(
            <SearchFilters
                filters={DEFAULT_CONTENT_SEARCH_FILTERS}
                onChange={onChange}
                expanded
                onToggleExpanded={vi.fn()}
            />,
        );
        const gear = screen.getByTestId('content-search-ignore-toggle');
        expect(gear.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(gear);
        expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_CONTENT_SEARCH_FILTERS, useIgnoreFiles: false });
    });
});

describe('ContentSearchPanel — filters wiring', () => {
    it('sends no globs and honours ignore files by default', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(lastOptions().include).toBeUndefined();
        expect(lastOptions().exclude).toBeUndefined();
        expect(lastOptions().showIgnored).toBe(false);
    });

    it('sends include and exclude as parsed glob arrays', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));

        type('content-search-include', '*.ts, *.tsx');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(lastOptions().include).toEqual(['*.ts', '*.tsx']);

        type('content-search-exclude', '**/dist/**');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(lastOptions().exclude).toEqual(['**/dist/**']);
    });

    it('debounces glob typing like a query keystroke', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        searchContentSpy.mockClear();
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));

        type('content-search-include', '*.t');
        type('content-search-include', '*.ts');
        await advance(SEARCH_DEBOUNCE_MS - 1);
        expect(searchContentSpy).not.toHaveBeenCalled();
        await advance(1);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(lastOptions().include).toEqual(['*.ts']);
    });

    it('does not re-run when an edit leaves the parsed globs unchanged', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        type('content-search-include', '*.ts');
        await advance(SEARCH_DEBOUNCE_MS);
        searchContentSpy.mockClear();

        type('content-search-include', '*.ts ');
        await advance(SEARCH_DEBOUNCE_MS * 2);
        expect(searchContentSpy).not.toHaveBeenCalled();
    });

    it('re-runs immediately when the ignore-files gear is toggled', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        searchContentSpy.mockClear();

        fireEvent.click(screen.getByTestId('content-search-ignore-toggle'));
        await advance(0);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(lastOptions().showIgnored).toBe(true);
    });

    it('clearing the boxes returns to the unfiltered request', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        type('content-search-include', '*.ts');
        type('content-search-exclude', 'dist/**');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(lastOptions().include).toEqual(['*.ts']);

        type('content-search-include', '');
        type('content-search-exclude', '');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(lastOptions().include).toBeUndefined();
        expect(lastOptions().exclude).toBeUndefined();
    });

    it('persists the filters per workspace and reopens the section for them', async () => {
        const { unmount } = renderPanel();
        fireEvent.click(screen.getByTestId('content-search-filters-toggle'));
        type('content-search-include', 'src/**');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(JSON.parse(localStorage.getItem(explorerContentFiltersStorageKey(WS))!))
            .toEqual({ include: 'src/**', exclude: '', useIgnoreFiles: true });

        unmount();
        cleanup();
        renderPanel();
        // Non-default filters render expanded, so a persisted filter is never
        // hidden behind a collapsed chevron.
        expect((screen.getByTestId('content-search-include') as HTMLInputElement).value).toBe('src/**');
        expect(screen.getByTestId('content-search-filters-dot')).toBeDefined();
    });

    it('starts collapsed with no dot when nothing is persisted', () => {
        renderPanel();
        expect(screen.queryByTestId('content-search-filters-fields')).toBeNull();
        expect(screen.queryByTestId('content-search-filters-dot')).toBeNull();
    });
});
