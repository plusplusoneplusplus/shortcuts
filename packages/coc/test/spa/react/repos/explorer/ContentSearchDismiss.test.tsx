// @vitest-environment jsdom
/**
 * §2.5 of the Explorer Search VS Code parity goal — dismissing result rows.
 *
 * `X` on a match hides that row; `X` on a file header hides the whole group.
 * Dismissal is view-only: nothing is written, the "N results in M files" summary
 * keeps reporting what the search found, and any new response brings the rows
 * back.
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
    ContentSearchResults,
    applyDismissals,
    dismissRow,
    matchDismissKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchResults';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

const WS = 'ws-dismiss';

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

describe('matchDismissKey', () => {
    it('is unique per match within a file', () => {
        expect(matchDismissKey(match({ line: 1 }))).not.toBe(matchDismissKey(match({ line: 2 })));
        expect(matchDismissKey(match({ startColumn: 0 })))
            .not.toBe(matchDismissKey(match({ startColumn: 6 })));
    });

    it('can never collide with the bare path a whole group is dismissed under', () => {
        // A path is dismissed as itself; a match key carries a NUL separator,
        // which no repo-relative path can contain.
        expect(matchDismissKey(match())).not.toBe('src/app.ts');
        expect(matchDismissKey(match())).toContain('\u0000');
    });
});

describe('applyDismissals', () => {
    const matches = [
        match({ path: 'a.ts', line: 1 }),
        match({ path: 'a.ts', line: 5 }),
        match({ path: 'b.ts', line: 2 }),
    ];

    it('returns the same array reference when nothing is dismissed', () => {
        expect(applyDismissals(matches, [])).toBe(matches);
    });

    it('drops one match by its key and leaves its siblings', () => {
        const kept = applyDismissals(matches, [matchDismissKey(matches[0])]);
        expect(kept.map(m => `${m.path}:${m.line}`)).toEqual(['a.ts:5', 'b.ts:2']);
    });

    it('drops every match of a file when the file path is dismissed', () => {
        const kept = applyDismissals(matches, ['a.ts']);
        expect(kept.map(m => m.path)).toEqual(['b.ts']);
    });
});

describe('dismissRow', () => {
    it('appends a key', () => {
        expect(dismissRow([], 'a.ts')).toEqual(['a.ts']);
    });

    it('ignores a repeat rather than growing the set', () => {
        expect(dismissRow(['a.ts'], 'a.ts')).toEqual(['a.ts']);
    });

    it('never mutates the input', () => {
        const before: readonly string[] = ['a.ts'];
        dismissRow(before, 'b.ts');
        expect(before).toEqual(['a.ts']);
    });
});

describe('ContentSearchResults — dismiss affordance', () => {
    afterEach(cleanup);

    const groups = [
        { path: 'a.ts', matches: [match({ path: 'a.ts', line: 1 }), match({ path: 'a.ts', line: 5 })] },
        { path: 'b.ts', matches: [match({ path: 'b.ts', line: 2 })] },
    ];

    it('renders no X at all when the owner passes no handler', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} />);
        expect(screen.queryAllByTestId('content-search-dismiss')).toHaveLength(0);
    });

    it('gives every file header and every match row its own X', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} onDismiss={vi.fn()} />);
        // 2 headers + 3 matches.
        expect(screen.getAllByTestId('content-search-dismiss')).toHaveLength(5);
    });

    it('dismisses a whole group with its bare path', () => {
        const onDismiss = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByLabelText('Dismiss a.ts'));
        expect(onDismiss).toHaveBeenCalledWith('a.ts');
    });

    it('dismisses one match with its match key', () => {
        const onDismiss = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} onDismiss={onDismiss} />);
        fireEvent.click(screen.getByLabelText('Dismiss match at line 5'));
        expect(onDismiss).toHaveBeenCalledWith(matchDismissKey(match({ path: 'a.ts', line: 5 })));
    });

    it('does not also open the file when the X is clicked', () => {
        const onOpenMatch = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={onOpenMatch} onDismiss={vi.fn()} />);
        fireEvent.click(screen.getByLabelText('Dismiss match at line 2'));
        expect(onOpenMatch).not.toHaveBeenCalled();
    });

    it('does not also collapse the group when a header X is clicked', () => {
        const onToggleCollapsed = vi.fn();
        render(
            <ContentSearchResults
                groups={groups}
                onOpenMatch={vi.fn()}
                onToggleCollapsed={onToggleCollapsed}
                onDismiss={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByLabelText('Dismiss b.ts'));
        expect(onToggleCollapsed).not.toHaveBeenCalled();
    });
});

describe('ContentSearchPanel — dismissing rows', () => {
    async function advance(ms: number): Promise<void> {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }

    function type(value: string): void {
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value } });
    }

    const results = [
        match({ path: 'a.ts', line: 1 }),
        match({ path: 'a.ts', line: 5 }),
        match({ path: 'b.ts', line: 2 }),
    ];

    async function searchWithResults(): Promise<void> {
        searchContentSpy.mockResolvedValue({ matches: results, truncated: false });
        render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
        type('needle');
        await advance(SEARCH_DEBOUNCE_MS);
    }

    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        clearExplorerContentResults();
        searchContentSpy.mockReset();
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it('hides the dismissed match row and keeps the rest of its group', async () => {
        await searchWithResults();
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);

        fireEvent.click(screen.getByLabelText('Dismiss match at line 1'));
        const lines = screen.getAllByTestId('content-search-match')
            .map(node => node.getAttribute('data-line'));
        expect(lines).toEqual(['5', '2']);
    });

    it('removes the group when its last surviving match is dismissed', async () => {
        await searchWithResults();
        fireEvent.click(screen.getByLabelText('Dismiss match at line 2'));
        const paths = screen.getAllByTestId('content-search-group')
            .map(node => node.getAttribute('data-path'));
        expect(paths).toEqual(['a.ts']);
    });

    it('dismissing a file header removes the whole group at once', async () => {
        await searchWithResults();
        fireEvent.click(screen.getByLabelText('Dismiss a.ts'));
        expect(screen.getAllByTestId('content-search-group')
            .map(node => node.getAttribute('data-path'))).toEqual(['b.ts']);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);
    });

    it('leaves the summary reporting what the search found, not what survives', async () => {
        await searchWithResults();
        expect(screen.getByTestId('content-search-summary').textContent)
            .toContain('3 results in 2 files');

        fireEvent.click(screen.getByLabelText('Dismiss a.ts'));
        expect(screen.getByTestId('content-search-summary').textContent)
            .toContain('3 results in 2 files');
    });

    it('writes nothing: dismissing issues no request', async () => {
        await searchWithResults();
        searchContentSpy.mockClear();
        fireEvent.click(screen.getByLabelText('Dismiss a.ts'));
        await advance(SEARCH_DEBOUNCE_MS * 4);
        expect(searchContentSpy).not.toHaveBeenCalled();
    });

    it('brings dismissed rows back on a re-run of the same query', async () => {
        await searchWithResults();
        fireEvent.click(screen.getByLabelText('Dismiss a.ts'));
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);

        // Refresh is a re-run at delay 0, the same path a remount takes.
        fireEvent.click(screen.getByTestId('content-search-refresh'));
        await advance(0);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
    });

    it('brings dismissed rows back on a new query', async () => {
        await searchWithResults();
        fireEvent.click(screen.getByLabelText('Dismiss match at line 1'));
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(2);

        type('other');
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(3);
    });

    it('keeps a dismissal across a layout switch, which repaints without re-searching', async () => {
        await searchWithResults();
        fireEvent.click(screen.getByLabelText('Dismiss match at line 1'));
        fireEvent.click(screen.getByTestId('content-search-view-mode'));
        expect(screen.getAllByTestId('content-search-match')
            .map(node => node.getAttribute('data-line'))).toEqual(['5', '2']);
    });
});
