// @vitest-environment jsdom
/**
 * explorer-sidebar-preview-tabs AC-06 — the tree column following its host's
 * active file.
 *
 * `activeFilePath` is a tri-state and each value is a different promise to the
 * user: a path means "reveal this" (expand every ancestor, lazy-loading the
 * levels that are not cached, and select the row), `null` means "the host has a
 * file open that is not in this tree" (drop the highlight, touch nothing else),
 * and omitting it means "not tracking" — a terminal or canvas tab must leave
 * the tree exactly as the user left it.
 *
 * Two guarantees are load-bearing and easy to lose: an auto-expansion never
 * collapses a folder the user opened by hand, and a failed lazy load along the
 * path leaves the tree usable and un-highlighted rather than erroring the whole
 * panel — this reveal runs in the background, not because the user asked.
 *
 * The selection is asserted through `explorerStateStore`'s own localStorage
 * entry, which is the store the tree renders its highlight from, rather than
 * through the row's accent classes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const treeSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: vi.fn(),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => null,
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import {
    explorerExpandedStorageKey,
    explorerSelectedStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-active-file';
const OTHER_WS = 'ws-active-file-other';

/**
 * Root listing with no nested children, so revealing `src/lib/util.ts` has to
 * lazy-load `src` and then `src/lib` — the path the spec calls out.
 */
const ROOT: TreeEntry[] = [
    { name: 'src', type: 'dir', path: 'src' },
    { name: 'docs', type: 'dir', path: 'docs' },
    { name: 'readme.md', type: 'file', path: 'readme.md' },
];

const SRC: TreeEntry[] = [
    { name: 'lib', type: 'dir', path: 'src/lib' },
    { name: 'app.ts', type: 'file', path: 'src/app.ts' },
];

const SRC_LIB: TreeEntry[] = [{ name: 'util.ts', type: 'file', path: 'src/lib/util.ts' }];

const DOCS: TreeEntry[] = [{ name: 'guide.md', type: 'file', path: 'docs/guide.md' }];

const LISTINGS: Record<string, TreeEntry[]> = {
    '/': ROOT,
    src: SRC,
    'src/lib': SRC_LIB,
    docs: DOCS,
};

/** The stub server: the listing for a directory, root when the path is absent or `/`. */
function listingFor(path?: string): TreeEntry[] {
    const key = !path || path === '/' ? '/' : path;
    const entries = LISTINGS[key];
    if (!entries) throw new Error(`no listing for ${path}`);
    return entries;
}

beforeEach(() => {
    vi.clearAllMocks();
    clearExplorerTreeCache();
    localStorage.clear();
    location.hash = '';
    Element.prototype.scrollIntoView = vi.fn();
    treeSpy.mockImplementation(async (_ws: string, options?: { path?: string }) => {
        return { entries: listingFor(options?.path) };
    });
});

/** The tree's persisted expansion for a workspace, straight from the store. */
function expandedPaths(workspaceId = WS): string[] {
    const raw = localStorage.getItem(explorerExpandedStorageKey(workspaceId));
    return raw === null ? [] : (JSON.parse(raw) as string[]);
}

/** The tree's persisted selection — what the highlight renders from. */
function selectedPath(workspaceId = WS): unknown {
    const raw = localStorage.getItem(explorerSelectedStorageKey(workspaceId));
    return raw === null ? null : JSON.parse(raw);
}

async function renderColumn(props: Partial<Parameters<typeof ExplorerPanel>[0]> = {}) {
    const view = render(
        <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} {...props} />,
    );
    await waitFor(() => expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy());
    return view;
}

