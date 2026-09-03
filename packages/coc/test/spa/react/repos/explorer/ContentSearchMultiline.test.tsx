// @vitest-environment jsdom
/**
 * §2.1 of the Explorer Search parity goal — the multi-line query box.
 *
 * The Rust searcher already understands a newline in the query (a match arrives
 * as several single-line pieces sharing a `group` id); this is the half that
 * lets the user type one. Two surfaces: SearchBar's opt-in textarea, and the
 * panel wiring that makes Enter a re-run rather than a keystroke.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { createRef } from 'react';

const searchContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
    },
}));

import {
    SearchBar,
    autoGrowRows,
    SEARCH_BAR_MAX_ROWS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/SearchBar';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

describe('autoGrowRows', () => {
    it('starts at one row, for an empty value and a single line alike', () => {
        expect(autoGrowRows('')).toBe(1);
        expect(autoGrowRows('needle')).toBe(1);
    });

    it('grows one row per line', () => {
        expect(autoGrowRows('a\nb')).toBe(2);
        expect(autoGrowRows('a\nb\nc')).toBe(3);
    });

    it('counts a trailing newline as the empty line it opens', () => {
        expect(autoGrowRows('a\n')).toBe(2);
    });

    it('caps at the max, so a pasted file scrolls instead of eating the results', () => {
        expect(autoGrowRows('a\n'.repeat(40))).toBe(SEARCH_BAR_MAX_ROWS);
    });

    it('honours an explicit cap', () => {
        expect(autoGrowRows('a\nb\nc\nd', 2)).toBe(2);
    });
});

describe('SearchBar multiline', () => {
    afterEach(cleanup);

    const base = () => ({ onChange: vi.fn(), onClear: vi.fn() });

    it('renders an input by default — the file filter has no use for a second line', () => {
        render(<SearchBar value="" {...base()} />);
        expect(screen.getByTestId('explorer-search-input').tagName).toBe('INPUT');
    });

    it('renders a textarea when multiline, keeping the same testid', () => {
        render(<SearchBar value="" {...base()} multiline testIdPrefix="content-search" />);
        expect(screen.getByTestId('content-search-input').tagName).toBe('TEXTAREA');
    });

    it('sizes the textarea to the value, one row at a time', () => {
        const { rerender } = render(<SearchBar value="" {...base()} multiline />);
        const box = () => screen.getByTestId('explorer-search-input');
        expect(box()).toHaveAttribute('rows', '1');

        rerender(<SearchBar value={'a\nb\nc'} {...base()} multiline />);
        expect(box()).toHaveAttribute('rows', '3');

        rerender(<SearchBar value={'a\n'.repeat(20)} {...base()} multiline />);
        expect(box()).toHaveAttribute('rows', String(SEARCH_BAR_MAX_ROWS));
    });

    it('keeps the toggle padding maths across the swap', () => {
        render(
            <SearchBar
                value=""
                {...base()}
                multiline
                toggles={[
                    { id: 'case', label: 'Aa', title: 'Match case', active: false, onToggle: vi.fn() },
                    { id: 'word', label: 'ab', title: 'Match whole word', active: false, onToggle: vi.fn() },
                    { id: 'regex', label: '.*', title: 'Use regular expression', active: false, onToggle: vi.fn() },
                ]}
            />,
        );
        expect((screen.getByTestId('explorer-search-input') as HTMLTextAreaElement).style.paddingRight)
            .toBe('106px');
    });

    it('forwards inputRef to the textarea', () => {
        const inputRef = createRef<HTMLTextAreaElement>();
        render(<SearchBar value="" {...base()} multiline inputRef={inputRef} />);
        expect(inputRef.current?.tagName).toBe('TEXTAREA');
    });

    it('submits on Enter and suppresses the default newline', () => {
        const onSubmit = vi.fn();
        render(<SearchBar value="a" {...base()} multiline onSubmit={onSubmit} />);
        const event = fireEvent.keyDown(screen.getByTestId('explorer-search-input'), { key: 'Enter' });
        expect(onSubmit).toHaveBeenCalledOnce();
        // fireEvent returns false once preventDefault ran — the textarea must not
        // also insert the line the user did not ask for.
        expect(event).toBe(false);
    });

    it('leaves Shift+Enter alone, so it inserts a newline', () => {
        const onSubmit = vi.fn();
        render(<SearchBar value="a" {...base()} multiline onSubmit={onSubmit} />);
        const event = fireEvent.keyDown(
            screen.getByTestId('explorer-search-input'),
            { key: 'Enter', shiftKey: true },
        );
        expect(onSubmit).not.toHaveBeenCalled();
        expect(event).toBe(true);
    });

    it('does nothing on Enter when the host wired no submit', () => {
        render(<SearchBar value="a" {...base()} multiline />);
        const event = fireEvent.keyDown(screen.getByTestId('explorer-search-input'), { key: 'Enter' });
        expect(event).toBe(true);
    });
});

const WS = 'ws-multiline';

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function type(value: string): void {
    fireEvent.change(screen.getByTestId('content-search-input'), { target: { value } });
}

describe('ContentSearchPanel multi-line query', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        searchContentSpy.mockReset();
        searchContentSpy.mockResolvedValue({ matches: [], truncated: false });
        clearExplorerContentResults(WS);
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    function renderPanel() {
        return render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
    }

    it('uses the multi-line box for the query', () => {
        renderPanel();
        expect(screen.getByTestId('content-search-input').tagName).toBe('TEXTAREA');
    });

    it('runs the query at once on Enter, without waiting out the debounce', async () => {
        renderPanel();
        type('needle');
        // Mid-debounce: nothing has gone out yet.
        await advance(SEARCH_DEBOUNCE_MS - 50);
        expect(searchContentSpy).not.toHaveBeenCalled();

        fireEvent.keyDown(screen.getByTestId('content-search-input'), { key: 'Enter' });
        await advance(0);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(searchContentSpy.mock.calls[0][1]).toBe('needle');

        // The Enter run replaced the pending debounce rather than adding to it.
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
    });

    it('sends a pasted multi-line query as one request, newline intact', async () => {
        renderPanel();
        type('first line\nsecond line');
        await advance(SEARCH_DEBOUNCE_MS);

        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(searchContentSpy.mock.calls[0][1]).toBe('first line\nsecond line');
    });

    it('grows the box for a pasted multi-line query', async () => {
        renderPanel();
        type('a\nb\nc');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-input')).toHaveAttribute('rows', '3');
    });

    it('re-runs an already-run query on Enter, like Refresh does', async () => {
        renderPanel();
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        // Enter is a re-run, not a no-op — same contract as the toolbar's Refresh.
        fireEvent.keyDown(screen.getByTestId('content-search-input'), { key: 'Enter' });
        await advance(0);
        expect(searchContentSpy).toHaveBeenCalledTimes(2);
    });

    it('ignores Enter while the query box is empty', async () => {
        renderPanel();
        fireEvent.keyDown(screen.getByTestId('content-search-input'), { key: 'Enter' });
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).not.toHaveBeenCalled();
    });
});
