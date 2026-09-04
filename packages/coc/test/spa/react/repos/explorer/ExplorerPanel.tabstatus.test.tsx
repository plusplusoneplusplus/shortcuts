// @vitest-environment jsdom
/**
 * AC-05 / AC-06: what the tab strip shows about a buffer the user is NOT looking
 * at — its loading and error state — plus the duplicate-filename labels and
 * full-path tooltips the panel derives from the open tab set.
 *
 * PreviewPane is mocked to a stub that lets the test drive `onStatusChange`
 * directly, so the strip's reaction is tested without Monaco or the blob API.
 * PreviewPane's own reporting is covered by PreviewPane.status.test.tsx.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const treeSpy = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        tree: (...args: unknown[]) => treeSpy(...args),
        searchFiles: vi.fn().mockResolvedValue({ results: [] }),
        reveal: vi.fn(),
    },
}));

vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath, onStatusChange }: {
        filePath: string;
        onStatusChange?: (status: 'loading' | 'error' | 'ready') => void;
    }) => (
        <div data-testid={`mock-preview-${filePath}`}>
            <button data-testid={`status-loading-${filePath}`} onClick={() => onStatusChange?.('loading')}>loading</button>
            <button data-testid={`status-error-${filePath}`} onClick={() => onStatusChange?.('error')}>error</button>
            <button data-testid={`status-ready-${filePath}`} onClick={() => onStatusChange?.('ready')}>ready</button>
        </div>
    ),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerSearchBuffers } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'src', type: 'dir', path: 'src' },
    { name: 'lib', type: 'dir', path: 'lib' },
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'b.ts', type: 'file', path: 'b.ts' },
];
const SRC_ENTRIES: TreeEntry[] = [{ name: 'index.ts', type: 'file', path: 'src/index.ts' }];
const LIB_ENTRIES: TreeEntry[] = [{ name: 'index.ts', type: 'file', path: 'lib/index.ts' }];

async function renderPanel(wsId = 'ws-status') {
    render(<ExplorerPanel workspaceId={wsId} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockImplementation((_ws: string, options: { path: string }) => {
        if (options.path === 'src') return Promise.resolve({ entries: SRC_ENTRIES });
        if (options.path === 'lib') return Promise.resolve({ entries: LIB_ENTRIES });
        return Promise.resolve({ entries: ROOT_ENTRIES });
    });
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — per-tab loading and error state in the strip', () => {
    it('marks a loading buffer busy and clears it when the buffer settles', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('status-loading-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('aria-busy', 'true'));
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveTextContent('(loading)');

        fireEvent.click(screen.getByTestId('status-ready-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).not.toHaveAttribute('aria-busy'));
    });

    it('shows the error marker on a failed buffer and keeps its tab open', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('status-error-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-error-file:a.ts')).toBeInTheDocument());
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveTextContent('(failed to load)');
        expect(screen.getByTestId('explorer-tab-file:a.ts')).not.toHaveAttribute('aria-busy');

        // A retry that succeeds drops the marker without touching the tab set.
        fireEvent.click(screen.getByTestId('status-ready-a.ts'));
        await waitFor(() => expect(screen.queryByTestId('explorer-tab-error-file:a.ts')).not.toBeInTheDocument());
        expect(screen.getByTestId('explorer-tab-file:a.ts')).toBeInTheDocument();
    });

    it('keeps each tab’s loading and error state to itself', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:b.ts')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('status-loading-a.ts'));
        fireEvent.click(screen.getByTestId('status-error-b.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toHaveAttribute('aria-busy', 'true'));

        expect(screen.getByTestId('explorer-tab-file:b.ts')).not.toHaveAttribute('aria-busy');
        expect(screen.getByTestId('explorer-tab-error-file:b.ts')).toBeInTheDocument();
        expect(screen.queryByTestId('explorer-tab-error-file:a.ts')).not.toBeInTheDocument();
    });

    it('drops the flags when the tab closes, so a reopened file starts clean', async () => {
        await renderPanel();
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('status-error-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-error-file:a.ts')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(screen.queryByTestId('explorer-tab-file:a.ts')).not.toBeInTheDocument());

        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:a.ts')).toBeInTheDocument());
        expect(screen.queryByTestId('explorer-tab-error-file:a.ts')).not.toBeInTheDocument();
    });
});

describe('ExplorerPanel — tab labels for colliding filenames', () => {
    it('widens colliding labels to the shortest distinguishing path and always tooltips the full path', async () => {
        await renderPanel();
        fireEvent.click(screen.getByTestId('tree-node-src'));
        await waitFor(() => expect(screen.getByTestId('tree-node-src/index.ts')).toBeInTheDocument());
        fireEvent.doubleClick(screen.getByTestId('tree-node-src/index.ts'));
        fireEvent.click(screen.getByTestId('tree-node-lib'));
        await waitFor(() => expect(screen.getByTestId('tree-node-lib/index.ts')).toBeInTheDocument());
        fireEvent.doubleClick(screen.getByTestId('tree-node-lib/index.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-file:lib/index.ts')).toBeInTheDocument());

        expect(screen.getByTestId('explorer-tab-label-file:src/index.ts')).toHaveTextContent('src/index.ts');
        expect(screen.getByTestId('explorer-tab-label-file:lib/index.ts')).toHaveTextContent('lib/index.ts');
        expect(screen.getByTestId('explorer-tab-file:src/index.ts')).toHaveAttribute('title', 'src/index.ts');

        // A file whose name is unique keeps the bare filename, tooltip still full.
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-tab-label-file:a.ts')).toHaveTextContent('a.ts'));
    });
});