describe('ExplorerPanel — tracking the host active file (AC-06)', () => {
    it('expands every ancestor, lazy-loading them, and highlights the file', async () => {
        await renderColumn({ activeFilePath: 'src/lib/util.ts' });

        await waitFor(() => expect(screen.getByTestId('tree-node-src/lib/util.ts')).toBeTruthy());
        expect(expandedPaths().sort()).toEqual(['src', 'src/lib']);
        expect(selectedPath()).toBe('src/lib/util.ts');
        // Both uncached levels were fetched, root aside.
        const fetched = treeSpy.mock.calls.map(([, options]) => options?.path);
        expect(fetched).toContain('src');
        expect(fetched).toContain('src/lib');
    });

    it('follows the host from one file to another', async () => {
        const { rerender } = await renderColumn({ activeFilePath: 'src/app.ts' });
        await waitFor(() => expect(selectedPath()).toBe('src/app.ts'));

        rerender(
            <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath="docs/guide.md" />,
        );
        await waitFor(() => expect(selectedPath()).toBe('docs/guide.md'));
        // The first file's folder is still open: revealing is additive.
        expect(expandedPaths().sort()).toEqual(['docs', 'src']);
    });

    it('leaves a folder the user expanded by hand open', async () => {
        const { rerender } = await renderColumn({});

        fireEvent.click(screen.getByTestId('tree-node-docs'));
        await waitFor(() => expect(expandedPaths()).toContain('docs'));

        rerender(
            <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath="src/app.ts" />,
        );
        await waitFor(() => expect(selectedPath()).toBe('src/app.ts'));
        expect(expandedPaths()).toContain('docs');
    });

    it('clears the highlight for a null path without collapsing anything', async () => {
        const { rerender } = await renderColumn({ activeFilePath: 'src/app.ts' });
        await waitFor(() => expect(selectedPath()).toBe('src/app.ts'));

        rerender(
            <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath={null} />,
        );
        await waitFor(() => expect(selectedPath()).toBeNull());
        expect(expandedPaths()).toContain('src');
    });

    it('leaves the selection alone when the host stops tracking', async () => {
        const { rerender } = await renderColumn({ activeFilePath: 'src/app.ts' });
        await waitFor(() => expect(selectedPath()).toBe('src/app.ts'));

        // A terminal/canvas/note/diff tab: not `null`, absent.
        rerender(<ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} />);
        expect(selectedPath()).toBe('src/app.ts');
        expect(expandedPaths()).toContain('src');
    });

    it('does not re-reveal on an unrelated re-render, so a manual collapse sticks', async () => {
        const { rerender } = await renderColumn({ activeFilePath: 'src/app.ts' });
        await waitFor(() => expect(screen.getByTestId('tree-node-src/app.ts')).toBeTruthy());

        fireEvent.click(screen.getByTestId('tree-node-src'));
        await waitFor(() => expect(screen.queryByTestId('tree-node-src/app.ts')).toBeNull());

        rerender(
            <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath="src/app.ts" deepLink />,
        );
        // Same path, so nothing re-expands underneath the user.
        expect(screen.queryByTestId('tree-node-src/app.ts')).toBeNull();
    });

    it('re-reveals the same path after the column is retargeted to another repo', async () => {
        const { rerender } = await renderColumn({ activeFilePath: 'src/app.ts' });
        await waitFor(() => expect(selectedPath(WS)).toBe('src/app.ts'));

        // The dock's repo picker moved the column; the same path there is a
        // different row, so the new workspace gets its own reveal.
        rerender(
            <ExplorerPanel workspaceId={OTHER_WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath="src/app.ts" />,
        );
        await waitFor(() => expect(selectedPath(OTHER_WS)).toBe('src/app.ts'));
        expect(expandedPaths(OTHER_WS)).toContain('src');
    });

    it('stays usable and un-highlighted when a level of the path fails to load', async () => {
        treeSpy.mockImplementation(async (_ws: string, options?: { path?: string }) => {
            if (options?.path === 'src') throw new Error('boom');
            return { entries: listingFor(options?.path) };
        });

        const { rerender } = await renderColumn({});
        fireEvent.click(screen.getByTestId('tree-node-docs'));
        await waitFor(() => expect(screen.getByTestId('tree-node-docs/guide.md')).toBeTruthy());

        rerender(
            <ExplorerPanel workspaceId={WS} mode="sidebar" onOpenFile={vi.fn()} activeFilePath="src/lib/util.ts" />,
        );
        await waitFor(() => expect(treeSpy.mock.calls.some(([, o]) => o?.path === 'src')).toBe(true));

        // The tree is still the tree: no panel-wide error, the rest of it renders,
        // and nothing got highlighted for a row that could not be reached.
        expect(screen.queryByTestId('explorer-error')).toBeNull();
        expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy();
        expect(screen.getByTestId('tree-node-docs/guide.md')).toBeTruthy();
        // The unreachable row is not highlighted, and the selection the user
        // made stays where it was rather than being cleared out from under them.
        expect(selectedPath()).not.toBe('src/lib/util.ts');
        expect(selectedPath()).toBe('docs');
    });
});
