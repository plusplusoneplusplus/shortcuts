/**
 * Repository -> file -> match grouping in the overlay (AC-03 DoD 2).
 *
 * Two halves: the pure bucketing/flattening module, and the tree the dialog
 * draws from it. The contract that ties them together is that the arrow keys
 * walk exactly the match rows that are on screen — collapsing a group has to
 * remove its matches from the keyboard walk, not just hide them.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
    ContentSearchOverlay,
    type ContentSearchOverlayMatch,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/ContentSearchOverlay';
import {
    fileGroupKey,
    groupOverlayMatches,
    toggleCollapsed,
    visibleMatches,
} from '../../../../src/server/spa/client/react/features/repo-detail/content-search/contentSearchGrouping';

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

function match(
    overrides: Partial<ContentSearchOverlayMatch> & Pick<ContentSearchOverlayMatch, 'id'>,
): ContentSearchOverlayMatch {
    return {
        workspaceId: 'repo-a',
        path: 'src/app.ts',
        line: 1,
        preview: 'hit',
        startColumn: 0,
        endColumn: 3,
        ...overrides,
    };
}

/** Alpha: two files (2 + 1 matches); Beta: the same relative path, 1 match. */
function groupMatches(): ContentSearchOverlayMatch[] {
    return [
        match({ id: 'a1', repoLabel: 'Alpha', line: 3 }),
        match({ id: 'a2', repoLabel: 'Alpha', line: 9 }),
        match({ id: 'a3', repoLabel: 'Alpha', path: 'src/util.ts', line: 2 }),
        match({ id: 'b1', workspaceId: 'repo-b', repoLabel: 'Beta', line: 7 }),
    ];
}

describe('groupOverlayMatches', () => {
    it('buckets by repository then file, in first-seen order', () => {
        const repos = groupOverlayMatches(groupMatches());

        expect(repos.map(repo => repo.workspaceId)).toEqual(['repo-a', 'repo-b']);
        expect(repos[0].repoLabel).toBe('Alpha');
        expect(repos[0].matchCount).toBe(3);
        expect(repos[0].files.map(file => file.path)).toEqual(['src/app.ts', 'src/util.ts']);
        expect(repos[0].files[0].matches.map(row => row.id)).toEqual(['a1', 'a2']);
        expect(repos[1].matchCount).toBe(1);
    });

    it('keeps the same relative path in two members as two file groups', () => {
        const repos = groupOverlayMatches(groupMatches());
        expect(repos[0].files[0].key).toBe(fileGroupKey('repo-a', 'src/app.ts'));
        expect(repos[1].files[0].key).toBe(fileGroupKey('repo-b', 'src/app.ts'));
        expect(repos[0].files[0].key).not.toBe(repos[1].files[0].key);
    });

    it('is empty for an empty result set', () => {
        expect(groupOverlayMatches([])).toEqual([]);
        expect(visibleMatches([], new Set())).toEqual([]);
    });
});

describe('visibleMatches', () => {
    const repos = groupOverlayMatches(groupMatches());

    it('flattens back to the original order when nothing is collapsed', () => {
        expect(visibleMatches(repos, new Set()).map(row => row.id)).toEqual([
            'a1',
            'a2',
            'a3',
            'b1',
        ]);
    });

    it('drops a collapsed file but keeps its siblings', () => {
        const collapsed = new Set([fileGroupKey('repo-a', 'src/app.ts')]);
        expect(visibleMatches(repos, collapsed).map(row => row.id)).toEqual(['a3', 'b1']);
    });

    it('drops every match under a collapsed repository', () => {
        expect(visibleMatches(repos, new Set(['repo-a'])).map(row => row.id)).toEqual(['b1']);
    });
});

describe('toggleCollapsed', () => {
    it('adds, removes, and never mutates the set it was given', () => {
        const start: ReadonlySet<string> = new Set<string>();
        const collapsed = toggleCollapsed(start, 'repo-a');
        expect(collapsed.has('repo-a')).toBe(true);
        expect(start.size).toBe(0);
        expect(toggleCollapsed(collapsed, 'repo-a').has('repo-a')).toBe(false);
    });
});

