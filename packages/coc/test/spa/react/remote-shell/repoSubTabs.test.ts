import { describe, it, expect } from 'vitest';
import { computeVisibleSubTabs, SUB_TABS, VISIBLE_SUB_TABS, type VisibleSubTabOptions } from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';

const allOn: VisibleSubTabOptions = {
    isGitRepo: true, terminalEnabled: true, notesEnabled: true, workflowsEnabled: true,
    pullRequestsEnabled: true, dreamsEnabled: true, showPlanDepTab: true,
};

describe('Workspace tabs', () => {
    it('keeps classic order and labels while hiding standalone Git, Terminal and Explorer', () => {
        const tabs = computeVisibleSubTabs(allOn);
        expect(tabs.map(t => t.key)).toEqual([
            'activity', 'work-items', 'dreams', 'pull-requests', 'workflows', 'schedules', 'tasks', 'notes', 'settings',
        ]);
        expect(tabs[0].label).toBe('Workspace');
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Plans (Dep.)');
        expect(tabs.find(t => t.key === 'schedules')?.label).toBe('Schedules');
        expect(tabs.find(t => t.key === 'pull-requests')?.label).toBe('PRs');
        expect(tabs.find(t => t.key === 'work-items')?.label).toBe('WIs');
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
        const tabs = computeVisibleSubTabs({ ...allOn, notesEnabled: false, workflowsEnabled: false, pullRequestsEnabled: false, dreamsEnabled: false });
        expect(tabs.map(t => t.key)).toEqual(['activity', 'work-items', 'schedules', 'tasks', 'settings']);
    });
    it('moves schedules into the Scheduled slide when enabled', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, schedulesInScheduledSlideEnabled: true });
        expect(tabs.map(t => t.key)).not.toContain('schedules');
        expect(tabs.map(t => t.key)).toEqual(['activity', 'work-items', 'dreams', 'pull-requests', 'workflows', 'tasks', 'notes', 'settings']);
    });
    it('keeps wiki in definitions but hidden by default, and CLI Sessions off the strip', () => {
        expect(SUB_TABS.find(t => t.key === 'wiki')).toBeDefined();
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'wiki')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'cli-sessions')).toBeUndefined();
    });
});
