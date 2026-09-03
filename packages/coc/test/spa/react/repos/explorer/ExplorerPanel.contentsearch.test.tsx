// @vitest-environment jsdom
/**
 * AC-04 of repo-content-search — ExplorerPanel hosts the Search view:
 * switching between Files and Search preserves each view's state, the search is
 * repo-wide regardless of the tree selection (§2.6), "Find in Folder" scopes it
 * through the include glob, and clicking a match opens the file in the preview
 * pane at that line.
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

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
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

    // §2.6: search is repo-wide until the user asks otherwise. The tree
    // selection used to narrow it silently, which VS Code never does.
    it('searches the whole repo even when a directory is selected in the tree', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByText('src'));
        await advance(0);
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);

        expect(searchContentSpy).toHaveBeenCalledTimes(1);
        expect(searchContentSpy.mock.calls[0][2].path).toBeUndefined();
        expect(screen.queryByTestId('content-search-scope')).toBeNull();
    });

    it('does not re-run the search when a file is selected in the tree', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('explorer-view-tree'));
        await advance(0);
        fireEvent.click(screen.getByText('README.md'));
        await advance(SEARCH_DEBOUNCE_MS);
        fireEvent.click(screen.getByTestId('explorer-view-search'));
        await advance(SEARCH_DEBOUNCE_MS);

        // Only the remount re-run — the selection itself changed nothing.
        expect(searchContentSpy).toHaveBeenCalledTimes(2);
        expect(searchContentSpy.mock.calls[1][2].path).toBeUndefined();
    });

    it('offers Find in Folder on a directory but not on a file', async () => {
        await renderPanel();
        fireEvent.contextMenu(screen.getByText('src'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByText('Find in Folder')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        cleanup();

        await renderPanel();
        fireEvent.contextMenu(screen.getByText('README.md'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByText('Find in Folder')).toBeNull();
    });

    it('Find in Folder switches to Search, fills include with <dir>/** and focuses the query box', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.contextMenu(screen.getByText('src'));
        await advance(0);
        fireEvent.click(screen.getByText('Find in Folder'));
        await advance(0);

        expect(screen.getByTestId('content-search-panel')).toBeInTheDocument();
        const input = screen.getByTestId('content-search-input') as HTMLInputElement;
        expect(document.activeElement).toBe(input);
        // The `…` section is open because a filter is active, so the glob is visible.
        expect((screen.getByTestId('content-search-include') as HTMLInputElement).value).toBe('src/**');

        fireEvent.change(input, { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);
        expect(searchContentSpy.mock.calls.at(-1)![2]).toMatchObject({ include: ['src/**'] });
    });

    it('clearing the include glob restores repo-wide results', async () => {
        vi.useFakeTimers();
        await renderPanel();
        fireEvent.contextMenu(screen.getByText('src'));
        await advance(0);
        fireEvent.click(screen.getByText('Find in Folder'));
        await advance(0);
        fireEvent.change(screen.getByTestId('content-search-input'), { target: { value: 'needle' } });
        await advance(SEARCH_DEBOUNCE_MS);

        fireEvent.change(screen.getByTestId('content-search-include'), { target: { value: '' } });
        await advance(SEARCH_DEBOUNCE_MS);

        expect(searchContentSpy.mock.calls.at(-1)![2].include).toBeUndefined();
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
