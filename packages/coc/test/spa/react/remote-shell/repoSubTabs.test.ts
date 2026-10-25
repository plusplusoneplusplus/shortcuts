import { describe, it, expect } from 'vitest';
import {
    computeVisibleSubTabs, isWorkspaceSubTab, subTabClickTarget, SUB_TABS, TAB_GROUP_INDEX, VISIBLE_SUB_TABS,
    type VisibleSubTabOptions,
} from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';
import { partitionShellTabs } from '../../../../src/server/spa/client/react/features/remote-shell/shellModel';

const allOn: VisibleSubTabOptions = {
    isGitRepo: true, terminalEnabled: true, workflowsEnabled: true,
    dreamsEnabled: true, showPlanDepTab: true,
};

describe('Workspace tabs', () => {
    it('keeps classic order and labels while hiding standalone Git, Terminal and Explorer', () => {
        const tabs = computeVisibleSubTabs(allOn);
        expect(tabs.map(t => t.key)).toEqual([
            'activity', 'dreams', 'workflows', 'schedules', 'tasks',
        ]);
        expect(tabs[0].label).toBe('Workspace');
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Plans (Dep.)');
        expect(tabs.find(t => t.key === 'schedules')?.label).toBe('Schedules');
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
        const tabs = computeVisibleSubTabs({ ...allOn, workflowsEnabled: false, dreamsEnabled: false });
        expect(tabs.map(t => t.key)).toEqual(['activity', 'schedules', 'tasks']);
    });
    it('moves schedules into the Scheduled slide when enabled', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, schedulesInScheduledSlideEnabled: true });
        expect(tabs.map(t => t.key)).toEqual(['activity', 'dreams', 'workflows', 'tasks']);
    });
    it('defines no wiki or CLI Sessions sub-tab', () => {
        expect(SUB_TABS.find(t => (t.key as string) === 'wiki')).toBeUndefined();
        expect(VISIBLE_SUB_TABS).toBe(SUB_TABS);
        expect(SUB_TABS.find(t => t.key === 'cli-sessions')).toBeUndefined();
    });
});

describe('desktop header tabs', () => {
    it('render no Workspace tab: the workspace is the repo main view', () => {
        const { clone } = partitionShellTabs(computeVisibleSubTabs({ ...allOn, showPlanDepTab: false, workflowsEnabled: false, dreamsEnabled: false }));
        expect(clone.map(t => t.key)).toEqual(['schedules']);
        expect(clone.some(t => isWorkspaceSubTab(t.key) || t.label === 'Workspace')).toBe(false);
    });
    it('return to the workspace when the active tab is clicked again', () => {
        expect(subTabClickTarget('dreams', 'dreams')).toBe('activity');
        expect(subTabClickTarget('activity', 'dreams')).toBe('dreams');
        expect(subTabClickTarget(null, 'schedules')).toBe('schedules');
    });
    it('treat both chat aliases as the workspace', () => {
        expect(isWorkspaceSubTab('chats')).toBe(true);
        expect(isWorkspaceSubTab('activity')).toBe(true);
        expect(isWorkspaceSubTab('dreams')).toBe(false);
    });
});
