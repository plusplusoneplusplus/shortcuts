import type { WorkItemTrackerKind, WorkItemTreeFilter } from '@plusplusoneplusplus/coc-client';

export interface WorkItemTrackerTab {
    kind: WorkItemTrackerKind;
    label: string;
    description: string;
}

export interface WorkItemTrackerViewCopy {
    title: string;
    subtitle: string;
    empty: string;
}

export const WORK_ITEM_TRACKER_TABS: readonly WorkItemTrackerTab[] = Object.freeze([
    {
        kind: 'local-only',
        label: 'Local',
        description: 'Local Epics',
    },
    {
        kind: 'github-backed',
        label: 'GitHub',
        description: 'Mirrored Epics',
    },
]);

export function getWorkItemTrackerViewCopy(trackerKind?: WorkItemTrackerKind): WorkItemTrackerViewCopy {
    if (trackerKind === 'local-only') {
        return {
            title: 'Local tracker',
            subtitle: 'Local Epic trees that never sync to GitHub.',
            empty: 'No local Epic trees yet. Create an Epic to start, or add an unparented Work Item.',
        };
    }
    if (trackerKind === 'github-backed') {
        return {
            title: 'GitHub tracker',
            subtitle: 'GitHub-backed Epic trees mirrored into CoC for local execution.',
            empty: 'No GitHub-backed Epic trees yet. Import a GitHub issue to create a mirrored Epic tree.',
        };
    }
    return {
        title: 'Work breakdown',
        subtitle: 'Select an item to inspect its children.',
        empty: 'No work items yet. Create an Epic to start, or add an unparented Work Item.',
    };
}

export function isGitHubTrackerView(trackerKind?: WorkItemTrackerKind): boolean {
    return trackerKind === 'github-backed';
}

export function shouldShowLocalRootCreationActions(trackerKind?: WorkItemTrackerKind): boolean {
    return !isGitHubTrackerView(trackerKind);
}

export function shouldShowLegacyWorkItemSyncToolbar(syncEnabled: boolean, trackerKind?: WorkItemTrackerKind): boolean {
    return syncEnabled && trackerKind === undefined;
}

export function buildWorkItemTreeFilter({
    searchQuery,
    trackerKind,
    showArchived,
    showDone,
}: {
    searchQuery: string;
    trackerKind?: WorkItemTrackerKind;
    showArchived: boolean;
    showDone: boolean;
}): WorkItemTreeFilter {
    return {
        q: searchQuery || undefined,
        tracker: trackerKind,
        includeArchived: showArchived,
        includeDone: showDone,
    };
}
