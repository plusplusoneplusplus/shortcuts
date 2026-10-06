/**
 * UnifiedRightPanel — the AC-01 shell: one right-side column, one tab strip,
 * one visible view.
 *
 * These cases pin the behavior the shell owns rather than the model: exactly
 * one panel beside the chat, keep-alive across tab switches and a collapse,
 * lazy mounting so a restored descriptor never spawns a session, the empty
 * state that creates nothing, and the persisted width/resize handle.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Mock the reused heavy views by source path so Monaco / xterm / API clients
// never load here, and so mount and unmount are observable.
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId, deepLink }: { workspaceId: string; deepLink?: boolean }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}:{String(deepLink)}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: ({
        workspaceId,
        onOpenMatch,
    }: {
        workspaceId: string;
        onOpenMatch: (path: string, line: number) => void;
    }) => (
        <div data-testid="mock-content-search">
            search:{workspaceId}
            <button type="button" data-testid="mock-search-result" onClick={() => onOpenMatch('src/match.ts', 12)}>
                Open result
            </button>
        </div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

// The "+" menu searches on the server and lists the chat's canvases; both are
// stubbed here so the shell cases exercise the seam, not the network.
const searchFiles = vi.fn(async () => ({ results: [] as { path: string }[] }));
// `readBlob` is here because a file tab now renders the Explorer's real buffer;
// the file view's own behavior is pinned in UnifiedPanelResourceTabs.test.tsx.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: (...args: unknown[]) => searchFiles(...(args as [])),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
    subscribeCloneBaseUrl: () => () => {},
}));
// `PreviewPane` opens a language document for every live repo file; this suite
// is about panel behaviour, not language support.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));


import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    inheritDraftPanelTabs,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelOpen';
import {
    clearUnifiedPanelState,
    readUnifiedPanelState,
    writeUnifiedPanelState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import {
    EMPTY_UNIFIED_PANEL,
    openTab,
    unifiedTabId,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import {
    clearUnifiedTreeState,
    writeUnifiedTreeState,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    openWorkspaceDock,
    workspaceDockOpenStorageKey,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceDockToggle';

const WS = 'ws-1';

/**
 * A dock controller stub. The real one is exercised by
 * useWorkspaceDock.test; the panel only reads open/width/target from it.
 */
function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        mode: 'explorer',
        selectMode: vi.fn(),
        target: WS,
        setTarget: vi.fn(),
        targets: [],
        width: 420,
        maxWidth: 900,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function renderPanel(props: Partial<React.ComponentProps<typeof UnifiedRightPanel>> = {}) {
    const dock = props.dock ?? dockStub();
    return render(<UnifiedRightPanel workspaceId={WS} dock={dock} {...props} />);
}

/** Open a workspace resource through the "+" menu, as a user would. */
function openViaMenu(testId: string) {
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId(testId));
}

