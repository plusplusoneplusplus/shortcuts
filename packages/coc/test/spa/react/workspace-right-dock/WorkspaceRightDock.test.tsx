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
vi.mock('../../../../src/server/spa/client/react/features/notes/dock/DockNotesPanel', () => ({
    DockNotesPanel: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="mock-notes">notes:{workspaceId}</div>
    ),
}));

import {
    WorkspaceRightDock,
    WorkspaceDockToggleButton,
    useWorkspaceDock,
    workspaceDockOpenStorageKey,
    workspaceDockViewStorageKey,
    workspaceDockWidthStorageKey,
    DOCK_INITIAL_WIDTH,
    DOCK_MIN_WIDTH,
    DOCK_MIN_CHAT_WIDTH,
    dockViewsForWorkspace,
} from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceRightDock';

/**
 * Set jsdom's window.innerWidth, fire a resize event, and flush the hook's
 * debounce. Requires fake timers (vi.useFakeTimers) to be active.
 */
function setViewportWidth(px: number) {
    Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true });
    act(() => {
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(150); // clear the 100ms resize debounce
    });
}

/** Live viewport-relative dock ceiling, mirroring useWorkspaceDock's formula. */
function expectedMaxWidth(): number {
    return Math.max(DOCK_MIN_WIDTH, window.innerWidth - DOCK_MIN_CHAT_WIDTH);
}

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
        expect(screen.queryByTestId('mock-notes')).toBeNull();
        // Default width applied to the dock body.
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe(`${DOCK_INITIAL_WIDTH}px`);
    });

    it('opens to Terminal by default with both views mounted, inactive hidden (AC-03/05)', () => {
        render(<Harness />);
        openDock();

        const dockEl = screen.getByTestId('workspace-right-dock');
        expect(dockEl.style.display).not.toBe('none');
        expect(dockEl.getAttribute('data-open')).toBe('true');

        // Every view mounted; terminal visible, the others hidden via display:none.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
        expect(screen.getByTestId('mock-notes')).toBeTruthy();
        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-explorer').style.display).toBe('none');
        expect(screen.getByTestId('workspace-dock-notes').style.display).toBe('none');
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
        // aria-valuemax tracks the live viewport-relative ceiling, not a fixed 800.
        expect(handle.getAttribute('aria-valuemax')).toBe(String(expectedMaxWidth()));
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

    it('does not render a built-in toggle inside the dock body (the toggle lives outside)', () => {
        render(<Harness />);
        // The open/close control lives in RepoDetail's header or the TopBar — the
        // dock body itself renders no toggle.
        expect(screen.queryByTestId('workspace-dock-toggle')).toBeNull();
    });
});

/**
 * The dock max-width scales with the window (`max(DOCK_MIN_WIDTH, viewportWidth −
 * DOCK_MIN_CHAT_WIDTH)`) instead of a fixed 800px cap, so it can be dragged as
 * wide as a big monitor allows while always reserving room for the chat pane.
 */
describe('WorkspaceRightDock viewport-relative max width', () => {
    let originalWidth: number;

    beforeEach(() => {
        localStorage.clear();
        vi.useFakeTimers();
        originalWidth = window.innerWidth;
    });

    afterEach(() => {
        vi.useRealTimers();
        Object.defineProperty(window, 'innerWidth', { value: originalWidth, writable: true, configurable: true });
    });

    it('lets the dock widen past the old 800px cap on a large monitor', () => {
        render(<Harness />);
        openDock();
        setViewportWidth(4000); // max = 4000 − 360 = 3640, well past 800

        const handle = screen.getByTestId('workspace-dock-resize-handle');
        expect(handle.getAttribute('aria-valuemax')).toBe('3640');

        // direction:'right' — drag left 1000px (clientX 1500 → 500) to widen the dock.
        act(() => {
            fireEvent.mouseDown(handle, { clientX: 1500 });
        });
        act(() => {
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
        });
        expect(screen.getByTestId('workspace-dock-body').style.width).toBe(`${DOCK_INITIAL_WIDTH + 1000}px`);
    });

    it('never lets the max fall below DOCK_MIN_WIDTH on a narrow window (inversion guard)', () => {
        render(<Harness />);
        openDock();
        setViewportWidth(400); // 400 − 360 = 40 < DOCK_MIN_WIDTH → floored at DOCK_MIN_WIDTH

        const handle = screen.getByTestId('workspace-dock-resize-handle');
        expect(handle.getAttribute('aria-valuemax')).toBe(String(DOCK_MIN_WIDTH));
    });

    it('clamps a persisted over-max width down on shrink and restores it on grow', () => {
        // Start on a wide viewport so the persisted 1000px fits under the cap.
        Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true, configurable: true });
        localStorage.setItem(workspaceDockOpenStorageKey('ws-clamp'), '1');
        localStorage.setItem(workspaceDockWidthStorageKey('ws-clamp'), '1000');

        render(<Harness workspaceId="ws-clamp" />);
        const body = screen.getByTestId('workspace-dock-body');
        expect(body.style.width).toBe('1000px'); // 1000 < 1600 − 360 = 1240

        // Shrink so the persisted width exceeds the new cap → clamps down to it.
        setViewportWidth(1200); // max = 1200 − 360 = 840
        expect(body.style.width).toBe('840px');

        // Grow back → the user's persisted intent (1000) is restored from storage.
        setViewportWidth(1600); // max = 1240
        expect(body.style.width).toBe('1000px');
        expect(localStorage.getItem(workspaceDockWidthStorageKey('ws-clamp'))).toBe('1000');
    });
});

