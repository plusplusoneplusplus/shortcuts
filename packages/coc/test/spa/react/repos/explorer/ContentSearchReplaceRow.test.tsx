// @vitest-environment jsdom
/**
 * The Search view's replace row (goal §2.2, phase 5 frontend part a): the
 * chevron beside the query box, the Replace field, the `AB` preserve-case
 * toggle, per-workspace persistence, and the two rules that keep replace state
 * from leaking into the search — a preserve-case toggle must not re-issue the
 * request, and a multi-line query must disable the field the endpoint would
 * reject with a 400.
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
    MULTILINE_REPLACE_NOTICE,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { ReplaceRow } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ReplaceRow';
import {
    clearExplorerContentResults,
    explorerContentReplaceStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import {
    DEFAULT_CONTENT_SEARCH_REPLACE,
    isMultiLineQuery,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-replace';

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function type(testId: string, value: string): void {
    fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

function renderPanel() {
    return render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
}

function storedReplace(): { replacement?: string; preserveCase?: boolean } {
    return JSON.parse(localStorage.getItem(explorerContentReplaceStorageKey(WS)) ?? '{}');
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

describe('isMultiLineQuery', () => {
    it('is true only for a query holding a real line break', () => {
        expect(isMultiLineQuery('foo')).toBe(false);
        // A regex escape is text, not a break — the server tests the same way.
        expect(isMultiLineQuery('foo\\nbar')).toBe(false);
        expect(isMultiLineQuery('foo\nbar')).toBe(true);
        expect(isMultiLineQuery('foo\r\nbar')).toBe(true);
    });
});

describe('ReplaceRow', () => {
    const noop = () => {};

    function renderRow(props: Partial<React.ComponentProps<typeof ReplaceRow>> = {}) {
        return render(
            <ReplaceRow
                replace={DEFAULT_CONTENT_SEARCH_REPLACE}
                onChange={noop}
                expanded={false}
                onToggleExpanded={noop}
                {...props}
            >
                <div data-testid="query-row" />
            </ReplaceRow>,
        );
    }

    it('renders the query row and hides the replace field until expanded', () => {
        renderRow();
        expect(screen.getByTestId('query-row')).toBeTruthy();
        expect(screen.queryByTestId('content-search-replace-input')).toBeNull();
        expect(screen.getByTestId('content-search-replace-toggle').getAttribute('aria-expanded')).toBe('false');
    });

    it('shows the field and the AB toggle when expanded', () => {
        renderRow({ expanded: true });
        expect(screen.getByTestId('content-search-replace-input')).toBeTruthy();
        expect(screen.getByTestId('content-search-preserve-case').textContent).toBe('AB');
    });

    it('reports edits and the preserve-case toggle through onChange', () => {
        const onChange = vi.fn();
        renderRow({ expanded: true, onChange, replace: { replacement: 'a', preserveCase: false } });
        type('content-search-replace-input', 'b');
        expect(onChange).toHaveBeenLastCalledWith({ replacement: 'b', preserveCase: false });
        fireEvent.click(screen.getByTestId('content-search-preserve-case'));
        expect(onChange).toHaveBeenLastCalledWith({ replacement: 'a', preserveCase: true });
    });

    it('disables both controls and explains why when a reason is given', () => {
        renderRow({ expanded: true, disabledReason: 'nope' });
        expect((screen.getByTestId('content-search-replace-input') as HTMLInputElement).disabled).toBe(true);
        expect((screen.getByTestId('content-search-preserve-case') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('content-search-replace-disabled').textContent).toBe('nope');
    });
});

describe('ContentSearchPanel — replace row', () => {
    it('starts collapsed and expands on the chevron', () => {
        renderPanel();
        expect(screen.queryByTestId('content-search-replace-input')).toBeNull();
        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        expect(screen.getByTestId('content-search-replace-input')).toBeTruthy();
    });

    it('persists the replacement and the preserve-case toggle per workspace', () => {
        const view = renderPanel();
        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        type('content-search-replace-input', 'after');
        fireEvent.click(screen.getByTestId('content-search-preserve-case'));
        expect(storedReplace()).toEqual({ replacement: 'after', preserveCase: true });

        // A remount (workspace switch, view switch) restores it — and starts
        // expanded, so a stored replacement is never hidden.
        view.unmount();
        renderPanel();
        const input = screen.getByTestId('content-search-replace-input') as HTMLInputElement;
        expect(input.value).toBe('after');
        expect(screen.getByTestId('content-search-preserve-case').getAttribute('aria-pressed')).toBe('true');
    });

    it('does not re-issue the search when replace state changes', async () => {
        renderPanel();
        type('content-search-input', 'needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        type('content-search-replace-input', 'thread');
        fireEvent.click(screen.getByTestId('content-search-preserve-case'));
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
    });

    it('disables replace for a multi-line query, which the endpoint rejects', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        expect((screen.getByTestId('content-search-replace-input') as HTMLInputElement).disabled).toBe(false);

        type('content-search-input', 'foo\nbar');
        await advance(SEARCH_DEBOUNCE_MS);
        expect((screen.getByTestId('content-search-replace-input') as HTMLInputElement).disabled).toBe(true);
        expect(screen.getByTestId('content-search-replace-disabled').textContent).toBe(MULTILINE_REPLACE_NOTICE);

        type('content-search-input', 'foo');
        await advance(SEARCH_DEBOUNCE_MS);
        expect((screen.getByTestId('content-search-replace-input') as HTMLInputElement).disabled).toBe(false);
    });

    it('the toolbar Clear wipes the replacement along with the query', async () => {
        renderPanel();
        fireEvent.click(screen.getByTestId('content-search-replace-toggle'));
        type('content-search-input', 'needle');
        type('content-search-replace-input', 'thread');
        await advance(SEARCH_DEBOUNCE_MS);

        fireEvent.click(screen.getByTestId('content-search-clear-results'));
        await advance(SEARCH_DEBOUNCE_MS);
        expect((screen.getByTestId('content-search-replace-input') as HTMLInputElement).value).toBe('');
        expect(storedReplace()).toEqual(DEFAULT_CONTENT_SEARCH_REPLACE);
    });
});
