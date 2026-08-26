/** @vitest-environment jsdom */
/**
 * Regression guard for the single-row dock header: the terminal toolbar (picker
 * + new-terminal action) must portal INTO the dock header next to the
 * Terminal/Explorer tabs — not render as a second stacked row. Renders the real
 * WorkspaceRightDock + TerminalView together (only xterm's TerminalPanel, the
 * Monaco ExplorerPanel, and config/network are mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalPanel', () => ({
    TerminalPanel: ({ sessionId }: { sessionId: string }) => (
        <div data-testid={`mock-terminal-panel-${sessionId}`}>mock terminal</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

let uuidCounter = 0;
vi.stubGlobal('crypto', {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
});
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue({ sessions: [] }),
}));

import {
    WorkspaceRightDock,
    useWorkspaceDock,
    type DockTarget,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

function Harness({ workspaceId = 'ws1', targets }: { workspaceId?: string; targets?: DockTarget[] }) {
    const dock = useWorkspaceDock(workspaceId, targets);
    return (
        <div>
            <button data-testid="ext-toggle" onClick={dock.toggleOpen}>toggle</button>
            <WorkspaceRightDock workspaceId={workspaceId} dock={dock} targets={targets} />
        </div>
    );
}

function openDock() {
    act(() => {
        fireEvent.click(screen.getByTestId('ext-toggle'));
    });
}

describe('WorkspaceRightDock single-row header', () => {
    beforeEach(() => {
        localStorage.clear();
        uuidCounter = 0;
    });

    it('renders compact Terminal/Explorer tabs in the header', () => {
        render(<Harness />);
        openDock();

        const header = screen.getByTestId('workspace-dock-header');
        expect(within(header).getByTestId('workspace-dock-view-terminal')).toBeTruthy();
        expect(within(header).getByTestId('workspace-dock-view-explorer')).toBeTruthy();
    });

    it('portals the terminal toolbar into the header (single row, not stacked)', () => {
        render(<Harness />);
        openDock();

        const header = screen.getByTestId('workspace-dock-header');
        // The new-terminal action lives in the header from the start (empty state).
        expect(within(header).getByTestId('terminal-new-btn')).toBeTruthy();

        // Create a terminal → its picker also appears inside the header row.
        act(() => {
            fireEvent.click(within(header).getByTestId('terminal-new-btn'));
        });
        expect(within(header).getByTestId('terminal-picker-btn')).toBeTruthy();
    });

    it('drops the toolbar out of the header when Explorer is active', () => {
        render(<Harness />);
        openDock();

        const header = screen.getByTestId('workspace-dock-header');
        act(() => {
            fireEvent.click(within(header).getByTestId('terminal-new-btn'));
        });
        expect(within(header).getByTestId('terminal-picker-btn')).toBeTruthy();

        // Switch to Explorer → toolbar no longer portals into the header.
        act(() => {
            fireEvent.click(within(header).getByTestId('workspace-dock-view-explorer'));
        });
        expect(within(header).queryByTestId('terminal-picker-btn')).toBeNull();
        expect(within(header).queryByTestId('terminal-new-btn')).toBeNull();

        // Switching back restores it.
        act(() => {
            fireEvent.click(within(header).getByTestId('workspace-dock-view-terminal'));
        });
        expect(within(header).getByTestId('terminal-picker-btn')).toBeTruthy();
    });

    it('keeps the target picker and the terminal toolbar in the same header row (AC-02)', () => {
        render(<Harness workspaceId="group-ai-repos" targets={[
            { workspaceId: 'group-ai-repos', label: 'Group root', deprioritized: true },
            { workspaceId: 'repo-alpha', label: 'alpha' },
        ]} />);
        openDock();

        const header = screen.getByTestId('workspace-dock-header');
        // Tabs, picker and the portaled terminal toolbar all share the one 35px row.
        expect(within(header).getByTestId('workspace-dock-view-switcher')).toBeTruthy();
        expect(within(header).getByTestId('workspace-dock-target-picker')).toBeTruthy();
        expect(within(header).getByTestId('terminal-new-btn')).toBeTruthy();

        act(() => {
            fireEvent.click(within(header).getByTestId('terminal-new-btn'));
        });
        expect(within(header).getByTestId('terminal-picker-btn')).toBeTruthy();
        expect(within(header).getByTestId('workspace-dock-target-picker')).toBeTruthy();
        expect(header.className).toContain('h-[35px]');
    });
});
