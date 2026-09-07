// @vitest-environment jsdom
/**
 * explorer-sidebar-preview-tabs AC-01b — ExplorerPanel's `mode` prop.
 *
 * `editor` renders the whole panel; `navigator` drops the editor area, its
 * resize handle and its tab strip; `sidebar` drops the internal breadcrumb row
 * on top of that, because the unified right panel renders one breadcrumb row
 * above the whole panel instead.
 *
 * Regression guard: the mode is taken from the explicit prop, NOT inferred from
 * `onOpenFile`. The two host modes are indistinguishable by callback shape, so
 * inference cannot tell them apart.
 *
 * PreviewPane is mocked out so Monaco never enters the module graph.
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

import {
    ExplorerPanel,
    resolveExplorerMode,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import type { TreeEntry } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/types';

const WS = 'ws-sidebar-mode';

const ROOT: TreeEntry[] = [
    {
        name: 'src',
        type: 'dir',
        path: 'src',
        children: [{ name: 'app.ts', type: 'file', path: 'src/app.ts' }],
    },
    { name: 'readme.md', type: 'file', path: 'readme.md' },
];

beforeEach(() => {
    vi.clearAllMocks();
    clearExplorerTreeCache();
    localStorage.clear();
    location.hash = '';
    treeSpy.mockResolvedValue({ entries: ROOT });
});

/** Render a panel and wait for the root listing to land. */
async function renderPanel(props: Parameters<typeof ExplorerPanel>[0]) {
    const view = render(<ExplorerPanel {...props} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy());
    return view;
}

describe('resolveExplorerMode', () => {
    it('defaults to editor with no callback and no explicit mode', () => {
        expect(resolveExplorerMode(undefined, false)).toBe('editor');
    });

    it('keeps inferring navigator from onOpenFile so existing callers are unchanged', () => {
        expect(resolveExplorerMode(undefined, true)).toBe('navigator');
    });

    it('lets an explicit mode win over the inference in both directions', () => {
        expect(resolveExplorerMode('sidebar', true)).toBe('sidebar');
        expect(resolveExplorerMode('editor', true)).toBe('editor');
        expect(resolveExplorerMode('navigator', false)).toBe('navigator');
    });
});

describe('ExplorerPanel — editor mode (the Explorer sub-tab)', () => {
    it('renders the editor area, its resize handle and the breadcrumb row', async () => {
        await renderPanel({ workspaceId: WS });
        expect(screen.getByTestId('explorer-preview-pane')).toBeTruthy();
        expect(screen.getByTestId('explorer-resize-handle')).toBeTruthy();
        expect(screen.getByTestId('explorer-breadcrumbs')).toBeTruthy();
        expect(screen.getByTestId('explorer-sidebar').getAttribute('data-explorer-mode')).toBe('editor');
    });
});

describe('ExplorerPanel — navigator mode', () => {
    it('drops the editor area and its resize handle but keeps the breadcrumb row', async () => {
        await renderPanel({ workspaceId: WS, onOpenFile: vi.fn() });
        expect(screen.queryByTestId('explorer-preview-pane')).toBeNull();
        expect(screen.queryByTestId('explorer-resize-handle')).toBeNull();
        expect(screen.getByTestId('explorer-breadcrumbs')).toBeTruthy();
        expect(screen.getByTestId('explorer-sidebar').getAttribute('data-explorer-mode')).toBe('navigator');
    });

    it('drops the editor even when stated explicitly with no onOpenFile', async () => {
        await renderPanel({ workspaceId: WS, mode: 'navigator' });
        expect(screen.queryByTestId('explorer-preview-pane')).toBeNull();
    });
});

describe('ExplorerPanel — sidebar mode (the unified panel tree column)', () => {
    it('renders the tree with no editor area, no resize handle and no breadcrumb row', async () => {
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile: vi.fn() });
        expect(screen.getByTestId('tree-node-src')).toBeTruthy();
        expect(screen.queryByTestId('explorer-preview-pane')).toBeNull();
        expect(screen.queryByTestId('explorer-resize-handle')).toBeNull();
        expect(screen.queryByTestId('explorer-breadcrumbs')).toBeNull();
        expect(screen.getByTestId('explorer-sidebar').getAttribute('data-explorer-mode')).toBe('sidebar');
    });

    it('is a labelled complementary region so the column has a name of its own', async () => {
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile: vi.fn() });
        expect(screen.getByRole('complementary', { name: 'File tree' })).toBeTruthy();
    });

    it('keeps the tree affordances that are not tab-related', async () => {
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile: vi.fn() });
        expect(screen.getByTestId('explorer-collapse-all-btn')).toBeTruthy();
        expect(screen.getByTestId('explorer-reveal-file-btn')).toBeTruthy();
        expect(screen.getByTestId('explorer-refresh-btn')).toBeTruthy();
        expect(screen.getByTestId('explorer-view-search')).toBeTruthy();
    });

    it('hands a single file click to the host as a preview open', async () => {
        const onOpenFile = vi.fn();
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile });
        fireEvent.click(screen.getByTestId('tree-node-readme.md'));
        expect(onOpenFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'readme.md', name: 'readme.md' }),
            expect.objectContaining({ preview: true }),
        );
    });

    it('expands a folder in place on click — no re-rooting and no file open', async () => {
        const onOpenFile = vi.fn();
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile });

        fireEvent.click(screen.getByTestId('tree-node-src'));
        await waitFor(() => expect(screen.getByTestId('tree-node-src/app.ts')).toBeTruthy());
        // Re-rooting would drop the sibling; the root listing is still whole.
        expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy();
        expect(onOpenFile).not.toHaveBeenCalled();

        fireEvent.click(screen.getByTestId('tree-node-src'));
        await waitFor(() => expect(screen.queryByTestId('tree-node-src/app.ts')).toBeNull());
        expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy();
        expect(onOpenFile).not.toHaveBeenCalled();
    });
});
