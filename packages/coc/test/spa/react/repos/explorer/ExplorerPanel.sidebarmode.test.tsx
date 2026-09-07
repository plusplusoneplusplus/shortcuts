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
import * as fs from 'fs';
import * as path from 'path';
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
    // jsdom has no layout, so the tree's focus-follow scroll needs a stub.
    Element.prototype.scrollIntoView = vi.fn();
    treeSpy.mockResolvedValue({ entries: ROOT });
});

/** Render a panel and wait for the root listing to land. */
async function renderPanel(props: Parameters<typeof ExplorerPanel>[0]) {
    const view = render(<ExplorerPanel {...props} />);
    await waitFor(() => expect(screen.getByTestId('tree-node-readme.md')).toBeTruthy());
    return view;
}

describe('ExplorerPanel — mode is stated, never inferred', () => {
    const SOURCE = fs.readFileSync(
        path.join(
            __dirname, '..', '..', '..', '..', '..', 'src', 'server', 'spa', 'client',
            'react', 'features', 'repo-detail', 'explorer', 'ExplorerPanel.tsx',
        ),
        'utf-8',
    );

    it('declares mode as a required prop', () => {
        expect(SOURCE).toContain('mode: ExplorerPanelMode;');
        expect(SOURCE).not.toContain('mode?: ExplorerPanelMode');
    });

    it('keeps no fallback that reads the mode off onOpenFile', () => {
        expect(SOURCE).not.toContain('resolveExplorerMode');
        expect(SOURCE).not.toContain("onOpenFile !== undefined");
    });
});

describe('ExplorerPanel — editor mode (the Explorer sub-tab)', () => {
    it('renders the editor area, its resize handle and the breadcrumb row', async () => {
        await renderPanel({ workspaceId: WS, mode: 'editor' });
        expect(screen.getByTestId('explorer-preview-pane')).toBeTruthy();
        expect(screen.getByTestId('explorer-resize-handle')).toBeTruthy();
        expect(screen.getByTestId('explorer-breadcrumbs')).toBeTruthy();
        expect(screen.getByTestId('explorer-sidebar').getAttribute('data-explorer-mode')).toBe('editor');
    });
});

describe('ExplorerPanel — navigator mode', () => {
    it('drops the editor area and its resize handle but keeps the breadcrumb row', async () => {
        await renderPanel({ workspaceId: WS, mode: 'navigator', onOpenFile: vi.fn() });
        expect(screen.queryByTestId('explorer-preview-pane')).toBeNull();
        expect(screen.queryByTestId('explorer-resize-handle')).toBeNull();
        expect(screen.getByTestId('explorer-breadcrumbs')).toBeTruthy();
        expect(screen.getByTestId('explorer-sidebar').getAttribute('data-explorer-mode')).toBe('navigator');
    });

    it('drops the editor with no onOpenFile at all, on the mode alone', async () => {
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

/**
 * AC-04's tree half: the gestures that ask the host for a permanent tab rather
 * than the replaceable preview slot. The panel does not know what a preview is
 * — it only reports `preview: false`, and the host promotes.
 */
describe('ExplorerPanel — permanent-open gestures (AC-04)', () => {
    it('hands a double click to the host as a permanent open', async () => {
        const onOpenFile = vi.fn();
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile });

        // What a browser actually sends: click, click, dblclick. The two clicks
        // ask for the same preview twice, which the host treats as a focus.
        const row = screen.getByTestId('tree-node-readme.md');
        fireEvent.click(row);
        fireEvent.click(row);
        fireEvent.doubleClick(row);

        expect(onOpenFile).toHaveBeenCalledTimes(3);
        expect(onOpenFile.mock.calls.map(([, options]) => options.preview)).toEqual([true, true, false]);
        expect(onOpenFile).toHaveBeenLastCalledWith(
            expect.objectContaining({ path: 'readme.md' }),
            expect.objectContaining({ preview: false }),
        );
    });

    it('offers a permanent open in the file context menu, above the preview one', async () => {
        const onOpenFile = vi.fn();
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile });

        fireEvent.contextMenu(screen.getByTestId('tree-node-readme.md'));
        const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
        const labels = items.map(node => (node.textContent ?? '').trim());
        const permanent = labels.findIndex(label => /Open$/.test(label));
        const previewItem = labels.findIndex(label => label.includes('Open Preview'));
        expect(permanent).toBeGreaterThanOrEqual(0);
        expect(previewItem).toBeGreaterThan(permanent);

        fireEvent.click(items[permanent]);
        expect(onOpenFile).toHaveBeenCalledWith(
            expect.objectContaining({ path: 'readme.md' }),
            expect.objectContaining({ preview: false }),
        );
    });

    it('opens permanently on Ctrl/Cmd+Enter and previews on plain Enter', async () => {
        const onOpenFile = vi.fn();
        await renderPanel({ workspaceId: WS, mode: 'sidebar', onOpenFile });
        const tree = screen.getByTestId('file-tree-scroll');

        // Focus the first row, then walk down to the file.
        fireEvent.keyDown(tree, { key: 'ArrowDown' });
        fireEvent.keyDown(tree, { key: 'ArrowDown' });
        fireEvent.keyDown(tree, { key: 'Enter' });
        expect(onOpenFile).toHaveBeenLastCalledWith(
            expect.objectContaining({ path: 'readme.md' }),
            expect.objectContaining({ preview: true }),
        );

        fireEvent.keyDown(tree, { key: 'Enter', ctrlKey: true });
        expect(onOpenFile).toHaveBeenLastCalledWith(
            expect.objectContaining({ path: 'readme.md' }),
            expect.objectContaining({ preview: false }),
        );

        fireEvent.keyDown(tree, { key: 'Enter', metaKey: true });
        expect(onOpenFile).toHaveBeenLastCalledWith(
            expect.objectContaining({ path: 'readme.md' }),
            expect.objectContaining({ preview: false }),
        );
    });
});
