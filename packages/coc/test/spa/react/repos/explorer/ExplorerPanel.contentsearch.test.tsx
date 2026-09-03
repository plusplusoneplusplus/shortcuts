// @vitest-environment jsdom
/**
 * AC-04 of repo-content-search — ExplorerPanel hosts the Search view:
 * switching between Files and Search preserves each view's state, the search is
 * scoped to the selected directory, and clicking a match opens the file in the
 * preview pane at that line.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import type { ExplorerContentMatch } from '@plusplusoneplusplus/coc-client';

const treeSpy = vi.fn();
const searchFilesSpy = vi.fn();
const searchContentSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchFilesSpy(...args),
        searchContent: (...args: unknown[]) => searchContentSpy(...args),
        reveal: vi.fn(),
    },
}));

// Keep Monaco out of the import graph; assert on the props the panel hands down.
const previewProps = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: (props: Record<string, unknown>) => {
        previewProps(props);
        return <div data-testid="preview-stub" data-path={props.filePath} data-line={String(props.revealLine)} />;
    },
}));

import { ExplorerPanel, resolveSearchScope, isDirectoryPath } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerContentResults } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { SEARCH_DEBOUNCE_MS } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-explorer';

const ROOT_ENTRIES: TreeEntry[] = [
    {
        name: 'src',
        type: 'dir',
        path: 'src',
        children: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }],
    },
    { name: 'README.md', type: 'file', path: 'README.md' },
];

const MATCH: ExplorerContentMatch = {
    path: 'src/app.ts',
    line: 17,
    text: 'const needle = 1;',
    startColumn: 6,
    endColumn: 12,
    before: [],
    after: [],
};

async function advance(ms: number): Promise<void> {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

async function renderPanel() {
    const result = render(<ExplorerPanel workspaceId={WS} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    return result;
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerContentResults();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchFilesSpy.mockReset();
    searchFilesSpy.mockResolvedValue({ results: [] });
    searchContentSpy.mockReset();
    searchContentSpy.mockResolvedValue({ matches: [MATCH], truncated: false });
    previewProps.mockReset();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe('resolveSearchScope', () => {
    const childrenMap = new Map<string, TreeEntry[]>([['src', ROOT_ENTRIES[0].children!]]);

    it('searches the whole repo when nothing is selected', () => {
        expect(resolveSearchScope(null, ROOT_ENTRIES, childrenMap)).toBeUndefined();
    });

    it('scopes to a selected directory', () => {
        expect(resolveSearchScope('src', ROOT_ENTRIES, childrenMap)).toBe('src');
    });

    it('scopes to the parent directory of a selected file', () => {
        expect(resolveSearchScope('src/app.ts', ROOT_ENTRIES, childrenMap)).toBe('src');
    });

    it('searches the whole repo for a file selected at the root', () => {
        expect(resolveSearchScope('README.md', ROOT_ENTRIES, childrenMap)).toBeUndefined();
    });

    it('reads an unknown path as a file and scopes to its parent', () => {
        expect(resolveSearchScope('a/b/c.ts', ROOT_ENTRIES, new Map())).toBe('a/b');
    });
});

describe('isDirectoryPath', () => {
    it('is true for a directory already expanded into childrenMap', () => {
        expect(isDirectoryPath('src', [], new Map([['src', []]]))).toBe(true);
    });

    it('is true for an unexpanded directory listed in its parent', () => {
        expect(isDirectoryPath('src', ROOT_ENTRIES, new Map())).toBe(true);
    });

    it('is false for a file', () => {
        expect(isDirectoryPath('README.md', ROOT_ENTRIES, new Map())).toBe(false);
    });

    it('is false for a path nothing knows about', () => {
        expect(isDirectoryPath('nope/at/all', ROOT_ENTRIES, new Map())).toBe(false);
    });
});

describe('ExplorerPanel — Search view', () => {
    it('starts on the Files view with the tree showing', async () => {
        await renderPanel();
        expect(screen.getByTestId('explorer-view-tree').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('explorer-search-bar')).toBeDefined();
        expect(screen.queryByTestId('content-search-panel')).toBeNull();
    });

    it('switches to the Search view and back without unmounting the tree data', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        await act(async () => { await Promise.resolve(); });

        expect(screen.getByTestId('content-search-panel')).toBeDefined();
        expect(screen.queryByTestId('explorer-search-bar')).toBeNull();
        expect(screen.getByTestId('explorer-view-search').getAttribute('aria-selected')).toBe('true');

        fireEvent.click(screen.getByTestId('explorer-view-tree'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('explorer-search-bar')).toBeDefined();
        // No refetch: the tree cache carried the listing across the round trip.
        expect(treeSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps search results when the user visits the tree and comes back', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);
        expect(screen.getAllByTestId('content-search-match')).toHaveLength(1);

        fireEvent.click(screen.getByTestId('explorer-view-tree'));
        await advance(0);
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        await advance(0);

        expect(screen.getByTestId('content-search-match').getAttribute('data-line')).toBe('17');
        expect(searchContentSpy).toHaveBeenCalledTimes(1);
    });

    it('scopes the search to the directory selected in the tree', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByText('src'));
        await advance(0);
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);

        expect(searchContentSpy.mock.calls[0][2]).toMatchObject({ path: 'src' });
    });

    it('opens the file at the matching line when a result is clicked', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);

        fireEvent.click(screen.getByTestId('content-search-match'));
        await advance(0);

        const stub = screen.getByTestId('preview-stub');
        expect(stub.getAttribute('data-path')).toBe('src/app.ts');
        expect(stub.getAttribute('data-line')).toBe('17');
        expect(previewProps).toHaveBeenCalledWith(
            expect.objectContaining({ repoId: WS, filePath: 'src/app.ts', fileName: 'app.ts', revealLine: 17 }),
        );
    });

    it('persists the open line so a reload reopens the file at the same place', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-match'));
        await advance(0);

        const stored = JSON.parse(localStorage.getItem(`split-workspace:${WS}:explorer-preview`)!);
        expect(stored).toEqual({ path: 'src/app.ts', name: 'app.ts', line: 17 });
    });

    it('opens a file at a line even when the tree click path opened it without one', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.doubleClick(screen.getByText('README.md'));
        await advance(0);
        expect(screen.getByTestId('preview-stub').getAttribute('data-line')).toBe('undefined');

        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('content-search-match'));
        await advance(0);

        expect(screen.getByTestId('preview-stub').getAttribute('data-line')).toBe('17');
    });

    it('swaps the Files header toolbar for the Search view\'s own strip', async () => {
        await renderPanel();
        expect(screen.getByTestId('explorer-refresh-btn')).toBeInTheDocument();
        expect(screen.getByTestId('explorer-collapse-all-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('content-search-toolbar')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('explorer-view-search'));
        await act(async () => { await Promise.resolve(); });

        // The tree buttons say nothing about a content search, so they go away.
        expect(screen.queryByTestId('explorer-refresh-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('explorer-collapse-all-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('explorer-reveal-file-btn')).not.toBeInTheDocument();
        expect(screen.getByTestId('content-search-toolbar')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('explorer-view-tree'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('explorer-refresh-btn')).toBeInTheDocument();
    });

    it('restores the Search view on a remount for the same workspace', async () => {
        const { unmount } = await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        await act(async () => { await Promise.resolve(); });
        unmount();

        await renderPanel();
        await waitFor(() => expect(screen.getByTestId('content-search-panel')).toBeDefined());
    });
});
