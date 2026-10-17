import '../../language-servers/fileIdentityMock';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    enabled: true,
    tree: vi.fn(),
    deleteEntry: vi.fn(),
}));
vi.mock('../../../../../src/server/spa/client/react/hooks/feature-flags/useExplorerDeleteEnabled', () => ({
    useExplorerDeleteEnabled: () => ({ enabled: mocks.enabled, error: null }),
}));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: { tree: mocks.tree, deleteEntry: mocks.deleteEntry, searchFiles: vi.fn(), reveal: vi.fn() },
}));
vi.mock('../../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ filePath }: { filePath: string }) => <div data-testid="preview-stub">{filePath}</div>,
}));
import { ExplorerPanel } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel';
import { clearExplorerTreeCache } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTreeCache';
import {
    acquireExplorerDeletion, beginExplorerFileSave, setExplorerFileDirty,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerDirtyStore';
import {
    explorerPreviewStorageKey, explorerSelectedStorageKey, explorerTabsStorageKey,
} from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerStateStore';
import { EMPTY_EXPLORER_TABS, openFileTab, serializeExplorerTabs } from '../../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerTabsModel';

const entries = [
    { path: 'a.ts', name: 'a.ts', type: 'file' },
    { path: 'folder', name: 'folder', type: 'dir', children: [{ path: 'folder/nested.txt', name: 'nested.txt', type: 'file' }] },
    { path: 'folder-other.txt', name: 'folder-other.txt', type: 'file' },
    { path: '.git', name: '.git', type: 'dir' },
    { path: '.', name: 'root', type: 'dir' },
];
const releases: (() => void)[] = [];
beforeEach(() => {
    mocks.enabled = true;
    mocks.tree.mockReset().mockImplementation((_workspace: string, options: { path: string }) =>
        Promise.resolve({ entries: options.path === 'folder' ? entries[1].children : entries }));
    mocks.deleteEntry.mockReset().mockResolvedValue({ success: true });
    localStorage.clear();
    location.hash = '';
    clearExplorerTreeCache();
});
afterEach(() => {
    cleanup();
    releases.splice(0).forEach(release => release());
    for (const id of ['dirty-a', 'dirty-b', 'sibling']) setExplorerFileDirty('ws-a', id, '', false);
});

async function panel(workspaceId = 'ws-a', routingRef?: string) {
    const view = render(<ExplorerPanel workspaceId={workspaceId} routingRef={routingRef} mode="editor" />);
    await screen.findByTestId('tree-node-a.ts');
    return view;
}
function menu(path: string) {
    fireEvent.contextMenu(screen.getByTestId(`tree-node-${path}`));
}
function chooseDelete(path: string) {
    menu(path);
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete$/ }));
}
function confirm() {
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
}

