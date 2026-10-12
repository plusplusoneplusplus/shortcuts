/**
 * Collapsed-rail Admin and quota shortcuts (`features.railStatusActions`).
 *
 * Renders the real SplitWorkspacePanel with the real docked StatusActions
 * footer and quota indicator, so the rail copies are proven to share the
 * footer's admin handler and single quota hook (no extra fetch, same owner).
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';

let mockSelectedRepoId: string | null = null;
let mockActiveTab = 'repos';

const mocks = vi.hoisted(() => ({
    localQuota: vi.fn(),
    remoteQuota: vi.fn(),
    getCocClientFor: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { activeTab: mockActiveTab, wsStatus: 'open', selectedRepoId: mockSelectedRepoId },
        dispatch: vi.fn(),
    }),
}));
vi.mock('../../../../src/server/spa/client/react/layout/ThemeProvider', () => ({
    useTheme: () => ({ theme: 'light', toggleTheme: vi.fn() }),
}));
vi.mock('../../../../src/server/spa/client/react/shared/NotificationBell', () => ({
    NotificationBell: () => <button aria-label="Notifications" data-testid="notification-bell" />,
}));
vi.mock('../../../../src/server/spa/client/react/features/dev-tools/DevToolsDialog', () => ({
    DevToolsDialog: () => null,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ admin: { getAgentProvidersQuota: mocks.localQuota } }),
    getCocClientFor: (baseUrl: string) => {
        mocks.getCocClientFor(baseUrl);
        return { admin: { getAgentProvidersQuota: mocks.remoteQuota } };
    },
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));
vi.mock('../../../../src/server/spa/client/react/repos/cloneRegistry', () => ({
    resolveCloneRoute: (target: unknown) => {
        if (target === 'remote:srv-1:ws-remote') return { kind: 'remote', baseUrl: 'http://srv-1' };
        if (target === 'remote:gone:ws-remote') return { kind: 'unresolved-remote' };
        return { kind: 'local' };
    },
    subscribeCloneBaseUrl: () => () => {},
}));

import { SplitWorkspacePanel } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { StatusActions } from '../../../../src/server/spa/client/react/layout/StatusActions';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

function quota(remainingPercentage: number): AgentProvidersQuotaResponse {
    return {
        lastUpdated: new Date().toISOString(),
        providers: [{
            id: 'copilot',
            quotaTypes: [{
                type: 'chat', isUnlimitedEntitlement: false, usedRequests: 0, entitlementRequests: 100,
                remainingPercentage, usageAllowedWithExhaustedQuota: false, overage: 0,
            }],
        }],
    };
}

function renderPanel({ collapsed = true, footer = true }: { collapsed?: boolean; footer?: boolean } = {}) {
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws1'), collapsed ? '1' : '0');
    return render(
        <SplitWorkspacePanel
            workspaceId="ws1"
            chatList={<div>chat</div>}
            gitList={<div>git</div>}
            detail={<div>detail</div>}
            footer={footer ? <StatusActions variant="sidebar" /> : undefined}
        />,
    );
}

const rail = () => screen.getByTestId('split-workspace-left-rail');

describe('collapsed-rail Admin and quota shortcuts', () => {
    beforeEach(() => {
        localStorage.clear();
        location.hash = '';
        mockSelectedRepoId = null;
        mockActiveTab = 'repos';
        mocks.localQuota.mockReset().mockResolvedValue(quota(0.4));
        mocks.remoteQuota.mockReset().mockResolvedValue(quota(0.9));
        mocks.getCocClientFor.mockReset();
        _resetRuntimeConfig();
    });

    afterEach(() => {
        _resetRuntimeConfig();
    });

    it('shows the Admin gear and quota ring by default in a bottom rail group, after the other rail controls', async () => {
        renderPanel();
        const group = within(rail()).getByTestId('split-workspace-left-status');
        expect(group.className).toContain('mt-auto');
        const buttons = within(group).getAllByRole('button');
        expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Admin', 'Agent provider quota']);
        expect(buttons[0].textContent).toBe('⚙');
        // Same narrow-rail sizing as the expand / new-chat buttons.
        for (const b of buttons) expect(b.className).toContain('w-7 h-7');
        expect(buttons[0].getAttribute('title')).toBe('Admin');
        // The group sits after the expand control, i.e. below per-chat controls.
        const expand = within(rail()).getByTestId('split-workspace-left-expand');
        expect(expand.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        // The footer keeps its own controls, and only the footer owns the stable id.
        expect(screen.getByTestId('sidebar-admin-toggle').id).toBe('admin-toggle');
        expect(document.querySelectorAll('#admin-toggle')).toHaveLength(1);
        await waitFor(() => expect(within(rail()).getByTestId('rail-agent-provider-quota-indicator').getAttribute('data-state')).toBe('finite'));
    });

    it('opens Admin through the footer action without expanding the rail', () => {
        renderPanel();
        fireEvent.click(within(rail()).getByTestId('rail-admin-toggle'));
        expect(location.hash).toBe('#admin');
        expect(screen.getByTestId('split-workspace-left-rail')).toBeTruthy();
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws1'))).toBe('1');
    });

    it('highlights the rail gear while the admin shell is open', () => {
        mockActiveTab = 'admin';
        renderPanel();
        expect(within(rail()).getByTestId('rail-admin-toggle').className).toContain('bg-[#0078d4]');
    });

    it('reuses the footer quota state: one fetch, identical gauge, shared dropdown', async () => {
        renderPanel();
        const railQuota = within(rail()).getByTestId('rail-agent-provider-quota-indicator');
        const footerQuota = screen.getByTestId('agent-provider-quota-indicator');
        await waitFor(() => expect(railQuota.getAttribute('data-used-percent')).toBe('60'));
        expect(footerQuota.getAttribute('data-used-percent')).toBe('60');
        expect(railQuota.getAttribute('title')).toBe(footerQuota.getAttribute('title'));
        expect(mocks.localQuota).toHaveBeenCalledTimes(1);
        // Same desktop-only visibility as the footer gauge.
        expect(within(rail()).getByTestId('rail-agent-provider-quota-container').className).toContain('md:block');

        fireEvent.click(railQuota);
        const panel = screen.getByTestId('agent-provider-quota-panel');
        // Portaled to body and opened beside the narrow rail, not clipped inside it.
        expect(panel.parentElement).toBe(document.body);
        expect(panel.getAttribute('data-placement')).toBe('right');
        expect(railQuota.getAttribute('aria-expanded')).toBe('true');
        expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('ws1'))).toBe('1');

        // Refresh goes through the same hook (force), still a single owner.
        fireEvent.click(screen.getByTestId('agent-provider-quota-refresh'));
        await waitFor(() => expect(mocks.localQuota).toHaveBeenCalledTimes(2));
        expect(mocks.localQuota).toHaveBeenLastCalledWith({ force: true });

        // Escape closes; toggling the rail trigger again closes too.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('agent-provider-quota-panel')).toBeNull();
        fireEvent.click(railQuota);
        fireEvent.click(railQuota);
        expect(screen.queryByTestId('agent-provider-quota-panel')).toBeNull();
    });

    it('keeps an open rail dropdown open when its own trigger is pressed (outside-click guard)', () => {
        renderPanel();
        const railQuota = within(rail()).getByTestId('rail-agent-provider-quota-indicator');
        fireEvent.click(railQuota);
        fireEvent.mouseDown(railQuota);
        expect(screen.getByTestId('agent-provider-quota-panel')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('agent-provider-quota-panel')).toBeNull();
    });

    it('closes a rail-anchored dropdown and removes the shortcuts when the sidebar expands', () => {
        renderPanel();
        fireEvent.click(within(rail()).getByTestId('rail-agent-provider-quota-indicator'));
        expect(screen.getByTestId('agent-provider-quota-panel')).toBeTruthy();
        fireEvent.click(screen.getByTestId('split-workspace-left-expand'));
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
        expect(screen.queryByTestId('rail-admin-toggle')).toBeNull();
        expect(screen.queryByTestId('agent-provider-quota-panel')).toBeNull();
        // The footer's own controls remain.
        expect(screen.getByTestId('sidebar-admin-toggle')).toBeTruthy();
        expect(screen.getByTestId('agent-provider-quota-indicator')).toBeTruthy();
    });

    it('routes the rail quota to the selected remote owner, never the page origin', async () => {
        mockSelectedRepoId = 'remote:srv-1:ws-remote';
        renderPanel();
        const railQuota = within(rail()).getByTestId('rail-agent-provider-quota-indicator');
        await waitFor(() => expect(railQuota.getAttribute('data-used-percent')).toBe('10'));
        expect(mocks.getCocClientFor).toHaveBeenCalledWith('http://srv-1');
        expect(mocks.remoteQuota).toHaveBeenCalledTimes(1);
        expect(mocks.localQuota).not.toHaveBeenCalled();
    });

    it('shows the unresolved-remote error instead of falling back to page-origin quota', async () => {
        mockSelectedRepoId = 'remote:gone:ws-remote';
        renderPanel();
        const railQuota = within(rail()).getByTestId('rail-agent-provider-quota-indicator');
        await waitFor(() => expect(railQuota.getAttribute('data-state')).toBe('error'));
        expect(railQuota.getAttribute('title')).toContain('Remote server route is unavailable');
        expect(mocks.localQuota).not.toHaveBeenCalled();
        expect(mocks.remoteQuota).not.toHaveBeenCalled();
    });

    it('leaves the rail and footer unchanged while the flag is off, and follows live flag updates', async () => {
        applyRuntimeConfigPatch({ railStatusActionsEnabled: false });
        renderPanel();
        expect(within(rail()).queryByTestId('split-workspace-left-status')).toBeNull();
        expect(screen.queryByTestId('rail-admin-toggle')).toBeNull();
        expect(screen.queryByTestId('rail-agent-provider-quota-indicator')).toBeNull();
        expect(within(rail()).getByText('Workspace')).toBeTruthy();
        expect(screen.getByTestId('sidebar-admin-toggle')).toBeTruthy();
        await waitFor(() => expect(mocks.localQuota).toHaveBeenCalledTimes(1));

        act(() => applyRuntimeConfigPatch({ railStatusActionsEnabled: true }));
        expect(within(rail()).getByTestId('rail-admin-toggle')).toBeTruthy();
        expect(within(rail()).getByTestId('rail-agent-provider-quota-indicator')).toBeTruthy();
        // Enabling the rail copy does not start another quota read.
        expect(mocks.localQuota).toHaveBeenCalledTimes(1);

        act(() => applyRuntimeConfigPatch({ railStatusActionsEnabled: false }));
        expect(within(rail()).queryByTestId('split-workspace-left-status')).toBeNull();
        expect(screen.getByTestId('sidebar-admin-toggle')).toBeTruthy();
        expect(mocks.localQuota).toHaveBeenCalledTimes(1);
    });

    it('renders no rail slot without a docked footer', () => {
        renderPanel({ footer: false });
        expect(within(rail()).queryByTestId('split-workspace-left-status')).toBeNull();
    });
});
