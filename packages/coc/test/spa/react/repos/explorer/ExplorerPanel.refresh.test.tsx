// @vitest-environment jsdom
/**
 * explorer-refresh-preserves-expansion — Refresh re-fetches the root listing plus
 * every currently expanded directory and swaps the results in atomically, instead
 * of collapsing the tree back to the root.
 *
 *  AC-01 the open hierarchy survives a refresh, one request per expanded path
 *  AC-02 a directory that vanished from disk is pruned silently, with descendants
 *  AC-03 a failed refresh leaves the tree (and expansion) untouched, banner only
 *
 * PreviewPane is mocked out so Monaco never enters the module graph.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => null,
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { explorerExpandedStorageKey } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-refresh';

/** Depth-2 root listing: `src` and `src/lib` arrive pre-seeded, so no lazy loads. */
function rootEntries(extraLibFile?: string): TreeEntry[] {
    const libChildren: TreeEntry[] = [{ name: 'a.ts', type: 'file', path: 'src/lib/a.ts' }];
    if (extraLibFile) {
        libChildren.push({ name: extraLibFile, type: 'file', path: `src/lib/${extraLibFile}` });
    }
    return [
        {
            name: 'src',
            type: 'dir',
            path: 'src',
            children: [
                { name: 'lib', type: 'dir', path: 'src/lib', children: libChildren },
                { name: 'app.ts', type: 'file', path: 'src/app.ts' },
            ],
        },
        { name: 'docs', type: 'dir', path: 'docs', children: [{ name: 'readme.md', type: 'file', path: 'docs/readme.md' }] },
    ];
}

/**
 * Answers a tree request the way the server would: the root gets the depth-2
 * listing, a directory path gets just that directory's own children. Returning
 * the root listing for a child path would make `childrenMap` self-referential.
 */
function treeResponse(path: string, extraLibFile?: string): { entries: TreeEntry[] } {
    const root = rootEntries(extraLibFile);
    if (path === '/') return { entries: root };
    const found = (function find(entries: TreeEntry[]): TreeEntry | undefined {
        for (const e of entries) {
            if (e.path === path) return e;
            const nested = e.children && find(e.children);
            if (nested) return nested;
        }
        return undefined;
    })(root);
    return { entries: found?.children ?? [] };
}

function mockServerTree(extraLibFile?: string): void {
    treeSpy.mockImplementation((_ws: string, options: { path: string }) =>
        Promise.resolve(treeResponse(options.path, extraLibFile)));
}

/** A not-found rejection shaped like the CoC client's 404 `CocApiError`. */
function notFoundError(path: string): Error & { status: number } {
    return Object.assign(new Error(`Path not found: ${path} does not exist`), { status: 404 });
}

function storedExpanded(): string[] {
    return JSON.parse(localStorage.getItem(explorerExpandedStorageKey(WS)) ?? '[]');
}

/** Mount with `src` + `src/lib` already expanded and the mount fetch settled. */
async function mountExpanded(): Promise<void> {
    localStorage.setItem(explorerExpandedStorageKey(WS), JSON.stringify(['src', 'src/lib']));
    render(<ExplorerPanel workspaceId={WS} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument());
    treeSpy.mockClear();
}

function clickRefresh(): void {
    screen.getByTestId('explorer-refresh-btn').click();
}

beforeEach(() => {
    localStorage.clear();
    clearExplorerTreeCache();
    treeSpy.mockReset();
    mockServerTree();
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
});

