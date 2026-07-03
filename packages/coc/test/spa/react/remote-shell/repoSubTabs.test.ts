/**
 * repoSubTabs — unit tests for the extracted sub-tab visibility logic.
 * Guards that the shared helper behaves exactly like the logic previously
 * inlined in RepoDetail (feature-flag gating, git gating, layout relabel/reorder).
 */
import { describe, it, expect } from 'vitest';
import {
    computeVisibleSubTabs,
    SUB_TABS,
    VISIBLE_SUB_TABS,
    type VisibleSubTabOptions,
} from '../../../../src/server/spa/client/react/features/repo-detail/repoSubTabs';

const allOn: VisibleSubTabOptions = {
    isGitRepo: true,
    terminalEnabled: true,
    notesEnabled: true,
    workflowsEnabled: true,
    pullRequestsEnabled: true,
    dreamsEnabled: true,
    nativeCliSessionsEnabled: true,
    showPlanDepTab: true,
    uiLayoutMode: 'dev-workflow',
};

describe('VISIBLE_SUB_TABS', () => {
    it('hides wiki by default but keeps it in the full SUB_TABS list', () => {
        expect(VISIBLE_SUB_TABS.find(t => t.key === 'wiki')).toBeUndefined();
        expect(SUB_TABS.find(t => t.key === 'wiki')).toBeDefined();
    });
});

describe('computeVisibleSubTabs', () => {
    it('classic mode replaces chats with activity and relabels tasks', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, uiLayoutMode: 'classic' });
        expect(tabs.find(t => t.key === 'chats')).toBeUndefined();
        expect(tabs.find(t => t.key === 'activity')?.label).toBe('Activity');
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Plans (Dep.)');
    });

    it('dev-workflow mode reorders chats first and relabels PRs / schedules', () => {
        const tabs = computeVisibleSubTabs(allOn);
        expect(tabs[0].key).toBe('chats');
        expect(tabs.find(t => t.key === 'pull-requests')?.label).toBe('Full Requests');
        expect(tabs.find(t => t.key === 'schedules')?.label).toBe('Jobs');
    });

    it('hides git and pull-requests for a non-git repo', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, isGitRepo: false });
        expect(tabs.find(t => t.key === 'git')).toBeUndefined();
        expect(tabs.find(t => t.key === 'pull-requests')).toBeUndefined();
    });

    it('gates tabs behind their feature flags', () => {
        const tabs = computeVisibleSubTabs({
            ...allOn,
            terminalEnabled: false,
            notesEnabled: false,
            workflowsEnabled: false,
            pullRequestsEnabled: false,
            dreamsEnabled: false,
            nativeCliSessionsEnabled: false,
        });
        for (const key of ['terminal', 'notes', 'workflows', 'pull-requests', 'dreams', 'cli-sessions', 'copilot-sessions']) {
            expect(tabs.find(t => t.key === key)).toBeUndefined();
        }
        // Non-gated tabs survive.
        expect(tabs.find(t => t.key === 'work-items')).toBeDefined();
        expect(tabs.find(t => t.key === 'git')).toBeDefined();
    });

    // AC-02: the deprecated `tasks` sub-tab is hidden when showPlanDepTab is false,
    // in both classic and dev-workflow layout modes.
    it('hides the tasks (Plans Dep.) tab when showPlanDepTab is false — classic', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, uiLayoutMode: 'classic', showPlanDepTab: false });
        expect(tabs.find(t => t.key === 'tasks')).toBeUndefined();
    });

    it('hides the tasks (Tasks Dep.) tab when showPlanDepTab is false — dev-workflow', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, uiLayoutMode: 'dev-workflow', showPlanDepTab: false });
        expect(tabs.find(t => t.key === 'tasks')).toBeUndefined();
    });

    // AC-03: when showPlanDepTab is true, the tab appears exactly as before with
    // the layout-specific label.
    it('shows the tasks tab labeled "Plans (Dep.)" in classic mode when showPlanDepTab is true', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, uiLayoutMode: 'classic', showPlanDepTab: true });
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Plans (Dep.)');
    });

    it('shows the tasks tab labeled "Tasks (Dep.)" in dev-workflow mode when showPlanDepTab is true', () => {
        const tabs = computeVisibleSubTabs({ ...allOn, uiLayoutMode: 'dev-workflow', showPlanDepTab: true });
        expect(tabs.find(t => t.key === 'tasks')?.label).toBe('Tasks (Dep.)');
    });
});
