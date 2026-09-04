// @vitest-environment jsdom
/**
 * AC-06 (mobile): with tabs on, a narrow layout still shows the tab strip above
 * the editor, opening a file moves from the tree to the editor, and the "Files"
 * back action returns to the tree WITHOUT closing anything — the tab set and the
 * active tab survive the round trip.
 *
 * `useBreakpoint` reads `window.matchMedia`, which jsdom does not implement, so
 * the mobile viewport is faked by stubbing it here.
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
    PreviewPane: ({ filePath, onClose }: { filePath: string; onClose?: () => void }) => (
        <div data-testid={`mock-preview-${filePath}`} data-has-close={onClose ? 'true' : undefined} />
    ),
}));

import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import { clearExplorerSearchBuffers } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { clearExplorerDirty } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import { applyRuntimeConfigPatch } from '../../../../../src/server/spa/client/react/utils/config';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const ROOT_ENTRIES: TreeEntry[] = [
    { name: 'a.ts', type: 'file', path: 'a.ts' },
    { name: 'b.ts', type: 'file', path: 'b.ts' },
];

/** Report the mobile breakpoint (max-width: 767px) as matching. */
function useMobileViewport() {
    window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width: 767px'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

/**
 * The open tabs, in strip order. A DOM query rather than `getAllByRole('tab')`,
 * because the strip lives inside the editor area — which mobile hides with
 * `display:none`, taking it out of the accessibility tree role queries see.
 */
function openTabIds(): string[] {
    return [...document.querySelectorAll('[data-testid="explorer-tab-list"] [data-tab-id]')]
        .map(node => node.getAttribute('data-tab-id') ?? '');
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    useMobileViewport();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — editor tabs on a mobile layout (AC-06)', () => {
    it('moves from the tree to the tabbed editor when a file is opened', async () => {
        render(<ExplorerPanel workspaceId="ws-mobile" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        // Nothing open: the tree owns the screen and the editor area is hidden.
        expect(screen.getByTestId('explorer-sidebar')).not.toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('explorer-preview-pane')).toHaveStyle({ display: 'none' });

        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-sidebar')).toHaveStyle({ display: 'none' }));
        expect(screen.getByTestId('explorer-preview-pane')).not.toHaveStyle({ display: 'none' });
        // The strip sits above the buffer, so no editor content is covered.
        expect(screen.getByTestId('explorer-tab-list')).toBeInTheDocument();
        expect(openTabIds()).toEqual(['file:a.ts']);
    });

    it('keeps every tab open when Files goes back to the tree, and returns to the same active tab', async () => {
        render(<ExplorerPanel workspaceId="ws-mobile" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
        expect(screen.getByTestId('explorer-tab-file:b.ts')).toHaveAttribute('aria-selected', 'true');

        fireEvent.click(screen.getByTestId('explorer-mobile-back-btn'));
        await waitFor(() => expect(screen.getByTestId('explorer-preview-pane')).toHaveStyle({ display: 'none' }));
        expect(screen.getByTestId('explorer-sidebar')).not.toHaveStyle({ display: 'none' });
        // Back is not a close: both tabs are still there, with the same active one.
        expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']);
        expect(screen.getByTestId('explorer-tab-file:b.ts')).toHaveAttribute('aria-selected', 'true');

        // Re-opening the tree file returns to the editor on the same tab.
        fireEvent.click(screen.getByTestId('tree-node-b.ts'));
        await waitFor(() => expect(screen.getByTestId('explorer-sidebar')).toHaveStyle({ display: 'none' }));
        expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']);
        expect(screen.getByTestId('explorer-tab-file:b.ts')).toHaveAttribute('aria-selected', 'true');
    });

    it('leaves the buffer without its own close control, so closing goes through the strip', async () => {
        render(<ExplorerPanel workspaceId="ws-mobile" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument());

        expect(screen.getByTestId('mock-preview-a.ts')).not.toHaveAttribute('data-has-close');
        fireEvent.click(screen.getByTestId('explorer-tab-close-file:a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual([]));
    });
});
