/**
 * Terminal close confirmation in the unified panel (AC-05).
 *
 * The tab's ✕ lives in the strip, outside the terminal view, so the panel is
 * what has to ask before ending a PTY. These cases pin the three outcomes the
 * goal names — cancel leaves both the tab and the process, confirm ends exactly
 * the reported sessions and then closes, a failed terminate keeps the tab with a
 * visible error — plus the case that must NOT prompt at all: a tab whose
 * sessions have already exited.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TerminalSessionSummary } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';

// A terminal view that reports whatever the test tells it to, so the panel's
// guard is exercised against the real reporting seam without xterm or a socket.
let reportSessions: (sessions: readonly TerminalSessionSummary[]) => void = () => {};
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({
        workspaceId, onSessionsChange,
    }: {
        workspaceId: string;
        onSessionsChange?: (sessions: readonly TerminalSessionSummary[]) => void;
    }) => {
        reportSessions = sessions => onSessionsChange?.(sessions);
        return <div data-testid="mock-terminal">terminal:{workspaceId}</div>;
    },
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: () => <div data-testid="mock-explorer" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: () => <div data-testid="mock-notes" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/explorerApi', () => ({
    explorerApi: {
        searchFiles: async () => ({ results: [] }),
        readBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
        writeBlob: async () => ({ success: true }),
        readTrustedBlob: async () => ({ content: '', encoding: 'utf-8', mimeType: 'text/plain' }),
    },
}));

const deleteTerminal = vi.fn(async (_ws: string, _id: string) => undefined);
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    getCocClientForWorkspace: () => ({
        canvases: { list: async () => [], create: async () => ({ id: 'c1', title: 'c' }) },
        workspaces: { deleteTerminal: (ws: string, id: string) => deleteTerminal(ws, id) },
    }),
    lookupCloneBaseUrl: () => null,
}));

import { UnifiedRightPanel } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedRightPanel';
import { clearUnifiedPanelState } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
import { unifiedTabId } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelTabsModel';
import type { WorkspaceDockController } from '../../../../src/server/spa/client/react/features/repo-detail/useWorkspaceDock';

const WS = 'ws-1';
const TERMINAL_TAB_ID = unifiedTabId({
    kind: 'terminal', ownerWorkspaceId: WS, chatId: null, resourceId: 'terminal',
});

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

/** Open the terminal tab through the "+" menu, as a user would. */
function openTerminalTab() {
    render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
    fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
    fireEvent.click(screen.getByTestId('unified-panel-open-terminal'));
    return screen.getByTestId(`unified-panel-tab-close-${TERMINAL_TAB_ID}`);
}

function report(sessions: readonly TerminalSessionSummary[]) {
    act(() => { reportSessions(sessions); });
}

describe('UnifiedRightPanel terminal close guard', () => {
    beforeEach(() => {
        localStorage.clear();
        clearUnifiedPanelState();
        deleteTerminal.mockReset();
        deleteTerminal.mockResolvedValue(undefined);
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        cleanup();
        clearUnifiedPanelState();
        vi.restoreAllMocks();
    });

    it('asks before closing a terminal tab with a live session', () => {
        const closeButton = openTerminalTab();
        report([{ id: 't1', serverSessionId: 's-1', status: 'running' }]);

        fireEvent.click(closeButton);

        expect(screen.getByTestId('unified-panel-close-confirm-message').textContent)
            .toContain('its running terminal session');
        // Nothing has happened yet: the tab is there and no kill was issued.
        expect(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeTruthy();
        expect(deleteTerminal).not.toHaveBeenCalled();
    });

    it('cancel leaves the tab and the process alone', () => {
        const closeButton = openTerminalTab();
        report([{ id: 't1', serverSessionId: 's-1', status: 'running' }]);
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-cancel'));

        expect(screen.queryByTestId('unified-panel-close-confirm')).toBeNull();
        expect(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeTruthy();
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(deleteTerminal).not.toHaveBeenCalled();
    });

    it('confirm ends exactly the live sessions, then closes the tab', async () => {
        const closeButton = openTerminalTab();
        report([
            { id: 't1', serverSessionId: 's-1', status: 'running' },
            { id: 't2', serverSessionId: 's-2', status: 'running' },
            // Already dead: it must not be killed a second time.
            { id: 't3', serverSessionId: 's-3', status: 'exited' },
        ]);
        fireEvent.click(closeButton);
        expect(screen.getByTestId('unified-panel-close-confirm-message').textContent)
            .toContain('its 2 running terminal sessions');

        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-confirm'));

        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeNull());
        expect(deleteTerminal.mock.calls).toEqual([[WS, 's-1'], [WS, 's-2']]);
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        expect(screen.getByTestId('unified-panel-empty')).toBeTruthy();
    });

    it('a failed terminate keeps the tab and shows the error', async () => {
        deleteTerminal.mockRejectedValueOnce(new Error('nope'));
        const closeButton = openTerminalTab();
        report([{ id: 't1', serverSessionId: 's-1', status: 'running' }]);
        fireEvent.click(closeButton);

        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-confirm'));

        await screen.findByTestId('unified-panel-close-confirm-error');
        expect(screen.getByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeTruthy();
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();

        // The failed confirm becomes a retry rather than a dead dialog.
        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-confirm'));
        await waitFor(() => expect(screen.queryByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeNull());
        expect(deleteTerminal).toHaveBeenCalledTimes(2);
    });

    it('closes without prompting when only tombstones remain', () => {
        const closeButton = openTerminalTab();
        report([{ id: 't1', serverSessionId: 's-1', status: 'exited' }]);

        fireEvent.click(closeButton);

        expect(screen.queryByTestId('unified-panel-close-confirm')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeNull();
        expect(deleteTerminal).not.toHaveBeenCalled();
    });

    it('does not prompt for a non-terminal tab', () => {
        render(<UnifiedRightPanel workspaceId={WS} dock={dockStub()} />);
        fireEvent.click(screen.getByTestId('unified-panel-open-menu'));
        fireEvent.click(screen.getByTestId('unified-panel-open-notes'));
        const notesTabId = unifiedTabId({
            kind: 'notes', ownerWorkspaceId: WS, chatId: null, resourceId: 'notes',
        });

        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${notesTabId}`));

        expect(screen.queryByTestId('unified-panel-close-confirm')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${notesTabId}`)).toBeNull();
    });

    it('drops a pending prompt whose tab is gone', () => {
        const closeButton = openTerminalTab();
        report([{ id: 't1', serverSessionId: 's-1', status: 'running' }]);
        fireEvent.click(closeButton);
        expect(screen.getByTestId('unified-panel-close-confirm')).toBeTruthy();

        // The terminal view itself reports the session gone (it exited while the
        // prompt was up), and a second close now needs no confirmation.
        report([{ id: 't1', serverSessionId: 's-1', status: 'exited' }]);
        fireEvent.click(screen.getByTestId('unified-panel-close-confirm-cancel'));
        fireEvent.click(screen.getByTestId(`unified-panel-tab-close-${TERMINAL_TAB_ID}`));

        expect(screen.queryByTestId('unified-panel-close-confirm')).toBeNull();
        expect(screen.queryByTestId(`unified-panel-tab-${TERMINAL_TAB_ID}`)).toBeNull();
    });
});
