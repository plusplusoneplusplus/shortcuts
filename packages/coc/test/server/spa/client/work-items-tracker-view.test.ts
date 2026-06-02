import { describe, expect, it } from 'vitest';
import {
    WORK_ITEM_TRACKER_TABS,
    buildWorkItemTreeFilter,
    getWorkItemTrackerViewCopy,
    isGitHubTrackerView,
    shouldShowLocalRootCreationActions,
} from '../../../../src/server/spa/client/react/features/work-items/workItemTrackerViews';

describe('work item tracker views', () => {
    it('defines separate Local and GitHub top-level tracker tabs', () => {
        expect(WORK_ITEM_TRACKER_TABS.map(tab => tab.kind)).toEqual(['local-only', 'github-backed']);
        expect(WORK_ITEM_TRACKER_TABS.map(tab => tab.label)).toEqual(['Local', 'GitHub']);
    });

    it('builds tree filters with the active Epic-rooted tracker partition', () => {
        expect(buildWorkItemTreeFilter({
            searchQuery: '',
            trackerKind: 'local-only',
            showArchived: false,
            showDone: false,
        })).toEqual({
            q: undefined,
            tracker: 'local-only',
            includeArchived: false,
            includeDone: false,
        });

        expect(buildWorkItemTreeFilter({
            searchQuery: 'auth',
            trackerKind: 'github-backed',
            showArchived: true,
            showDone: true,
        })).toEqual({
            q: 'auth',
            tracker: 'github-backed',
            includeArchived: true,
            includeDone: true,
        });
    });

    it('keeps local creation actions in Local while GitHub roots are seeded by import', () => {
        expect(shouldShowLocalRootCreationActions('local-only')).toBe(true);
        expect(shouldShowLocalRootCreationActions('github-backed')).toBe(false);
        expect(isGitHubTrackerView('github-backed')).toBe(true);
        expect(isGitHubTrackerView('local-only')).toBe(false);
    });

    it('uses tracker-specific copy for the split dashboard views', () => {
        expect(getWorkItemTrackerViewCopy('local-only')).toEqual(expect.objectContaining({
            title: 'Local tracker',
            empty: expect.stringContaining('local Epic trees'),
        }));
        expect(getWorkItemTrackerViewCopy('github-backed')).toEqual(expect.objectContaining({
            title: 'GitHub tracker',
            empty: expect.stringContaining('Import a GitHub issue'),
        }));
    });
});
