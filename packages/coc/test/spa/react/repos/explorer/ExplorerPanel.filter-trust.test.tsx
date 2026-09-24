// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

const results = (paths: string[]) => ({ results: paths.map(path => ({ path, score: 1 })) });

beforeEach(() => {
    localStorage.clear();
    clearExplorerTreeCache();
    treeSpy.mockReset().mockResolvedValue({
        entries: [
            { name: 'src', type: 'dir', path: 'src' },
            { name: 'scripts', type: 'dir', path: 'scripts' },
        ],
    });
    searchSpy.mockReset();
});

async function searchFor(query: string): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('tree-node-src')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('explorer-search-input'), { target: { value: query } });
    await waitFor(() => expect(searchSpy).toHaveBeenCalledWith('ws-filter', query, { limit: 100 }, undefined));
}

describe('ExplorerPanel file-filter trust', () => {
    it('keeps unfetched directories during search and hides them after a clean response', async () => {
        let finishSearch!: (data: ReturnType<typeof results>) => void;
        searchSpy.mockImplementation(() => new Promise(resolve => { finishSearch = resolve; }));
        render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
        await searchFor('storage.rs');

        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
        expect(screen.getByTestId('tree-node-scripts')).toBeInTheDocument();
        finishSearch(results([]));
        await waitFor(() => expect(screen.queryByTestId('tree-node-src')).not.toBeInTheDocument());
        expect(screen.queryByTestId('tree-node-scripts')).not.toBeInTheDocument();
    });

    it('keeps unfetched directories when search fails', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            searchSpy.mockRejectedValue(new Error('search unavailable'));
            render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
            await searchFor('storage.rs');
            await waitFor(() => expect(log).toHaveBeenCalled());
            expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
            expect(screen.getByTestId('tree-node-scripts')).toBeInTheDocument();
        } finally {
            log.mockRestore();
        }
    });

    it('keeps unfetched directories when results reach the 100-hit cap', async () => {
        searchSpy.mockResolvedValue(results(Array(100).fill('other.rs')));
        render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
        await searchFor('storage.rs');
        await waitFor(() => expect(screen.queryByTestId('explorer-server-search-loading')).not.toBeInTheDocument());
        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
        expect(screen.getByTestId('tree-node-scripts')).toBeInTheDocument();
    });

    it('resets trust as soon as the query changes, before the next request starts', async () => {
        searchSpy.mockResolvedValueOnce(results([])).mockImplementation(() => new Promise(() => {}));
        render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
        await searchFor('storage.rs');
        await waitFor(() => expect(screen.queryByTestId('tree-node-src')).not.toBeInTheDocument());

        fireEvent.change(screen.getByTestId('explorer-search-input'), { target: { value: 'another.rs' } });
        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
        await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
    });

    it('ignores a successful response from an obsolete query', async () => {
        let finishOldSearch!: (data: ReturnType<typeof results>) => void;
        searchSpy.mockImplementationOnce(() => new Promise(resolve => { finishOldSearch = resolve; }))
            .mockImplementation(() => new Promise(() => {}));
        render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
        await searchFor('storage.rs');
        fireEvent.change(screen.getByTestId('explorer-search-input'), { target: { value: 'other.rs' } });
        await waitFor(() => expect(searchSpy).toHaveBeenCalledTimes(2));
        finishOldSearch(results([]));
        expect(screen.getByTestId('tree-node-src')).toBeInTheDocument();
    });

    it('keeps unfetched directories if an ancestor listing fails', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            treeSpy.mockImplementation((_ws: string, options: { path: string }) =>
                options.path === '/' ? Promise.resolve({
                    entries: [{ name: 'src', type: 'dir', path: 'src' }, { name: 'scripts', type: 'dir', path: 'scripts' }],
                }) : Promise.reject(new Error('ancestor unavailable')));
            searchSpy.mockResolvedValue(results(['src/storage.rs']));
            render(<ExplorerPanel workspaceId="ws-filter" mode="editor" />);
            await searchFor('storage.rs');
            await waitFor(() => expect(log).toHaveBeenCalled());
            expect(screen.getByTestId('tree-node-scripts')).toBeInTheDocument();
        } finally {
            log.mockRestore();
        }
    });
});
