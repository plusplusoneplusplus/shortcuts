/**
 * workItemCopyMenu — builds the shared "Copy" context-menu entry used by both the
 * hierarchy tree and the flat work-item section menus.
 *
 * The entry is a single 📋 Copy parent with a submenu (Copy ID / Copy title / Copy info);
 * on mobile `ContextMenu` flattens it under a "Copy" section header. Each action copies to
 * the clipboard via the shared helper and reports the outcome through `notify` (a toast).
 *
 * The returned item never sets `separator: true` — `ContextMenu` treats a `separator` item
 * as a divider only and drops its content, so callers add their own dedicated separator
 * entries (`{ label: '', separator: true, onClick: () => {} }`) to group it.
 */

import type { ContextMenuItem } from '../../tasks/comments/ContextMenu';
import { copyToClipboard } from '../../utils/format';
import { formatWorkItemInfo, getWorkItemIdentifier, type WorkItemInfoInput } from './workItemInfo';

export type CopyMenuNotify = (message: string, type?: 'success' | 'error' | 'info') => void;

/**
 * Build the "Copy" context-menu item (with submenu) for a work item.
 *
 * @param item   The work item fields needed to format the clipboard text.
 * @param notify Optional toast callback invoked on success / failure.
 */
export function buildCopyContextMenuItem(
    item: WorkItemInfoInput,
    notify?: CopyMenuNotify,
): ContextMenuItem {
    const copy = async (text: string, label: string) => {
        try {
            await copyToClipboard(text);
            notify?.(`Copied ${label}`, 'success');
        } catch {
            notify?.('Failed to copy to clipboard', 'error');
        }
    };

    return {
        label: 'Copy',
        icon: '📋',
        // Parent of a submenu — the click is handled by the submenu rows below.
        onClick: () => {},
        children: [
            { label: 'Copy ID', onClick: () => void copy(getWorkItemIdentifier(item), 'ID') },
            { label: 'Copy title', onClick: () => void copy(item.title, 'title') },
            { label: 'Copy info', onClick: () => void copy(formatWorkItemInfo(item), 'info') },
        ],
    };
}
