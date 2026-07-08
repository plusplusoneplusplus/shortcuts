/**
 * GlobalStatusDock — the app-wide bottom status bar for the remote-first shell.
 *
 * It renders the shared `StatusActions` sidebar variant across tabs, but only in
 * the remote-first shell on desktop, and only as wide as the left sidebar
 * column. Off (classic mode) or on mobile it renders nothing (topbar keeps the
 * cluster). On the workspace chat/activity sub-tab it also renders nothing —
 * that view docks the cluster in its own left-column footer instead.
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

    it('pins its width to the admin sidebar (248px) on the admin tab so it stays flush, not overhanging', () => {
        mockAppState = { activeTab: 'admin', selectedRepoId: null, activeRepoSubTab: undefined };
        render(<GlobalStatusDock />);
        const wrapper = screen.getByTestId('global-status-dock');
        // The admin shell renders its own fixed 248px sidebar and never publishes
        // --workspace-left-col-width; using the (wider) workspace column here made
        // the dock overhang past the sidebar into the content pane.
        expect(wrapper.style.width).toBe('248px');
        expect(wrapper.style.width).not.toContain('--workspace-left-col-width');
    });

    it('pins to the admin sidebar width on every tab that mounts the admin shell', () => {
        for (const tab of ['admin', 'memory', 'skills', 'logs', 'stats', 'servers', 'dreams-admin']) {
            mockAppState = { activeTab: tab, selectedRepoId: null, activeRepoSubTab: undefined };
            const { unmount } = render(<GlobalStatusDock />);
            expect(screen.getByTestId('global-status-dock').style.width).toBe('248px');
            unmount();
        }
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
