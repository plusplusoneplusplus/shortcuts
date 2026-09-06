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
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

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
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

const WS = 'ws-1';

/**
 * A dock controller stub. The real one is exercised by the existing
 * WorkspaceRightDock tests; the panel only reads open/width/target from it.
 */
function dockStub(overrides: Partial<WorkspaceDockController> = {}): WorkspaceDockController {
    return {
        isOpen: true,
        toggleOpen: vi.fn(),
        view: 'terminal',
        setView: vi.fn(),
        views: ['terminal', 'explorer', 'notes'],
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
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
    });

    it('starts empty, and its empty state creates nothing on its own', () => {
        renderPanel();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
        // Nothing was auto-opened: no terminal, no explorer, no notes.
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        expect(screen.queryByTestId('mock-explorer')).toBeNull();
        expect(screen.queryByTestId('mock-notes')).toBeNull();
        // The way out of the empty state is an explicit action.
        fireEvent.click(screen.getByTestId('unified-panel-empty-open'));
        expect(screen.getByTestId('unified-panel-open-menu-popover')).toBeTruthy();
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
    });

    it('shows exactly one panel with one visible view per selected tab', () => {
        renderPanel();
        openViaMenu('unified-panel-open-terminal');
        openViaMenu('unified-panel-open-explorer');

        expect(screen.getAllByTestId('unified-right-panel')).toHaveLength(1);
        const terminalId = unifiedTabId({ kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal' });
        const explorerId = unifiedTabId({ kind: 'explorer', ownerWorkspaceId: WS, chatId: null, resourceId: 'explorer' });
        // Opening activates the new tab; the terminal stays mounted but hidden.
        expect(screen.getByTestId(`unified-panel-view-${explorerId}`).getAttribute('data-active')).toBe('true');
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

    it('opens workspace resources against the dock target, with repo attribution', () => {
        const member = 'ws-member';
        renderPanel({
            dock: dockStub({
                target: member,
                targets: [{ workspaceId: WS, label: 'group' }, { workspaceId: member, label: 'api' }],
            }),
        });
        openViaMenu('unified-panel-open-explorer');

        // Explorer follows the target repo; deep-linking is off for a member.
        expect(screen.getByTestId('mock-explorer').textContent).toBe(`explorer:${member}:false`);
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

    it('shows an explicit state for a kind it cannot render yet, instead of a blank panel', () => {
        writeUnifiedPanelState(WS, openTab(EMPTY_UNIFIED_PANEL, {
            kind: 'canvas', ownerWorkspaceId: WS, chatId: null, resourceId: 'canvas-1', label: 'Plan',
        }));
        renderPanel();
        expect(screen.getByTestId('unified-panel-unsupported')).toBeTruthy();
        expect(screen.queryByTestId('unified-panel-empty')).toBeNull();
    });
});