/**
 * The remote-first shell renders the toggle up in the global TopBar
 * (`WorkspaceDockToggleButton`) while the dock body renders in RepoDetail — two
 * separate subtrees. This harness proves they share one open state via the
 * cross-tree store, so the TopBar button opens the RepoDetail-side dock.
 */
function SplitHarness({ workspaceId = 'ws1' }: { workspaceId?: string }) {
    const dock = useWorkspaceDock(workspaceId);
    return (
        <div>
            {/* TopBar toggle — no shared React state with the body, only the store. */}
            <WorkspaceDockToggleButton workspaceId={workspaceId} />
            {/* Dock body, as RepoDetail mounts it. */}
            <WorkspaceRightDock workspaceId={workspaceId} dock={dock} />
        </div>
    );
}

describe('WorkspaceDockToggleButton (remote-first / TopBar)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    function clickToggle() {
        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-toggle'));
        });
    }

    it('opens the separately-rendered dock body via the shared cross-tree store', () => {
        render(<SplitHarness />);
        // Closed: body column hidden, no views mounted, button not pressed.
        expect(screen.getByTestId('workspace-right-dock').style.display).toBe('none');
        expect(screen.getByTestId('workspace-dock-toggle').getAttribute('aria-pressed')).toBe('false');
        expect(screen.queryByTestId('mock-terminal')).toBeNull();

        clickToggle();

        // The TopBar button toggled a store the body subscribes to → body opens.
        expect(screen.getByTestId('workspace-right-dock').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-toggle').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
    });

    it('reflects and persists open state, and stays keep-alive after closing', () => {
        render(<SplitHarness workspaceId="ws-topbar" />);
        clickToggle(); // open
        expect(localStorage.getItem(workspaceDockOpenStorageKey('ws-topbar'))).toBe('1');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();

        clickToggle(); // close
        expect(localStorage.getItem(workspaceDockOpenStorageKey('ws-topbar'))).toBe('0');
        expect(screen.getByTestId('workspace-right-dock').style.display).toBe('none');
        // Terminal stays mounted while hidden → PTY session survives.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
    });

    it('restores persisted open state on mount', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('ws-restore'), '1');
        render(<SplitHarness workspaceId="ws-restore" />);
        expect(screen.getByTestId('workspace-dock-toggle').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('workspace-right-dock').style.display).not.toBe('none');
    });
});

/**
 * The dock's third view. Notes is a sibling of Terminal/Explorer inside the same
 * keep-alive block, so the selected note and preview scroll position survive a
 * view switch exactly like the terminal session does.
 */
describe('WorkspaceRightDock — Notes view', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('offers a Notes tab alongside Terminal and Explorer in a repo workspace', () => {
        render(<Harness />);
        openDock();

        const tabs = screen.getByTestId('workspace-dock-view-switcher');
        expect(tabs.textContent).toBe('TerminalExplorerNotes');
        expect(screen.getByTestId('workspace-dock-view-notes')).toBeTruthy();
    });

    it('switches to Notes without unmounting the other views (keep-alive)', () => {
        render(<Harness />);
        openDock();

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-notes'));
        });

        expect(screen.getByTestId('workspace-dock-notes').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
        expect(screen.getByTestId('workspace-dock-explorer').style.display).toBe('none');
        // Nothing torn down — the PTY session and the explorer tree both survive.
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
        expect(screen.getByTestId('mock-notes')).toBeTruthy();
    });

    it('marks the active tab via aria-selected', () => {
        render(<Harness />);
        openDock();
        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-notes'));
        });
        expect(screen.getByTestId('workspace-dock-view-notes').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('workspace-dock-view-terminal').getAttribute('aria-selected')).toBe('false');
    });

    it('passes the workspace id down to the notes panel', () => {
        render(<Harness workspaceId="ws-notes" />);
        openDock();
        expect(screen.getByTestId('mock-notes').textContent).toBe('notes:ws-notes');
    });

    it('round-trips the Notes view through localStorage', () => {
        const { unmount } = render(<Harness workspaceId="ws-persist" />);
        openDock();
        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-notes'));
        });
        expect(localStorage.getItem(workspaceDockViewStorageKey('ws-persist'))).toBe('notes');
        unmount();

        render(<Harness workspaceId="ws-persist" />);
        // Reopens straight to Notes rather than falling back to Terminal.
        expect(screen.getByTestId('workspace-dock-notes').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
    });
});

