import type {
    WorkItemSyncConflictDetails,
    WorkItemSyncConflictField,
    WorkItemSyncConflictFieldDetail,
} from '@plusplusoneplusplus/coc-client';
import type { WorkItem } from './types';
import { parseGitHubWorkItemIssue } from './work-item-sync-github-issue';
import { mapGitHubStateToWorkItemStatus } from './work-item-sync-github-mapping';
import type { AzureBoardsWorkItem } from './work-item-sync-azure-boards-provider';
import type { GitHubWorkItemIssue } from './work-item-sync-github-provider';
import {
    mapAzureBoardsPriorityToWorkItemPriority,
    mapAzureBoardsStateToWorkItemStatus,
    parseAzureBoardsTags,
} from './work-item-sync-azure-boards-mapping';

export { WORK_ITEM_SYNC_CONFLICT_CODE } from '@plusplusoneplusplus/coc-client';
export type { WorkItemSyncConflictResolution } from '@plusplusoneplusplus/coc-client';

/**
 * Provider-owned field values for a work item, normalized to display strings (or
 * `null` when unset/empty) so the local base/draft and the remote provider value
 * can be compared field-by-field. `parent` is `undefined` when a comparable
 * reference is unavailable (e.g. the remote parent is not mirrored locally), so
 * that the parent row can be omitted rather than rendered as a false divergence.
 */
interface ProviderOwnedFieldValues {
    title: string | null;
    description: string | null;
    status: string | null;
    priority: string | null;
    tags: string | null;
    parent: string | null | undefined;
}

const CONFLICT_FIELDS: WorkItemSyncConflictField[] = [
    'title',
    'description',
    'status',
    'priority',
    'tags',
    'parent',
];

function normalizeText(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function normalizePriority(value: string | undefined | null): string {
    const trimmed = value?.trim();
    return trimmed ? trimmed : 'normal';
}

function normalizeTags(tags: readonly string[] | undefined | null): string | null {
    if (!tags) return null;
    const unique = [...new Set(tags.map(tag => tag.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return unique.length > 0 ? unique.join(', ') : null;
}

function localFieldValues(item: WorkItem): ProviderOwnedFieldValues {
    return {
        title: normalizeText(item.title),
        description: normalizeText(item.description),
        status: normalizeText(item.status),
        priority: normalizePriority(item.priority),
        tags: normalizeTags(item.tags),
        parent: normalizeText(item.parentId),
    };
}

function buildConflictFields(
    base: ProviderOwnedFieldValues,
    draft: ProviderOwnedFieldValues,
    remote: ProviderOwnedFieldValues,
): WorkItemSyncConflictFieldDetail[] {
    const fields: WorkItemSyncConflictFieldDetail[] = [];
    for (const field of CONFLICT_FIELDS) {
        const remoteValue = remote[field];
        // Skip fields where a comparable provider value is unavailable.
        if (remoteValue === undefined) continue;
        const baseValue = base[field] ?? null;
        // Only surface fields the provider actually changed since the local base;
        // those are exactly the values a stale save would clobber.
        if (remoteValue === baseValue) continue;
        fields.push({
            field,
            draft: draft[field] ?? null,
            base: baseValue,
            remote: remoteValue,
        });
    }
    return fields;
}

export interface BuildGitHubWorkItemSyncConflictOptions {
    /** The locally stored work item (its provider-owned fields are the mirror base). */
    current: WorkItem;
    /** The merged draft (current + pending updates) the user is attempting to save. */
    draft: WorkItem;
    /** The current backing GitHub issue snapshot. */
    remote: GitHubWorkItemIssue;
    issueNumber: number;
}

/**
 * Build the shared, typed conflict payload for a stale GitHub-backed save. The
 * remote provider values are read from the issue body's hidden
 * `coc-work-item-sync` metadata and canonical labels so the comparison matches
 * CoC's own field semantics.
 */
export function buildGitHubWorkItemSyncConflict(
    options: BuildGitHubWorkItemSyncConflictOptions,
): WorkItemSyncConflictDetails {
    const parsed = parseGitHubWorkItemIssue(options.remote);
    const remoteStatus = parsed.metadata?.status
        ?? parsed.status
        ?? mapGitHubStateToWorkItemStatus(options.remote.state);
    const remote: ProviderOwnedFieldValues = {
        title: normalizeText(options.remote.title),
        description: normalizeText(parsed.bodyWithoutMetadata),
        status: normalizeText(remoteStatus),
        priority: normalizePriority(parsed.priority),
        tags: normalizeTags(parsed.tags),
        parent: normalizeText(parsed.metadata?.parent?.workItemId ?? null),
    };
    return {
        kind: 'work-item-sync-conflict',
        provider: 'github',
        providerLabel: 'GitHub',
        workItemId: options.current.id,
        issueNumber: options.issueNumber,
        localUpdatedAt: options.current.githubMirror?.updatedAt,
        remoteUpdatedAt: options.remote.updatedAt,
        fields: buildConflictFields(
            localFieldValues(options.current),
            localFieldValues(options.draft),
            remote,
        ),
    };
}

export interface BuildAzureBoardsWorkItemSyncConflictOptions {
    /** The locally stored work item (its provider-owned fields are the mirror base). */
    current: WorkItem;
    /** The merged draft (current + pending updates) the user is attempting to save. */
    draft: WorkItem;
    /** The current backing Azure Boards work item snapshot. */
    remote: AzureBoardsWorkItem;
    remoteWorkItemId: number;
    /**
     * Local work item id of the remote parent, resolved by the caller from the
     * remote `Hierarchy-Reverse` relation. `null` means the remote item has no
     * parent (Epic root); `undefined` means the remote parent is not mirrored
     * locally so the parent row is omitted from the conflict.
     */
    remoteParentLocalId?: string | null;
}

/**
 * Build the shared, typed conflict payload for a stale Azure Boards-backed save.
 * Remote provider values are mapped back to CoC field semantics using the same
 * mapping helpers used during import.
 */
export function buildAzureBoardsWorkItemSyncConflict(
    options: BuildAzureBoardsWorkItemSyncConflictOptions,
): WorkItemSyncConflictDetails {
    const remote: ProviderOwnedFieldValues = {
        title: normalizeText(options.remote.title),
        description: normalizeText(options.remote.description),
        status: normalizeText(mapAzureBoardsStateToWorkItemStatus(options.remote.state)),
        priority: normalizePriority(mapAzureBoardsPriorityToWorkItemPriority(options.remote.priority).priority),
        tags: normalizeTags(parseAzureBoardsTags(options.remote.tags)),
        parent: options.remoteParentLocalId === undefined
            ? undefined
            : normalizeText(options.remoteParentLocalId),
    };
    const localRevision = options.current.azureBoardsMirror?.revision
        ?? (options.current.tracker?.kind === 'azure-boards-backed'
            ? options.current.tracker.azureBoards.revision
            : undefined);
    return {
        kind: 'work-item-sync-conflict',
        provider: 'azure-boards',
        providerLabel: 'Azure Boards',
        workItemId: options.current.id,
        remoteWorkItemId: options.remoteWorkItemId,
        localRevision,
        remoteRevision: options.remote.revision,
        localUpdatedAt: options.current.azureBoardsMirror?.updatedAt
            ?? (options.current.tracker?.kind === 'azure-boards-backed'
                ? options.current.tracker.azureBoards.updatedAt
                : undefined),
        remoteUpdatedAt: options.remote.updatedAt,
        fields: buildConflictFields(
            localFieldValues(options.current),
            localFieldValues(options.draft),
            remote,
        ),
    };
}
