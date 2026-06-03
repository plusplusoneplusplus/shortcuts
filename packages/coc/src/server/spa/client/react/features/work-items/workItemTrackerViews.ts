import type { WorkItemSyncProvider, WorkItemTrackerKind, WorkItemTreeFilter } from '@plusplusoneplusplus/coc-client';

export type WorkItemTrackerViewKind = 'local' | 'remote';
export type WorkItemRemoteProviderFilter = 'all' | WorkItemSyncProvider;

export interface WorkItemTrackerTab {
    kind: WorkItemTrackerViewKind;
    label: string;
    description: string;
}

export interface WorkItemRemoteProviderFilterOption {
    kind: WorkItemRemoteProviderFilter;
    label: string;
}

export interface WorkItemTrackerViewCopy {
    title: string;
    subtitle: string;
    empty: string;
}

export const WORK_ITEM_TRACKER_TABS: readonly WorkItemTrackerTab[] = Object.freeze([
    {
        kind: 'local',
        label: 'Local',
        description: 'Local Epics',
    },
    {
        kind: 'remote',
        label: 'Remote',
        description: 'Synced Epics',
    },
]);

export const WORK_ITEM_REMOTE_PROVIDER_FILTERS: readonly WorkItemRemoteProviderFilterOption[] = Object.freeze([
    { kind: 'all', label: 'All' },
    { kind: 'github', label: 'GitHub' },
    { kind: 'azure-boards', label: 'Azure Boards' },
]);

export function getWorkItemTrackerViewCopy(viewKind?: WorkItemTrackerViewKind, remoteProviderFilter: WorkItemRemoteProviderFilter = 'all'): WorkItemTrackerViewCopy {
    if (viewKind === 'local') {
        return {
            title: 'Local tracker',
            subtitle: 'Local Epic trees that never sync to a remote provider.',
            empty: 'No local Epic trees yet. Create an Epic to start, or add an unparented Work Item.',
        };
    }
    if (viewKind === 'remote') {
        if (remoteProviderFilter === 'github') {
            return {
                title: 'Remote tracker',
                subtitle: 'GitHub-backed Epic trees mirrored into CoC for local execution.',
                empty: 'No GitHub-backed Epic trees yet. Import a GitHub issue to create a mirrored Epic tree.',
            };
        }
        if (remoteProviderFilter === 'azure-boards') {
            return {
                title: 'Remote tracker',
                subtitle: 'Azure Boards-backed Epic trees mirrored into CoC for local execution.',
                empty: 'No Azure Boards-backed Epic trees yet. Import an Azure Boards work item to create a mirrored Epic tree.',
            };
        }
        return {
            title: 'Remote tracker',
            subtitle: 'GitHub and Azure Boards Epic trees synced into CoC for local execution.',
            empty: 'No synced Epic trees yet. Import a GitHub issue or Azure Boards work item to create a mirrored tree.',
        };
    }
    return {
        title: 'Work breakdown',
        subtitle: 'Select an item to inspect its children.',
        empty: 'No work items yet. Create an Epic to start, or add an unparented Work Item.',
    };
}

export function getTrackerKindsForView(viewKind: WorkItemTrackerViewKind, remoteProviderFilter: WorkItemRemoteProviderFilter = 'all'): WorkItemTrackerKind[] {
    if (viewKind === 'local') return ['local-only'];
    if (remoteProviderFilter === 'github') return ['github-backed'];
    if (remoteProviderFilter === 'azure-boards') return ['azure-boards-backed'];
    return ['github-backed', 'azure-boards-backed'];
}

export function isRemoteTrackerView(viewKind?: WorkItemTrackerViewKind): boolean {
    return viewKind === 'remote';
}

export function isGitHubTrackerView(trackerKind?: WorkItemTrackerKind): boolean {
    return trackerKind === 'github-backed';
}

export function shouldShowLocalRootCreationActions(viewKind?: WorkItemTrackerViewKind | WorkItemTrackerKind): boolean {
    if (viewKind === 'remote' || viewKind === 'github-backed' || viewKind === 'azure-boards-backed') return false;
    return true;
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

export function buildWorkItemTreeFilters({
    searchQuery,
    trackerKinds,
    showArchived,
    showDone,
}: {
    searchQuery: string;
    trackerKinds?: readonly WorkItemTrackerKind[];
    showArchived: boolean;
    showDone: boolean;
}): WorkItemTreeFilter[] {
    const kinds = trackerKinds && trackerKinds.length > 0 ? trackerKinds : [undefined];
    return kinds.map(trackerKind => buildWorkItemTreeFilter({
        searchQuery,
        trackerKind,
        showArchived,
        showDone,
    }));
}
