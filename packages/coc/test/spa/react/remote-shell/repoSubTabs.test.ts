import { describe, it, expect } from 'vitest';
import {
    computeVisibleSubTabs, isWorkspaceSubTab, subTabClickTarget, SUB_TABS, TAB_GROUP_INDEX, VISIBLE_SUB_TABS,
    type VisibleSubTabOptions,
} from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';
import { partitionShellTabs } from '../../../../src/server/spa/client/react/features/remote-shell/shellModel';

const allOn: VisibleSubTabOptions = {
    isGitRepo: true, terminalEnabled: true, workflowsEnabled: true,
    pullRequestsEnabled: true, dreamsEnabled: true, showPlanDepTab: true,
};

describe('Workspace tabs', () => {
    it('keeps classic order and labels while hiding standalone Git, Terminal and Explorer', () => {
        const tabs = computeVisibleSubTabs(allOn);
        expect(tabs.map(t => t.key)).toEqual([
            'activity', 'work-items', 'dreams', 'pull-requests', 'workflows', 'schedules', 'tasks',
        ]);
        expect(tabs[0].label).toBe('Workspace');
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Plans (Dep.)');
        expect(tabs.find(t => t.key === 'schedules')?.label).toBe('Schedules');
        expect(tabs.find(t => t.key === 'pull-requests')?.label).toBe('PRs');
        expect(tabs.find(t => t.key === 'work-items')?.label).toBe('WIs');
    });
    it('has no Notes or Settings page tab: both live only in the right panel', () => {
        expect(SUB_TABS.map(t => t.key)).not.toContain('notes');
        expect(SUB_TABS.map(t => t.key)).not.toContain('settings');
        expect(TAB_GROUP_INDEX).not.toHaveProperty('notes');
        expect(TAB_GROUP_INDEX).not.toHaveProperty('settings');
    });
    it('hides deprecated Plans unless opted in', () => {
        expect(computeVisibleSubTabs({ ...allOn, showPlanDepTab: false }).map(t => t.key)).not.toContain('tasks');
    });
    it('hides PRs for a non-Git repo while retaining its Workspace', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, isGitRepo: false });
        expect(tabs.map(t => t.key)).not.toContain('pull-requests');
        expect(tabs[0]).toMatchObject({ key: 'activity', label: 'Workspace' });
    });
    it('continues to gate optional feature tabs', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, workflowsEnabled: false, pullRequestsEnabled: false, dreamsEnabled: false });
        expect(tabs.map(t => t.key)).toEqual(['activity', 'work-items', 'schedules', 'tasks']);
    });
    it('moves schedules into the Scheduled slide when enabled', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, schedulesInScheduledSlideEnabled: true });
        expect(tabs.map(t => t.key)).toEqual(['activity', 'work-items', 'dreams', 'pull-requests', 'workflows', 'tasks']);
    });
    it('keeps wiki in definitions but hidden by default, and CLI Sessions off the strip', () => {
        expect(SUB_TABS.find(t => t.key === 'wiki')).toBeDefined();
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'wiki')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'cli-sessions')).toBeUndefined();
    });
});

describe('desktop header tabs', () => {
    it('render no Workspace tab: the workspace is the repo main view', () => {
        const { remote, clone } = partitionShellTabs(computeVisibleSubTabs({ ...allOn, showPlanDepTab: false, workflowsEnabled: false, dreamsEnabled: false }));
        expect(remote.map(t => t.key)).toEqual(['work-items', 'pull-requests']);
        expect(clone.map(t => t.key)).toEqual(['schedules']);
        expect(clone.some(t => isWorkspaceSubTab(t.key) || t.label === 'Workspace')).toBe(false);
    });
    it('return to the workspace when the active tab is clicked again', () => {
        expect(subTabClickTarget('work-items', 'work-items')).toBe('activity');
        expect(subTabClickTarget('activity', 'work-items')).toBe('work-items');
        expect(subTabClickTarget(null, 'pull-requests')).toBe('pull-requests');
    });
    it('treat both chat aliases as the workspace', () => {
        expect(isWorkspaceSubTab('chats')).toBe(true);
        expect(isWorkspaceSubTab('activity')).toBe(true);
        expect(isWorkspaceSubTab('work-items')).toBe(false);
    });
});