describe('UnifiedRightPanel', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        clearUnifiedTreeState();
        delete (window as { cocDesktop?: unknown }).cocDesktop;
    });

    describe('desktop HTML page tabs', () => {
        let stateListener: ((state: { pageId: string; status: 'loading' | 'loaded' | 'failed'; error?: string }) => void) | undefined;
        const bridge = {
            open: vi.fn(async () => ({ ok: true as const })),
            close: vi.fn(),
            hide: vi.fn(),
            reload: vi.fn(),
            openExternal: vi.fn(),
            setBounds: vi.fn(),
            onState: vi.fn((callback: typeof stateListener) => {
                stateListener = callback;
                return () => { stateListener = undefined; };
            }),
        };
        const filePath = '/workspace/pages/demo.html';
        const tabId = unifiedTabId({
            kind: 'html-page', ownerWorkspaceId: WS, ownerRoutingRef: null,
            chatId: null, resourceId: filePath,
        });
        const openPage = (path = filePath, pageId = 'page-1', scopeWsId = WS, wsId = WS) => {
            const detail = { pageId, filePath: path, wsId, scopeWsId, handled: false };
            act(() => {
                window.dispatchEvent(new CustomEvent('coc-open-html-page', { detail }));
            });
            return detail;
        };

        beforeEach(() => {
            localStorage.clear();
            clearUnifiedPanelState();
            clearUnifiedTreeState();
            vi.clearAllMocks();
            stateListener = undefined;
            Object.defineProperty(window, 'cocDesktop', { value: { htmlPage: bridge }, configurable: true });
        });
        afterEach(() => {
            cleanup();
            clearUnifiedPanelState();
            clearUnifiedTreeState();
            delete (window as { cocDesktop?: unknown }).cocDesktop;
        });

        it('opens, deduplicates and focuses a per-file tab with its filename', async () => {
            renderPanel({ chatId: 'chat-1' });
            expect(openPage().handled).toBe(true);
            expect(screen.getByTestId(`unified-panel-tab-${tabId}`).textContent).toContain('demo.html');
            openPage('/workspace/other.htm', 'page-2');
            expect(screen.getAllByRole('tab')).toHaveLength(2);
            openPage();
            expect(screen.getAllByRole('tab')).toHaveLength(2);
            expect(screen.getByTestId(`unified-panel-tab-${tabId}`).getAttribute('aria-selected')).toBe('true');
            expect(bridge.open).toHaveBeenCalledWith('page-1', filePath);
            expect(screen.getAllByTestId('html-page-placeholder')).toHaveLength(2);
        });

        it('routes toolbar actions and inline failure fallback to the source viewer', () => {
            renderPanel({ chatId: 'chat-1' });
            openPage();
            const sourceEvents: CustomEvent[] = [];
            const collect = (event: Event) => sourceEvents.push(event as CustomEvent);
            window.addEventListener('coc-open-source-canvas', collect);
            try {
                fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
                fireEvent.click(screen.getByRole('button', { name: 'Open in system browser' }));
                fireEvent.click(screen.getByRole('button', { name: 'View source' }));
                expect(bridge.reload).toHaveBeenCalledWith('page-1');
                expect(bridge.openExternal).toHaveBeenCalledWith('page-1');
                expect(sourceEvents[0].detail).toEqual({ filePath, wsId: WS, forceSourceViewer: true });

                act(() => stateListener?.({ pageId: 'page-1', status: 'failed', error: 'File not found' }));
                expect(screen.getByRole('alert').textContent).toContain('File not found');
                expect(screen.getByTestId(`unified-panel-tab-error-${tabId}`)).toBeTruthy();
                expect(bridge.hide).toHaveBeenCalledWith('page-1');
                fireEvent.click(screen.getByRole('alert').querySelector('button')!);
                expect(sourceEvents).toHaveLength(2);
            } finally {
                window.removeEventListener('coc-open-source-canvas', collect);
            }
        });

        it('tracks geometry, hides on tab switch/collapse/menu, and closes the native view', async () => {
            const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
                x: 50, y: 90, width: 300, height: 220,
            } as DOMRect);
            try {
                const { rerender } = renderPanel({ chatId: 'chat-1' });
                openPage();
                expect(bridge.setBounds).toHaveBeenCalledWith('page-1', { x: 50, y: 90, width: 300, height: 220 });
                rect.mockReturnValue({ x: 80, y: 90, width: 250, height: 220 } as DOMRect);
                fireEvent(window, new Event('resize'));
                await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledWith(
                    'page-1', { x: 80, y: 90, width: 250, height: 220 },
                ));
                openViaMenu('unified-panel-open-terminal');
                expect(bridge.hide).toHaveBeenCalledWith('page-1');
                fireEvent.click(screen.getByTestId(`unified-panel-tab-${tabId}`));
                fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
                expect(bridge.hide).toHaveBeenCalledWith('page-1');
                fireEvent.keyDown(document, { key: 'Escape' });
                bridge.hide.mockClear();
                fireEvent.contextMenu(screen.getByTestId(`unified-panel-tab-${tabId}`));
                await waitFor(() => expect(bridge.hide).toHaveBeenCalledWith('page-1'));
                fireEvent.keyDown(document, { key: 'Escape' });
                rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub({ isOpen: false })} />);
                expect(bridge.hide).toHaveBeenCalledWith('page-1');
                rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
                fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${tabId}`));
                expect(bridge.close).toHaveBeenCalledWith('page-1');
                expect(screen.queryByTestId(`unified-panel-tab-${tabId}`)).toBeNull();
            } finally {
                rect.mockRestore();
            }
        });

        it('does not claim pages for another panel scope', () => {
            renderPanel({ chatId: 'chat-1' });
            expect(openPage(filePath, 'page-1', 'group-other').handled).toBe(false);
            expect(screen.queryAllByRole('tab')).toHaveLength(0);
        });

        it('persists a page tab and reattaches its view by page id after a reload', async () => {
            renderPanel({ chatId: 'chat-1' });
            openPage();
            const stored = localStorage.getItem(`unified-right-panel:${WS}:tabs`)!;
            expect(stored).toContain('html-page');
            expect(stored).toContain('page-1');
            cleanup();
            localStorage.setItem(`unified-right-panel:${WS}:tabs`, stored);
            vi.clearAllMocks();
            renderPanel({ chatId: 'chat-1' });
            expect(readUnifiedPanelState(WS).workspaceTabs[0]).toMatchObject({ kind: 'html-page', htmlPageId: 'page-1', resourceId: filePath });
            expect(screen.getByTestId(`unified-panel-tab-${tabId}`).getAttribute('aria-selected')).toBe('true');
            await waitFor(() => expect(bridge.open).toHaveBeenCalledWith('page-1', filePath));
        });

        it('accepts a group-scoped page owned by a local member repo', () => {
            renderPanel({ workspaceId: 'group-one', chatId: 'chat-1' });
            const detail = openPage('/workspace/member/index.htm', 'group-page', 'group-one', 'member-one');
            expect(detail.handled).toBe(true);
            const tabs = readUnifiedPanelState('group-one').workspaceTabs;
            expect(tabs).toHaveLength(1);
            expect(tabs[0].ownerWorkspaceId).toBe('member-one');
            expect(tabs[0].label).toBe('index.htm');
        });
    });

    describe('browser tabs', () => {
        const browserTabs = () => screen.queryAllByRole('tab').filter(tab => (tab.getAttribute('data-testid') ?? '').includes('browser'));

        it('opens blank and pasted-URL tabs, keeps them across chats, and never persists them', async () => {
            const { rerender } = renderPanel({ chatId: 'chat-1' });
            openViaMenu('unified-panel-open-browser');
            expect(browserTabs()).toHaveLength(1);
            expect(browserTabs()[0].textContent).toContain('New Tab');
            expect((screen.getByTestId('browser-address') as HTMLInputElement).value).toBe('');

            fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
            fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'example.com/docs' } });
            await waitFor(() => expect(screen.getByTestId('unified-panel-open-menu-url')).toBeTruthy());
            fireEvent.click(screen.getByTestId('unified-panel-open-menu-url'));
            expect(browserTabs()).toHaveLength(2);
            expect(browserTabs()[1].textContent).toContain('example.com');
            expect(browserTabs()[1].getAttribute('aria-selected')).toBe('true');

            rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
            expect(browserTabs()).toHaveLength(2);
            rerender(<UnifiedRightPanel workspaceId={WS} chatId={null} dock={dockStub()} />);
            expect(browserTabs()).toHaveLength(2);

            const closeId = browserTabs()[0].getAttribute('data-testid')!.replace('unified-panel-tab-', '');
            fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${closeId}`));
            expect(browserTabs()).toHaveLength(1);

            const raw = localStorage.getItem(`unified-right-panel:${WS}:tabs`) ?? '';
            expect(raw).not.toContain('browser');
            expect(raw).not.toContain('example.com');
        });

        it('rejects a malformed or unsupported address inline and follows a valid one', () => {
            renderPanel({ chatId: 'chat-1' });
            openViaMenu('unified-panel-open-browser');
            const address = screen.getByTestId('browser-address') as HTMLInputElement;

            fireEvent.change(address, { target: { value: 'what is a monad' } });
            fireEvent.submit(address.form!);
            expect(screen.getByTestId('browser-address-error').textContent).toMatch(/Not a URL/);
            expect(browserTabs()[0].textContent).toContain('New Tab');

            fireEvent.change(address, { target: { value: 'javascript:alert(1)' } });
            fireEvent.submit(address.form!);
            expect(screen.getByTestId('browser-address-error').textContent).toMatch(/not supported/);

            fireEvent.change(address, { target: { value: 'localhost:3000' } });
            expect(screen.queryByTestId('browser-address-error')).toBeNull();
            fireEvent.submit(address.form!);
            expect(address.value).toBe('http://localhost:3000/');
            expect(browserTabs()[0].textContent).toContain('localhost:3000');
            expect(readUnifiedPanelState(WS).workspaceTabs[0].browserUrl).toBe('http://localhost:3000/');
        });

        it.each([{ ctrlKey: true }, { metaKey: true }])('closes a web-hosted browser tab from its controls (%o)', modifiers => {
            renderPanel();
            Object.defineProperty(screen.getByTestId('unified-right-panel'), 'offsetParent', { get: () => document.body });
            openViaMenu('unified-panel-open-browser');
            const address = screen.getByTestId('browser-address');
            address.focus();
            const event = new KeyboardEvent('keydown', { key: 'w', ...modifiers, bubbles: true, cancelable: true });
            act(() => address.dispatchEvent(event));
            expect(event.defaultPrevented).toBe(true);
            expect(browserTabs()).toHaveLength(0);
        });

        it('offers the system browser when there is no desktop bridge', () => {
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            try {
                renderPanel({ chatId: 'chat-1' });
                openViaMenu('unified-panel-open-browser');
                fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
                expect((screen.getByTestId('browser-open-external') as HTMLButtonElement).disabled).toBe(true);
                fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
                const address = screen.getByTestId('browser-address') as HTMLInputElement;
                fireEvent.change(address, { target: { value: 'https://example.com' } });
                fireEvent.submit(address.form!);
                fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
                fireEvent.click(screen.getByTestId('browser-open-external'));
                expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener,noreferrer');
                expect(screen.getByTestId('browser-web-fallback').textContent).toContain('desktop app');
            } finally {
                open.mockRestore();
            }
        });
    });

    describe('desktop browser tabs', () => {
        type Listener<T> = ((payload: T) => void) | undefined;
        let onState: Listener<{
            viewId: string; url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean; error?: string;
        }>;
        let onCloseRequested: Listener<{ viewId: string }>;
        let onNewTab: Listener<{ openerViewId: string; url: string }>;
        let onDownload: Listener<{ viewId: string; url: string; ok: boolean; error?: string }>;
        const bridge = {
            open: vi.fn(async () => ({ ok: true as const })),
            navigate: vi.fn(async () => ({ ok: true as const })),
            nav: vi.fn(),
            setBounds: vi.fn(),
            hide: vi.fn(),
            close: vi.fn(),
            openExternal: vi.fn(async () => true),
            onCloseRequested: vi.fn((callback: typeof onCloseRequested) => { onCloseRequested = callback; return () => { onCloseRequested = undefined; }; }),
            onState: vi.fn((callback: typeof onState) => { onState = callback; return () => { onState = undefined; }; }),
            onNewTab: vi.fn((callback: typeof onNewTab) => { onNewTab = callback; return () => { onNewTab = undefined; }; }),
            onDownload: vi.fn((callback: typeof onDownload) => { onDownload = callback; return () => { onDownload = undefined; }; }),
        };
        const browserTabs = () => screen.queryAllByRole('tab').filter(tab => (tab.getAttribute('data-testid') ?? '').includes('browser'));
        const viewIdOf = (index = 0) => readUnifiedPanelState(WS).workspaceTabs.filter(tab => tab.kind === 'browser')[index].resourceId;
        const page = (viewId: string, patch: Partial<NonNullable<Parameters<NonNullable<typeof onState>>[0]>> = {}) => ({
            viewId, url: 'https://example.com/', title: '', canGoBack: false, canGoForward: false, loading: false, ...patch,
        });
        const openUrlTab = async (url: string) => {
            fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
            fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: url } });
            await waitFor(() => expect(screen.getByTestId('unified-panel-open-menu-url')).toBeTruthy());
            fireEvent.click(screen.getByTestId('unified-panel-open-menu-url'));
            await waitFor(() => expect(bridge.open).toHaveBeenCalled());
        };

        beforeEach(() => {
            vi.clearAllMocks();
            onState = undefined;
            onNewTab = undefined;
            onDownload = undefined;
            onCloseRequested = undefined;
            bridge.onCloseRequested.mockImplementation(callback => {
                onCloseRequested = callback;
                return () => { onCloseRequested = undefined; };
            });
            Object.defineProperty(window, 'cocDesktop', { value: { browser: bridge }, configurable: true });
        });

        it('closes only the active browser source through the existing lifecycle', async () => {
            writeUnifiedTreeState(WS, { open: false, width: 220 });
            const panel = renderPanel({ chatId: 'chat-1' });
            Object.defineProperty(screen.getByTestId('unified-right-panel'), 'offsetParent', { get: () => document.body });
            await openUrlTab('https://example.com/');
            const first = viewIdOf();
            await openUrlTab('https://other.example.com/');
            const second = viewIdOf(1);
            // Native focus can leave DOM focus on an unrelated editor/composer.
            document.body.focus();
            act(() => onCloseRequested?.({ viewId: first }));
            act(() => onCloseRequested?.({ viewId: 'another-workspace-view' }));
            expect(browserTabs()).toHaveLength(2);
            act(() => onCloseRequested?.({ viewId: second }));
            expect(browserTabs()).toHaveLength(1);
            expect(bridge.close).toHaveBeenCalledExactlyOnceWith(second);
            act(() => onCloseRequested?.({ viewId: second }));
            expect(browserTabs()).toHaveLength(1);
            panel.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub({ isOpen: false })} />);
            act(() => onCloseRequested?.({ viewId: first }));
            expect(bridge.close).toHaveBeenCalledTimes(1);
            panel.rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
            act(() => openWorkspaceDock(WS));
            act(() => onCloseRequested?.({ viewId: first }));
            expect(browserTabs()).toHaveLength(0);
            expect(bridge.close).toHaveBeenLastCalledWith(first);
            expect(bridge.hide).toHaveBeenCalledWith(first);
            expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('0');
        });

        it.each([{ ctrlKey: true }, { metaKey: true }])('closes the active browser from its editable address bar (%o)', async modifiers => {
            renderPanel();
            Object.defineProperty(screen.getByTestId('unified-right-panel'), 'offsetParent', { get: () => document.body });
            await openUrlTab('https://example.com/');
            const viewId = viewIdOf();
            const address = screen.getByTestId('browser-address');
            address.focus();
            const event = new KeyboardEvent('keydown', { key: 'w', ...modifiers, bubbles: true, cancelable: true });
            act(() => address.dispatchEvent(event));
            expect(event.defaultPrevented).toBe(true);
            expect(browserTabs()).toHaveLength(0);
            expect(bridge.close).toHaveBeenCalledWith(viewId);
        });

        it('targets a remote-owned browser in its group panel without closing another workspace', () => {
            const listeners = new Set<(event: { viewId: string }) => void>();
            bridge.onCloseRequested.mockImplementation(callback => {
                listeners.add(callback!);
                return () => { listeners.delete(callback!); };
            });
            const browserInput = (ownerRoutingRef: string, resourceId: string) => ({
                kind: 'browser' as const, ownerWorkspaceId: 'same-workspace-id', ownerRoutingRef,
                chatId: null, resourceId, label: 'Page', browserUrl: 'https://example.com/',
            });
            writeUnifiedPanelState('group', openTab(EMPTY_UNIFIED_PANEL, browserInput('remote:server-a:repo', 'group-view')));
            writeUnifiedPanelState(WS, openTab(EMPTY_UNIFIED_PANEL, browserInput('remote:server-b:repo', 'workspace-view')));
            renderPanel({ workspaceId: 'group', dock: dockStub({ target: 'another-dock-target' }) });
            renderPanel();
            for (const root of screen.getAllByTestId('unified-right-panel')) {
                Object.defineProperty(root, 'offsetParent', { get: () => document.body });
            }
            act(() => listeners.forEach(listener => listener({ viewId: 'group-view' })));
            expect(readUnifiedPanelState('group').workspaceTabs).toHaveLength(0);
            expect(readUnifiedPanelState(WS).workspaceTabs).toHaveLength(1);
            expect(bridge.close).toHaveBeenCalledExactlyOnceWith('group-view');
            cleanup();
            expect(listeners.size).toBe(0);
        });

        it('rejects native requests when a terminal is the active tab', async () => {
            renderPanel();
            Object.defineProperty(screen.getByTestId('unified-right-panel'), 'offsetParent', { get: () => document.body });
            await openUrlTab('https://example.com/');
            const browserId = viewIdOf();
            openViaMenu('unified-panel-open-terminal');
            act(() => onCloseRequested?.({ viewId: browserId }));
            expect(browserTabs()).toHaveLength(1);
            expect(bridge.close).not.toHaveBeenCalled();
            expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        });

        it('opens a chat web link as a new browser tab and claims the event', async () => {
            renderPanel({ chatId: 'chat-1' });
            const send = (url: string) => {
                const detail = { url, handled: false };
                act(() => { window.dispatchEvent(new CustomEvent('coc-open-browser-url', { detail })); });
                return detail;
            };
            expect(send('https://google.com/search?q=x').handled).toBe(true);
            expect(browserTabs()).toHaveLength(1);
            expect(browserTabs()[0].getAttribute('aria-selected')).toBe('true');
            await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(viewIdOf(), 'https://google.com/search?q=x', WS, undefined));

            // Each click opens its own tab, like the "+" menu does.
            send('https://google.com/search?q=x');
            expect(browserTabs()).toHaveLength(2);

            // Not a web URL, or already taken by another listener: left alone.
            expect(send('javascript:alert(1)').handled).toBe(false);
            const taken = { url: 'https://example.com', handled: true };
            act(() => { window.dispatchEvent(new CustomEvent('coc-open-browser-url', { detail: taken })); });
            expect(browserTabs()).toHaveLength(2);
        });

        it('ignores chat web links without the desktop browser view', () => {
            delete (window as { cocDesktop?: unknown }).cocDesktop;
            renderPanel({ chatId: 'chat-1' });
            const detail = { url: 'https://example.com', handled: false };
            act(() => { window.dispatchEvent(new CustomEvent('coc-open-browser-url', { detail })); });
            expect(detail.handled).toBe(false);
            expect(browserTabs()).toHaveLength(0);
        });

        it('opens a view only once a blank tab has a URL, then navigates the live view', async () => {
            renderPanel({ chatId: 'chat-1' });
            openViaMenu('unified-panel-open-browser');
            expect(bridge.open).not.toHaveBeenCalled();
            expect((screen.getByTestId('browser-back') as HTMLButtonElement).disabled).toBe(true);

            const address = screen.getByTestId('browser-address') as HTMLInputElement;
            fireEvent.change(address, { target: { value: 'example.com' } });
            fireEvent.submit(address.form!);
            const viewId = viewIdOf();
            await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(viewId, 'https://example.com/', WS, undefined));
            expect(bridge.navigate).not.toHaveBeenCalled();

            fireEvent.change(address, { target: { value: 'https://example.org/next' } });
            fireEvent.submit(address.form!);
            await waitFor(() => expect(bridge.navigate).toHaveBeenCalledWith(viewId, 'https://example.org/next'));
            expect(bridge.open).toHaveBeenCalledTimes(1);
        });

        it('follows redirects, title and history, and drives back/forward/stop/reload', async () => {
            renderPanel({ chatId: 'chat-1' });
            await openUrlTab('https://example.com');
            const viewId = viewIdOf();
            act(() => onState?.(page(viewId, { url: 'https://example.com/login', loading: true, canGoBack: true })));
            expect((screen.getByTestId('browser-address') as HTMLInputElement).value).toBe('https://example.com/login');
            expect((screen.getByTestId('browser-back') as HTMLButtonElement).disabled).toBe(false);
            expect((screen.getByTestId('browser-forward') as HTMLButtonElement).disabled).toBe(true);
            fireEvent.click(screen.getByTestId('browser-stop'));
            expect(bridge.nav).toHaveBeenCalledWith(viewId, 'stop');

            act(() => onState?.(page(viewId, {
                url: 'https://example.com/login', title: 'Sign in', canGoBack: true, canGoForward: true,
            })));
            expect(browserTabs()[0].textContent).toContain('Sign in');
            expect(screen.getByTestId('browser-title').textContent).toBe('Sign in');
            expect(readUnifiedPanelState(WS).workspaceTabs[0].browserUrl).toBe('https://example.com/login');
            fireEvent.click(screen.getByTestId('browser-back'));
            fireEvent.click(screen.getByTestId('browser-forward'));
            fireEvent.click(screen.getByTestId('browser-reload'));
            expect(bridge.nav.mock.calls.map(call => call[1])).toEqual(['stop', 'back', 'forward', 'reload']);
        });

        it('shows a load failure with Retry and hides the view while failed', async () => {
            renderPanel({ chatId: 'chat-1' });
            await openUrlTab('https://example.com');
            const viewId = viewIdOf();
            bridge.hide.mockClear();
            act(() => onState?.(page(viewId, { error: 'ERR_CONNECTION_REFUSED' })));
            expect(screen.getByTestId('browser-load-error').textContent).toContain('ERR_CONNECTION_REFUSED');
            expect(bridge.hide).toHaveBeenCalledWith(viewId);
            fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
            expect(bridge.nav).toHaveBeenCalledWith(viewId, 'reload');
            act(() => onState?.(page(viewId, { title: 'Back up' })));
            expect(screen.queryByTestId('browser-load-error')).toBeNull();
        });

        it('keeps the view across chat switches and collapse, and closes it only with the tab', async () => {
            const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
                x: 40, y: 80, width: 320, height: 240,
            } as DOMRect);
            try {
                const { rerender } = renderPanel({ chatId: 'chat-1' });
                await openUrlTab('https://example.com');
                const viewId = viewIdOf();
                await waitFor(() => expect(bridge.setBounds).toHaveBeenCalledWith(viewId, { x: 40, y: 80, width: 320, height: 240 }));
                bridge.hide.mockClear();
                fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
                expect(bridge.hide).toHaveBeenCalledWith(viewId);
                fireEvent.keyDown(document, { key: 'Escape' });

                rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
                rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub({ isOpen: false })} />);
                expect(bridge.hide).toHaveBeenCalledWith(viewId);
                rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
                expect(bridge.close).not.toHaveBeenCalled();
                // Any remount reopens with the same id and session, which keeps live history.
                expect(new Set(bridge.open.mock.calls.map(call => JSON.stringify(call)))).toEqual(
                    new Set([JSON.stringify([viewId, 'https://example.com/', WS, undefined])]),
                );

                const id = browserTabs()[0].getAttribute('data-testid')!.replace('unified-panel-tab-', '');
                fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${id}`));
                expect(bridge.close).toHaveBeenCalledWith(viewId);
            } finally {
                rect.mockRestore();
            }
        });

        it('opens a page\'s new-window link as another tab with the opener\'s owner', async () => {
            renderPanel({ chatId: 'chat-1' });
            await openUrlTab('https://example.com');
            const viewId = viewIdOf();
            act(() => onNewTab?.({ openerViewId: 'not-a-tab', url: 'https://ignored.example/' }));
            act(() => onNewTab?.({ openerViewId: viewId, url: 'javascript:alert(1)' }));
            expect(browserTabs()).toHaveLength(1);
            act(() => onNewTab?.({ openerViewId: viewId, url: 'https://docs.example.com/page', engine: 'webview2' }));
            expect(browserTabs()).toHaveLength(2);
            expect(browserTabs()[1].getAttribute('aria-selected')).toBe('true');
            const [opener, opened] = readUnifiedPanelState(WS).workspaceTabs;
            expect(opened.browserUrl).toBe('https://docs.example.com/page');
            expect(opened.ownerWorkspaceId).toBe(opener.ownerWorkspaceId);
            expect(opened.browserEngine).toBe('webview2');
            expect(opened.resourceId).not.toBe(opener.resourceId);
            await waitFor(() => expect(bridge.open).toHaveBeenCalledWith(opened.resourceId, 'https://docs.example.com/page', WS, 'webview2'));
        });

        it('reports download handoff and opens the current page in the system browser via the bridge', async () => {
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            try {
                renderPanel({ chatId: 'chat-1' });
                await openUrlTab('https://example.com');
                const viewId = viewIdOf();
                act(() => onDownload?.({ viewId: 'other', url: 'https://example.com/x.zip', ok: true }));
                expect(screen.queryByTestId('browser-notice')).toBeNull();
                act(() => onDownload?.({ viewId, url: 'https://example.com/file.zip', ok: true }));
                expect(screen.getByTestId('browser-notice').textContent).toContain('system browser');
                act(() => onDownload?.({ viewId, url: 'https://example.com/file.zip', ok: false, error: 'no handler' }));
                expect(screen.getByTestId('browser-notice').textContent).toContain('no handler');

                act(() => onState?.(page(viewId, { url: 'https://example.com/after' })));
                fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
                fireEvent.click(screen.getByTestId('browser-open-external'));
                await waitFor(() => expect(bridge.openExternal).toHaveBeenCalledWith('https://example.com/after'));
                expect(open).not.toHaveBeenCalled();
                bridge.openExternal.mockResolvedValueOnce(false);
                fireEvent.click(screen.getByRole('button', { name: 'Browser options' }));
                fireEvent.click(screen.getByTestId('browser-open-external'));
                await waitFor(() => expect(screen.getByTestId('browser-notice').textContent).toContain('Could not open your system browser'));
            } finally {
                open.mockRestore();
            }
        });
    });

    it('starts empty, and its empty state creates nothing on its own', () => {
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '1');
        renderPanel();
        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('0');
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        // The selected Explorer mode is panel chrome, not a resource tab.
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
        expect(screen.queryByTestId('mock-notes')).toBeNull();
        // The way out of the empty state is an explicit action.
        fireEvent.click(screen.getByTestId('unified-panel-empty-open'));
        expect(screen.getByTestId('unified-panel-open-menu-popover')).toBeTruthy();
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
    });

    it('reconciles initial visibility from the selected chat and restores its active tab', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'src/a.ts', label: 'a.ts',
        });
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'src/b.ts', label: 'b.ts',
        });
        writeUnifiedPanelState(WS, state);
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '0');

        renderPanel({ chatId: 'chat-a', dock: dockStub({ isOpen: false }) });

        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('1');
        const activeId = unifiedTabId({
            kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'src/b.ts',
        });
        expect(screen.getByTestId(`unified-panel-tab-${activeId}`).getAttribute('aria-selected')).toBe('true');
    });

    it('closes for an empty destination chat and reopens the remembered source chat unchanged', () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'src/a.ts', label: 'a.ts',
        });
        state = openTab(state, {
            kind: 'canvas', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'canvas-1', label: 'Canvas',
        });
        writeUnifiedPanelState(WS, state);
        const rememberedState = readUnifiedPanelState(WS);

        const { rerender } = renderPanel({ chatId: 'chat-a' });
        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('1');

        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-b" dock={dockStub()} />);
        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('0');
        expect(readUnifiedPanelState(WS)).toEqual(rememberedState);

        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-a" dock={dockStub({ isOpen: false })} />);
        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('1');
        expect(readUnifiedPanelState(WS)).toEqual(rememberedState);
        const canvasId = unifiedTabId({
            kind: 'canvas', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'canvas-1',
        });
        expect(screen.getByTestId(`unified-panel-tab-${canvasId}`).getAttribute('aria-selected')).toBe('true');
    });

    it('counts workspace-owned tabs as visible in every selected chat', () => {
        writeUnifiedPanelState(WS, openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: 'chat-a', resourceId: 'terminal', label: 'Terminal',
        }));
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '0');

        renderPanel({ chatId: 'chat-b', dock: dockStub({ isOpen: false }) });

        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('1');
    });

    it('allows an explicitly opened empty panel to remain open for the current chat', () => {
        localStorage.setItem(workspaceDockOpenStorageKey(WS), '1');
        const { rerender } = renderPanel({ chatId: 'chat-a' });
        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('0');

        openWorkspaceDock(WS);
        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-a" dock={dockStub()} />);

        expect(localStorage.getItem(workspaceDockOpenStorageKey(WS))).toBe('1');
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
    });

    it('shows exactly one panel with one visible view per selected tab', () => {
        renderPanel();
        openViaMenu('unified-panel-open-terminal');
        openViaMenu('unified-panel-open-notes');

        expect(screen.getAllByTestId('unified-right-panel')).toHaveLength(1);
        const terminalId = unifiedTabId({ kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal' });
        const notesId = unifiedTabId({ kind: 'notes', ownerWorkspaceId: WS, chatId: null, resourceId: 'notes' });
        // Opening activates the new tab; the terminal stays mounted but hidden.
        expect(screen.getByTestId(`unified-panel-view-${notesId}`).getAttribute('data-active')).toBe('true');
        expect(screen.getByTestId(`unified-panel-view-${terminalId}`).getAttribute('data-active')).toBe('false');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
    });

    it('keeps a mounted view alive across tab switches and a collapse', () => {
        const { rerender } = renderPanel();
        openViaMenu('unified-panel-open-terminal');
        const terminal = screen.getByTestId('mock-terminal');

        openViaMenu('unified-panel-open-notes');
        // Same DOM node — switching hid it, it did not unmount and respawn.
        expect(screen.getByTestId('mock-terminal')).toBe(terminal);

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ isOpen: false })} />);
        expect(screen.getByTestId('unified-right-panel').getAttribute('data-open')).toBe('false');
        // Collapse hides the column (so the tabs leave the a11y tree with it);
        // the tab session and the live view are untouched.
        expect(screen.getAllByRole('tab', { hidden: true })).toHaveLength(2);
        expect(screen.getByTestId('mock-terminal')).toBe(terminal);

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        expect(screen.getByTestId('unified-right-panel').getAttribute('data-open')).toBe('true');
        expect(screen.getAllByRole('tab')).toHaveLength(2);
    });

    it('mounts a restored tab only once it is shown, and never a background one', () => {
        // A reload with two terminals persisted: only the active one attaches.
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        state = openTab(state, {
            kind: 'notes', ownerWorkspaceId: WS, chatId: null, resourceId: 'notes', label: 'Notes',
        });
        writeUnifiedPanelState(WS, state);

        renderPanel();
        expect(screen.getAllByRole('tab')).toHaveLength(2);
        // Notes was the last active tab; the terminal descriptor restored as a
        // tab without mounting a session.
        expect(screen.getByTestId('mock-notes')).toBeTruthy();
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
    });

    it('does not mount anything while collapsed', () => {
        const state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        writeUnifiedPanelState(WS, state);

        renderPanel({ dock: dockStub({ isOpen: false }) });
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
    });

    it('hides the panel when the last tab is closed, without touching the others', () => {
        renderPanel();
        openViaMenu('unified-panel-open-terminal');
        const terminalId = unifiedTabId({ kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal' });

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${terminalId}`));
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        // Reopening starts a fresh mount rather than resurrecting a stale one.
        openViaMenu('unified-panel-open-terminal');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
    });

    it('reuses the dock controller width and resize handle', () => {
        const dock = dockStub({ width: 500, maxWidth: 800 });
        renderPanel({ dock });
        const body = screen.getByTestId('unified-panel-body');
        expect(body.style.width).toBe('500px');

        const handle = screen.getByTestId('unified-panel-resize-handle');
        expect(handle.getAttribute('aria-valuenow')).toBe('500');
        expect(handle.getAttribute('aria-valuemax')).toBe('800');
        fireEvent.mouseDown(handle);
        expect(dock.handleMouseDown).toHaveBeenCalled();
    });

    it('renders Search and Explorer as keep-alive modes at the same panel width', () => {
        writeUnifiedTreeState(WS, { open: true, width: 220 });
        const { rerender } = renderPanel({ dock: dockStub({ mode: 'explorer', width: 500 }) });
        const explorer = screen.getByTestId('unified-panel-explorer-mode');
        expect(screen.getByTestId('unified-panel-body').style.width).toBe('500px');
        expect(screen.getByTestId('unified-panel-tree').style.display).not.toBe('none');
        expect(screen.queryByTestId('mock-content-search')).toBeNull();

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ mode: 'search', width: 620 })} />);
        const search = screen.getByTestId('unified-panel-search-mode');
        expect(screen.getByTestId('unified-panel-body').style.width).toBe('620px');
        expect(search.style.display).not.toBe('none');
        expect(explorer.style.display).toBe('none');

        rerender(<UnifiedRightPanel workspaceId={WS} dock={dockStub({ mode: 'explorer', width: 620 })} />);
        expect(screen.getByTestId('unified-panel-body').style.width).toBe('620px');
        expect(screen.getByTestId('unified-panel-explorer-mode')).toBe(explorer);
        expect(screen.getByTestId('unified-panel-search-mode')).toBe(search);
    });

    it('routes Search to the dock target and opens a result in the existing file tabs', () => {
        renderPanel({
            chatId: 'chat-1',
            dock: dockStub({ mode: 'search', target: 'ws-member' }),
        });
        expect(screen.getByTestId('mock-content-search').textContent).toContain('search:ws-member');

        fireEvent.click(screen.getByTestId('mock-search-result'));

        const fileId = unifiedTabId({
            kind: 'file',
            ownerWorkspaceId: 'ws-member',
            chatId: 'chat-1',
            resourceId: 'src/match.ts',
        });
        expect(screen.getByTestId(`unified-panel-tab-${fileId}`)).toBeTruthy();
        expect(screen.getByTestId('unified-panel-search-mode')).toBeTruthy();
    });

    it('opens workspace resources against the dock target, with repo attribution', () => {
        const member = 'ws-member';
        renderPanel({
            dock: dockStub({
                target: member,
                targets: [{ workspaceId: WS, label: 'group' }, { workspaceId: member, label: 'api' }],
            }),
        });
        // The menu's Explorer entry selects and opens the navigator rather than
        // opening a tab; the tree browses the dock target, with deep-linking off
        // for a member repo.
        openViaMenu('unified-panel-open-explorer');
        expect(screen.getByTestId('unified-panel-tree').style.display).not.toBe('none');
        expect(screen.getByTestId('mock-explorer').textContent).toBe(`explorer:${member}:false`);
        expect(screen.getByTestId('unified-panel-tab-list').querySelectorAll('[role="tab"]')).toHaveLength(0);

        // A tab opened against the member carries the repo attribution. Read it
        // off the tab, not the document: the strip's repo picker shows the same
        // label for the dock target.
        openViaMenu('unified-panel-open-terminal');
        const terminalId = unifiedTabId({
            kind: 'terminal', ownerWorkspaceId: member, chatId: null, resourceId: 'terminal',
        });
        expect(screen.getByTestId(`unified-panel-tab-repo-${terminalId}`).textContent).toBe('api');
        // Notes stays with the panel's own workspace scope.
        openViaMenu('unified-panel-open-notes');
        expect(screen.getByTestId('mock-notes').textContent).toBe(`notes:${WS}`);
    });

    it('offers no Explorer when the target has no single repository root', () => {
        renderPanel({ dock: dockStub({ target: 'group-acme' }) });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        expect(screen.getByTestId('unified-panel-open-terminal')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-open-explorer')).toBeNull();
    });

    it('persists its tabs per workspace across a remount', () => {
        const { unmount } = renderPanel();
        openViaMenu('unified-panel-open-terminal');
        unmount();

        renderPanel();
        expect(screen.getAllByRole('tab')).toHaveLength(1);
        expect(screen.getByText('Terminal')).toBeTruthy();

        cleanup();
        // Another workspace has its own set.
        render(<UnifiedRightPanel workspaceId="ws-2" dock={dockStub({ target: 'ws-2' })} />);
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
    });

    it('files chat-owned tabs under the selected chat and keeps workspace tabs visible', () => {
        const { rerender } = renderPanel({ chatId: 'chat-1' });
        openViaMenu('unified-panel-open-terminal');
        writeUnifiedPanelState(WS, openTab(
            // A chat-owned file, as AC-04's entry points will open it.
            openTab(EMPTY_UNIFIED_PANEL, { kind: 'terminal', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'terminal', label: 'Terminal' }),
            { kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts', label: 'a.ts' },
        ));
        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);
        expect(screen.getAllByRole('tab')).toHaveLength(2);

        // Switching chats drops the chat-owned tab and keeps the workspace one.
        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-2" dock={dockStub()} />);
        const labels = screen.getAllByRole('tab').map(node => node.getAttribute('data-kind'));
        expect(labels).toEqual(['terminal']);
    });

    it('keeps the draft strip and active body visible when the draft becomes a chat', async () => {
        let state = openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal', label: 'Terminal',
        });
        state = openTab(state, {
            kind: 'file', ownerWorkspaceId: WS, chatId: null, resourceId: 'src/a.ts', label: 'a.ts',
        });
        writeUnifiedPanelState(WS, state);
        const { rerender } = renderPanel({ chatId: null });
        expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('data-kind'))).toEqual(['terminal', 'file']);
        expect(await screen.findByTestId('mock-monaco')).toBeTruthy();

        inheritDraftPanelTabs(WS, 'chat-1');
        rerender(<UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />);

        expect(screen.getAllByRole('tab').map(tab => tab.getAttribute('data-kind'))).toEqual(['terminal', 'file']);
        expect(await screen.findByTestId('mock-monaco')).toBeTruthy();
    });

    it('opens a searched file as a tab of the selected chat', async () => {
        searchFiles.mockResolvedValue({ results: [{ path: 'src/app.ts' }] });
        renderPanel({ chatId: 'chat-1' });
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'app' } });
        fireEvent.click(await screen.findByTestId('unified-panel-open-menu-file-0'));

        // The menu closes and the file is a chat-scoped tab on the panel.
        expect(screen.queryByTestId('unified-panel-open-menu-popover')).toBeNull();
        const fileId = unifiedTabId({ kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/app.ts' });
        expect(screen.getByTestId(`unified-panel-tab-${fileId}`)).toBeTruthy();
    });

    it('hands focus back to the "+" trigger when the menu is dismissed', () => {
        renderPanel();
        const trigger = screen.getByTestId('unified-panel-open-menu') as HTMLButtonElement;
        trigger.focus();
        fireEvent.click(trigger);
        expect(screen.getByTestId('unified-panel-open-menu-popover')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('unified-panel-open-menu-popover')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('shows an explicit state for a kind it has no view for, instead of a blank panel', () => {
        // Every kind this build knows now renders, so the fallback is for a
        // descriptor from a build that knows one more — it must not blank the panel.
        writeUnifiedPanelState(WS, openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'future-kind' as never, ownerWorkspaceId: WS, chatId: null, resourceId: 'x', label: 'x',
        }));
        renderPanel();
        expect(screen.getByTestId('unified-panel-unsupported')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-empty')).toBeNull();
    });
});
