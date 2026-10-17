/**
 * Ctrl/Cmd+Shift+T reopens the panel's closed web tabs.
 *
 * Stack rules are unit-tested in `unifiedClosedBrowserTabs.test.ts`; these
 * cases prove the shell records only user closes, restores into the exact
 * workspace/chat scope through the ordinary open path, focuses the restored
 * tab, and honours native requests only from this panel's active view.
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

const native = vi.hoisted(() => ({
    enabled: false,
    reopen: (_event: { viewId: string }) => {},
    close: vi.fn(),
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-path/browser-bridge', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/shared/file-path/browser-bridge')>(),
    desktopBrowserBridge: () => native.enabled ? {
        onNewTab: () => () => {},
        close: native.close,
        onReopenClosedRequested: (callback: (event: { viewId: string }) => void) => {
            native.reopen = callback;
            return () => { native.reopen = () => {}; };
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
    applyRuntimeConfigPatch({ panelReopenClosedTabEnabled: true });
    stubOffsetParent();
});
afterEach(() => {
    cleanup();
    native.enabled = false;
    native.close.mockClear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearClosedBrowserTabs();
    _resetRuntimeConfig();
});

describe('unified panel reopen-closed-tab shortcut', () => {
    it('does nothing and leaves the key alone while the flag is off', () => {
        _resetRuntimeConfig();
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        openBrowser('a.test');
        closeActive();
        expect(pressReopen().defaultPrevented).toBe(false);
        expect(browserTabs()).toEqual([]);
    });

    it.each([{ ctrlKey: true }, { ctrlKey: false, metaKey: true }])(
        'restores newest-first with the last URL and title, activating and focusing each (%j)', modifiers => {
            render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
            const a = openBrowser('a.test', 'Page A');
            const b = openBrowser('https://b.test/start');
            act(() => { writeUnifiedPanelState(WS, updateBrowserTab(readUnifiedPanelState(WS), b.id, { url: 'https://b.test/after', label: 'Page B' })); });
            closeActive();
            closeActive();
            expect(browserTabs()).toEqual([]);
            act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });

            expect(pressReopen(modifiers).defaultPrevented).toBe(true);
            let restored = browserTabs();
            expect(restored).toHaveLength(1);
            expect(restored[0]).toMatchObject({ browserUrl: 'https://a.test/', label: 'Page A', ownerWorkspaceId: WS });
            expect(restored[0].resourceId).not.toBe(a.resourceId);
            expect(activeTab().getAttribute('data-testid')).toBe(`unified-panel-tab-${restored[0].id}`);
            expectFocusIn(restored[0].id);

            expect(pressReopen(modifiers).defaultPrevented).toBe(true);
            restored = browserTabs();
            expect(restored.map(tab => [tab.browserUrl, tab.label])).toEqual([
                ['https://a.test/', 'Page A'], ['https://b.test/after', 'Page B'],
            ]);
            expect(restored[1].resourceId).not.toBe(b.resourceId);
            expectFocusIn(restored[1].id);
            expect(activeTab().textContent).toContain('Page B');

            // Empty stack: still ours while focused, nothing changes.
            expect(pressReopen(modifiers).defaultPrevented).toBe(true);
            expect(browserTabs()).toHaveLength(2);
        },
    );

    it('works from the address bar, ignores auto-repeat and keeps closed duplicates distinct', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        openBrowser('same.test');
        openBrowser('same.test');
        closeActive();
        closeActive();
        openBrowser('other.test');
        expect(document.activeElement).toBe(screen.getByTestId('browser-address'));
        expect(pressReopen({ repeat: true }).defaultPrevented).toBe(true);
        expect(browserTabs()).toHaveLength(1);
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(browserTabs().map(tab => tab.browserUrl)).toEqual(['https://other.test/', 'https://same.test/', 'https://same.test/']);
    });

    it('records strip, menu and bulk closes in tab order, and a re-closed tab becomes newest', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const a = openBrowser('a.test');
        openBrowser('b.test');
        const c = openBrowser('c.test');
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${c.id}`));
        fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${a.id}`), { clientX: 20, clientY: 30 });
        fireEvent.click(screen.getByTestId('unified-panel-tab-menu-close-all'));
        expect(browserTabs()).toEqual([]);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        const urls = () => browserTabs().map(tab => tab.browserUrl);
        pressReopen();
        expect(urls()).toEqual(['https://b.test/']);
        pressReopen();
        expect(urls()).toEqual(['https://b.test/', 'https://a.test/']);
        // Closing a restored tab puts it back on top, ahead of c.
        closeActive();
        pressReopen();
        expect(urls()).toEqual(['https://b.test/', 'https://a.test/']);
        pressReopen();
        expect(urls()).toEqual(['https://b.test/', 'https://a.test/', 'https://c.test/']);
    });

    it('excludes HTML previews, other tab kinds and lifecycle cleanup closes', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        const cleaned = openBrowser('cleaned.test');
        act(() => { closeBrowserPanelView(cleaned.resourceId); });
        expect(browserTabs()).toEqual([]);
        act(() => {
            writeUnifiedPanelState(WS, openTab(readUnifiedPanelState(WS), {
                kind: 'html-page', ownerWorkspaceId: WS, chatId: null, resourceId: '/tmp/page.html',
                label: 'page.html', htmlPageId: 'page-1',
            }));
        });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-notes'));
        closeActive();
        closeActive();
        expect(readUnifiedPanelState(WS).workspaceTabs).toEqual([]);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(readUnifiedPanelState(WS).workspaceTabs).toEqual([]);
        expect(Object.keys(localStorage).some(key => /closed/i.test(key))).toBe(false);
    });

    it('leaves the shortcut alone outside the panel and while collapsed', () => {
        const view = render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        openBrowser('a.test');
        closeActive();
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        act(() => { outside.focus(); });
        expect(pressReopen().defaultPrevented).toBe(false);
        act(() => { outside.blur(); });
        expect(pressReopen().defaultPrevented).toBe(false);
        outside.remove();
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(pressReopen().defaultPrevented).toBe(false);
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(browserTabs().map(tab => tab.browserUrl)).toEqual(['https://a.test/']);
    });

    it('keeps the Ctrl+T and Ctrl+W bindings unchanged', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        openBrowser('a.test');
        expect(browserTabs()).toHaveLength(1);
        closeActive();
        expect(browserTabs()).toHaveLength(0);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        expect(press('t').defaultPrevented).toBe(true);
        expect(browserTabs()).toEqual([expect.objectContaining({ label: 'New Tab' })]);
    });

    it('isolates chats and workspaces, restoring after switching away and back', () => {
        const view = render(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        openBrowser('chat1.test');
        closeActive();
        view.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(browserTabs()).toEqual([]);
        view.rerender(<UnifiedRightPanel workspaceId="ws-2" chatId="chat-1" dock={dockStub({ target: 'ws-2' })} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        pressReopen();
        expect(browserTabs('ws-2')).toEqual([]);
        view.unmount();
        render(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        pressReopen();
        expect(browserTabs()).toEqual([expect.objectContaining({ browserUrl: 'https://chat1.test/' })]);
    });

    it('restores a remote group member tab on its own route, never another owner', () => {
        const props = {
            workspaceId: 'group-acme', routingRef: 'remote:server-1:group-acme', chatId: 'chat-1',
        } as const;
        const view = render(<UnifiedRightPanel {...props}
            dock={dockStub({ target: 'ws-member', targets: [{ workspaceId: 'ws-member', label: 'api' }] })} />);
        openBrowser('member.test', undefined, 'group-acme');
        closeActive();
        // The member left the group: its entry is dropped, not retargeted.
        view.rerender(<UnifiedRightPanel {...props}
            dock={dockStub({ target: 'ws-other', targets: [{ workspaceId: 'ws-other', label: 'web' }] })} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        expect(pressReopen().defaultPrevented).toBe(true);
        expect(browserTabs('group-acme')).toEqual([]);
        view.rerender(<UnifiedRightPanel {...props}
            dock={dockStub({ target: 'ws-member', targets: [{ workspaceId: 'ws-member', label: 'api' }] })} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        pressReopen();
        expect(browserTabs('group-acme')).toEqual([]);

        openBrowser('member2.test', undefined, 'group-acme');
        closeActive();
        pressReopen();
        expect(browserTabs('group-acme')).toEqual([expect.objectContaining({
            ownerWorkspaceId: 'ws-member', ownerRoutingRef: 'remote:server-1:ws-member', repoLabel: 'api',
            browserUrl: 'https://member2.test/',
        })]);
    });

    it('honours native requests only from the active visible browser view, once each', () => {
        native.enabled = true;
        const view = render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        press('t');
        const first = browserTabs()[0];
        act(() => { screen.getByTestId('unified-panel-open-menu').focus(); });
        press('t');
        const second = browserTabs()[1];
        closeActive();
        expect(native.close).toHaveBeenCalledWith(second.resourceId);
        expect(browserTabs()).toEqual([first]);

        act(() => { native.reopen({ viewId: second.resourceId }); });
        act(() => { native.reopen({ viewId: 'other-window-view' }); });
        expect(browserTabs()).toHaveLength(1);
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        act(() => { native.reopen({ viewId: first.resourceId }); });
        expect(browserTabs()).toHaveLength(1);
        view.rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);

        act(() => { native.reopen({ viewId: first.resourceId }); });
        const restored = browserTabs();
        expect(restored).toHaveLength(2);
        expect(restored[1].resourceId).not.toBe(second.resourceId);
        expectFocusIn(restored[1].id);
        expect(activeTab().getAttribute('data-testid')).toBe(`unified-panel-tab-${restored[1].id}`);
        // The restored tab is now active; the old view id is not honoured again.
        act(() => { native.reopen({ viewId: first.resourceId }); });
        expect(browserTabs()).toHaveLength(2);
    });
});
