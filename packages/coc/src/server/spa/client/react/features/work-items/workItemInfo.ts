/**
 * workItemInfo — pure, DOM-free formatters for copying a work item's information.
 *
 * Reuses the existing identifier formatter (`getWorkItemChatIdentifier`), human-readable
 * type labels (`TYPE_LABELS`), and status labels (`STATUS_LABEL`) so no new prefix/label
 * map copies are introduced.
 */

import { getWorkItemChatIdentifier } from './WorkItemChatPanel';
import { STATUS_LABEL, TYPE_LABELS, type WorkItemTypeLabel } from './WorkItemHierarchyNode';

/** Minimal shape shared by `WorkItem` (hierarchy) and `WorkItemSummary` (flat list). */
export interface WorkItemInfoInput {
    id: string;
    workItemNumber?: number;
    title: string;
    status: string;
    type?: string;
    description?: string;
}

/** Human-readable identifier, e.g. `PBI-23` — falls back to the raw UUID when unsynced. */
export function getWorkItemIdentifier(item: WorkItemInfoInput): string {
    return getWorkItemChatIdentifier(item.id, item.workItemNumber, item.type);
}

/** Human-readable type label, e.g. `PBI` — falls back to the raw type then `Work Item`. */
export function getWorkItemTypeLabel(item: WorkItemInfoInput): string {
    const key = (item.type ?? 'work-item') as WorkItemTypeLabel;
    return TYPE_LABELS[key] ?? item.type ?? TYPE_LABELS['work-item'];
}

/** Human-readable status label, e.g. `Planning` — falls back to the raw status. */
export function getWorkItemStatusLabel(item: WorkItemInfoInput): string {
    return STATUS_LABEL[item.status] ?? item.status;
}

/**
 * A readable, plain-text block describing the work item. Example:
 *
 *   PBI-23
 *   Show project-relative paths in the work item list
 *   Type: PBI · Status: Planning
 *   ID: 4a27276e-9b0c-...
 *
 *   <description, if present>
 */
export function formatWorkItemInfo(item: WorkItemInfoInput): string {
    const lines = [
        getWorkItemIdentifier(item),
        item.title,
        `Type: ${getWorkItemTypeLabel(item)} · Status: ${getWorkItemStatusLabel(item)}`,
        `ID: ${item.id}`,
    ];
    const description = item.description?.trim();
    if (description) {
        lines.push('', description);
    }
    return lines.join('\n');
}
