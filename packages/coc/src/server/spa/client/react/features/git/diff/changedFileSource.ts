/**
 * changedFileSource — "Open file" on a changed-file row: the file's current
 * working copy as a raw source editor tab, never its diff or a rendered
 * Markdown view.
 *
 * The raw view is a per-tab request (`rawSource`); the global Markdown preview
 * setting is unchanged. With a unified panel the tab lands there and an open
 * tab for the same owner and path is focused rather than duplicated; without
 * one, the Explorer deep link shows its Monaco source view.
 */

import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import type { UnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openUnifiedPanelTab } from '../../repo-detail/unified-right-panel/unifiedPanelOpen';
import { explorerFileTabInput } from '../../repo-detail/unified-right-panel/unifiedExplorerFiles';
import { reviewFileStatus } from './gitReviewFiles';

export interface OpenChangedFileSourceInput {
    /** Repo-relative path of the working copy. */
    path: string;
    /** The review's own workspace. */
    workspaceId: string;
    /** Remote clone key of the owner; null (or absent) for a local owner. */
    ownerRoutingRef?: string | null;
    panelHost: UnifiedPanelHost | null;
}

/** Whether the file was opened. */
export function openChangedFileSource({ path, workspaceId, ownerRoutingRef, panelHost }: OpenChangedFileSourceInput): boolean {
    if (panelHost) {
        const input = explorerFileTabInput(
            { path },
            { ownerWorkspaceId: workspaceId, ownerRoutingRef, scopeWorkspaceId: panelHost.workspaceId, chatId: panelHost.chatId },
        );
        if (!input) return false;
        openUnifiedPanelTab(panelHost.workspaceId, { ...input, rawSource: true });
        return true;
    }
    location.hash = `#repos/${encodeURIComponent(ownerRoutingRef ?? workspaceId)}/explorer/${encodeURIComponent(path)}`;
    return true;
}

/**
 * The row action. A rename opens its new path; a deletion has no working copy,
 * so the action is disabled rather than opening the old path or a revision.
 */
export function openFileMenuItem(file: { path: string; status: string }, open: () => void): ContextMenuItem {
    const deleted = reviewFileStatus(file.status) === 'D';
    return {
        label: 'Open file',
        icon: '📄',
        disabled: deleted,
        title: deleted ? `${file.path} is deleted in this change; there is no file to open`
            : `Open the current working copy of ${file.path}`,
        onClick: open,
    };
}
