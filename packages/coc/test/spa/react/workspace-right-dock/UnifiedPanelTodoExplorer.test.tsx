/** @vitest-environment jsdom */
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { SentinelTodoItem } from '@plusplusoneplusplus/coc-client';

const { client, events } = vi.hoisted(() => {
    const events = new Set<(message: unknown) => void>();
    return {
        events,
        client: {
            sentinelTodos: { get: vi.fn() },
            triggers: { listSentinelTodo: async () => [] },
            canvases: { list: async () => [] },
            events: { connect: ({ onMessage }: { onMessage: (message: unknown) => void }) => {
                events.add(onMessage);
                return { close: () => events.delete(onMessage) };
            } },
        },
    };
});
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => client,
    getCocClientFor: () => client,
}));
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: () => <button>Terminal content</button>,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/NotesView', () => ({
    NotesView: () => <button>Notes content</button>,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <button>Explorer content</button>,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ContentSearchPanel', () => ({
    ContentSearchPanel: () => <button>Search content</button>,
}));
// Keep the real shell/dirty bridge and To-do list; replace the source editor's
// browser-only implementation with an observable live, editable buffer.
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/PreviewPane', () => ({
    PreviewPane: ({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) => (
        <textarea aria-label="Source buffer" defaultValue="saved" onChange={() => onDirtyChange?.(true)} />
    ),
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState, readUnifiedPanelState, writeUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { activateTab, EMPTY_UNIFIED_PANEL, openTab, unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { clearUnifiedTreeState, readUnifiedTreeState, writeUnifiedTreeState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTree';
import { sentinelTodoTabInput } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoPanelModel';
import { clearSentinelTodoExcursion } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoExcursion';
import { clearSentinelTodoChats } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/sentinelTodoChats';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-todo';
const CHAT = 'sentinel';
const todo = sentinelTodoTabInput({ ownerWorkspaceId: 'member', ownerRoutingRef: null, processId: CHAT }, CHAT);
const file = { kind: 'file' as const, ownerWorkspaceId: 'member', ownerRoutingRef: null,
    chatId: CHAT, resourceId: 'src/dirty.ts', label: 'dirty.ts' };

function item(id: string): SentinelTodoItem {
    return { id, title: `Item ${id}`, completionCondition: 'Test passes', notes: '', status: 'todo',
        archived: false, revision: 1, createdAt: '2026-10-09T00:00:00Z', updatedAt: '2026-10-09T00:00:00Z',
        createdBy: 'sentinel', updatedBy: 'sentinel', jobs: [], type: 'normal', priority: 'regular' };
}
function dock(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return { isOpen: true, mode: 'explorer', target: 'member', targets: [], width: 900, maxWidth: 1200,
        isDragging: false, toggleOpen: vi.fn(), selectMode: vi.fn(), setTarget: vi.fn(() => true),
        handleMouseDown: vi.fn(), handleTouchStart: vi.fn(), ...overrides };
}
function seed(activeTodo = true, scope = WS) {
    const state = openTab(openTab(EMPTY_UNIFIED_PANEL, file), todo);
    writeUnifiedPanelState(scope, activeTodo ? state : activateTab(state, CHAT, unifiedTabId(file)));
    writeUnifiedTreeState(scope, { open: true, width: 243 });
}
function panel(controller = dock(), scope = WS, chatId = CHAT) {
    return <><button>Chat content</button><UnifiedRightPanel workspaceId={scope} chatId={chatId} dock={controller} /></>;
}
function selectItem(id = 'one') {
    return screen.getByTestId(`sentinel-todo-row-${id}`).querySelector('button[data-todo-select]') as HTMLButtonElement;
}
function explorerOpen(scope = WS) { return readUnifiedTreeState(scope).open; }
async function loaded() { await screen.findByTestId('sentinel-todo-row-one'); }
async function refreshLedger() {
    const calls = client.sentinelTodos.get.mock.calls.length;
    act(() => events.forEach(onMessage => onMessage({ type: 'sentinel-todos-changed', workspaceId: 'member', processId: CHAT, ledgerRevision: 2 })));
    await waitFor(() => expect(client.sentinelTodos.get.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.getByTestId('sentinel-todo-refresh')).not.toBeDisabled());
}

beforeEach(() => {
    localStorage.clear();
    clearUnifiedPanelState();
    clearUnifiedTreeState();
    clearSentinelTodoExcursion();
    clearSentinelTodoChats();
    events.clear();
    client.sentinelTodos.get.mockReset().mockImplementation(async () => ({ revision: 2, items: [item('one'), item('two')] }));
    applyRuntimeConfigPatch({ sentinelTodoScrubberEnabled: false, sentinelTodoDependenciesEnabled: false,
        sentinelPrOutcomeWakeEnabled: false, sentinelTodoTagsEnabled: false,
        sessionContextAttachmentsEnabled: false });
});
afterEach(() => { cleanup(); clearUnifiedPanelState(); clearUnifiedTreeState(); clearSentinelTodoExcursion(); clearSentinelTodoChats(); });

describe('To-do activation and Explorer presentation', () => {
    it('hides restored Explorer on entry, retaining its width and the selected owner/target', async () => {
        seed();
        const controller = dock();
        const before = readUnifiedPanelState(WS);
        render(panel(controller));
        await loaded();
        expect(explorerOpen()).toBe(false);
        expect(screen.getByTestId('unified-panel-mode-column')).toHaveStyle({ display: 'none' });
        expect(readUnifiedTreeState(WS).width).toBe(243);
        expect(readUnifiedPanelState(WS)).toEqual(before);
        expect(controller.setTarget).not.toHaveBeenCalled();
        expect(controller.selectMode).not.toHaveBeenCalled();
        expect(client.sentinelTodos.get).toHaveBeenCalledWith('member', CHAT, { full: true });
    });

    it('keeps Explorer hidden through item clicks, keyboard selection, ledger events and rerenders', async () => {
        seed();
        const view = render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(selectItem());
        act(() => selectItem('two').focus());
        await user.keyboard('{Enter}');
        await refreshLedger();
        view.rerender(panel(dock({ width: 1000 })));
        expect(explorerOpen()).toBe(false);
    });

    it('preserves explicit reopen during item interactions and background refresh, then hides on tab reactivation', async () => {
        seed();
        render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Show Explorer' }));
        await user.click(selectItem());
        act(() => selectItem('two').focus());
        await user.keyboard(' ');
        await refreshLedger();
        expect(explorerOpen()).toBe(true);
        await user.click(screen.getByRole('tab', { name: /dirty.ts/ }));
        expect(explorerOpen()).toBe(true);
        await user.click(screen.getByRole('tab', { name: /To-do/ }));
        expect(explorerOpen()).toBe(false);
    });

    it.each(['{Enter}', ' ', '{ArrowRight}'])('hides on keyboard tab activation via %s without losing a dirty source buffer', async key => {
        seed(false);
        render(panel());
        const buffer = screen.getByRole('textbox', { name: 'Source buffer' });
        fireEvent.change(buffer, { target: { value: 'unsaved change' } });
        const before = readUnifiedPanelState(WS);
        const user = userEvent.setup();
        act(() => screen.getByRole('tab', { name: key === '{ArrowRight}' ? /dirty.ts/ : /To-do/ }).focus());
        await user.keyboard(key);
        await loaded();
        expect(explorerOpen()).toBe(false);
        expect(screen.getByRole('tab', { name: /dirty.ts/ })).toHaveTextContent('●');
        expect(readUnifiedPanelState(WS).chatTabs).toEqual(before.chatTabs);
        await user.click(screen.getByRole('tab', { name: /dirty.ts/ }));
        expect(screen.getByRole('textbox', { name: 'Source buffer' })).toBe(buffer);
        expect(buffer).toHaveValue('unsaved change');
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each(['pointer', 'keyboard'])('hides when %s returns from another focused content view, ignoring panel chrome', async interaction => {
        seed();
        render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Show Explorer' }));
        await user.click(selectItem());
        expect(explorerOpen()).toBe(true);
        if (interaction === 'pointer') {
            await user.click(screen.getByRole('button', { name: 'Chat content' }));
            // A list's padding/text need not take DOM focus.
            fireEvent.pointerDown(screen.getByTestId('sentinel-todo-row-one'));
        } else {
            act(() => screen.getByRole('button', { name: 'Explorer content' }).focus());
            act(() => selectItem().focus());
        }
        expect(explorerOpen()).toBe(false);
    });

    it('treats a deliberate click on the still-selected To-do tab as activation after leaving its content', async () => {
        seed();
        render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Show Explorer' }));
        await user.click(screen.getByRole('button', { name: 'Chat content' }));
        await user.click(screen.getByRole('tab', { name: /To-do/ }));
        expect(explorerOpen()).toBe(false);
    });

    it('retains explicit reopen across the To-do item menu portal and focus restoration', async () => {
        applyRuntimeConfigPatch({ sessionContextAttachmentsEnabled: true });
        seed();
        render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Show Explorer' }));
        await user.click(within(screen.getByTestId('sentinel-todo-row-one')).getByRole('button', { name: 'More actions' }));
        const action = screen.getByRole('menuitem', { name: 'Attach' });
        expect(screen.getByTestId('unified-panel-views').contains(action)).toBe(false);
        act(() => action.focus());
        await user.keyboard('{Escape}');
        await user.click(selectItem());
        expect(explorerOpen()).toBe(true);
    });

    it('accepts an explicit Explorer open from outside panel chrome while To-do remains selected', async () => {
        seed();
        render(panel());
        await loaded();
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: 'Chat content' }));
        // The chat header folder action shares this canonical tree store.
        act(() => writeUnifiedTreeState(WS, { open: true, width: 243 }));
        await user.click(selectItem());
        await refreshLedger();
        expect(explorerOpen()).toBe(true);
    });

    it('preserves Search mode and leaves non-To-do views alone', async () => {
        seed();
        const controller = dock({ mode: 'search' });
        const view = render(panel(controller));
        await loaded();
        expect(explorerOpen()).toBe(true);
        await userEvent.click(screen.getByRole('tab', { name: /dirty.ts/ }));
        view.rerender(panel(dock()));
        expect(explorerOpen()).toBe(true);
    });

    it('accepts explicit Explorer selection while Search is already open', async () => {
        seed();
        const view = render(panel(dock({ mode: 'search' })));
        await loaded();
        await userEvent.click(screen.getByRole('button', { name: 'Chat content' }));
        // External folder controls select Explorer with the navigator already open.
        view.rerender(panel(dock()));
        await userEvent.click(selectItem());
        expect(explorerOpen()).toBe(true);
    });

    it('preserves explicit Explorer reopen when revealing a collapsed panel with To-do retained', async () => {
        seed();
        const view = render(panel());
        await loaded();
        view.rerender(panel(dock({ isOpen: false })));
        act(() => writeUnifiedTreeState(WS, { open: true, width: 243 }));
        view.rerender(panel());
        await userEvent.click(selectItem());
        expect(explorerOpen()).toBe(true);
    });

    it('keeps Explorer hidden when leaving To-do for another tab until explicitly reopened', async () => {
        seed();
        render(panel());
        await loaded();
        await userEvent.click(screen.getByRole('tab', { name: /dirty.ts/ }));
        expect(explorerOpen()).toBe(false);
        await userEvent.click(screen.getByRole('button', { name: 'Show Explorer' }));
        expect(explorerOpen()).toBe(true);
    });

    it('isolates workspace and chat scopes and hides on returning to the To-do chat', async () => {
        seed();
        seed(false, 'other-workspace');
        const view = render(panel());
        await loaded();
        expect(explorerOpen('other-workspace')).toBe(true);
        await userEvent.click(screen.getByRole('button', { name: 'Show Explorer' }));
        view.rerender(panel(dock(), WS, 'other-chat'));
        expect(explorerOpen()).toBe(true);
        expect(screen.queryByTestId('sentinel-todo-row-one')).toBeNull();
        view.rerender(panel());
        await loaded();
        expect(explorerOpen()).toBe(false);
        expect(explorerOpen('other-workspace')).toBe(true);
        expect(readUnifiedPanelState(WS).chatTabs[CHAT]).toHaveLength(2);
    });
});