describe('ContentSearchOverlay grouped results', () => {
    function renderOverlay(
        overrides: Partial<React.ComponentProps<typeof ContentSearchOverlay>> = {},
    ) {
        const props = {
            open: true,
            scope: 'group' as const,
            query: 'needle',
            onQueryChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
            matches: groupMatches(),
            onOpenMatch: vi.fn(),
            ...overrides,
        };
        render(<ContentSearchOverlay {...props} />);
        return props;
    }

    function matchRows(): HTMLElement[] {
        return screen.queryAllByTestId(/^content-search-overlay-match-/);
    }

    it('draws a repository, file and match level with accessible depths', () => {
        renderOverlay();
        const tree = screen.getByTestId('content-search-overlay-results');
        expect(tree.getAttribute('role')).toBe('tree');

        const repo = screen.getByTestId('content-search-overlay-repo-repo-a');
        expect(repo.getAttribute('aria-level')).toBe('1');
        expect(repo.getAttribute('aria-expanded')).toBe('true');
        expect(repo.getAttribute('aria-label')).toBe('Alpha, 3 results');

        const file = screen.getByTestId(
            `content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`,
        );
        expect(file.getAttribute('aria-level')).toBe('2');
        expect(file.getAttribute('aria-label')).toBe('src/app.ts, 2 results');

        const row = screen.getByTestId('content-search-overlay-match-a1');
        expect(row.getAttribute('aria-level')).toBe('3');
        // Line number and preview, with the path carried by the file heading.
        expect(row.textContent).toContain('3');
        expect(row.textContent).toContain('hit');
    });

    it('lifts the file level in a single-repo search, with no repository row', () => {
        renderOverlay({ scope: 'repo' });
        expect(screen.queryByTestId('content-search-overlay-repo-repo-a')).toBeNull();
        expect(
            screen
                .getByTestId(`content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`)
                .getAttribute('aria-level'),
        ).toBe('1');
        expect(screen.getByTestId('content-search-overlay-match-a1').getAttribute('aria-level'))
            .toBe('2');
    });

    it('collapses a file group and its matches, and expands it again', () => {
        renderOverlay();
        const file = screen.getByTestId(
            `content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`,
        );

        fireEvent.click(file);
        expect(file.getAttribute('aria-expanded')).toBe('false');
        expect(matchRows().map(row => row.dataset.testid)).not.toContain(
            'content-search-overlay-match-a1',
        );
        // The file heading itself stays, and its siblings are untouched.
        expect(screen.getByTestId('content-search-overlay-match-a3')).toBeTruthy();

        fireEvent.click(file);
        expect(file.getAttribute('aria-expanded')).toBe('true');
        expect(screen.getByTestId('content-search-overlay-match-a1')).toBeTruthy();
    });

    it('collapses a repository down to its own row', () => {
        renderOverlay();
        const repo = screen.getByTestId('content-search-overlay-repo-repo-a');
        fireEvent.click(repo);

        expect(repo.getAttribute('aria-expanded')).toBe('false');
        expect(
            screen.queryByTestId(`content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`),
        ).toBeNull();
        expect(matchRows()).toHaveLength(1);
        // The other member is unaffected.
        expect(screen.getByTestId('content-search-overlay-match-b1')).toBeTruthy();
    });

    it('expand and collapse controls are keyboard reachable and take Enter', () => {
        const props = renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        const repo = screen.getByTestId('content-search-overlay-repo-repo-a');
        const file = screen.getByTestId(
            `content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`,
        );
        // Tab reaches both heading levels; the matches keep the roving index.
        expect(repo.tabIndex).toBe(0);
        expect(file.tabIndex).toBe(0);

        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        repo.focus();
        // Enter belongs to the toggle: with a match selected, the dialog must
        // not read it as opening that match, and never as a fresh search.
        fireEvent.keyDown(repo, { key: 'Enter' });
        expect(props.onOpenMatch).not.toHaveBeenCalled();
        expect(props.onSubmit).not.toHaveBeenCalled();

        // The browser turns that same Enter into the button's own activation.
        fireEvent.click(repo);
        expect(repo.getAttribute('aria-expanded')).toBe('false');
    });

    it('arrow keys walk only the matches that are on screen', () => {
        const props = renderOverlay();
        const dialog = screen.getByTestId('content-search-overlay');
        fireEvent.click(
            screen.getByTestId(`content-search-overlay-file-${fileGroupKey('repo-a', 'src/app.ts')}`),
        );

        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        expect(screen.getByTestId('content-search-overlay-match-a3').getAttribute('aria-selected'))
            .toBe('true');
        fireEvent.keyDown(dialog, { key: 'ArrowDown' });
        fireEvent.keyDown(dialog, { key: 'Enter' });

        expect(props.onOpenMatch).toHaveBeenCalledTimes(1);
        expect(props.onOpenMatch.mock.calls[0][0].id).toBe('b1');
    });

    it('re-expands everything when a new result set arrives', () => {
        const props = {
            open: true,
            scope: 'group' as const,
            query: 'needle',
            onQueryChange: vi.fn(),
            onSubmit: vi.fn(),
            onClose: vi.fn(),
            matches: groupMatches(),
            onOpenMatch: vi.fn(),
        };
        const { rerender } = render(<ContentSearchOverlay {...props} />);
        fireEvent.click(screen.getByTestId('content-search-overlay-repo-repo-a'));
        expect(matchRows()).toHaveLength(1);

        rerender(<ContentSearchOverlay {...props} matches={groupMatches()} />);
        expect(screen.getByTestId('content-search-overlay-repo-repo-a').getAttribute('aria-expanded'))
            .toBe('true');
        expect(matchRows()).toHaveLength(4);
    });

    it('says so when the server capped the answer', () => {
        renderOverlay({ truncated: true });
        expect(screen.getByTestId('content-search-overlay-truncated').textContent).toMatch(
            /showing the first results/i,
        );
    });

    it('has no truncation notice for a complete answer', () => {
        renderOverlay();
        expect(screen.queryByTestId('content-search-overlay-truncated')).toBeNull();
    });

    it('names every member that dropped out, with a reason', () => {
        renderOverlay({
            failures: [
                { workspaceId: 'repo-c', repoLabel: 'Gamma', reason: 'error', message: 'boom' },
                { workspaceId: 'repo-d', repoLabel: 'Delta', reason: 'unavailable', message: '' },
                { workspaceId: 'repo-e', reason: 'stale', message: '' },
            ],
        });
        const list = screen.getByTestId('content-search-overlay-failures');
        expect(list.getAttribute('aria-label')).toBe('Repositories that could not be searched');
        expect(screen.getByTestId('content-search-overlay-failure-repo-c').textContent).toContain(
            'Gamma could not be searched: boom',
        );
        expect(screen.getByTestId('content-search-overlay-failure-repo-d').textContent).toContain(
            'Delta is not a Git repository.',
        );
        // A removed member has no label left, so the workspace id stands in.
        expect(screen.getByTestId('content-search-overlay-failure-repo-e').textContent).toContain(
            'repo-e is no longer part of this group.',
        );
    });

    it('shows no failure list when every member answered', () => {
        renderOverlay();
        expect(screen.queryByTestId('content-search-overlay-failures')).toBeNull();
    });
});
