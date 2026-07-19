// @vitest-environment jsdom
/**
 * AC-02 of preserve-explorer-state (fetch-spy end-to-end): the fetched tree-data
 * cache is preserved in-memory per workspace, so returning to a workspace does not
 * re-issue the root tree-listing request. Verified by spying on `explorerApi.tree`
 * across a `key={ws.id}`-style remount (unmount + re-render).
 *
 * PreviewPane is mocked to a stub so this test never pulls Monaco into the module
 * graph — it does not render a preview file anyway.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const treeSpy = vi.fn();
const searchSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: (...args: unknown[]) => searchSpy(...args),
        reveal: vi.fn(),
    },
}));

// Keep Monaco out of the import graph — the panel opens no preview here.
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: () => null,
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'src', type: 'dir', path: 'src', children: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }] },
    { name: 'README.md', type: 'file', path: 'README.md' },
];

beforeEach(() => {
    localStorage.clear();
    clearExplorerTreeCache();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
});

describe('ExplorerPanel — in-memory tree cache (AC-02)', () => {
    it('fetches the root listing once on first mount', async () => {
        render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('explorer-panel')).toBeInTheDocument());
        expect(treeSpy).toHaveBeenCalledTimes(1);
        expect(treeSpy).toHaveBeenCalledWith('ws-1', { path: '/', depth: 2 });
    });

    it('does not re-fetch the root listing when switching back to a workspace', async () => {
        const first = render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('explorer-panel')).toBeInTheDocument());
        expect(treeSpy).toHaveBeenCalledTimes(1);

        // Switch away — the `key={ws.id}` remount unmounts the panel entirely.
        first.unmount();

        // Switch back to the same workspace: the cached root renders immediately
        // (no loading spinner) and no new tree-listing request is issued.
        render(<ExplorerPanel workspaceId="ws-1" />);
        expect(screen.getByTestId('explorer-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('explorer-loading')).not.toBeInTheDocument();
        expect(treeSpy).toHaveBeenCalledTimes(1);
    });

    it('fetches independently for a different workspace', async () => {
        const first = render(<ExplorerPanel workspaceId="ws-1" />);
        await waitFor(() => expect(screen.getByTestId('explorer-panel')).toBeInTheDocument());
        expect(treeSpy).toHaveBeenCalledTimes(1);
        first.unmount();

        render(<ExplorerPanel workspaceId="ws-2" />);
        await waitFor(() => expect(treeSpy).toHaveBeenCalledWith('ws-2', { path: '/', depth: 2 }));
        expect(treeSpy).toHaveBeenCalledTimes(2);
    });
});
