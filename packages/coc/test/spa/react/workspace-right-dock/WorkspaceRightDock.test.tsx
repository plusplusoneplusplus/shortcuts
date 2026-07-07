/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock the two reused heavy views by their source paths so their real dep
// graphs (Monaco, xterm, API clients) never load in the unit test, and so we
// can assert mount/unmount + which one is visible.
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalView', () => ({
    TerminalView: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-terminal">terminal:{workspaceId}</div>
    ),
}));
vi.mock('../../../../src/server/spa/client/react/features/repo-detail/explorer/ExplorerPanel', () => ({
    ExplorerPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-explorer">explorer:{workspaceId}</div>
    ),
}));

import {
    WorkspaceRightDock,
    useWorkspaceDock,
    workspaceDockOpenStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
    DOCK_INITIAL_WIDTH,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

/**
 * Test harness: mirrors how RepoDetail wires the dock — one shared controller
 * feeds both an external open/close toggle (the header button) and the dock body.
 */
function Harness({ workspaceId = 'ws1' }: { workspaceId?: string }) {
    const dock = useWorkspaceDock(workspaceId);
    return (
        <div>
            <button data-testid="ext-toggle" onClick={dock.toggleOpen}>
                toggle
            </button>
            <WorkspaceRightDock workspaceId={workspaceId} dock={dock} />
        </div>
    );
}

function openDock() {
    act(() => {
        fireEvent.click(screen.getByTestId('ext-toggle'));
    });
}

describe('WorkspaceRightDock', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to closed and does not mount the views until first open (AC-03/06)', () => {
        render(<Harness />);
        const dockEl = screen.getByTestId('workspace-right-dock');
        // Column hidden while closed, and neither view is mounted yet.
        expect(dockEl.style.display).toBe('none');
        expect(dockEl.getAttribute('data-open')).toBe('false');
        expect(screen.queryByTestId('mock-terminal')).toBeNull();
        expect(screen.queryByTestId('mock-explorer')).toBeNull();
        // Default width applied to the dock body.
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe(`${DOCK_INITIAL_WIDTH}px`);
    });

    it('opens to Terminal by default with both views mounted, inactive hidden (AC-03/05)', () => {
        render(<Harness />);
        openDock();

        const dockEl = screen.getByTestId('workspace-right-dock');
        expect(dockEl.style.display).not.toBe('none');
        expect(dockEl.getAttribute('data-open')).toBe('true');

        // Both views mounted; terminal visible, explorer hidden via display:none.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-explorer').style.display).toBe('none');
    });

    it('switching to Explorer keeps both views mounted (only visibility flips) (AC-05)', () => {
        render(<Harness />);
        openDock();

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-explorer'));
        });

        // Neither view unmounts — the terminal session survives the switch.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
        expect(screen.getByTestId('workspace-dock-explorer').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
    });

    it('keeps the views mounted after the dock is closed again (keep-alive) (AC-03)', () => {
        render(<Harness />);
        openDock(); // mount
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        openDock(); // close

        const dockEl = screen.getByTestId('workspace-right-dock');
        expect(dockEl.style.display).toBe('none');
        // Still mounted (hidden by the ancestor), so the PTY session is not torn down.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
    });

    it('exposes an accessible left-edge resize handle and resizes the dock (AC-03)', () => {
        render(<Harness />);
        openDock();
        const handle = screen.getByTestId('workspace-dock-resize-handle');
        expect(handle.getAttribute('role')).toBe('separator');
        expect(handle.getAttribute('aria-orientation')).toBe('vertical');
        expect(handle.getAttribute('aria-valuemin')).toBe('280');
        expect(handle.getAttribute('aria-valuemax')).toBe('800');
        expect(handle.getAttribute('aria-valuenow')).toBe(String(DOCK_INITIAL_WIDTH));

        // direction:'right' — dragging left (clientX 500 -> 400) widens the dock by 100.
        act(() => {
            fireEvent.mouseDown(handle, { clientX: 500 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 400 }));
        });
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe(`${DOCK_INITIAL_WIDTH + 100}px`);
    });

    it('persists open / view / width per-workspace to localStorage (AC-06)', () => {
        render(<Harness workspaceId="ws-alpha" />);

        openDock();
        expect(localStorage.getItem(workspaceDockOpenStorageKey('ws-alpha'))).toBe('1');

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-explorer'));
        });
        expect(localStorage.getItem(workspaceDockViewStorageKey('ws-alpha'))).toBe('explorer');

        const handle = screen.getByTestId('workspace-dock-resize-handle');
        act(() => {
            fireEvent.mouseDown(handle, { clientX: 500 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 460 }));
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mouseup'));
        });
        expect(localStorage.getItem(workspaceDockWidthStorageKey('ws-alpha'))).toBe(String(DOCK_INITIAL_WIDTH + 40));
    });

    it('restores persisted open / view / width on mount (AC-06)', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('ws-beta'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('ws-beta'), 'explorer');
        localStorage.setItem(workspaceDockWidthStorageKey('ws-beta'), '555');

        render(<Harness workspaceId="ws-beta" />);

        // Opens straight to the persisted Explorer view at the persisted width.
        expect(screen.getByTestId('workspace-right-dock').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe('555px');
        expect(screen.getByTestId('workspace-dock-explorer').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
    });

    it('scopes persistence keys per workspace (independent state) (AC-06)', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('ws-one'), '1');
        // ws-two has no state → stays closed.
        const { unmount } = render(<Harness workspaceId="ws-one" />);
        expect(screen.getByTestId('workspace-right-dock').style.display).not.toBe('none');
        unmount();

        render(<Harness workspaceId="ws-two" />);
        expect(screen.getByTestId('workspace-right-dock').style.display).toBe('none');
    });
});
