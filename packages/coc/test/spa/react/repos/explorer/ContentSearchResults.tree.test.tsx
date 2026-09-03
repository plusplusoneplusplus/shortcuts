// @vitest-environment jsdom
/**
 * §2.4 of the Explorer Search parity goal — "View as Tree / View as List".
 *
 * Three layers: the pure tree builder (nesting, ordering, single-child chain
 * compression, counts), the rendered rows in each layout, and the panel wiring
 * (the toolbar toggle, its persistence, and Collapse All reaching the directory
 * rows the tree adds).
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
    buildSearchTree,
    collapsibleTreePaths,
    groupMatchesByFile,
    type ContentSearchDirNode,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchResults';
import {
    ContentSearchPanel,
    SEARCH_DEBOUNCE_MS,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import {
    clearExplorerContentResults,
    explorerContentResultViewStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';

const WS = 'ws-result-view';

function match(overrides: Partial<ExplorerContentMatch> = {}): ExplorerContentMatch {
    return {
        path: 'src/app.ts',
        line: 1,
        text: 'const needle = 1;',
        startColumn: 6,
        endColumn: 12,
        before: [],
        after: [],
        ...overrides,
    };
}

function groupsOf(...matches: ExplorerContentMatch[]) {
    return groupMatchesByFile(matches);
}

describe('buildSearchTree', () => {
    it('returns nothing for no groups', () => {
        expect(buildSearchTree([])).toEqual([]);
    });

    it('puts a root-level file straight at the top level', () => {
        const tree = buildSearchTree(groupsOf(match({ path: 'README.md' })));
        expect(tree).toHaveLength(1);
        expect(tree[0]).toMatchObject({ kind: 'file', path: 'README.md', name: 'README.md' });
    });

    it('nests files under their directories', () => {
        const tree = buildSearchTree(groupsOf(
            match({ path: 'src/a.ts' }),
            match({ path: 'src/b.ts' }),
        ));
        expect(tree).toHaveLength(1);
        const dir = tree[0] as ContentSearchDirNode;
        expect(dir).toMatchObject({ kind: 'dir', path: 'src', name: 'src', matchCount: 2 });
        expect(dir.children.map(child => child.path)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('compresses a single-child directory chain into one row keyed by the deepest path', () => {
        const tree = buildSearchTree(groupsOf(match({ path: 'src/server/spa/app.ts' })));
        const dir = tree[0] as ContentSearchDirNode;
        expect(dir.name).toBe('src/server/spa');
        expect(dir.path).toBe('src/server/spa');
        expect(dir.children.map(child => child.path)).toEqual(['src/server/spa/app.ts']);
    });

    it('stops compressing where a directory branches', () => {
        const tree = buildSearchTree(groupsOf(
            match({ path: 'src/server/a.ts' }),
            match({ path: 'src/client/b.ts' }),
        ));
        const dir = tree[0] as ContentSearchDirNode;
        expect(dir.name).toBe('src');
        expect(dir.children.map(child => (child as ContentSearchDirNode).name))
            .toEqual(['server', 'client']);
    });

    it('does not compress a directory that holds both a file and a directory', () => {
        const tree = buildSearchTree(groupsOf(
            match({ path: 'src/index.ts' }),
            match({ path: 'src/deep/a.ts' }),
        ));
        const dir = tree[0] as ContentSearchDirNode;
        expect(dir.name).toBe('src');
        expect(dir.children.map(child => child.kind)).toEqual(['file', 'dir']);
    });

    it('counts every match beneath a directory, not just its direct files', () => {
        const tree = buildSearchTree(groupsOf(
            match({ path: 'src/deep/a.ts', line: 1 }),
            match({ path: 'src/deep/a.ts', line: 2 }),
            match({ path: 'src/other/b.ts', line: 3 }),
        ));
        expect((tree[0] as ContentSearchDirNode).matchCount).toBe(3);
    });

    it('keeps a directory where its first matching file appeared', () => {
        const tree = buildSearchTree(groupsOf(
            match({ path: 'zzz/a.ts' }),
            match({ path: 'aaa/b.ts' }),
        ));
        expect(tree.map(node => node.path)).toEqual(['zzz', 'aaa']);
    });
});

describe('collapsibleTreePaths', () => {
    it('lists every directory row and every file', () => {
        const paths = collapsibleTreePaths(groupsOf(
            match({ path: 'src/server/a.ts' }),
            match({ path: 'src/client/b.ts' }),
        ));
        expect(paths).toEqual([
            'src',
            'src/server',
            'src/server/a.ts',
            'src/client',
            'src/client/b.ts',
        ]);
    });

    it('uses the compressed path for a collapsed chain, matching what renders', () => {
        expect(collapsibleTreePaths(groupsOf(match({ path: 'a/b/c/d.ts' }))))
            .toEqual(['a/b/c', 'a/b/c/d.ts']);
    });

    it('is empty for no results', () => {
        expect(collapsibleTreePaths([])).toEqual([]);
    });
});

describe('ContentSearchResults layouts', () => {
    afterEach(cleanup);

    const groups = groupsOf(
        match({ path: 'src/server/a.ts', line: 1 }),
        match({ path: 'src/client/b.ts', line: 2 }),
    );

    it('defaults to the flat list, with no directory rows', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} />);
        expect(screen.getByTestId('content-search-results'))
            .toHaveAttribute('data-result-view', 'list');
        expect(screen.queryAllByTestId('content-search-dir')).toHaveLength(0);
        expect(screen.getAllByTestId('content-search-file-header')).toHaveLength(2);
    });

    it('shows the dimmed directory beside the file name in the list view only', () => {
        const { rerender } = render(
            <ContentSearchResults groups={groups} onOpenMatch={vi.fn()} resultView="list" />,
        );
        expect(screen.getAllByTestId('content-search-file-header')[0]).toHaveTextContent('src/server');

        rerender(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} resultView="tree" />);
        // In the tree the directory is its own row, so repeating it would be noise.
        expect(screen.getAllByTestId('content-search-file-header')[0]).not.toHaveTextContent('src/server');
    });

    it('renders directory rows with their subtree counts in the tree view', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} resultView="tree" />);
        const dirs = screen.getAllByTestId('content-search-dir-header');
        expect(dirs.map(row => row.getAttribute('data-path')))
            .toEqual(['src', 'src/server', 'src/client']);
        expect(dirs[0]).toHaveTextContent('2');
    });

    it('indents each nesting level of the tree', () => {
        render(<ContentSearchResults groups={groups} onOpenMatch={vi.fn()} resultView="tree" />);
        const rows = screen.getAllByTestId('content-search-dir-header');
        const outer = Number.parseInt(rows[0].style.paddingLeft, 10);
        const inner = Number.parseInt(rows[1].style.paddingLeft, 10);
        expect(inner).toBeGreaterThan(outer);
    });

    it('collapsing a directory hides everything beneath it but keeps its count', () => {
        render(
            <ContentSearchResults
                groups={groups}
                onOpenMatch={vi.fn()}
                resultView="tree"
                collapsed={['src']}
            />,
        );
        expect(screen.getAllByTestId('content-search-dir-header')).toHaveLength(1);
        expect(screen.queryAllByTestId('content-search-file-header')).toHaveLength(0);
        expect(screen.queryAllByTestId('content-search-match')).toHaveLength(0);
        const row = screen.getByTestId('content-search-dir-header');
        expect(row).toHaveAttribute('data-collapsed', 'true');
        expect(row).toHaveAttribute('aria-expanded', 'false');
        expect(row).toHaveTextContent('2');
    });

    it('asks the owner to toggle the directory it was clicked on', () => {
        const onToggleCollapsed = vi.fn();
        render(
            <ContentSearchResults
                groups={groups}
                onOpenMatch={vi.fn()}
                resultView="tree"
                onToggleCollapsed={onToggleCollapsed}
            />,
        );
        fireEvent.click(screen.getAllByTestId('content-search-dir-header')[1]);
        expect(onToggleCollapsed).toHaveBeenCalledWith('src/server');
    });

    it('still opens a match at its line from inside the tree', () => {
        const onOpenMatch = vi.fn();
        render(<ContentSearchResults groups={groups} onOpenMatch={onOpenMatch} resultView="tree" />);
        fireEvent.click(screen.getAllByTestId('content-search-match')[1]);
        expect(onOpenMatch).toHaveBeenCalledWith('src/client/b.ts', 2);
    });
});

describe('ContentSearchPanel view-as-tree toggle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        clearExplorerContentResults();
        searchContentSpy.mockReset();
        searchContentSpy.mockResolvedValue({
            matches: [
                match({ path: 'src/server/a.ts', line: 1 }),
                match({ path: 'src/client/b.ts', line: 2 }),
            ],
            truncated: false,
        });
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    async function advance(ms: number): Promise<void> {
        await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
    }

    async function searchFor(query: string): Promise<void> {
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: query } });
        await advance(SEARCH_DEBOUNCE_MS);
    }

    function renderPanel() {
        return render(<ContentSearchPanel workspaceId={WS} onOpenMatch={vi.fn()} />);
    }

    it('starts in the list view and offers to switch to the tree', async () => {
        renderPanel();
        await searchFor('needle');
        const button = screen.getByTestId('content-search-view-mode');
        expect(button).toHaveAttribute('aria-label', 'View as Tree');
        expect(screen.getByTestId('content-search-results'))
            .toHaveAttribute('data-result-view', 'list');
    });

    it('is disabled without a query, like the rest of the strip', () => {
        renderPanel();
        expect(screen.getByTestId('content-search-view-mode')).toBeDisabled();
    });

    it('switches to the tree and back', async () => {
        renderPanel();
        await searchFor('needle');

        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });
        expect(screen.getByTestId('content-search-results'))
            .toHaveAttribute('data-result-view', 'tree');
        expect(screen.getAllByTestId('content-search-dir-header').length).toBeGreaterThan(0);
        expect(screen.getByTestId('content-search-view-mode'))
            .toHaveAttribute('aria-label', 'View as List');

        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });
        expect(screen.getByTestId('content-search-results'))
            .toHaveAttribute('data-result-view', 'list');
        expect(screen.queryAllByTestId('content-search-dir-header')).toHaveLength(0);
    });

    it('does not re-run the search just to change layout', async () => {
        renderPanel();
        await searchFor('needle');
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });
        await advance(SEARCH_DEBOUNCE_MS);

        expect(searchContentSpy).toHaveBeenCalledTimes(1);
    });

    it('persists the layout per workspace, so a remount comes back as a tree', async () => {
        const first = renderPanel();
        await searchFor('needle');
        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });
        expect(localStorage.getItem(explorerContentResultViewStorageKey(WS))).toBe('"tree"');

        first.unmount();
        renderPanel();
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getByTestId('content-search-results'))
            .toHaveAttribute('data-result-view', 'tree');
    });

    it('closes the directory rows too on Collapse All', async () => {
        renderPanel();
        await searchFor('needle');
        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });
        expect(screen.getAllByTestId('content-search-dir-header')).toHaveLength(3);

        await act(async () => { screen.getByTestId('content-search-collapse-all').click(); });

        expect(screen.getAllByTestId('content-search-dir-header')).toHaveLength(1);
        expect(screen.queryAllByTestId('content-search-match')).toHaveLength(0);
    });

    it('carries a collapse made in the list view over to the tree view', async () => {
        renderPanel();
        await searchFor('needle');
        await act(async () => { screen.getAllByTestId('content-search-file-header')[0].click(); });

        await act(async () => { screen.getByTestId('content-search-view-mode').click(); });

        const header = screen.getAllByTestId('content-search-file-header')
            .find(row => row.getAttribute('data-path') === 'src/server/a.ts');
        expect(header).toHaveAttribute('data-collapsed', 'true');
    });
});
