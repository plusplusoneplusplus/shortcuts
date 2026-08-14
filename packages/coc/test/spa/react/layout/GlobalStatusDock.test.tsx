/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * It renders the shared `StatusActions` sidebar variant across tabs, but only in
 * the remote-first shell on desktop, and only as wide as the left sidebar
 * column. Off (classic mode) or on mobile it renders nothing (topbar keeps the
 * cluster). It also renders nothing on views that dock the cluster in their own
 * left-column footer: the workspace chat/activity sub-tab, the workspace notes
 * sub-tab, the workspace settings sub-tab, and the workspace notes-git sub-tab.
 * My Work docks per-sub-tab like a regular repo, so those same sub-tab
 * stand-downs cover it. Admin is an overlay dialog, so it gets no stand-down —
 * but the stand-downs are evaluated against the page BEHIND the dialog.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let mockRemoteShell = true;
let mockSplitPanel = true;
let mockIsMobile = false;
let mockAppState: Record<string, unknown> = {};
let lastStatusActionsProps: Record<string, unknown> | null = null;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: mockAppState, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled', () => ({
    useSplitWorkspacePanelEnabled: () => mockSplitPanel,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ breakpoint: mockIsMobile ? 'mobile' : 'desktop', isMobile: mockIsMobile, isTablet: false, isDesktop: !mockIsMobile }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: (props: Record<string, unknown>) => {
        lastStatusActionsProps = props;
        return <div data-testid="status-actions" data-variant={String(props.variant)} />;
    },
}));

import { GlobalStatusDock } from '../../../../src/server/spa/client/react/layout/GlobalStatusDock';

beforeEach(() => {
    mockRemoteShell = true;
    mockSplitPanel = true;
    mockIsMobile = false;
    // A non-chat context by default, so the global dock renders.
    mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: undefined };
    lastStatusActionsProps = null;
});

