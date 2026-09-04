// @vitest-environment jsdom
/**
 * AC-03 (keyboard): Ctrl+Tab / Ctrl+Shift+Tab MRU cycling and scoped Ctrl/Cmd+W
 * in ExplorerPanel, behind `features.explorerEditorTabs`.
 *
 * Two properties matter here beyond "the key does the thing":
 *  - a held Ctrl walks *further* down the MRU on every Tab instead of
 *    ping-ponging between the two most recent tabs, and releasing Ctrl starts
 *    the next walk from the freshly reordered list;
 *  - Ctrl/Cmd+W is a browser shortcut, so the Explorer only takes it while it
 *    owns the keyboard. Focus anywhere else on the dashboard leaves it alone.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

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
    PreviewPane: ({ filePath }: { filePath: string }) => (
        <div data-testid={`mock-preview-${filePath}`} />
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
    { name: 'c.ts', type: 'file', path: 'c.ts' },
];

function openTabIds(): string[] {
    return editorTabs().map(node => node.getAttribute('data-tab-id') ?? '');
}

/** The strip's own rows — the sidebar's Files/Search buttons are tabs too. */
function editorTabs(): HTMLElement[] {
    return screen.queryAllByRole('tab').filter(node => node.hasAttribute('data-tab-id'));
}

function activeTabId(): string | null {
    const active = editorTabs().find(node => node.getAttribute('aria-selected') === 'true');
    return active?.getAttribute('data-tab-id') ?? null;
}

/** Focus something inside the Explorer, as a real user's click would. */
function focusExplorer(): void {
    editorTabs().find(node => node.getAttribute('aria-selected') === 'true')?.focus();
}

function pressCtrlTab(opts: { shift?: boolean } = {}): void {
    fireEvent.keyDown(document, { key: 'Tab', ctrlKey: true, shiftKey: opts.shift ?? false });
}

function releaseCtrl(): void {
    fireEvent.keyUp(document, { key: 'Control' });
}

/** Open a.ts, b.ts, c.ts as pinned tabs — MRU ends up [c, b, a]. */
async function openThreeTabs(): Promise<void> {
    render(<ExplorerPanel workspaceId="ws-keys" />);
    await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
    fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
    fireEvent.doubleClick(screen.getByTestId('tree-node-b.ts'));
    fireEvent.doubleClick(screen.getByTestId('tree-node-c.ts'));
    await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts']));
    expect(activeTabId()).toBe('file:c.ts');
}

beforeEach(() => {
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
    clearExplorerDirty();
    clearExplorerSearchBuffers();
    treeSpy.mockReset();
    treeSpy.mockResolvedValue({ entries: ROOT_ENTRIES });
    searchSpy.mockReset();
    searchSpy.mockResolvedValue({ results: [] });
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
});

afterEach(() => {
    cleanup();
    applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
});

describe('ExplorerPanel — Ctrl+Tab MRU cycling', () => {
    it('activates the previously used tab on Ctrl+Tab', async () => {
        await openThreeTabs();
        focusExplorer();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:b.ts'));
    });

    it('walks further down the MRU while Ctrl stays held', async () => {
        await openThreeTabs();
        focusExplorer();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:b.ts'));
        // Still holding Ctrl: the second Tab reaches the third tab rather than
        // bouncing back to c.ts, even though activating b.ts reordered the MRU.
        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:a.ts'));
        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:c.ts'));
    });

    it('starts a new walk from the reordered MRU after Ctrl is released', async () => {
        await openThreeTabs();
        focusExplorer();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:b.ts'));
        releaseCtrl();

        // MRU is now [b, c, a]: a fresh Ctrl+Tab goes back to c.ts.
        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:c.ts'));
    });

    it('walks the other way with Ctrl+Shift+Tab', async () => {
        await openThreeTabs();
        focusExplorer();

        pressCtrlTab({ shift: true });
        await waitFor(() => expect(activeTabId()).toBe('file:a.ts'));
        pressCtrlTab({ shift: true });
        await waitFor(() => expect(activeTabId()).toBe('file:b.ts'));
    });

    it('ends the walk when the window loses focus with Ctrl held', async () => {
        await openThreeTabs();
        focusExplorer();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:b.ts'));
        fireEvent.blur(window);

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:c.ts'));
    });

    it('does nothing when focus is outside the Explorer', async () => {
        await openThreeTabs();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:c.ts'));
        outside.remove();
    });

    it('does nothing with a single tab open', async () => {
        render(<ExplorerPanel workspaceId="ws-keys" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        fireEvent.doubleClick(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts']));
        focusExplorer();

        pressCtrlTab();
        await waitFor(() => expect(activeTabId()).toBe('file:a.ts'));
    });
});

describe('ExplorerPanel — scoped Ctrl/Cmd+W', () => {
    it('closes the active tab and falls back to the most recently used one', async () => {
        await openThreeTabs();
        focusExplorer();

        fireEvent.keyDown(document, { key: 'w', ctrlKey: true });
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
        expect(activeTabId()).toBe('file:b.ts');
    });

    it('accepts Cmd+W for macOS', async () => {
        await openThreeTabs();
        focusExplorer();

        fireEvent.keyDown(document, { key: 'w', metaKey: true });
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts']));
    });

    it('leaves the browser shortcut alone when focus is outside the Explorer', async () => {
        await openThreeTabs();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();

        const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts']));
        expect(event.defaultPrevented).toBe(false);
        outside.remove();
    });

    it('leaves the browser shortcut alone when nothing is focused', async () => {
        await openThreeTabs();
        (document.activeElement as HTMLElement | null)?.blur();

        const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        await waitFor(() => expect(openTabIds()).toEqual(['file:a.ts', 'file:b.ts', 'file:c.ts']));
        expect(event.defaultPrevented).toBe(false);
    });

    it('does nothing when no tab is open', async () => {
        render(<ExplorerPanel workspaceId="ws-keys" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        screen.getByTestId('explorer-view-tree').focus();

        const event = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(openTabIds()).toEqual([]);
    });
});

describe('ExplorerPanel — tab keys with the flag off', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
    });

    it('ignores Ctrl+W and Ctrl+Tab entirely', async () => {
        render(<ExplorerPanel workspaceId="ws-keys" />);
        await waitFor(() => expect(screen.getByTestId('tree-node-a.ts')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('tree-node-a.ts'));
        await waitFor(() => expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument());
        screen.getByTestId('explorer-view-tree').focus();

        const closeEvent = new KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(closeEvent);
        const cycleEvent = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
        document.dispatchEvent(cycleEvent);

        expect(closeEvent.defaultPrevented).toBe(false);
        expect(cycleEvent.defaultPrevented).toBe(false);
        expect(screen.getByTestId('mock-preview-a.ts')).toBeInTheDocument();
        expect(openTabIds()).toEqual([]);
    });
});
