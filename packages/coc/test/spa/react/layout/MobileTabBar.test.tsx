/**
 * Tests for MobileTabBar — mobile bottom tab navigation bar.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileTabBar } from '../../../../src/server/spa/client/react/layout/MobileTabBar';
import type { RepoSubTab } from '../../../../src/server/spa/client/react/types/dashboard';

const ALL_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'git', label: 'Git' },
    { key: 'explorer', label: 'Explorer' },
    { key: 'chats', label: 'Chats' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'work-items', label: 'Work Items' },
    { key: 'workflows', label: 'Workflows' },
    { key: 'schedules', label: 'Jobs' },
    { key: 'copilot', label: 'Copilot' },
];

const DEFAULT_PINNED: RepoSubTab[] = ['chats', 'work-items', 'git'];

function renderBar(overrides: Partial<Parameters<typeof MobileTabBar>[0]> = {}) {
    const onTabChange = overrides.onTabChange ?? vi.fn();
    return {
        onTabChange,
        ...render(
            <MobileTabBar
                activeTab="work-items"
                onTabChange={onTabChange}
                tabs={ALL_TABS}
                {...overrides}
            />
        ),
    };
}

describe('MobileTabBar: basic render', () => {
    it('renders the nav element with data-testid="mobile-tab-bar"', () => {
        renderBar();
        expect(screen.getByTestId('mobile-tab-bar')).toBeTruthy();
    });

    it('renders pinned tabs by default (Chats, Work Items, Git)', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="chats"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="work-items"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="git"]')).toBeTruthy();
    });

    it('does not pin chat or queue by default', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="chat"]')).toBeNull();
        expect(nav.querySelector('[data-tab="queue"]')).toBeNull();
    });

    it('renders More button for non-pinned tabs', () => {
        renderBar();
        expect(screen.getByTestId('mobile-tab-more-btn')).toBeTruthy();
    });

    it('More button has data-tab="more"', () => {
        renderBar();
        const btn = screen.getByTestId('mobile-tab-more-btn');
        expect(btn.getAttribute('data-tab')).toBe('more');
    });

    it('does not render More button when all tabs are pinned', () => {
        renderBar({ pinnedTabs: ALL_TABS.map(t => t.key) });
        expect(screen.queryByTestId('mobile-tab-more-btn')).toBeNull();
    });

    it('nav is in normal document flow (not fixed)', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.className).not.toContain('fixed');
        expect(nav.className).not.toContain('top-10');
    });

    it('nav has aria-label "Repo tab navigation"', () => {
        renderBar();
        expect(screen.getByRole('navigation', { name: 'Repo tab navigation' })).toBeTruthy();
    });
});

describe('MobileTabBar: active tab highlighting', () => {
    it('highlights active pinned tab in blue', () => {
        renderBar({ activeTab: 'work-items' });
        const workItemsBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="work-items"]') as HTMLElement;
        expect(workItemsBtn.className).toContain('text-[#0078d4]');
    });

    it('inactive pinned tabs are gray', () => {
        renderBar({ activeTab: 'chats' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const workItemsBtn = nav.querySelector('[data-tab="work-items"]') as HTMLElement;
        expect(workItemsBtn.className).not.toContain('text-[#0078d4]');
        expect(workItemsBtn.className).toContain('text-[#616161]');
    });

    it('sets aria-current="page" on active pinned tab', () => {
        renderBar({ activeTab: 'chats' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const chatsBtn = nav.querySelector('[data-tab="chats"]') as HTMLElement;
        expect(chatsBtn.getAttribute('aria-current')).toBe('page');
    });

    it('does not set aria-current on inactive tabs', () => {
        renderBar({ activeTab: 'chats' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const workItemsBtn = nav.querySelector('[data-tab="work-items"]') as HTMLElement;
        expect(workItemsBtn.getAttribute('aria-current')).toBeNull();
    });

    it('More button is highlighted when active tab is a "more" tab', () => {
        renderBar({ activeTab: 'info' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).toContain('text-[#0078d4]');
    });

    it('More button is gray when active tab is a pinned tab', () => {
        renderBar({ activeTab: 'chats' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).not.toContain('text-[#0078d4]');
    });
});

describe('MobileTabBar: tab switching', () => {
    it('calls onTabChange when a pinned tab is clicked', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'chats' });
        const workItemsBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="work-items"]') as HTMLElement;
        fireEvent.click(workItemsBtn);
        expect(onTabChange).toHaveBeenCalledWith('work-items');
    });

    it('calls onTabChange for git tab', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'work-items' });
        const gitBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="git"]') as HTMLElement;
        fireEvent.click(gitBtn);
        expect(onTabChange).toHaveBeenCalledWith('git');
    });
});

describe('MobileTabBar: More sheet', () => {
    afterEach(() => {
        document.body.style.overflow = '';
    });

    it('More sheet is closed by default', () => {
        renderBar();
        expect(screen.queryByTestId('mobile-tab-more-sheet')).toBeNull();
    });

    it('clicking More button opens the BottomSheet', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-sheet')).toBeTruthy();
    });

    it('sheet lists non-pinned tabs (Info, Tasks, Workflows, Schedules, Copilot, Explorer)', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-info')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-tasks')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-workflows')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-schedules')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-copilot')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-explorer')).toBeTruthy();
    });

    it('pinned tabs are NOT in the more sheet', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.queryByTestId('mobile-tab-more-item-chats')).toBeNull();
        expect(screen.queryByTestId('mobile-tab-more-item-work-items')).toBeNull();
        expect(screen.queryByTestId('mobile-tab-more-item-git')).toBeNull();
    });

    it('selecting a tab from the sheet calls onTabChange', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        fireEvent.click(screen.getByTestId('mobile-tab-more-item-info'));
        expect(onTabChange).toHaveBeenCalledWith('info');
    });

    it('selecting a tab from the sheet closes the sheet', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-sheet')).toBeTruthy();
        fireEvent.click(screen.getByTestId('mobile-tab-more-item-info'));
        expect(screen.queryByTestId('mobile-tab-more-sheet')).toBeNull();
    });

    it('closing the sheet via backdrop hides it', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('bottomsheet-backdrop')).toBeTruthy();
        fireEvent.click(screen.getByTestId('bottomsheet-backdrop'));
        expect(screen.queryByTestId('mobile-tab-more-sheet')).toBeNull();
    });

    it('active "more" tab is highlighted in the sheet', () => {
        renderBar({ activeTab: 'info' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        const infoBtn = screen.getByTestId('mobile-tab-more-item-info');
        expect(infoBtn.className).toContain('text-[#0078d4]');
    });

    it('inactive "more" tabs are not highlighted in the sheet', () => {
        renderBar({ activeTab: 'tasks' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        const infoBtn = screen.getByTestId('mobile-tab-more-item-info');
        expect(infoBtn.className).not.toContain('text-[#0078d4]');
    });

    it('More button has aria-expanded=false when sheet closed', () => {
        renderBar();
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('More button has aria-expanded=true when sheet open', () => {
        renderBar();
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        fireEvent.click(moreBtn);
        expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
    });
});

describe('MobileTabBar: badge display', () => {
    it('shows task badge when taskCount > 0', () => {
        renderBar({ taskCount: 3, pinnedTabs: ['chats', 'tasks', 'git'] });
        expect(screen.getByTestId('mobile-tab-badge-tasks')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-tasks').textContent).toBe('3');
    });

    it('hides task badge when taskCount is 0', () => {
        renderBar({ taskCount: 0, pinnedTabs: ['chats', 'tasks', 'git'] });
        expect(screen.queryByTestId('mobile-tab-badge-tasks')).toBeNull();
    });

    it('shows chats badge when activityCount > 0', () => {
        renderBar({ activityCount: 5 });
        expect(screen.getByTestId('mobile-tab-badge-chats')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-chats').textContent).toBe('5');
    });

    it('hides chats badge when activityCount is 0', () => {
        renderBar({ activityCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-chats')).toBeNull();
    });

    it('multiple badges can appear simultaneously', () => {
        renderBar({ taskCount: 5, activityCount: 3, pinnedTabs: ['chats', 'tasks', 'git'] });
        expect(screen.getByTestId('mobile-tab-badge-tasks').textContent).toBe('5');
        expect(screen.getByTestId('mobile-tab-badge-chats').textContent).toBe('3');
    });

    it('shows git badge when gitPendingCount > 0', () => {
        renderBar({ gitPendingCount: 4 });
        expect(screen.getByTestId('mobile-tab-badge-git')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-git').textContent).toBe('4');
    });

    it('hides git badge when gitPendingCount is 0', () => {
        renderBar({ gitPendingCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-git')).toBeNull();
    });

    it('shows work-items badge when workItemCount > 0', () => {
        renderBar({ workItemCount: 2 });
        expect(screen.getByTestId('mobile-tab-badge-work-items')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-work-items').textContent).toBe('2');
    });

    it('hides work-items badge when workItemCount is 0', () => {
        renderBar({ workItemCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-work-items')).toBeNull();
    });

    it('shows work-items badge alongside other badges', () => {
        renderBar({ workItemCount: 3, activityCount: 1, gitPendingCount: 2 });
        expect(screen.getByTestId('mobile-tab-badge-work-items').textContent).toBe('3');
        expect(screen.getByTestId('mobile-tab-badge-chats').textContent).toBe('1');
        expect(screen.getByTestId('mobile-tab-badge-git').textContent).toBe('2');
    });
});

describe('MobileTabBar: custom pinned tabs', () => {
    it('respects custom pinnedTabs prop', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'] });
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="info"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="git"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="tasks"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="chats"]')).toBeNull();
    });

    it('more sheet shows non-pinned tabs when custom pinnedTabs provided', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'], activeTab: 'info' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-chats')).toBeTruthy();
        expect(screen.queryByTestId('mobile-tab-more-item-info')).toBeNull();
    });
});
