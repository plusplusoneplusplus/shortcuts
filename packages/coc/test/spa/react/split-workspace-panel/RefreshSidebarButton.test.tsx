/** @vitest-environment jsdom */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { SplitWorkspacePanel } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { RefreshSidebarButton } from '../../../../src/server/spa/client/react/features/chat/RefreshSidebarButton';
import { SentinelRailShortcut } from '../../../../src/server/spa/client/react/features/chat/SentinelRailShortcut';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { _resetRuntimeConfig, applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));
beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('owner'), '1');
    _resetRuntimeConfig();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(() => { cleanup(); _resetRuntimeConfig(); delete (window as any).__DASHBOARD_CONFIG__; });

it('shows refresh by default, keeps expand, plus, refresh, shield ordering and preserves rail state on keyboard activation', async () => {
    const onRefresh = vi.fn(async () => {});
    const newChat = vi.fn();
    const openSentinel = vi.fn();
    render(<SplitWorkspacePanel workspaceId="owner" chatList={<div>Chats</div>} gitList={<div>Git</div>}
        detail={<div>Current chat</div>} onNewChat={newChat} railShortcuts={<>
            <RefreshSidebarButton busy={false} onRefresh={onRefresh} />
            <SentinelRailShortcut running={[]} history={[{ id: 'queue_sn', type: 'chat', mode: 'sentinel' }]}
                selectedTaskId={null} onOpen={openSentinel} />
        </>} />);
    const rail = screen.getByTestId('split-workspace-left-rail');
    const buttons = within(rail).getAllByRole('button');
    expect(buttons.slice(0, 4).map(button => button.dataset.testid)).toEqual([
        'split-workspace-left-expand', 'split-workspace-left-new-chat',
        'split-workspace-left-refresh', 'split-workspace-left-sentinel',
    ]);
    expect(rail).toHaveClass('w-9');
    const refresh = within(rail).getByRole('button', { name: 'Refresh sidebar' });
    expect(refresh).toHaveClass('h-7', 'w-7', 'focus-visible:ring-2', 'dark:hover:bg-[#2d2d2d]');
    refresh.focus();
    expect(refresh).toHaveFocus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(newChat).not.toHaveBeenCalled();
    expect(openSentinel).not.toHaveBeenCalled();
    expect(localStorage.getItem(splitWorkspaceLeftCollapsedStorageKey('owner'))).toBe('1');
    expect(screen.getByTestId('split-workspace-left-rail')).toBe(rail);
});

it('preserves explicit disablement and follows live refresh setting updates', () => {
    applyRuntimeConfigPatch({ railManualRefreshEnabled: false });
    const onRefresh = vi.fn(async () => {});
    render(<RefreshSidebarButton busy={false} onRefresh={onRefresh} />);
    expect(screen.queryByRole('button', { name: 'Refresh sidebar' })).toBeNull();

    act(() => applyRuntimeConfigPatch({ railManualRefreshEnabled: true }));
    expect(screen.getByRole('button', { name: 'Refresh sidebar' })).toBeTruthy();
    expect(onRefresh).not.toHaveBeenCalled();

    act(() => applyRuntimeConfigPatch({ railManualRefreshEnabled: false }));
    expect(screen.queryByRole('button', { name: 'Refresh sidebar' })).toBeNull();
    expect(onRefresh).not.toHaveBeenCalled();
});
