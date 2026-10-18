import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MobileTabBar } from '../../../../src/server/spa/client/react/layout/MobileTabBar';
import { computeVisibleSubTabs } from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';

afterEach(cleanup);
const tabs = computeVisibleSubTabs({ isGitRepo: true, terminalEnabled: true, workflowsEnabled: true, dreamsEnabled: true, showPlanDepTab: true });
function renderBar(props: Partial<Parameters<typeof MobileTabBar>[0]> = {}) {
    const onTabChange = vi.fn();
    return { onTabChange, ...render(<MobileTabBar activeTab="activity" onTabChange={onTabChange} tabs={tabs} {...props} />) };
}
describe('MobileTabBar', () => {
    it('keeps WI/PR resource destinations out of page navigation', () => {
        renderBar();
        expect(screen.getByTestId('mobile-tab-bar')).toBeTruthy();
        expect(screen.queryByText('WIs')).toBeNull();
        expect(screen.queryByText('PRs')).toBeNull();
    });
    it('opens overflow page tabs and invokes navigation', () => {
        const { onTabChange } = renderBar();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        fireEvent.click(screen.getByTestId('mobile-tab-more-item-dreams'));
        expect(onTabChange).toHaveBeenCalledWith('dreams');
    });
    it('retains queue badges on explicitly pinned workspace tabs', () => {
        renderBar({ pinnedTabs: ['activity'], activityCount: 5 });
        expect(screen.getByTestId('mobile-tab-badge-activity').textContent).toBe('5');
    });
    it('retains caller actions and leading controls', () => {
        const onClick = vi.fn();
        renderBar({ leadingSlot: <button>Workspace</button>, actions: [{ label: 'New chat', onClick }] });
        expect(screen.getByText('Workspace')).toBeTruthy();
        fireEvent.click(screen.getByTestId('mobile-tab-more-btn'));
        fireEvent.click(screen.getByText('New chat'));
        expect(onClick).toHaveBeenCalledOnce();
    });
});