describe('GlobalStatusDock', () => {
    it('renders the sidebar StatusActions variant when the remote shell is on (desktop)', () => {
        render(<GlobalStatusDock />);
        const dock = screen.getByTestId('status-actions');
        expect(dock).toBeTruthy();
        expect(dock.getAttribute('data-variant')).toBe('sidebar');
    });

    it('constrains its width to the left sidebar column (not full width)', () => {
        render(<GlobalStatusDock />);
        const wrapper = screen.getByTestId('global-status-dock');
        // Tracks the live left-column width, falling back to the panel default.
        expect(wrapper.style.width).toContain('--workspace-left-col-width');
        expect(wrapper.style.width).toContain('360px');
        expect(wrapper.className).toContain('flex-shrink-0');
    });

    it('pins to the workspace left-column width on a non-admin, non-chat tab', () => {
        mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: undefined };
        render(<GlobalStatusDock />);
        const wrapper = screen.getByTestId('global-status-dock');
        expect(wrapper.style.width).toContain('--workspace-left-col-width');
        expect(wrapper.style.width).toContain('360px');
    });

    it('keeps rendering while the admin dialog is open (admin is an overlay, not a page)', () => {
        // Admin no longer replaces the page and its sidebar no longer docks a
        // cluster, so the page behind the dialog keeps its dock — exactly one.
        mockAppState = { activeTab: 'admin', selectedRepoId: null, activeRepoSubTab: undefined };
        render(<GlobalStatusDock />);
        expect(screen.getAllByTestId('status-actions')).toHaveLength(1);
    });

    it('keeps rendering on every admin-shell tab hosted by the dialog', () => {
        for (const tab of ['admin', 'memory', 'skills', 'logs', 'stats', 'servers', 'dreams-admin']) {
            mockAppState = { activeTab: tab, selectedRepoId: null, activeRepoSubTab: undefined };
            const { unmount } = render(<GlobalStatusDock />);
            expect(screen.getAllByTestId('status-actions')).toHaveLength(1);
            unmount();
        }
    });

    it('still stands down when the admin dialog opens over a view that docks its own footer', () => {
        // Regression: the stand-downs read the tab BEHIND the dialog. Reading
        // `state.activeTab` instead would flip them off the moment admin opened
        // and paint a second dock under the note editor.
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'notes' };
        const { container, rerender } = render(<GlobalStatusDock />);
        expect(container.firstChild).toBeNull();

        mockAppState = { activeTab: 'admin', selectedRepoId: 'ws-a', activeRepoSubTab: 'notes' };
        rerender(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('restores the dock when the admin dialog closes back onto a plain tab', () => {
        mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: undefined };
        const { rerender } = render(<GlobalStatusDock />);
        mockAppState = { activeTab: 'logs', selectedRepoId: null, activeRepoSubTab: undefined };
        rerender(<GlobalStatusDock />);
        expect(screen.getAllByTestId('status-actions')).toHaveLength(1);
        mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: undefined };
        rerender(<GlobalStatusDock />);
        expect(screen.getAllByTestId('status-actions')).toHaveLength(1);
    });

    it('renders nothing on the My Work notes sub-tab (NotesView docks the cluster in its own sidebar footer)', () => {
        // My Work now docks per-sub-tab like a regular repo: on the notes sub-tab
        // it flows through the same notes stand-down as `ws-a`, not a wholesale
        // My-Work return.
        mockAppState = { activeTab: 'repos', selectedRepoId: 'my_work', activeRepoSubTab: 'notes' };
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the My Work git sub-tab (NotesGitTab docks the cluster in its commit-history sidebar footer)', () => {
        // The Git sub-tab now owns a left-column footer (`NotesGitTab` docks a
        // `DockedStatusFooter` at the bottom of its commit-history sidebar), so
        // the global band stands down like Notes/Settings — otherwise a
        // partial-width band paints an empty strip beside the diff pane.
        mockAppState = { activeTab: 'repos', selectedRepoId: 'my_work', activeRepoSubTab: 'git' };
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the workspace git sub-tab too', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'git' };
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the workspace notes sub-tab (NotesView docks the cluster in its own sidebar footer)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'notes' };
        const { container } = render(<GlobalStatusDock />);
        // NotesView hosts the cluster in its own NotesSidebar footer, so the
        // global band stands down — otherwise a partial-width band paints an
        // empty white strip beside the note editor.
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the workspace settings sub-tab (RepoSettingsTab docks the cluster in its own sidebar footer)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'settings' };
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the workspace pull-requests sub-tab (PullRequestsTab docks the cluster in its PR queue footer)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'pull-requests' };
        const { container } = render(<GlobalStatusDock />);
        // The PR queue column is independently resizable, so the global band
        // would not line up under it — the tab hosts its own sidebar footer.
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('still renders when a stale pull-requests sub-tab lingers but the active tab is not a workspace', () => {
        mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: 'pull-requests' };
        render(<GlobalStatusDock />);
        expect(screen.getByTestId('status-actions')).toBeTruthy();
    });

    it('still renders when a stale notes sub-tab lingers but the active tab is not a workspace', () => {
        // `activeRepoSubTab` can retain 'notes' after leaving the repos tab; the
        // notes stand-down is scoped to activeTab === 'repos' + a selected repo
        // so the cluster does not vanish on e.g. the wiki tab.
        mockAppState = { activeTab: 'wiki', selectedRepoId: null, activeRepoSubTab: 'notes' };
        render(<GlobalStatusDock />);
        expect(screen.getByTestId('status-actions')).toBeTruthy();
    });

    it('forwards onAdminOpen to StatusActions', () => {
        const onAdminOpen = vi.fn();
        render(<GlobalStatusDock onAdminOpen={onAdminOpen} />);
        expect(lastStatusActionsProps?.onAdminOpen).toBe(onAdminOpen);
    });

    it('renders nothing when the remote shell is off (classic mode keeps the topbar cluster)', () => {
        mockRemoteShell = false;
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on mobile (no room for a bottom status bar)', () => {
        mockIsMobile = true;
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the workspace chat sub-tab (its own footer hosts the dock)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'chats' };
        const { container } = render(<GlobalStatusDock />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on the classic activity sub-tab too', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'activity' };
        const { container } = render(<GlobalStatusDock />);
        expect(container.firstChild).toBeNull();
    });

    it('still renders on a non-chat repo sub-tab (no left-column footer there)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'terminal' };
        render(<GlobalStatusDock />);
        expect(screen.getByTestId('status-actions')).toBeTruthy();
    });

    it('still renders on the chat sub-tab when the split panel is disabled (no footer to defer to)', () => {
        mockSplitPanel = false;
        mockAppState = { activeTab: 'repos', selectedRepoId: 'ws-a', activeRepoSubTab: 'chats' };
        render(<GlobalStatusDock />);
        expect(screen.getByTestId('status-actions')).toBeTruthy();
    });
});