describe('ExplorerPanel — Refresh preserves the open hierarchy (AC-01)', () => {
    it('keeps expandedPaths and the visible rows after a refresh', async () => {
        await mountExpanded();

        await act(async () => { clickRefresh(); });

        expect(storedExpanded().sort()).toEqual(['src', 'src/lib']);
        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
        expect(screen.getByTestId('tree-node-src/lib')).toBeInTheDocument();
        expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument();
    });

    it('issues one tree request for the root and one per expanded path', async () => {
        await mountExpanded();

        await act(async () => { clickRefresh(); });

        expect(treeSpy).toHaveBeenCalledTimes(3);
        expect(treeSpy).toHaveBeenCalledWith(WS, { path: '/', depth: 2 });
        expect(treeSpy).toHaveBeenCalledWith(WS, { path: 'src' });
        expect(treeSpy).toHaveBeenCalledWith(WS, { path: 'src/lib' });
    });

    it('never unmounts the tree or shows the panel spinner while refreshing', async () => {
        await mountExpanded();
        const pending: ((value: { entries: TreeEntry[] }) => void)[] = [];
        treeSpy.mockImplementation((_ws: string, options: { path: string }) =>
            new Promise(resolve => pending.push(() => resolve(treeResponse(options.path)))));

        await act(async () => { clickRefresh(); });

        expect(screen.queryByTestId('explorer-loading')).not.toBeInTheDocument();
        expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument();
        expect(screen.getByTestId('explorer-refresh-btn')).toBeDisabled();

        await act(async () => { pending.forEach(resolve => resolve()); });
        expect(screen.getByTestId('explorer-refresh-btn')).not.toBeDisabled();
    });

    it('surfaces a file created inside an open folder without collapsing it', async () => {
        await mountExpanded();
        mockServerTree('b.ts');

        await act(async () => { clickRefresh(); });

        expect(screen.getByTestId('tree-node-src/lib/b.ts')).toBeInTheDocument();
        expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument();
        expect(storedExpanded().sort()).toEqual(['src', 'src/lib']);
    });
});

describe('ExplorerPanel — Refresh prunes vanished directories (AC-02)', () => {
    it('removes a not-found expanded path and its descendants, keeping siblings', async () => {
        localStorage.setItem(
            explorerExpandedStorageKey(WS),
            JSON.stringify(['src', 'src/lib', 'src/lib/nested', 'docs']),
        );
        render(<ExplorerPanel workspaceId={WS} />);
        await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument());
        treeSpy.mockClear();

        treeSpy.mockImplementation((_ws: string, options: { path: string }) => {
            if (options.path === 'src/lib' || options.path === 'src/lib/nested') {
                return Promise.reject(notFoundError(options.path));
            }
            // `src` survives but no longer contains `lib`.
            if (options.path === 'src') {
                return Promise.resolve({ entries: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }] });
            }
            return Promise.resolve(treeResponse(options.path));
        });

        await act(async () => { clickRefresh(); });

        expect(storedExpanded().sort()).toEqual(['docs', 'src']);
        expect(screen.queryByTestId('explorer-error')).not.toBeInTheDocument();
        expect(screen.getByTestId('tree-node-docs')).toBeInTheDocument();
    });
});

describe('ExplorerPanel — a failed refresh never collapses the tree (AC-03)', () => {
    it('keeps rows and expansion when the root request fails, and shows the banner', async () => {
        await mountExpanded();
        treeSpy.mockRejectedValue(new Error('server unreachable'));

        await act(async () => { clickRefresh(); });

        expect(screen.getByTestId('explorer-error')).toHaveTextContent('server unreachable');
        expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument();
        expect(storedExpanded().sort()).toEqual(['src', 'src/lib']);

        // Still interactive: a retry succeeds and clears the banner.
        mockServerTree();
        await act(async () => { clickRefresh(); });
        expect(screen.queryByTestId('explorer-error')).not.toBeInTheDocument();
    });

    it('treats an indistinguishable child failure as transient — no swap, no pruning', async () => {
        await mountExpanded();
        treeSpy.mockImplementation((_ws: string, options: { path: string }) => {
            if (options.path === 'src/lib') return Promise.reject(new Error('read timed out'));
            return Promise.resolve(treeResponse(options.path));
        });

        await act(async () => { clickRefresh(); });

        expect(screen.getByTestId('explorer-error')).toHaveTextContent('read timed out');
        expect(storedExpanded().sort()).toEqual(['src', 'src/lib']);
        expect(screen.getByTestId('tree-node-src/lib/a.ts')).toBeInTheDocument();
    });
});
