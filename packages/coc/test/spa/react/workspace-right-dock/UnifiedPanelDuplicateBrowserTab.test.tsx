/**
 * Browser tab right-click → Duplicate.
 *
 * Descriptor and placement rules are unit-tested in `browserTabDuplicate.test.ts`;
 * these cases prove the shell opens an independent copy beside the clicked tab
 * at its committed URL, selects and focuses it, leaves the original alone, and
 * keeps the themed menu's keyboard and dismissal behaviour.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <textarea data-testid="mock-terminal-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <textarea data-testid="mock-notes-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
    getAncestorPaths: () => [],
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        tree: async () => ({ entries: [] }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/repos/cloneRegistry')>(),
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
        workspaces: { deleteTerminal: async () => undefined },
    }),
    lookupCloneBaseUrl: () => null,
}));

const native = vi.hoisted(() => {
    // Like preload's `subscribe`, every live subscriber receives each IPC event.
    const reopenListeners = new Set<(event: { viewId: string }) => void>();
    return {
        enabled: false,
        reopenListeners,
        reopen: (event: { viewId: string }) => { for (const listener of [...reopenListeners]) listener(event); },
        close: vi.fn(),
    };
});
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => native.enabled ? {
        onNewTab: () => () => {},
        onState: () => () => {},
        onDownload: () => () => {},
        open: async () => ({ ok: true }),
        hide: async () => ({ ok: true }),
        navigate: async () => ({ ok: true }),
        close: native.close,
        onReopenClosedRequested: (callback: (event: { viewId: string }) => void) => {
            native.reopenListeners.add(callback);
            return () => { native.reopenListeners.delete(callback); };
        },
    } : undefined,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    clearUnifiedPanelState, closeBrowserPanelView, readUnifiedPanelState, writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { clearClosedBrowserTabs } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedClosedBrowserTabs';
import { openTab, updateBrowserTab } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 420, maxWidth: 900, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function stubOffsetParent() {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement) {
            return this.style.display === 'none' ? null : this.parentElement ?? document.body;
        },
    });
}

function press(key: string, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
    act(() => { (document.activeElement ?? document).dispatchEvent(event); });
    return event;
}
const pressReopen = (init: KeyboardEventInit = {}) => press('T', { shiftKey: true, ...init });

function browserTabs(scope = WS) {
    return readUnifiedPanelState(scope).workspaceTabs.filter(tab => tab.kind === 'browser');
}

/** Open a browser tab through Ctrl+T and the address bar, optionally setting the page title. */
function openBrowser(url: string, title?: string, scope = WS) {
    act(() => { screen.getAllByTestId('unified-panel-open-menu').at(-1)!.focus(); });
    press('t');
    const address = document.activeElement as HTMLInputElement;
    fireEvent.change(address, { target: { value: url } });
    fireEvent.submit(address.closest('form')!);
    const tab = browserTabs(scope).at(-1)!;
    if (title) act(() => { writeUnifiedPanelState(scope, updateBrowserTab(readUnifiedPanelState(scope), tab.id, { label: title })); });
    return browserTabs(scope).at(-1)!;
}

function activeTab() {
    return screen.getByRole('tab', { selected: true });
}

/** Ctrl+W with focus parked on the panel chrome, as a user would after any close. */
function closeActive() {
    act(() => { screen.getAllByTestId('unified-panel-open-menu').at(-1)!.focus(); });
    expect(press('w').defaultPrevented).toBe(true);
}

/** Focus sits on the restored tab's strip button or inside its own view. */
function expectFocusIn(tabId: string) {
    const focused = document.activeElement!;
    expect(focused === screen.getByTestId(`unified-panel-tab-${tabId}`)
        || focused.closest(`[data-testid="unified-panel-view-${tabId}"]`) !== null).toBe(true);
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearClosedBrowserTabs();
    _resetRuntimeConfig();
    stubOffsetParent();
});
afterEach(() => {
    cleanup();
    native.enabled = false;
    native.reopenListeners.clear();
    native.close.mockClear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearClosedBrowserTabs();
    _resetRuntimeConfig();
});

/** Browser tab ids in the order the strip shows them. */
function stripIds() {
    const ids = new Set(browserTabs().map(tab => tab.id));
    return screen.getAllByRole('tab')
        .map(tab => tab.getAttribute('data-testid')!.replace(/^unified-panel-tab-/, ''))
        .filter(id => ids.has(id));
}

