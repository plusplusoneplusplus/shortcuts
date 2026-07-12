/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * It renders the shared `StatusActions` sidebar variant across tabs, but only in
 * the remote-first shell on desktop, and only as wide as the left sidebar
 * column. Off (classic mode) or on mobile it renders nothing (topbar keeps the
 * cluster). It also renders nothing on views that dock the cluster in their own
 * left-column footer: the workspace chat/activity sub-tab, the admin shell, the
 * My Work workspace, the workspace notes sub-tab, and the workspace settings
 * sub-tab.
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
// Keep this suite lightweight — pull only the workspace-id constant, not the
// heavy MyWorkView module (Notes editor, tiptap, monaco, …).
vi.mock('../../../../src/server/spa/client/react/repos/MyWorkView', () => ({
    MY_WORK_WORKSPACE_ID: 'my_work',
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

    it('renders nothing on the admin tab (the admin sidebar hosts the cluster in its own footer)', () => {
        mockAppState = { activeTab: 'admin', selectedRepoId: null, activeRepoSubTab: undefined };
        const { container } = render(<GlobalStatusDock />);
        // The admin shell renders its own sidebar and docks the status cluster in
        // its footer (`DockedStatusFooter`), so the global bottom band stands down
        // to avoid the empty partial-width strip beside it.
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing on every tab that mounts the admin shell', () => {
        for (const tab of ['admin', 'memory', 'skills', 'logs', 'stats', 'servers', 'dreams-admin']) {
            mockAppState = { activeTab: tab, selectedRepoId: null, activeRepoSubTab: undefined };
            const { container, unmount } = render(<GlobalStatusDock />);
            expect(container.firstChild).toBeNull();
            unmount();
        }
    });

    it('renders nothing on the My Work workspace (its body footer hosts the cluster)', () => {
        mockAppState = { activeTab: 'repos', selectedRepoId: 'my_work', activeRepoSubTab: 'notes' };
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