describe('Explorer permanent deletion', () => {
    it('is unavailable with the feature disabled', async () => {
        mocks.enabled = false;
        await panel();
        menu('a.ts');
        expect(screen.queryByRole('menuitem', { name: /Delete$/ })).toBeNull();
    });
    it.each(['.git', '.'])('visibly disables protected entry %s', async path => {
        await panel();
        menu(path);
        const item = screen.getByRole('menuitem', { name: /Delete$/ });
        expect(item).toBeDisabled();
        expect(item.title).toMatch(/cannot be deleted/);
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });
    it('offers Delete last with a red treatment and separator', async () => {
        await panel();
        menu('a.ts');
        const items = screen.getAllByRole('menuitem');
        expect(items.at(-1)).toHaveTextContent('Delete');
        expect(items.at(-1)?.className).toContain('text-[#d32f2f]');
        expect(items.at(-1)?.previousElementSibling).toHaveAttribute('role', 'separator');
    });
    it('focuses Cancel, identifies the exact path and cancels without any request', async () => {
        await panel();
        chooseDelete('a.ts');
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('a.ts')).toBeInTheDocument();
        expect(dialog).toHaveTextContent('permanent and cannot be undone');
        expect(dialog).toHaveTextContent('this window only');
        expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });
    it('warns about folder contents and confirms on the captured remote member owner', async () => {
        const route = 'remote:server-a:ws-a';
        await panel('ws-a', route);
        chooseDelete('folder');
        expect(screen.getByRole('dialog')).toHaveTextContent('removes all its contents');
        confirm();
        await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledWith('ws-a', 'folder', route));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
    it('blocks dirty files in any instance and identifies affected descendants, not prefix siblings', async () => {
        setExplorerFileDirty('ws-a', 'dirty-a', 'folder/nested.txt', true);
        setExplorerFileDirty('ws-a', 'dirty-b', 'folder/deep/other.txt', true);
        setExplorerFileDirty('ws-a', 'sibling', 'folder-other.txt', true);
        await panel();
        chooseDelete('folder');
        expect(screen.getByRole('dialog')).toHaveTextContent('folder/nested.txt');
        expect(screen.getByRole('dialog')).toHaveTextContent('folder/deep/other.txt');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('folder-other.txt');
        expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });
    it('allows an unaffected dirty sibling', async () => {
        setExplorerFileDirty('ws-a', 'sibling', 'folder-other.txt', true);
        await panel();
        chooseDelete('folder');
        confirm();
        await waitFor(() => expect(mocks.deleteEntry).toHaveBeenCalledTimes(1));
    });
    it('rechecks dirty state immediately before dispatch', async () => {
        await panel();
        chooseDelete('a.ts');
        setExplorerFileDirty('ws-a', 'dirty-a', 'a.ts', true);
        confirm();
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog')).toHaveTextContent('Cannot delete unsaved files');
    });
    it('blocks in-flight saves even for a clean buffer', async () => {
        releases.push(beginExplorerFileSave('ws-a', 'a.ts'));
        await panel();
        chooseDelete('a.ts');
        expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });
    it('disables duplicate submissions and holds the edit/save lock while pending', async () => {
        let resolve!: (value: { success: boolean }) => void;
        mocks.deleteEntry.mockReturnValue(new Promise(done => { resolve = done; }));
        await panel();
        chooseDelete('a.ts');
        confirm();
        expect(screen.getByRole('button', { name: /Deleting/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(() => beginExplorerFileSave('ws-a', 'a.ts')).toThrow(/being deleted/);
        expect(() => acquireExplorerDeletion('ws-a', 'a.ts')).toThrow(/already in progress/);
        expect(mocks.deleteEntry).toHaveBeenCalledTimes(1);
        await act(async () => resolve({ success: true }));
        releases.push(beginExplorerFileSave('ws-a', 'a.ts'));
    });
    it('retains tabs and preview on failure, shows the error and refreshes actual disk state', async () => {
        const tabs = openFileTab(EMPTY_EXPLORER_TABS, { path: 'a.ts', name: 'a.ts', preview: false });
        localStorage.setItem(explorerTabsStorageKey('ws-a'), serializeExplorerTabs(tabs));
        localStorage.setItem(explorerPreviewStorageKey('ws-a'), JSON.stringify({ path: 'a.ts', name: 'a.ts' }));
        mocks.deleteEntry.mockRejectedValue(new Error('Deletion partially completed; no rollback'));
        await panel();
        chooseDelete('a.ts');
        confirm();
        await screen.findByText('Deletion partially completed; no rollback');
        expect(JSON.parse(localStorage.getItem(explorerTabsStorageKey('ws-a'))!).tabs).toHaveLength(1);
        expect(screen.getByTestId('preview-stub')).toHaveTextContent('a.ts');
        expect(mocks.tree.mock.calls.length).toBeGreaterThan(1);
    });
    it('retains the remote confirmation and loaded tree when deletion and refresh both fail', async () => {
        const route = 'remote:server-a:ws-a';
        const view = await panel('ws-a', route);
        chooseDelete('a.ts');
        mocks.deleteEntry.mockRejectedValue(new Error('Remote deletion unavailable'));
        mocks.tree.mockRejectedValue(new Error('Remote tree unavailable'));
        confirm();
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Remote deletion unavailable');
        expect(screen.getByRole('dialog')).toContainElement(alert);
        expect(screen.getByTestId('tree-node-a.ts')).toBeVisible();
        expect(mocks.deleteEntry).toHaveBeenCalledWith('ws-a', 'a.ts', route);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByTestId('tree-node-a.ts')).toBeVisible();
        expect(screen.getByText('Remote tree unavailable')).toBeVisible();

        // A loaded snapshot from this owner must not mask another owner's initial failure.
        view.rerender(<ExplorerPanel workspaceId="ws-b" routingRef="remote:server-b:ws-b" mode="editor" />);
        await waitFor(() => expect(screen.getByTestId('explorer-error')).toHaveTextContent('Remote tree unavailable'));
        expect(screen.queryByTestId('tree-node-a.ts')).toBeNull();
    });
    it('closes affected clean previews and clears top-level row selection on success', async () => {
        localStorage.setItem(explorerPreviewStorageKey('ws-a'), JSON.stringify({ path: 'a.ts', name: 'a.ts' }));
        await panel();
        chooseDelete('a.ts');
        confirm();
        await waitFor(() => expect(screen.queryByTestId('preview-stub')).toBeNull());
        expect(JSON.parse(localStorage.getItem(explorerSelectedStorageKey('ws-a'))!)).toBeNull();
        await waitFor(() => expect(screen.getByTestId('file-tree-scroll')).toHaveFocus());
    });
    it('closes all affected file tabs, retains prefix siblings and selects the containing parent', async () => {
        let tabs = openFileTab(EMPTY_EXPLORER_TABS, { path: 'folder/nested.txt', name: 'nested.txt', preview: false });
        tabs = openFileTab(tabs, { path: 'folder-other.txt', name: 'folder-other.txt', preview: false });
        localStorage.setItem(explorerTabsStorageKey('ws-a'), serializeExplorerTabs(tabs));
        await panel();
        fireEvent.click(screen.getByTestId('tree-node-folder'));
        chooseDelete('folder/nested.txt');
        confirm();
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        const remaining = JSON.parse(localStorage.getItem(explorerTabsStorageKey('ws-a'))!).tabs;
        expect(remaining.map((tab: { path: string }) => tab.path)).toEqual(['folder-other.txt']);
        await waitFor(() => expect(JSON.parse(localStorage.getItem(explorerSelectedStorageKey('ws-a'))!)).toBe('folder'));
    });
    it('does not retarget an admitted deletion or alter the new workspace when it completes late', async () => {
        let finish!: (value: { success: boolean }) => void;
        mocks.deleteEntry.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const view = await panel();
        chooseDelete('a.ts');
        confirm();
        location.hash = '#repos/ws-b/workspace';
        view.rerender(<ExplorerPanel workspaceId="ws-b" mode="editor" />);
        await act(async () => finish({ success: true }));
        expect(mocks.deleteEntry).toHaveBeenCalledWith('ws-a', 'a.ts', undefined);
        expect(location.hash).toBe('#repos/ws-b/workspace');
        expect(localStorage.getItem(explorerSelectedStorageKey('ws-b'))).toBeNull();
    });
    it('drops an undispatched confirmation when the workspace switches', async () => {
        const view = await panel();
        chooseDelete('a.ts');
        view.rerender(<ExplorerPanel workspaceId="ws-b" mode="editor" />);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(mocks.deleteEntry).not.toHaveBeenCalled();
    });
});