function openMenu(tabId: string) {
    fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${tabId}`), { clientX: 20, clientY: 30 });
    return screen.getByTestId('unified-panel-tab-menu');
}

describe('unified panel browser tab Duplicate', () => {
    it('opens a selected, independent copy beside the clicked tab at its committed URL', () => {
        render(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        const a = openBrowser('a.test');
        const b = openBrowser('b.test');
        act(() => { writeUnifiedPanelState(WS, updateBrowserTab(readUnifiedPanelState(WS), a.id, { url: 'https://a.test/after', label: 'Page A' })); });
        const original = browserTabs().find(tab => tab.id === a.id)!;

        openMenu(a.id);
        fireEvent.click(screen.getByTestId('unified-panel-tab-menu-duplicate'));

        expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
        expect(browserTabs()).toHaveLength(3);
        expect(browserTabs().find(tab => tab.id === a.id)).toBe(original);
        const copy = browserTabs().find(tab => tab.id !== a.id && tab.id !== b.id)!;
        expect(copy).toMatchObject({ kind: 'browser', ownerWorkspaceId: WS, label: 'Page A', browserUrl: 'https://a.test/after' });
        expect(copy.resourceId).not.toBe(original.resourceId);
        expect(stripIds()).toEqual([a.id, copy.id, b.id]);
        expect(activeTab().getAttribute('data-testid')).toBe(`unified-panel-tab-${copy.id}`);
        expect(document.activeElement).toBe(screen.getByTestId(`unified-panel-tab-${copy.id}`));
    });

    it('duplicates from the keyboard and dismisses with Escape without opening anything', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        const tabButton = screen.getByTestId(`unified-panel-tab-${a.id}`);

        act(() => { tabButton.focus(); });
        fireEvent.keyDown(tabButton, { key: 'F10', shiftKey: true });
        expect(screen.getByTestId('unified-panel-tab-menu')).toBeTruthy();
        act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
        expect(screen.queryByTestId('unified-panel-tab-menu')).toBeNull();
        expect(browserTabs()).toHaveLength(1);

        act(() => { tabButton.focus(); });
        fireEvent.keyDown(tabButton, { key: 'ContextMenu' });
        const duplicate = screen.getByTestId('unified-panel-tab-menu-duplicate');
        for (let i = 0; i < 10 && document.activeElement !== duplicate; i++) {
            fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
        }
        expect(document.activeElement).toBe(duplicate);
        fireEvent.keyDown(duplicate, { key: 'Enter' });
        const copy = browserTabs().find(tab => tab.id !== a.id)!;
        expect(copy.browserUrl).toBe('https://a.test/');
        expect(stripIds()).toEqual([a.id, copy.id]);
        expect(activeTab().getAttribute('data-testid')).toBe(`unified-panel-tab-${copy.id}`);
    });

    it('keeps the other tab actions beside Duplicate', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        openBrowser('b.test');
        openMenu(a.id);
        fireEvent.click(screen.getByTestId('unified-panel-tab-menu-close-others'));
        expect(browserTabs().map(tab => tab.id)).toEqual([a.id]);
    });

    it('offers no Duplicate on HTML previews or other non-web tabs', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        act(() => {
            writeUnifiedPanelState(WS, openTab(readUnifiedPanelState(WS), {
                kind: 'html-page', ownerWorkspaceId: WS, chatId: null, resourceId: '/tmp/page.html',
                label: 'page.html', htmlPageId: 'page-1',
            }));
        });
        const page = readUnifiedPanelState(WS).workspaceTabs[0];
        openMenu(page.id);
        expect(screen.queryByTestId('unified-panel-tab-menu-duplicate')).toBeNull();
        expect(screen.getByTestId('unified-panel-tab-menu-close')).toBeTruthy();
    });

    it('disables Duplicate on a page that is not an http(s) address', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        act(() => { writeUnifiedPanelState(WS, updateBrowserTab(readUnifiedPanelState(WS), a.id, { url: 'chrome-error://chromewebdata/' })); });
        openMenu(a.id);
        const duplicate = screen.getByTestId('unified-panel-tab-menu-duplicate') as HTMLButtonElement;
        expect(duplicate.disabled).toBe(true);
        fireEvent.click(duplicate);
        expect(browserTabs()).toHaveLength(1);
    });
});
