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
    { key: 'tasks', label: 'Tasks' },
    { key: 'activity', label: 'Activity' },
    { key: 'workflows', label: 'Workflows' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'copilot', label: 'Copilot' },
];

const DEFAULT_PINNED: RepoSubTab[] = ['tasks', 'activity', 'git'];

function renderBar(overrides: Partial<Parameters<typeof MobileTabBar>[0]> = {}) {
    const onTabChange = overrides.onTabChange ?? vi.fn();
    return {
        onTabChange,
        ...render(
            <MobileTabBar
                activeTab="tasks"
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

    it('renders pinned tabs by default (Tasks, Activity, Git)', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="tasks"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="activity"]')).toBeTruthy();
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

    it('nav has fixed bottom-0 classes', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.className).toContain('fixed');
        expect(nav.className).toContain('bottom-0');
    });

    it('nav has z-[8000] class', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.className).toContain('z-[8000]');
    });

    it('nav has aria-label "Repo tab navigation"', () => {
        renderBar();
        expect(screen.getByRole('navigation', { name: 'Repo tab navigation' })).toBeTruthy();
    });
});

describe('MobileTabBar: active tab highlighting', () => {
    it('highlights active pinned tab in blue', () => {
        renderBar({ activeTab: 'tasks' });
        const tasksBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="tasks"]') as HTMLElement;
        expect(tasksBtn.className).toContain('text-[#0078d4]');
    });

    it('inactive pinned tabs are gray', () => {
        renderBar({ activeTab: 'tasks' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const activityBtn = nav.querySelector('[data-tab="activity"]') as HTMLElement;
        expect(activityBtn.className).not.toContain('text-[#0078d4]');
        expect(activityBtn.className).toContain('text-[#616161]');
    });

    it('sets aria-current="page" on active pinned tab', () => {
        renderBar({ activeTab: 'activity' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const activityBtn = nav.querySelector('[data-tab="activity"]') as HTMLElement;
        expect(activityBtn.getAttribute('aria-current')).toBe('page');
    });

    it('does not set aria-current on inactive tabs', () => {
        renderBar({ activeTab: 'tasks' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const activityBtn = nav.querySelector('[data-tab="activity"]') as HTMLElement;
        expect(activityBtn.getAttribute('aria-current')).toBeNull();
    });

    it('More button is highlighted when active tab is a "more" tab', () => {
        renderBar({ activeTab: 'info' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).toContain('text-[#0078d4]');
    });

    it('More button is gray when active tab is a pinned tab', () => {
        renderBar({ activeTab: 'activity' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).not.toContain('text-[#0078d4]');
    });
});

describe('MobileTabBar: tab switching', () => {
    it('calls onTabChange when a pinned tab is clicked', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'tasks' });
        const activityBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="activity"]') as HTMLElement;
        fireEvent.click(activityBtn);
        expect(onTabChange).toHaveBeenCalledWith('activity');
    });

    it('calls onTabChange for git tab', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'tasks' });
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

    it('sheet lists non-pinned tabs (Info, Workflows, Schedules, Copilot, Explorer)', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-info')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-workflows')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-schedules')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-copilot')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-explorer')).toBeTruthy();
    });

    it('pinned tabs are NOT in the more sheet', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.queryByTestId('mobile-tab-more-item-tasks')).toBeNull();
        expect(screen.queryByTestId('mobile-tab-more-item-activity')).toBeNull();
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
        renderBar({ taskCount: 3 });
        expect(screen.getByTestId('mobile-tab-badge-tasks')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-tasks').textContent).toBe('3');
    });

    it('hides task badge when taskCount is 0', () => {
        renderBar({ taskCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-tasks')).toBeNull();
    });

    it('shows activity badge when activityCount > 0', () => {
        renderBar({ activityCount: 5 });
        expect(screen.getByTestId('mobile-tab-badge-activity')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-activity').textContent).toBe('5');
    });

    it('hides activity badge when activityCount is 0', () => {
        renderBar({ activityCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-activity')).toBeNull();
    });

    it('multiple badges can appear simultaneously', () => {
        renderBar({ taskCount: 5, activityCount: 3 });
        expect(screen.getByTestId('mobile-tab-badge-tasks').textContent).toBe('5');
        expect(screen.getByTestId('mobile-tab-badge-activity').textContent).toBe('3');
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
});

describe('MobileTabBar: custom pinned tabs', () => {
    it('respects custom pinnedTabs prop', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'] });
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="info"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="git"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="tasks"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="activity"]')).toBeNull();
    });

    it('more sheet shows non-pinned tabs when custom pinnedTabs provided', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'], activeTab: 'info' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-activity')).toBeTruthy();
        expect(screen.queryByTestId('mobile-tab-more-item-info')).toBeNull();
    });
});
