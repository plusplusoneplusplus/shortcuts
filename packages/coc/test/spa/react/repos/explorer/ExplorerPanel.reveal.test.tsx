// @vitest-environment jsdom
/**
 * explorer-tree-collapse-and-reveal — the two icon buttons in the Files header row.
 *
 *  AC-01 Collapse All clears every expanded folder and touches nothing else.
 *  AC-02 Reveal Open File expands the preview file's ancestors (lazy-fetching the
 *        levels that are not cached yet) and centres its row in the tree.
 *
 * PreviewPane is mocked out so Monaco never enters the module graph.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();
const revealSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        reveal: (...args: unknown[]) => revealSpy(...args),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => null,
}));

import { ExplorerPanel, computeCenterScrollTop } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import {
    explorerExpandedStorageKey,
    explorerPreviewStorageKey,
    explorerSelectedStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-reveal';
const DEEP = 'a/b/c/deep.ts';

/**
 * Depth-2 root listing: `a` and `a/b` arrive seeded, `a/b/c` does not — so
 * revealing `a/b/c/deep.ts` has exactly one level left to lazy-fetch.
 */
function rootEntries(): TreeEntry[] {
    return [
        {
            name: 'a',
            type: 'dir',
            path: 'a',
            children: [
                { name: 'b', type: 'dir', path: 'a/b', children: [{ name: 'c', type: 'dir', path: 'a/b/c' }] },
            ],
        },
        { name: 'top.ts', type: 'file', path: 'top.ts' },
    ];
}

function treeResponse(path: string): { entries: TreeEntry[] } {
    if (path === '/') return { entries: rootEntries() };
    if (path === 'a') return { entries: [{ name: 'b', type: 'dir', path: 'a/b' }] };
    if (path === 'a/b') return { entries: [{ name: 'c', type: 'dir', path: 'a/b/c' }] };
    if (path === 'a/b/c') return { entries: [{ name: 'deep.ts', type: 'file', path: DEEP }] };
    return { entries: [] };
}

function storedExpanded(): string[] {
    return JSON.parse(localStorage.getItem(explorerExpandedStorageKey(WS)) ?? '[]');
}

function storedSelected(): string | null {
    const raw = localStorage.getItem(explorerSelectedStorageKey(WS));
    return raw === null ? null : JSON.parse(raw);
}

