import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TopBar } from '../../../../src/server/spa/client/react/layout/TopBar';

const mockDispatch = vi.fn();
const mockToggleTheme = vi.fn();
const mockOnAdminOpen = vi.fn();
let mockActiveTab = 'repos';
let mockIsMobile = false;

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            activeTab: mockActiveTab,
            reposSidebarCollapsed: false,
            wsStatus: 'open',
            selectedRepoId: null,
            repoTabState: {},
            repoRouteState: {},
            notePathState: {},
        },
        dispatch: mockDispatch,
    }),
    AppProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({ state: { selectedTaskIdByRepo: {} }, dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [], unseenCounts: {}, fetchRepos: vi.fn(), loading: false }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'auto', toggleTheme: mockToggleTheme }),
}));

vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => <button aria-label="Notifications" data-testid="notification-bell">🔔</button>,
}));

vi.mock('../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: () => <button aria-label="Agent provider quota" data-testid="agent-provider-quota-indicator">◔</button>,
}));

vi.mock('../../../../src/server/spa/client/react/repos/RepoManagementPopover', () => ({
    RepoManagementPopover: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyWorkEnabled', () => ({
    useMyWorkEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useMyLifeEnabled', () => ({
    useMyLifeEnabled: () => false,
}));

function renderTopBar() {
    return render(<TopBar onAdminOpen={mockOnAdminOpen} />);
}

function actionLabels(): string[] {
    return within(screen.getByTestId('topbar-actions')).getAllByRole('button')
        .map(button => button.getAttribute('aria-label'))
        .filter((label): label is string => Boolean(label));
}

describe('TopBar fixed action order', () => {
    beforeEach(() => {
        location.hash = '';
        mockActiveTab = 'repos';
        mockIsMobile = false;
        mockDispatch.mockClear();
        mockToggleTheme.mockClear();
        mockOnAdminOpen.mockClear();
        delete (window as any).__DASHBOARD_CONFIG__;
    });

    it('renders top-bar actions in the fixed code-defined order', () => {
        renderTopBar();

        // Skills/Logs/Usage/Models/Servers live inside the Admin page's left
        // sidebar "Tools" group; the top-level action row exposes only the
        // high-level buttons.
        expect(actionLabels()).toEqual([
            'Notifications',
            'Agent provider quota',
            'Admin',
            'Toggle theme',
        ]);
    });

    it('does not expose drag handles or a reorder group', () => {
        renderTopBar();

        expect(screen.queryByTestId('topbar-reorder-group')).toBeNull();
        expect(screen.queryByText('Drag icons to reorder. Long-press an icon to pick it up. Esc to finish.')).toBeNull();
        expect(screen.queryByText('Reset order')).toBeNull();
    });

    it('keeps long press and drag gestures from changing action order', () => {
        renderTopBar();
        const before = actionLabels();
        const notifications = screen.getByLabelText('Notifications');
        const admin = screen.getByLabelText('Admin');

        fireEvent.pointerDown(notifications, { pointerId: 1, clientX: 1, clientY: 1 });
        fireEvent.pointerMove(notifications, { pointerId: 1, clientX: 20, clientY: 1 });
        fireEvent.pointerUp(notifications, { pointerId: 1, clientX: 20, clientY: 1 });
        fireEvent.dragStart(notifications);
        fireEvent.drop(admin);

        expect(actionLabels()).toEqual(before);
        expect(screen.queryByText(/Picked up/)).toBeNull();
    });

    it('still activates the fixed action buttons', () => {
        renderTopBar();

        // The legacy "Tools" trigger and "Logs" entry have been migrated to
        // the Admin page sidebar; the topbar surfaces only Notifications,
        // Admin, and the theme toggle.
        expect(screen.queryByLabelText('Tools')).toBeNull();
        expect(screen.queryByLabelText('Logs')).toBeNull();

        fireEvent.click(screen.getByLabelText('Admin'));
        fireEvent.click(screen.getByLabelText('Toggle theme'));

        expect(mockOnAdminOpen).toHaveBeenCalledTimes(1);
        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });
});
