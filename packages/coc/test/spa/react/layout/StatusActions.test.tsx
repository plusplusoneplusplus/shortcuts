/**
 * StatusActions — the shared status/action cluster used both in the topbar and,
 * for the remote-first shell, docked in the left sidebar footer.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const mockToggleTheme = vi.fn();
let mockActiveTab = 'repos';
let mockWsStatus = 'open';

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: { activeTab: mockActiveTab, wsStatus: mockWsStatus }, dispatch: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: mockToggleTheme }),
}));
vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: ({ placement }: { placement?: string }) => (
        <button aria-label="Notifications" data-testid="notification-bell" data-placement={placement ?? 'down'} />
    ),
}));
vi.mock('../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator', () => ({
    agentProviderQuotaIndicator: ({ placement }: { placement?: string } = {}) => (
        <button aria-label="Agent provider quota" data-testid="agent-provider-quota-indicator" data-placement={placement ?? 'down'} />
    ),
}));

import { StatusActions } from '../../../../src/server/spa/client/react/layout/StatusActions';

beforeEach(() => {
    mockToggleTheme.mockReset();
    mockActiveTab = 'repos';
    mockWsStatus = 'open';
    location.hash = '';
});

describe('StatusActions — topbar variant', () => {
    it('renders the connection pill + notification, quota, admin and theme in order', () => {
        render(<div data-testid="host"><StatusActions variant="topbar" /></div>);
        const host = screen.getByTestId('host');
        expect(within(host).getByTestId('ws-status-indicator')).toBeTruthy();
        const buttonLabels = within(host).getAllByRole('button').map(b => b.getAttribute('aria-label'));
        expect(buttonLabels).toEqual(['Notifications', 'Agent provider quota', 'Admin', 'Toggle theme']);
        // Keeps the legacy ids the rest of the app/tests key on.
        expect(document.getElementById('admin-toggle')).toBeTruthy();
        expect(document.getElementById('theme-toggle')).toBeTruthy();
        // Topbar popovers keep the historic downward placement.
        expect(within(host).getByTestId('notification-bell').getAttribute('data-placement')).toBe('down');
        expect(within(host).getByTestId('agent-provider-quota-indicator').getAttribute('data-placement')).toBe('down');
    });

    it('delegates admin to onAdminOpen and toggles theme', () => {
        const onAdminOpen = vi.fn();
        render(<StatusActions variant="topbar" onAdminOpen={onAdminOpen} />);
        fireEvent.click(screen.getByLabelText('Admin'));
        fireEvent.click(screen.getByLabelText('Toggle theme'));
        expect(onAdminOpen).toHaveBeenCalledTimes(1);
        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('reflects the websocket status label', () => {
        mockWsStatus = 'closed';
        render(<StatusActions variant="topbar" />);
        expect(screen.getByTestId('ws-status-label').textContent).toBe('Disconnected');
        expect(screen.getByTestId('ws-status-indicator').getAttribute('data-ws-status')).toBe('closed');
    });

    it('exposes the backend endpoint and port in the connection tooltip', () => {
        render(<StatusActions variant="topbar" />);
        const title = screen.getByTestId('ws-status-indicator').getAttribute('title') ?? '';
        // Status label headlines the tooltip, followed by the reachable endpoints.
        expect(title.startsWith('Connected')).toBe(true);
        expect(title).toContain(location.host); // host:port the browser dialed
        expect(title).toContain(`API ${location.origin}/api`);
        expect(title).toContain(`WS ws://${location.host}/ws`);
        // The mobile bare-dot indicator carries the same detail.
        expect(screen.getByTestId('ws-status-indicator-mobile').getAttribute('title')).toBe(title);
    });
});

describe('StatusActions — sidebar variant', () => {
    it('renders a docked footer with distinct testids that never collide with the topbar cluster', () => {
        render(<StatusActions variant="sidebar" />);
        expect(screen.getByTestId('sidebar-status-actions')).toBeTruthy();
        expect(screen.getByTestId('sidebar-ws-status-indicator')).toBeTruthy();
        expect(screen.getByTestId('sidebar-ws-status-label').textContent).toBe('Connected');
        // The sidebar footer must NOT reuse the topbar ids/testids so the two can
        // coexist in the DOM without duplicate ids.
        expect(document.getElementById('admin-toggle')).toBeNull();
        expect(document.getElementById('theme-toggle')).toBeNull();
        expect(screen.queryByTestId('ws-status-indicator')).toBeNull();
        expect(screen.getByTestId('sidebar-admin-toggle')).toBeTruthy();
        expect(screen.getByTestId('sidebar-theme-toggle')).toBeTruthy();
    });

    it('lays the dock out left→right as admin, notifications, quota, theme, then the connection pill', () => {
        render(<StatusActions variant="sidebar" />);
        const dock = screen.getByTestId('sidebar-status-actions');
        const expected = [
            'sidebar-admin-toggle',
            'notification-bell',
            'agent-provider-quota-indicator',
            'sidebar-theme-toggle',
            'sidebar-ws-status-indicator',
        ];
        const seen = Array.from(dock.querySelectorAll('[data-testid]'))
            .map(el => el.getAttribute('data-testid'))
            .filter((id): id is string => !!id && expected.includes(id));
        expect(seen).toEqual(expected);
    });

    it('opens the bell and quota popovers upward so they stay on-screen above the dock', () => {
        render(<StatusActions variant="sidebar" />);
        expect(screen.getByTestId('notification-bell').getAttribute('data-placement')).toBe('up');
        expect(screen.getByTestId('agent-provider-quota-indicator').getAttribute('data-placement')).toBe('up');
    });

    it('defaults admin to navigating to #admin and toggles theme', () => {
        render(<StatusActions variant="sidebar" />);
        fireEvent.click(screen.getByTestId('sidebar-admin-toggle'));
        expect(location.hash).toBe('#admin');
        fireEvent.click(screen.getByTestId('sidebar-theme-toggle'));
        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('highlights admin while in the admin shell', () => {
        mockActiveTab = 'logs';
        render(<StatusActions variant="sidebar" />);
        expect(screen.getByTestId('sidebar-admin-toggle').className).toContain('bg-[#0078d4]');
    });

    it('exposes the backend endpoint and port in the docked connection tooltip', () => {
        render(<StatusActions variant="sidebar" />);
        const title = screen.getByTestId('sidebar-ws-status-indicator').getAttribute('title') ?? '';
        expect(title.startsWith('Connected')).toBe(true);
        expect(title).toContain(location.host);
        expect(title).toContain(`API ${location.origin}/api`);
        expect(title).toContain(`WS ws://${location.host}/ws`);
    });

    it('uses the shell chrome background set off by a top border (no colored tint)', () => {
        render(<StatusActions variant="sidebar" />);
        const dock = screen.getByTestId('sidebar-status-actions');
        // The dock reads as part of the shell chrome: it reuses the neutral
        // topbar/bottom-nav background and is separated from the sidebar body by
        // a top border, not a blue tint that clashes with the dark theme.
        expect(dock.className).toContain('bg-[#f3f3f3]');
        expect(dock.className).toContain('dark:bg-[#252526]');
        expect(dock.className).toContain('border-t');
        expect(dock.className).toContain('border-[#e0e0e0]');
        expect(dock.className).toContain('dark:border-[#3c3c3c]');
        // The old blue-tinted fill/border must be gone.
        expect(dock.className).not.toContain('bg-[#dbe8fa]');
        expect(dock.className).not.toContain('dark:bg-[#23324a]');
    });
});