/**
 * A repo group has no single repository root — its cwd is the synthetic
 * `~/.coc/repos/group-<name>` directory — so a file tree there is meaningless.
 * The dock drops Explorer entirely in that context (tab AND mount, so a group
 * workspace never loads Monaco).
 */
describe('WorkspaceRightDock — repo-group workspaces', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('derives Terminal|Notes for a group id and Terminal|Explorer|Notes for a repo id', () => {
        expect(dockViewsForWorkspace('group-ai-repos')).toEqual(['terminal', 'notes']);
        expect(dockViewsForWorkspace('my-repo')).toEqual(['terminal', 'explorer', 'notes']);
        // Only the server's `group-<slug>` shape counts as a group.
        expect(dockViewsForWorkspace('group')).toEqual(['terminal', 'explorer', 'notes']);
        expect(dockViewsForWorkspace('grouped-repo')).toEqual(['terminal', 'explorer', 'notes']);
    });

    it('shows only Terminal and Notes tabs in a group workspace', () => {
        render(<Harness workspaceId="group-ai-repos" />);
        openDock();

        const tabs = screen.getByTestId('workspace-dock-view-switcher');
        expect(tabs.textContent).toBe('TerminalNotes');
        expect(screen.queryByTestId('workspace-dock-view-explorer')).toBeNull();
        expect(screen.getByTestId('workspace-dock-view-notes')).toBeTruthy();
    });

    it('never mounts the explorer in a group workspace (no Monaco load)', () => {
        render(<Harness workspaceId="group-ai-repos" />);
        openDock();

        expect(screen.queryByTestId('workspace-dock-explorer')).toBeNull();
        expect(screen.queryByTestId('mock-explorer')).toBeNull();
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
        expect(screen.getByTestId('mock-notes')).toBeTruthy();
    });

    it('still keeps Terminal and Notes mounted across a view switch in a group', () => {
        render(<Harness workspaceId="group-ai-repos" />);
        openDock();

        act(() => {
            fireEvent.click(screen.getByTestId('workspace-dock-view-notes'));
        });

        expect(screen.getByTestId('workspace-dock-notes').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
        expect(screen.getByTestId('mock-terminal')).toBeTruthy();
    });

    it('keeps the explorer for a concrete repo workspace', () => {
        render(<Harness workspaceId="my-repo" />);
        openDock();
        expect(screen.getByTestId('workspace-dock-view-explorer')).toBeTruthy();
        expect(screen.getByTestId('mock-explorer')).toBeTruthy();
    });
});

/**
 * Persisted-view fallback: the stored view must be validated against the views
 * available in THIS context, or a user with `explorer` persisted lands on a
 * hidden tab (and an empty dock) the moment they open a group workspace.
 */
describe('WorkspaceRightDock — persisted view fallback', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('falls back to Terminal when the persisted view is unavailable here', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('group-ai-repos'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('group-ai-repos'), 'explorer');

        render(<Harness workspaceId="group-ai-repos" />);

        // Not an empty dock: Terminal is shown, not a hidden explorer tab.
        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-notes').style.display).toBe('none');
        expect(screen.queryByTestId('workspace-dock-explorer')).toBeNull();
    });

    it('honours a persisted Notes view in a group workspace', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('group-ai-repos'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('group-ai-repos'), 'notes');

        render(<Harness workspaceId="group-ai-repos" />);

        expect(screen.getByTestId('workspace-dock-notes').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-terminal').style.display).toBe('none');
    });

    it('falls back to Terminal for an unrecognised persisted value', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('ws-junk'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('ws-junk'), 'not-a-view');

        render(<Harness workspaceId="ws-junk" />);

        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
        expect(screen.getByTestId('workspace-dock-explorer').style.display).toBe('none');
        expect(screen.getByTestId('workspace-dock-notes').style.display).toBe('none');
    });

    it('re-resolves the view when the harness switches to a workspace without that view', () => {
        localStorage.setItem(workspaceDockOpenStorageKey('ws-repo'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('ws-repo'), 'explorer');
        localStorage.setItem(workspaceDockOpenStorageKey('group-ai-repos'), '1');
        localStorage.setItem(workspaceDockViewStorageKey('group-ai-repos'), 'explorer');

        const { rerender } = render(<Harness workspaceId="ws-repo" />);
        expect(screen.getByTestId('workspace-dock-explorer').style.display).not.toBe('none');

        rerender(<Harness workspaceId="group-ai-repos" />);

        expect(screen.queryByTestId('workspace-dock-explorer')).toBeNull();
        expect(screen.getByTestId('workspace-dock-terminal').style.display).not.toBe('none');
        // The fallback is a read, not a write — the repo's own preference is untouched.
        expect(localStorage.getItem(workspaceDockViewStorageKey('group-ai-repos'))).toBe('explorer');
    });
});