/** Mount with the given persisted state and the mount fetch settled. */
async function mount(options: {
    expanded?: string[];
    preview?: { path: string; name: string };
    selected?: string;
} = {}): Promise<void> {
    if (options.expanded) {
        localStorage.setItem(explorerExpandedStorageKey(WS), JSON.stringify(options.expanded));
    }
    if (options.preview) {
        localStorage.setItem(explorerPreviewStorageKey(WS), JSON.stringify(options.preview));
    }
    if (options.selected) {
        localStorage.setItem(explorerSelectedStorageKey(WS), JSON.stringify(options.selected));
    }
    render(<ExplorerPanel workspaceId={WS} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a')).toBeInTheDocument());
    treeSpy.mockClear();
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    treeSpy.mockReset();
    treeSpy.mockImplementation((_ws: string, options: { path: string }) =>
        Promise.resolve(treeResponse(options.path)));
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
    revealSpy.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('AC-01 — Collapse All', () => {
    it('clears every expanded folder in one click', async () => {
        await mount({ expanded: ['a', 'a/b'] });
        expect(screen.getByTestId('tree-node-a/b')).toBeInTheDocument();

        await act(async () => { screen.getByTestId('explorer-collapse-all-btn').click(); });

        expect(storedExpanded()).toEqual([]);
        expect(screen.queryByTestId('tree-node-a/b')).not.toBeInTheDocument();
        expect(screen.getByTestId('tree-node-a')).toBeInTheDocument();
    });

    it('leaves the selection, the preview file and the filter text untouched', async () => {
        await mount({
            expanded: ['a'],
            selected: 'top.ts',
            preview: { path: 'top.ts', name: 'top.ts' },
        });
        const filter = screen.getByPlaceholderText('Filter files…') as HTMLInputElement;
        fireEvent.change(filter, { target: { value: 'dee' } });

        await act(async () => { screen.getByTestId('explorer-collapse-all-btn').click(); });

        expect(storedExpanded()).toEqual([]);
        expect(storedSelected()).toBe('top.ts');
        expect(JSON.parse(localStorage.getItem(explorerPreviewStorageKey(WS))!).path).toBe('top.ts');
        expect(filter.value).toBe('dee');
    });

    it('is disabled when nothing is expanded', async () => {
        await mount();
        expect(screen.getByTestId('explorer-collapse-all-btn')).toBeDisabled();
    });

    it('is enabled once a folder is expanded', async () => {
        await mount({ expanded: ['a'] });
        expect(screen.getByTestId('explorer-collapse-all-btn')).not.toBeDisabled();
    });

    it('issues no server request', async () => {
        await mount({ expanded: ['a', 'a/b'] });

        await act(async () => { screen.getByTestId('explorer-collapse-all-btn').click(); });

        expect(treeSpy).not.toHaveBeenCalled();
        expect(revealSpy).not.toHaveBeenCalled();
    });
});

describe('AC-02 — Reveal Open File', () => {
    it('is disabled when no file is open in the preview pane', async () => {
        await mount();
        expect(screen.getByTestId('explorer-reveal-file-btn')).toBeDisabled();
    });

    it('is enabled when a file is open in the preview pane', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });
        expect(screen.getByTestId('explorer-reveal-file-btn')).not.toBeDisabled();
    });

    it('expands every ancestor, lazy-fetching the levels not yet cached', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        expect(storedExpanded().sort()).toEqual(['a', 'a/b', 'a/b/c']);
        // `a` and `a/b` were seeded by the depth-2 mount listing; only `a/b/c` is fetched.
        expect(treeSpy).toHaveBeenCalledTimes(1);
        expect(treeSpy).toHaveBeenCalledWith(WS, { path: 'a/b/c' });
        expect(screen.getByTestId(`tree-node-${DEEP}`)).toBeInTheDocument();
    });

    it('selects the revealed file so its row is highlighted', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        expect(storedSelected()).toBe(DEEP);
    });

    it('centres the revealed row in the file-tree-scroll container', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });
        const container = screen.getByTestId('file-tree-scroll');
        Object.defineProperty(container, 'clientHeight', { value: 200, configurable: true });
        Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            const top = this.getAttribute('data-testid') === `tree-node-${DEEP}` ? 500 : 0;
            const height = top === 500 ? 20 : 200;
            return { top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
        });

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        // rowOffset 500 + half of 20 − half of 200 = 410, inside [0, 800].
        expect(container.scrollTop).toBe(410);
    });

    it('does nothing for a root-level file beyond selecting and centring it', async () => {
        await mount({ preview: { path: 'top.ts', name: 'top.ts' } });

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        expect(treeSpy).not.toHaveBeenCalled();
        expect(storedExpanded()).toEqual([]);
        expect(storedSelected()).toBe('top.ts');
    });

    it('expands as far as it got and reports a failed level in the error banner', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });
        treeSpy.mockRejectedValue(new Error('boom'));

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        expect(storedExpanded().sort()).toEqual(['a', 'a/b']);
        expect(screen.getByTestId('explorer-error')).toHaveTextContent('boom');
        // The tree survives the failure: the deepest reachable row is still there.
        expect(screen.getByTestId('tree-node-a/b/c')).toBeInTheDocument();
        expect(screen.queryByTestId(`tree-node-${DEEP}`)).not.toBeInTheDocument();
    });

    it('never routes through explorerApi.reveal, which reveals in the OS file manager', async () => {
        await mount({ preview: { path: DEEP, name: 'deep.ts' } });

        await act(async () => { screen.getByTestId('explorer-reveal-file-btn').click(); });

        expect(revealSpy).not.toHaveBeenCalled();
    });
});

describe('computeCenterScrollTop', () => {
    it('puts the row middle at the viewport middle', () => {
        expect(computeCenterScrollTop(500, 20, 200, 800)).toBe(410);
    });

    it('clamps a row near the top to zero', () => {
        expect(computeCenterScrollTop(10, 20, 200, 800)).toBe(0);
    });

    it('clamps a row near the bottom to the maximum scroll offset', () => {
        expect(computeCenterScrollTop(990, 20, 200, 800)).toBe(800);
    });

    it('returns zero when the content is not scrollable', () => {
        expect(computeCenterScrollTop(0, 20, 200, -50)).toBe(0);
    });
});
