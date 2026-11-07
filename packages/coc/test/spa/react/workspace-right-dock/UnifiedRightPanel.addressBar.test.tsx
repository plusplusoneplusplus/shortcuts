/**
 * UnifiedRightPanel — the `coc://` address row (`features.panelAddressBar`):
 * typed addresses open or focus To-do, Settings and Terminal tabs with the
 * owner the "+" menu uses, Ctrl/Cmd+L focuses the address, and the flag off
 * leaves the panel unchanged.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({ canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) } }),
    lookupCloneBaseUrl: () => null,
    subscribeCloneBaseUrl: () => () => {},
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats', async importOriginal => ({
    ...(await importOriginal<object>()),
    useSentinelTodoEvents: () => {},
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
    UnifiedTodoTab: ({ owner, selectItemRequest, onSelectionChange }: {
        owner: { ownerWorkspaceId: string };
        selectItemRequest?: { id: string; nonce: number } | null;
        onSelectionChange?: (id: string | null) => void;
    }) => (
        <div data-testid="mock-todo" data-owner={owner.ownerWorkspaceId} data-request={selectItemRequest ? `${selectItemRequest.id}:${selectItemRequest.nonce}` : ''}>
            <button type="button" onClick={() => onSelectionChange?.(selectItemRequest?.id ?? null)}>apply</button>
            <button type="button" onClick={() => onSelectionChange?.(null)}>clear</button>
        </div>
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { WorkspaceSettingsProvider } from '../../../../src/server/spa/client/react/features/repo-settings/WorkspaceSettingsHost';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { EMPTY_UNIFIED_PANEL, openTab, unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { browserOpenInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { clearUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { clearSentinelTodoChats, publishSentinelTodoChat } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

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

function seed(workspaceId: string, input: Parameters<typeof openTab>[1]) {
    writeUnifiedPanelState(workspaceId, openTab(EMPTY_UNIFIED_PANEL, input));
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
const pressL = (target: Element) => {
    const event = new KeyboardEvent('keydown', { key: 'l', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
};
const settingsInput = { kind: 'settings' as const, ownerWorkspaceId: WS, ownerRoutingRef: null, chatId: 'chat-1', resourceId: 'settings', label: 'Settings' };

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    // jsdom has no layout; the panel's visibility checks read offsetParent.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
    applyRuntimeConfigPatch({ panelAddressBarEnabled: true });
});

afterEach(() => {
    cleanup();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearSentinelTodoChats();
    _resetRuntimeConfig();
    vi.restoreAllMocks();
});

describe('UnifiedRightPanel address row', () => {
    it('shows the address of a Settings tab with navigator controls in its row', () => {
        seed(WS, settingsInput);
        renderPanel();
        expect(address().value).toBe('coc://settings');
        const row = screen.getByTestId('unified-panel-address-row');
        expect(row.querySelector('[data-testid="unified-panel-search-toggle"]')?.getAttribute('data-placement')).toBe('toolbar');
        expect(screen.queryByTestId('unified-panel-address-owner')).toBeNull();
    });

    it('opens each address once and focuses the existing tab with no duplicate', () => {
        seed(WS, settingsInput);
        renderPanel();
        typeAddress('coc://terminal');
        expect(address().value).toBe('coc://terminal');
        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${WS}`);
        typeAddress('COC://Settings/');
        expect(address().value).toBe('coc://settings');
        typeAddress('coc://terminal');
        expect(address().value).toBe('coc://terminal');
        expect(tabsOf(WS).map(tab => tab.kind).sort()).toEqual(['settings', 'terminal']);
    });

    it('opens Terminal for the dock target and Settings for the panel scope in a repo group', () => {
        const group = 'group-g';
        const member = 'ws-member';
        seed(group, { ...settingsInput, ownerWorkspaceId: group });
        renderPanel({ workspaceId: group, dock: dockStub({
            target: member, targets: [{ workspaceId: group, label: 'group' }, { workspaceId: member, label: 'api' }],
        }) });
        typeAddress('coc://terminal');
        const terminal = tabsOf(group).find(tab => tab.kind === 'terminal');
        expect(terminal).toMatchObject({ ownerWorkspaceId: member, repoLabel: 'api' });
        expect(screen.getByTestId('unified-panel-address-owner').textContent).toBe('api');
        typeAddress('coc://settings');
        expect(tabsOf(group).filter(tab => tab.kind === 'settings')).toEqual([expect.objectContaining({ ownerWorkspaceId: group })]);
        expect(screen.queryByTestId('unified-panel-address-owner')).toBeNull();
    });

    it('refuses coc://todo without a Sentinel chat and opens nothing', () => {
        seed(WS, settingsInput);
        renderPanel();
        typeAddress('coc://todo');
        expect(screen.getByTestId('unified-panel-address-error').textContent).toBe('To-do is only available in a Sentinel chat');
        expect(tabsOf(WS).map(tab => tab.kind)).toEqual(['settings']);
    });

    it('opens the Sentinel To-do and selects the addressed item', () => {
        publishSentinelTodoChat(WS, 'chat-1', { ownerWorkspaceId: WS, processId: 'chat-1', title: 'Sentinel' });
        seed(WS, settingsInput);
        renderPanel();
        typeAddress('coc://todo/item-7');
        const todo = tabsOf(WS).find(tab => tab.kind === 'todo')!;
        expect(todo).toMatchObject({ ownerWorkspaceId: WS, resourceId: 'chat-1', chatId: 'chat-1' });
        expect(screen.getByTestId('mock-todo').dataset.request).toBe('item-7:1');
        expect(address().value).toBe('coc://todo');
        act(() => { fireEvent.click(screen.getByText('apply')); });
        expect(address().value).toBe('coc://todo/item-7');

        // The same item again is a new request.
        act(() => { fireEvent.click(screen.getByText('clear')); });
        typeAddress('coc://todo/item-7');
        expect(screen.getByTestId('mock-todo').dataset.request).toBe('item-7:2');
        expect(tabsOf(WS).filter(tab => tab.kind === 'todo')).toHaveLength(1);

        // Leaving the tab drops the request.
        typeAddress('coc://settings');
        typeAddress('coc://todo');
        expect(screen.getByTestId('mock-todo').dataset.request).toBe('');
    });

    it('rejects unknown hosts inline without reaching the browser', () => {
        seed(WS, settingsInput);
        renderPanel();
        typeAddress('coc://git');
        expect(screen.getByTestId('unified-panel-address-error').textContent).toBe('Not supported yet');
        expect(tabsOf(WS).map(tab => tab.kind)).toEqual(['settings']);
    });

    it('Ctrl/Cmd+L focuses and selects the address from the panel, but not from an editable field', () => {
        seed(WS, settingsInput);
        renderPanel();
        const tab = screen.getByTestId(`unified-panel-tab-${unifiedTabId(settingsInput)}`);
        tab.focus();
        expect(pressL(tab)).toBe(true);
        expect(document.activeElement).toBe(address());
        expect(address().selectionStart).toBe(0);
        expect(address().selectionEnd).toBe('coc://settings'.length);

        const field = document.createElement('input');
        screen.getByTestId('settings-page').appendChild(field);
        field.focus();
        expect(pressL(field)).toBe(false);
        expect(document.activeElement).toBe(field);
    });

    it('keeps the breadcrumb toolbar for file tabs and never shows the address row', () => {
        seed(WS, { kind: 'file', ownerWorkspaceId: WS, chatId: 'chat-1', resourceId: 'src/a.ts', label: 'a.ts' });
        renderPanel();
        expect(screen.getByTestId('unified-panel-toolbar')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-address-row')).toBeNull();
    });

    it('opens an address typed in the "+" menu', async () => {
        seed(WS, settingsInput);
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
        await act(async () => { fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'coc://terminal' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu-coc')); });
        expect(tabsOf(WS).map(tab => tab.kind).sort()).toEqual(['settings', 'terminal']);
        expect(screen.queryByTestId('unified-panel-open-menu-search')).toBeNull();
    });

    it('keeps the menu open with an inline error for an unavailable address', async () => {
        seed(WS, settingsInput);
        renderPanel();
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
        await act(async () => { fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'coc://todo' } }); });
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu-coc')); });
        expect(screen.getByTestId('unified-panel-open-menu-coc-error').textContent).toBe('To-do is only available in a Sentinel chat');
        expect(tabsOf(WS).map(tab => tab.kind)).toEqual(['settings']);
    });

    it('opens a coc:// address typed in a web tab\'s address bar instead of rejecting it as a URL', () => {
        seed(WS, browserOpenInput({ ownerWorkspaceId: WS, chatId: 'chat-1' }));
        renderPanel();
        expect(screen.queryByTestId('unified-panel-address-row')).toBeNull();
        typeAddress('coc://terminal');
        expect(tabsOf(WS).map(tab => tab.kind).sort()).toEqual(['browser', 'terminal']);
        expect(screen.getByTestId('mock-terminal').textContent).toBe(`terminal:${WS}`);
    });

    it('shows coc:// errors inline in a web tab without opening anything', () => {
        seed(WS, browserOpenInput({ ownerWorkspaceId: WS, chatId: 'chat-1' }));
        renderPanel();
        typeAddress('coc://todo');
        expect(screen.getByText('To-do is only available in a Sentinel chat')).toBeTruthy();
        typeAddress('coc://git');
        expect(screen.getByText('Not supported yet')).toBeTruthy();
        expect(tabsOf(WS).map(tab => tab.kind)).toEqual(['browser']);
    });

    it('with the flag off shows no row, binds no Ctrl/Cmd+L and offers no coc:// menu row', async () => {
        applyRuntimeConfigPatch({ panelAddressBarEnabled: false });
        seed(WS, browserOpenInput({ ownerWorkspaceId: WS, chatId: 'chat-1' }));
        const web = renderPanel();
        typeAddress('coc://terminal');
        expect(tabsOf(WS).map(tab => tab.kind)).toEqual(['browser']);
        expect(screen.getByText(/coc: URLs are not supported/)).toBeTruthy();
        web.unmount();
        clearUnifiedPanelState();

        applyRuntimeConfigPatch({ panelAddressBarEnabled: false });
        seed(WS, settingsInput);
        renderPanel();
        expect(screen.queryByTestId('unified-panel-address-row')).toBeNull();
        expect(screen.getByTestId('unified-panel-search-toggle').getAttribute('data-placement')).toBe('strip');
        const tab = screen.getByTestId(`unified-panel-tab-${unifiedTabId(settingsInput)}`);
        tab.focus();
        expect(pressL(tab)).toBe(false);
        await act(async () => { fireEvent.click(screen.getByTestId('unified-panel-open-menu')); });
        await act(async () => { fireEvent.change(screen.getByTestId('unified-panel-open-menu-search'), { target: { value: 'coc://settings' } }); });
        expect(screen.queryByTestId('unified-panel-open-menu-coc')).toBeNull();
        expect(screen.getByTestId('unified-panel-open-menu-url-error')).toBeTruthy();
    });
});
