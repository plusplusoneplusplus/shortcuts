/**
 * Tests for MobileTabBar — mobile bottom tab navigation bar.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MobileTabBar } from '../../../../src/server/spa/client/react/layout/MobileTabBar';
import type { RepoSubTab } from '../../../../src/server/spa/client/react/types/dashboard';

const ALL_TABS: { key: RepoSubTab; label: string }[] = [
    { key: 'info', label: 'Info' },
    { key: 'git', label: 'Git' },
    { key: 'pipelines', label: 'Pipelines' },
    { key: 'tasks', label: 'Tasks' },
    { key: 'queue', label: 'Queue' },
    { key: 'schedules', label: 'Schedules' },
    { key: 'chat', label: 'Chat' },
];

const DEFAULT_PINNED: RepoSubTab[] = ['tasks', 'queue', 'chat'];

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

    it('renders pinned tabs by default (Tasks, Queue, Chat)', () => {
        renderBar();
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="tasks"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="queue"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="chat"]')).toBeTruthy();
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
        renderBar({ pinnedTabs: ['info', 'git', 'pipelines', 'tasks', 'queue', 'schedules', 'chat'] });
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
        const queueBtn = nav.querySelector('[data-tab="queue"]') as HTMLElement;
        expect(queueBtn.className).not.toContain('text-[#0078d4]');
        expect(queueBtn.className).toContain('text-[#616161]');
    });

    it('sets aria-current="page" on active pinned tab', () => {
        renderBar({ activeTab: 'queue' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const queueBtn = nav.querySelector('[data-tab="queue"]') as HTMLElement;
        expect(queueBtn.getAttribute('aria-current')).toBe('page');
    });

    it('does not set aria-current on inactive tabs', () => {
        renderBar({ activeTab: 'tasks' });
        const nav = screen.getByTestId('mobile-tab-bar');
        const queueBtn = nav.querySelector('[data-tab="queue"]') as HTMLElement;
        expect(queueBtn.getAttribute('aria-current')).toBeNull();
    });

    it('More button is highlighted when active tab is a "more" tab', () => {
        renderBar({ activeTab: 'info' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).toContain('text-[#0078d4]');
    });

    it('More button is gray when active tab is a pinned tab', () => {
        renderBar({ activeTab: 'chat' });
        const moreBtn = screen.getByTestId('mobile-tab-more-btn');
        expect(moreBtn.className).not.toContain('text-[#0078d4]');
    });
});

describe('MobileTabBar: tab switching', () => {
    it('calls onTabChange when a pinned tab is clicked', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'tasks' });
        const queueBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="queue"]') as HTMLElement;
        fireEvent.click(queueBtn);
        expect(onTabChange).toHaveBeenCalledWith('queue');
    });

    it('calls onTabChange for chat tab', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange, activeTab: 'tasks' });
        const chatBtn = screen.getByTestId('mobile-tab-bar').querySelector('[data-tab="chat"]') as HTMLElement;
        fireEvent.click(chatBtn);
        expect(onTabChange).toHaveBeenCalledWith('chat');
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

    it('sheet lists non-pinned tabs (Info, Git, Pipelines, Schedules)', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-info')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-git')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-pipelines')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-schedules')).toBeTruthy();
    });

    it('pinned tabs are NOT in the more sheet', () => {
        renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.queryByTestId('mobile-tab-more-item-tasks')).toBeNull();
        expect(screen.queryByTestId('mobile-tab-more-item-queue')).toBeNull();
        expect(screen.queryByTestId('mobile-tab-more-item-chat')).toBeNull();
    });

    it('selecting a tab from the sheet calls onTabChange', () => {
        const onTabChange = vi.fn();
        renderBar({ onTabChange });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        fireEvent.click(screen.getByTestId('mobile-tab-more-item-git'));
        expect(onTabChange).toHaveBeenCalledWith('git');
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
        renderBar({ activeTab: 'git' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        const gitBtn = screen.getByTestId('mobile-tab-more-item-git');
        expect(gitBtn.className).toContain('text-[#0078d4]');
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

    it('shows queue badge combining running + queued counts', () => {
        renderBar({ queueRunningCount: 2, queueQueuedCount: 3 });
        expect(screen.getByTestId('mobile-tab-badge-queue')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-queue').textContent).toBe('5');
    });

    it('shows queue badge with only running count', () => {
        renderBar({ queueRunningCount: 1, queueQueuedCount: 0 });
        expect(screen.getByTestId('mobile-tab-badge-queue').textContent).toBe('1');
    });

    it('hides queue badge when both running and queued are 0', () => {
        renderBar({ queueRunningCount: 0, queueQueuedCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-queue')).toBeNull();
    });

    it('shows chat badge when chatPendingCount > 0', () => {
        renderBar({ chatPendingCount: 2 });
        expect(screen.getByTestId('mobile-tab-badge-chat')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-badge-chat').textContent).toBe('2');
    });

    it('hides chat badge when chatPendingCount is 0', () => {
        renderBar({ chatPendingCount: 0 });
        expect(screen.queryByTestId('mobile-tab-badge-chat')).toBeNull();
    });

    it('multiple badges can appear simultaneously', () => {
        renderBar({ taskCount: 5, queueRunningCount: 1, chatPendingCount: 3 });
        expect(screen.getByTestId('mobile-tab-badge-tasks').textContent).toBe('5');
        expect(screen.getByTestId('mobile-tab-badge-queue').textContent).toBe('1');
        expect(screen.getByTestId('mobile-tab-badge-chat').textContent).toBe('3');
    });
});

describe('MobileTabBar: custom pinned tabs', () => {
    it('respects custom pinnedTabs prop', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'] });
        const nav = screen.getByTestId('mobile-tab-bar');
        expect(nav.querySelector('[data-tab="info"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="git"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="tasks"]')).toBeTruthy();
        expect(nav.querySelector('[data-tab="queue"]')).toBeNull();
        expect(nav.querySelector('[data-tab="chat"]')).toBeNull();
    });

    it('more sheet shows non-pinned tabs when custom pinnedTabs provided', () => {
        renderBar({ pinnedTabs: ['info', 'git', 'tasks'], activeTab: 'info' });
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        expect(screen.getByTestId('mobile-tab-more-item-queue')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-more-item-chat')).toBeTruthy();
        expect(screen.queryByTestId('mobile-tab-more-item-info')).toBeNull();
    });
});
