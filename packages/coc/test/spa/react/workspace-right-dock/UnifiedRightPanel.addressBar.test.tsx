/**
 * UnifiedRightPanel — `coc://` pages in web tabs: a web tab's address bar
 * shows To-do, Settings and Terminal in place of the page with the owner the
 * "+" menu uses, back/forward step across them, and the "+" menu opens or
 * focuses a web tab at an address. There are no dedicated tabs for them.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
    subscribeCloneBaseUrl: () => () => {},
}));
// The panel's ledger listener; a test fires a change through it.
let emitTodoChange: ((event: { workspaceId: string; processId: string; ledgerRevision: number }) => void) | null = null;
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats', async importOriginal => ({
    ...(await importOriginal<object>()),
    useSentinelTodoEvents: (_owner: unknown, onChange: typeof emitTodoChange) => { emitTodoChange = onChange; },
}));
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => <div data-testid="mock-terminal">terminal:{workspaceId}</div>,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));
vi.mock('../../../../src/server/spa/client/react/shared/file-viewer/MonacoFileEditor', () => ({
    MonacoFileEditor: () => <div data-testid="mock-monaco" />,
    getMonacoLanguage: () => 'plaintext',
}));
// The To-do view's own selection is pinned in select-request-panel.test.tsx.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedTodoTab', () => ({
    UnifiedTodoTab: ({ owner, selectItemRequest, onSelectionChange, reloadNonce = 0 }: {
        owner: { ownerWorkspaceId: string };
        selectItemRequest?: { id: string; nonce: number } | null;
        onSelectionChange?: (id: string | null) => void;
        reloadNonce?: number;
    }) => (
        <div data-testid="mock-todo" data-owner={owner.ownerWorkspaceId} data-reload={reloadNonce} data-request={selectItemRequest ? `${selectItemRequest.id}:${selectItemRequest.nonce}` : ''}>
            <button type="button" onClick={() => onSelectionChange?.(selectItemRequest?.id ?? null)}>apply</button>
            <button type="button" onClick={() => onSelectionChange?.(null)}>clear</button>
        </div>
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { WorkspaceSettingsProvider } from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';
import { _resetRuntimeConfig } from '../../../../src/server/spa/client/react/utils/config';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, openTab, unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { browserOpenInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { clearSentinelTodoChats, publishSentinelTodoChat } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';
import {
    clearSentinelTodoExcursion, startSentinelTodoExcursion, visitSentinelTodoExcursionChat,
} from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';

const WS = 'ws-1';

function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true, toggleOpen: vi.fn(), mode: 'explorer', selectMode: vi.fn(), target: WS, setTarget: vi.fn(),
        targets: [], width: 420, maxWidth: 900, isDragging: false, handleMouseDown: vi.fn(), handleTouchStart: vi.fn(),
        ...overrides,
    };
}

function renderPanel({ workspaceId = WS, chatId = 'chat-1', dock = dockStub() }: {
    workspaceId?: string; chatId?: string | null; dock?: WorkspaceDockController;
} = {}) {
    return render(
        <WorkspaceSettingsProvider ownerKey={workspaceId} renderPage={() => <div data-testid="settings-page" />}>
            <UnifiedRightPanel workspaceId={workspaceId} chatId={chatId} dock={dock} />
        </WorkspaceSettingsProvider>,
    );
}

function seed(workspaceId: string, ...inputs: Parameters<typeof openTab>[1][]) {
    writeUnifiedPanelState(workspaceId, inputs.reduce(openTab, EMPTY_UNIFIED_PANEL));
}

const address = () => screen.getByTestId('browser-address') as HTMLInputElement;
function typeAddress(value: string) {
    act(() => {
        fireEvent.change(address(), { target: { value } });
        fireEvent.keyDown(address(), { key: 'Enter' });
    });
}
const tabsOf = (workspaceId: string) => {
    const state = readUnifiedPanelState(workspaceId);
    return [...state.workspaceTabs, ...Object.values(state.chatTabs).flat()];
};
const browserTabs = (workspaceId = WS) => tabsOf(workspaceId).filter(tab => tab.kind === 'browser');
const cocPage = () => screen.queryByTestId('browser-coc-page');
const click = (testId: string) => act(() => { fireEvent.click(screen.getByTestId(testId)); });
const webTab = (owner = WS, url?: string) => browserOpenInput({ ownerWorkspaceId: owner, chatId: 'chat-1' }, url);

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    // jsdom has no layout; the panel's visibility checks read offsetParent.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
});

afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearSentinelTodoChats();
    clearSentinelTodoExcursion();
    emitTodoChange = null;
    _resetRuntimeConfig();
    vi.restoreAllMocks();
});

describe('UnifiedRightPanel coc:// pages in web tabs', () => {
    it('shows coc://settings in place of the page, in the same tab, with the web toolbar', () => {
        seed(WS, webTab());
        renderPanel();
        typeAddress('COC://Settings/');
        expect(cocPage()).toContainElement(screen.getByTestId('settings-page'));
        expect(address().value).toBe('coc://settings');
        expect(screen.getByTestId('browser-toolbar')).toContainElement(address());
        expect(browserTabs()).toEqual([expect.objectContaining({ browserUrl: 'coc://settings', label: 'Settings' })]);
        expect(tabsOf(WS)).toHaveLength(1);
    });

    it('steps back to the web page and forward to the coc:// page', () => {
        seed(WS, webTab());
        renderPanel();
        typeAddress('coc://terminal');
        typeAddress('coc://settings');
        expect(cocPage()).toContainElement(screen.getByTestId('settings-page'));
        click('browser-back');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(address().value).toBe('coc://terminal');
        click('browser-back');
        expect(cocPage()).toBeNull();
        expect(browserTabs()[0]).toMatchObject({ label: 'New Tab' });
        expect(browserTabs()[0].browserUrl).toBeUndefined();
        expect((screen.getByTestId('browser-back') as HTMLButtonElement).disabled).toBe(true);
        click('browser-forward');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        click('browser-forward');
        expect(address().value).toBe('coc://settings');
        expect((screen.getByTestId('browser-forward') as HTMLButtonElement).disabled).toBe(true);
    });

    it('a web address from a coc:// page leaves it and drops forward steps', () => {
        seed(WS, webTab());
        renderPanel();
        typeAddress('coc://terminal');
        typeAddress('example.com');
        expect(cocPage()).toBeNull();
        expect(browserTabs()[0]).toMatchObject({ browserUrl: 'https://example.com/' });
        click('browser-back');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        click('browser-forward');
        expect(cocPage()).toBeNull();
        expect(address().value).toBe('https://example.com/');
    });

    it('routes Terminal to the web tab owner and Settings to the panel scope in a repo group', () => {
        const group = 'group-g';
        const member = 'ws-member';
        seed(group, webTab(member));
        renderPanel({ workspaceId: group, dock: dockStub({
            target: member, targets: [{ workspaceId: group, label: 'group' }, { workspaceId: member, label: 'api' }],
        }) });
        typeAddress('coc://terminal');
        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${member}`);
        typeAddress('coc://settings');
        expect(cocPage()).toContainElement(screen.getByTestId('settings-page'));
    });

    it('refuses coc://todo without a Sentinel chat and stays on the page', () => {
        seed(WS, webTab());
        renderPanel();
        typeAddress('coc://todo');
        expect(screen.getByTestId('browser-address-error').textContent).toBe('To-do is only available in a Sentinel chat');
        expect(cocPage()).toBeNull();
        typeAddress('coc://git');
        expect(screen.getByTestId('browser-address-error').textContent).toBe('Not supported yet');
        expect(browserTabs()[0].browserUrl).toBeUndefined();
    });

    it('shows the Sentinel To-do, selects the addressed item and follows the selection', () => {
        publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'chat-1', title: 'Sentinel' });
        seed(WS, webTab());
        renderPanel();
        typeAddress('coc://todo/item-7');
        const todo = screen.getByTestId('mock-todo');
        expect(todo.dataset.owner).toBe(WS);
        const [id, nonce] = todo.dataset.request!.split(':');
        expect(id).toBe('item-7');
        act(() => { fireEvent.click(screen.getByText('apply')); });
        expect(address().value).toBe('coc://todo/item-7');
        act(() => { fireEvent.click(screen.getByText('clear')); });
        expect(address().value).toBe('coc://todo');
        expect(browserTabs()[0].browserUrl).toBe('coc://todo');

        // The same page again is a new request, not a new history step.
        typeAddress('coc://todo/item-7');
        expect(screen.getByTestId('mock-todo').dataset.request).not.toBe(`item-7:${nonce}`);
        click('browser-back');
        expect(cocPage()).toBeNull();
    });

    it('Ctrl/Cmd+L on a coc:// page focuses and selects the address', () => {
        seed(WS, webTab());
        renderPanel();
        typeAddress('coc://settings');
        const page = screen.getByTestId('settings-page');
        const event = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true });
        act(() => { page.dispatchEvent(event); });
        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(address());
        expect(address().selectionEnd).toBe('coc://settings'.length);
    });

    it('reloads Settings and To-do from the toolbar without a new history step', () => {
        let mounts = 0;
        function SettingsPage() {
            const [mount] = useState(() => ++mounts);
            return <div data-testid="settings-page">{mount}</div>;
        }
        publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'sentinel-1', title: 'Sentinel' });
        seed(WS, webTab());
        render(
            <WorkspaceSettingsProvider ownerKey={WS} renderPage={() => <SettingsPage />}>
                <UnifiedRightPanel workspaceId={WS} chatId="chat-1" dock={dockStub()} />
            </WorkspaceSettingsProvider>,
        );
        typeAddress('coc://settings');
        expect(screen.getByTestId('settings-page').textContent).toBe('1');
        click('browser-reload');
        expect(screen.getByTestId('settings-page').textContent).toBe('2');
        expect(browserTabs()).toHaveLength(1);
        expect(address().value).toBe('coc://settings');

        typeAddress('coc://todo');
        expect(screen.getByTestId('mock-todo').dataset.reload).toBe('1');
        click('browser-reload');
        expect(screen.getByTestId('mock-todo').dataset.reload).toBe('2');
        expect(address().value).toBe('coc://todo');
        expect(browserTabs().filter(tab => tab.browserUrl === 'coc://todo')).toHaveLength(1);
    });

    it('shows the shared Settings form in whichever tab is active', () => {
        const first = webTab(WS, 'coc://settings');
        seed(WS, first, webTab());
        renderPanel();
        typeAddress('coc://settings');
        const activeView = () => document.querySelector('[data-testid^="unified-panel-view-"][data-active="true"]')!;
        expect(activeView().querySelector('[data-testid="browser-coc-page"]')).toContainElement(screen.getByTestId('settings-page'));
        click(`unified-panel-tab-${unifiedTabId(first)}`);
        expect(activeView().querySelector('[data-testid="browser-coc-page"]')).toContainElement(screen.getByTestId('settings-page'));
        expect(screen.getAllByTestId('settings-page')).toHaveLength(1);
    });

    it('opens a tab restored at a coc:// address on that page', () => {
        seed(WS, webTab(WS, 'coc://terminal'));
        renderPanel();
        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${WS}`);
        expect(address().value).toBe('coc://terminal');
    });

    it('shows a restored To-do page once its Sentinel chat is known', () => {
        seed(WS, webTab(WS, 'coc://todo'));
        renderPanel();
        expect(screen.getByTestId('browser-address-error').textContent).toBe('To-do is only available in a Sentinel chat');
        act(() => { publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'sentinel-1', title: 'Sentinel' }); });
        expect(screen.getByTestId('mock-todo').dataset.owner).toBe(WS);
        expect(screen.queryByTestId('browser-address-error')).toBeNull();
        expect(address().value).toBe('coc://todo');
    });

    it('opens a new web tab at an address typed in the "+" menu', async () => {
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
        await act(async () => { fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'coc://terminal' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu-coc')); });
        expect(browserTabs()).toEqual([expect.objectContaining({ browserUrl: 'coc://terminal', label: 'Terminal' })]);
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-open-menu-search')).toBeNull();
    });

    it('keeps the menu open with an inline error for an unavailable address', async () => {
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
        await act(async () => { fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'coc://todo' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu-coc')); });
        expect(screen.getByTestId('unified-panel-open-menu-coc-error').textContent).toBe('To-do is only available in a Sentinel chat');
        expect(browserTabs()).toHaveLength(0);
    });
});

describe('UnifiedRightPanel Terminal, Settings and To-do entry points', () => {
    const openFromMenu = (action: string) => {
        click('unified-panel-open-menu');
        click(`unified-panel-open-${action}`);
    };
    const activeTab = () => readUnifiedPanelState(WS).activeByScope['chat-1'];

    it.each([['terminal', 'coc://terminal', 'mock-terminal'], ['settings', 'coc://settings', 'settings-page']])(
        'opens %s as a web tab at its coc:// page and focuses that tab on the next open', (action, url, view) => {
            seed(WS, webTab(WS, 'https://example.com/'));
            renderPanel();
            openFromMenu(action);
            const [page] = browserTabs().filter(tab => tab.browserUrl === url);
            expect(page).toMatchObject({ ownerWorkspaceId: WS });
            expect(activeTab()).toBe(page.id);
            expect(cocPage()).toContainElement(screen.getByTestId(view));

            click(`unified-panel-tab-${browserTabs()[0].id}`);
            openFromMenu(action);
            expect(browserTabs().filter(tab => tab.browserUrl === url)).toHaveLength(1);
            expect(activeTab()).toBe(page.id);
        });

    it('opens and focuses the chat\'s To-do page from the menu', () => {
        publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'sentinel-1', title: 'Sentinel' });
        renderPanel();
        openFromMenu('todo');
        openFromMenu('todo');
        expect(browserTabs()).toEqual([expect.objectContaining({ browserUrl: 'coc://todo', browserChatId: 'chat-1' })]);
        expect(screen.getByTestId('mock-todo').dataset.owner).toBe(WS);
    });

    it('opens the To-do page on the first ledger write when the chat shows no tab', () => {
        publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'sentinel-1', title: 'Sentinel' });
        renderPanel();
        act(() => emitTodoChange!({ workspaceId: WS, processId: 'sentinel-1', ledgerRevision: 1 }));
        expect(browserTabs()).toEqual([expect.objectContaining({ browserUrl: 'coc://todo', browserChatId: 'chat-1' })]);
        expect(screen.getByTestId('mock-todo')).toBeTruthy();
        act(() => emitTodoChange!({ workspaceId: WS, processId: 'sentinel-1', ledgerRevision: 1 }));
        expect(browserTabs()).toHaveLength(1);
    });

    it('shows the origin Sentinel\'s ledger in the pinned To-do of a visited chat', () => {
        const origin = { scopeWorkspaceId: WS, chatId: 'chat-s', title: 'Release', href: '#repos/ws-1/chats/chat-s' };
        act(() => {
            startSentinelTodoExcursion({ ...origin, owner: { ownerWorkspaceId: 'origin-ws', processId: 'sentinel-9' }, linkKey: 'i1|ref:x' });
            visitSentinelTodoExcursionChat({ scopeWorkspaceId: WS, chatId: 'chat-1', title: 'Child', href: '#repos/ws-1/chats/chat-1' });
        });
        renderPanel();
        // The visited chat is not a Sentinel chat; the pinned page still resolves.
        expect(screen.getByTestId('mock-todo').dataset.owner).toBe('origin-ws');
        expect(address().value).toBe('coc://todo');
        expect(screen.getByText('To-do · Release')).toBeTruthy();
        // The pinned tab is layered on read, never stored.
        expect(browserTabs()).toHaveLength(0);
    });
});
