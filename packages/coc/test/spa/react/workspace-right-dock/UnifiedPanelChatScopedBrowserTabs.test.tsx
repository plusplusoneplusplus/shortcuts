/**
 * Conversation-owned browser tabs in the real panel and Electron guest layer
 * (`features.chatScopedBrowserTabs`). Switching chats hides another chat's
 * tabs and guests without closing them; returning restores the same guest and
 * the chat's selection. Model rules live in `chatScopedBrowserTabs.test.ts`.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <textarea data-testid="mock-terminal-input" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <div data-testid="mock-notes" />,
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

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { BrowserWebviewLayer } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserWebviewLayer';
import {
    browserWebviewEntries, removeBrowserWebview, setBrowserWebviewBackground,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/browserWebviewLayerStore';
import {
    clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { activateTab, openTab, type UnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { browserOpenInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { DesktopBrowserBridge } from '../../../../src/server/spa/client/react/shared/file-path/browser-bridge';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const SENTINEL = 'sentinel-chat';

let bridge: DesktopBrowserBridge;
let newTab: (event: { openerViewId: string; viewId?: string; url: string; engine?: 'electron' }) => void;

function dockStub(): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 420, maxWidth: 900, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
    };
}

function Shell({ chatId }: { chatId: string | null }) {
    return <><BrowserWebviewLayer /><UnifiedRightPanel workspaceId={WS} chatId={chatId} dock={dockStub()} /></>;
}

const guestHost = (viewId: string) => document.querySelector<HTMLElement>(`[data-browser-view-id="${viewId}"]`);
const guest = (viewId: string) => guestHost(viewId)?.querySelector('webview') ?? null;
const browserTabs = () => readUnifiedPanelState(WS).workspaceTabs.filter(tab => tab.kind === 'browser');
const tabByLabel = (label: string) => browserTabs().find(tab => tab.label === label)!;
const stripLabels = () => screen.getAllByRole('tab').map(tab => (tab.textContent ?? '').replace('✕', '').trim());
const selected = () => screen.getByRole('tab', { selected: true }).getAttribute('data-testid');

/** Notes (non-page), A's Docs + Report, B's Results and one workspace-global manual page. */
function seed(): void {
    applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: true });
    let state: UnifiedPanelState = openTab(readUnifiedPanelState(WS), {
        kind: 'notes', ownerWorkspaceId: WS, chatId: null, resourceId: 'notes', label: 'Notes',
    });
    const add = (chatId: string | null, label: string) => {
        state = openTab(state, { ...browserOpenInput({ ownerWorkspaceId: WS, chatId }, `https://${label.toLowerCase()}.test/`), label });
    };
    add('chat-a', 'Docs');
    add('chat-a', 'Report');
    add('chat-b', 'Results');
    add(null, 'Shared');
    state = activateTab(state, 'chat-a', state.workspaceTabs.find(tab => tab.label === 'Report')!.id);
    state = activateTab(state, 'chat-b', state.workspaceTabs.find(tab => tab.label === 'Results')!.id);
    writeUnifiedPanelState(WS, state);
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    _resetRuntimeConfig();
    // The panel owns Ctrl+T only while it is laid out.
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
        configurable: true,
        get(this: HTMLElement) { return this.style.display === 'none' ? null : this.parentElement ?? document.body; },
    });
    bridge = {
        open: vi.fn(async (viewId: string, url: string) => ({ ok: true, engine: 'electron', embed: 'webview', src: url, partition: `token-${viewId}` })),
        adopt: vi.fn(async () => ({ ok: true })),
        navigate: vi.fn(async () => ({ ok: true })), nav: vi.fn(), setBounds: vi.fn(), hide: vi.fn(), close: vi.fn(), focus: vi.fn(),
        openExternal: vi.fn(), onState: vi.fn(() => vi.fn()), onDownload: vi.fn(() => vi.fn()),
        onNewTab: vi.fn(handler => { newTab = handler; return vi.fn(); }), onClosed: vi.fn(() => vi.fn()), getPreferences: vi.fn(),
        setDefaultEngine: vi.fn(), clearData: vi.fn(), onPreferencesChanged: vi.fn(() => vi.fn()),
    } as unknown as DesktopBrowserBridge;
    Object.assign(window, { cocDesktop: { browser: bridge } });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => (
        { x: 100, y: 80, left: 100, top: 80, right: 500, bottom: 380, width: 400, height: 300, toJSON: () => ({}) }) as DOMRect);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
    cleanup();
    for (const entry of [...browserWebviewEntries()]) removeBrowserWebview(entry.viewId);
    delete (window as { cocDesktop?: unknown }).cocDesktop;
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    _resetRuntimeConfig();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('conversation-owned browser tabs in the panel', () => {
    it('A -> Sentinel -> B -> A hides foreign tabs and guests immediately and restores the same guest and selection', async () => {
        seed();
        const report = tabByLabel('Report');
        const results = tabByLabel('Results');
        const view = render(<Shell chatId="chat-a" />);
        expect(stripLabels()).toEqual(['Notes', 'Docs', 'Report', 'Shared']);
        expect(selected()).toBe(`unified-panel-tab-${report.id}`);
        await waitFor(() => expect(guestHost(report.resourceId)?.style.visibility).toBe('visible'));
        const reportGuest = guest(report.resourceId);

        // Sentinel: neither child's pages, no visible foreign guest in the same commit, non-page fallback.
        act(() => { view.rerender(<Shell chatId={SENTINEL} />); });
        expect(guestHost(report.resourceId)?.style.visibility).toBe('hidden');
        expect(guestHost(report.resourceId)?.style.pointerEvents).toBe('none');
        expect(stripLabels()).toEqual(['Notes', 'Shared']);
        expect(selected()).toBe(`unified-panel-tab-${readUnifiedPanelState(WS).workspaceTabs[0].id}`);

        // B: only its own page, selected; A's guest stays hidden.
        act(() => { view.rerender(<Shell chatId="chat-b" />); });
        expect(guestHost(report.resourceId)?.style.visibility).toBe('hidden');
        expect(stripLabels()).toEqual(['Notes', 'Results', 'Shared']);
        expect(selected()).toBe(`unified-panel-tab-${results.id}`);
        await waitFor(() => expect(guestHost(results.resourceId)?.style.visibility).toBe('visible'));

        // Back to A: same live guest, same selection, nothing closed or navigated.
        act(() => { view.rerender(<Shell chatId="chat-a" />); });
        expect(guestHost(results.resourceId)?.style.visibility).toBe('hidden');
        expect(selected()).toBe(`unified-panel-tab-${report.id}`);
        await waitFor(() => expect(guestHost(report.resourceId)?.style.visibility).toBe('visible'));
        expect(guest(report.resourceId)).toBe(reportGuest);
        expect(browserTabs().map(tab => tab.label)).toEqual(['Docs', 'Report', 'Results', 'Shared']);
        expect(bridge.close).not.toHaveBeenCalled();
        expect(bridge.navigate).not.toHaveBeenCalled();
        expect(bridge.nav).not.toHaveBeenCalled();
    });

    it('keeps a hidden page driven by a background turn laid out, invisible and click-through', async () => {
        seed();
        const report = tabByLabel('Report');
        const view = render(<Shell chatId="chat-a" />);
        await waitFor(() => expect(guestHost(report.resourceId)?.style.visibility).toBe('visible'));
        act(() => { view.rerender(<Shell chatId="chat-b" />); });
        act(() => { setBrowserWebviewBackground(report.resourceId, true); });
        const host = guestHost(report.resourceId)!;
        expect(host.style.opacity).toBe('0');
        expect(host.style.visibility).toBe('visible');
        expect(host.style.pointerEvents).toBe('none');
        expect(stripLabels()).not.toContain('Report');
        act(() => { setBrowserWebviewBackground(report.resourceId, false); });
        expect(host.style.visibility).toBe('hidden');
    });

    it('opens popups in the opener\'s conversation even while another chat is shown', async () => {
        seed();
        const report = tabByLabel('Report');
        const view = render(<Shell chatId="chat-a" />);
        await waitFor(() => expect(guest(report.resourceId)).toBeTruthy());
        act(() => { view.rerender(<Shell chatId="chat-b" />); });
        act(() => { newTab({ openerViewId: report.resourceId, viewId: 'popup-1', url: 'https://popup.test/', engine: 'electron' }); });
        const popup = browserTabs().find(tab => tab.resourceId === 'popup-1')!;
        expect(popup).toMatchObject({ browserChatId: 'chat-a', browserUrl: 'https://popup.test/' });
        expect(screen.queryByTestId(`unified-panel-tab-${popup.id}`)).toBeNull();
        act(() => { view.rerender(<Shell chatId="chat-a" />); });
        expect(selected()).toBe(`unified-panel-tab-${popup.id}`);

        // A popup from a workspace-global page stays global.
        const shared = tabByLabel('Shared');
        act(() => { newTab({ openerViewId: shared.resourceId, viewId: 'popup-2', url: 'https://popup2.test/' }); });
        expect(browserTabs().find(tab => tab.resourceId === 'popup-2')).not.toHaveProperty('browserChatId');
    });

    it('files a page opened with Ctrl+T under the selected chat and closes only on explicit close', async () => {
        seed();
        const view = render(<Shell chatId="chat-b" />);
        act(() => { screen.getAllByTestId('unified-panel-open-menu').at(-1)!.focus(); });
        act(() => {
            document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true, cancelable: true }));
        });
        const blank = browserTabs().at(-1)!;
        expect(blank.label).toBe('New Tab');
        expect(blank.browserChatId).toBe('chat-b');
        act(() => { view.rerender(<Shell chatId="chat-a" />); });
        expect(screen.queryByTestId(`unified-panel-tab-${blank.id}`)).toBeNull();

        const report = tabByLabel('Report');
        await waitFor(() => expect(guest(report.resourceId)).toBeTruthy());
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${report.id}`));
        expect(bridge.close).toHaveBeenCalledExactlyOnceWith(report.resourceId);
        expect(browserTabs().map(tab => tab.label)).toEqual(['Docs', 'Results', 'Shared', blank.label]);
    });

    it('shows every page in every chat when the flag is off or turns off live', () => {
        // Four visible pages exceed the Web group's cap.
        applyRuntimeConfigPatch({ panelTabGroupsEnabled: false });
        seed();
        const view = render(<Shell chatId="chat-b" />);
        expect(stripLabels()).toEqual(['Notes', 'Results', 'Shared']);
        act(() => { applyRuntimeConfigPatch({ chatScopedBrowserTabsEnabled: false }); });
        expect(stripLabels()).toEqual(['Notes', 'Docs', 'Report', 'Results', 'Shared']);
        expect(browserTabs().every(tab => tab.browserChatId === undefined)).toBe(true);
        act(() => { view.rerender(<Shell chatId={SENTINEL} />); });
        expect(stripLabels()).toEqual(['Notes', 'Docs', 'Report', 'Results', 'Shared']);
    });
});
