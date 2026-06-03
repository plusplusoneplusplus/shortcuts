import { describe, expect, it } from 'vitest';
import {
    WORK_ITEM_REMOTE_PROVIDER_FILTERS,
    WORK_ITEM_TRACKER_TABS,
    buildWorkItemTreeFilter,
    buildWorkItemTreeFilters,
    getWorkItemTrackerViewCopy,
    getTrackerKindsForView,
    isGitHubTrackerView,
    isRemoteTrackerView,
    shouldShowLocalRootCreationActions,
} from '../../../../src/server/spa/client/react/features/work-items/workItemTrackerViews';

describe('work item tracker views', () => {
    it('defines Local and Remote top-level tracker tabs without a separate Azure tab', () => {
        expect(WORK_ITEM_TRACKER_TABS.map(tab => tab.kind)).toEqual(['local', 'remote']);
        expect(WORK_ITEM_TRACKER_TABS.map(tab => tab.label)).toEqual(['Local', 'Remote']);
        expect(WORK_ITEM_TRACKER_TABS.map(tab => tab.label)).not.toContain('Azure Boards');
    });

    it('builds tree filters with the active Epic-rooted tracker partitions', () => {
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

        expect(buildWorkItemTreeFilters({
            searchQuery: 'remote',
            trackerKinds: ['github-backed', 'azure-boards-backed'],
            showArchived: false,
            showDone: false,
        }).map(filter => filter.tracker)).toEqual(['github-backed', 'azure-boards-backed']);
    });

    it('keeps local creation actions in Local while Remote roots are seeded by import', () => {
        expect(shouldShowLocalRootCreationActions('local')).toBe(true);
        expect(shouldShowLocalRootCreationActions('remote')).toBe(false);
        expect(shouldShowLocalRootCreationActions('github-backed')).toBe(false);
        expect(shouldShowLocalRootCreationActions('azure-boards-backed')).toBe(false);
        expect(isGitHubTrackerView('github-backed')).toBe(true);
        expect(isGitHubTrackerView('local-only')).toBe(false);
        expect(isRemoteTrackerView('remote')).toBe(true);
        expect(isRemoteTrackerView('local')).toBe(false);
    });

    it('uses tracker-specific copy and provider filter options for the split dashboard views', () => {
        expect(getWorkItemTrackerViewCopy('local')).toEqual(expect.objectContaining({
            title: 'Local tracker',
            empty: expect.stringContaining('local Epic trees'),
        }));
        expect(getWorkItemTrackerViewCopy('remote')).toEqual(expect.objectContaining({
            title: 'Remote tracker',
            empty: expect.stringContaining('GitHub issue or Azure Boards work item'),
        }));
        expect(getWorkItemTrackerViewCopy('remote', 'azure-boards')).toEqual(expect.objectContaining({
            title: 'Remote tracker',
            empty: expect.stringContaining('Azure Boards'),
        }));
        expect(WORK_ITEM_REMOTE_PROVIDER_FILTERS.map(option => option.kind)).toEqual(['all', 'github', 'azure-boards']);
        expect(getTrackerKindsForView('remote', 'all')).toEqual(['github-backed', 'azure-boards-backed']);
        expect(getTrackerKindsForView('remote', 'github')).toEqual(['github-backed']);
        expect(getTrackerKindsForView('remote', 'azure-boards')).toEqual(['azure-boards-backed']);
        expect(getTrackerKindsForView('local', 'all')).toEqual(['local-only']);
    });

    it('keeps GitHub-specific copy available through the Remote provider filter', () => {
        expect(getWorkItemTrackerViewCopy('remote', 'github')).toEqual(expect.objectContaining({
            title: 'Remote tracker',
            empty: expect.stringContaining('Import a GitHub issue'),
        }));
    });
});
