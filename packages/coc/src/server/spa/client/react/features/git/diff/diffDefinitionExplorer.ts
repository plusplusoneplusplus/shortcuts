/**
 * diffDefinitionExplorer — open a diff's go-to-definition target in Explorer.
 *
 * The 'explorer' route of `resolveDiffDefinitionRoute`: the current version of
 * the file at the definition line, in the unified panel's Explorer file tab
 * when a panel hosts the diff, else the repo's Explorer sub-tab deep link
 * (pop-outs and embedded hosts; that link carries no line, and the browser's
 * own Back returns from it). A panel tab remembers its way back to the diff
 * (`diffDefinitionReturn`).
 */

import type { UnifiedPanelHost } from '../../repo-detail/unified-right-panel/unifiedPanelHost';
import { openUnifiedPanelTab } from '../../repo-detail/unified-right-panel/unifiedPanelOpen';
import { explorerFileTabInput } from '../../repo-detail/unified-right-panel/unifiedExplorerFiles';
import { readUnifiedPanelState } from '../../repo-detail/unified-right-panel/unifiedPanelStore';
import { activeTabId } from '../../repo-detail/unified-right-panel/unifiedPanelTabsModel';
import { recordDiffDefinitionReturn } from './diffDefinitionReturn';
import type { DiffDefinitionRoute } from './diffDefinitionRoute';

export interface OpenDiffDefinitionInExplorerInput {
    route: Extract<DiffDefinitionRoute, { kind: 'explorer' }>;
    /** The diff's own workspace. */
    workspaceId: string;
    /** Remote clone key of the owner; null (or absent) for a local owner. */
    ownerRoutingRef?: string | null;
    panelHost: UnifiedPanelHost | null;
    /** The way back to the diff: chip label and the diff's position restore. */
    returnTo?: { label: string; restore?: () => void };
}

/** Whether the target was opened. */
export function openDiffDefinitionInExplorer({ route, workspaceId, ownerRoutingRef, panelHost, returnTo }: OpenDiffDefinitionInExplorerInput): boolean {
    if (panelHost) {
        const input = explorerFileTabInput(
            { path: route.path, line: route.line, column: route.column, ...(route.symbolCandidate ? { symbolCandidate: true as const } : {}) },
            { ownerWorkspaceId: workspaceId, ownerRoutingRef, scopeWorkspaceId: panelHost.workspaceId, chatId: panelHost.chatId },
        );
        if (!input) return false;
        // Read before opening: the tab hosting the diff (often the Git tab).
        const originTabId = activeTabId(readUnifiedPanelState(panelHost.workspaceId), panelHost.chatId);
        const tabId = openUnifiedPanelTab(panelHost.workspaceId, input);
        if (returnTo && tabId !== originTabId) {
            recordDiffDefinitionReturn(panelHost.workspaceId, tabId, {
                label: returnTo.label, originTabId, chatId: panelHost.chatId, restore: returnTo.restore,
            });
        }
        return true;
    }
    location.hash = `#repos/${encodeURIComponent(ownerRoutingRef ?? workspaceId)}/explorer/${encodeURIComponent(route.path)}`;
    return true;
}
