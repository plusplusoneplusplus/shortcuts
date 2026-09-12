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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
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
}));
// `PreviewPane` opens a language document for every live repo file; this suite
// is about panel behaviour, not language support.
vi.mock('../../../../src/server/spa/client/react/features/language-servers/languageServerClient',
    async () => await import('../language-servers/inertTransportMock'));


import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import {
    clearUnifiedPanelState,
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
    });

    it('starts empty, and its empty state creates nothing on its own', () => {
        renderPanel();
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

        // A tab opened against the member carries the repo attribution.
        openViaMenu('unified-panel-open-terminal');
        expect(screen.getByText('api')).toBeTruthy();
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
            kind: 'browser' as never, ownerWorkspaceId: WS, chatId: null, resourceId: 'https://x', label: 'x',
        }));
        renderPanel();
        expect(screen.getByTestId('unified-panel-unsupported')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-empty')).toBeNull();
    });
});
