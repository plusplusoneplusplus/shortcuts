/**
 * Open one overlay result without losing the search when its owner disappeared.
 *
 * Group membership and the file itself are checked before panel state changes.
 * That makes the operation transactional from the overlay's point of view: a
 * stale member, an unresolved clone, or a deleted file leaves the current page,
 * dock target, tabs, results, and selection untouched.
 */
import { explorerApi } from '../explorer/explorerApi';
import {
    getRepoGroup,
    type RepoGroupDetails,
} from '../../../repos/repoGroupService';
import {
    hasWorkspaceRouteForBaseUrl,
    resolveCloneRoute,
} from '../../../repos/cloneRegistry';
import { explorerFileTabInput } from '../unified-right-panel/unifiedExplorerFiles';
import { openUnifiedPanelPreviewTab } from '../unified-right-panel/unifiedPanelOpen';
import { routingRefForPanelOwner } from '../unified-right-panel/unifiedPanelOwnerRouting';
import type { ContentSearchOverlayMatch } from './ContentSearchOverlay';
import type { ContentSearchScope } from './contentSearchShortcut';

export type ContentSearchOpenOutcome =
    | { opened: true }
    | { opened: false; error: string };

export interface OpenContentSearchMatchInput {
    /** Panel/page scope. This stays the group id for a group result. */
    panelWorkspaceId: string;
    scope: ContentSearchScope;
    chatId: string | null;
    /** Owning server URL for a group. Absent for a local group. */
    groupBaseUrl?: string;
    /** Cancels a close-in-progress activation before it can mutate panel state. */
    signal?: AbortSignal;
    match: ContentSearchOverlayMatch;
}

export interface ContentSearchOpenDependencies {
    getGroup: (groupId: string, baseUrl?: string) => Promise<RepoGroupDetails>;
    hasWorkspaceRoute: (workspaceId: string, baseUrl: string) => boolean;
    resolveRoute: typeof resolveCloneRoute;
    readBlob: typeof explorerApi.readBlob;
    openPreview: typeof openUnifiedPanelPreviewTab;
}

const DEFAULT_DEPENDENCIES: ContentSearchOpenDependencies = {
    getGroup: getRepoGroup,
    hasWorkspaceRoute: hasWorkspaceRouteForBaseUrl,
    resolveRoute: resolveCloneRoute,
    readBlob: explorerApi.readBlob,
    openPreview: openUnifiedPanelPreviewTab,
};

function unavailable(message: string): ContentSearchOpenOutcome {
    return { opened: false, error: message };
}

/**
 * Verify the result owner and path, then open the file at its matching line in
 * the panel's preview slot. Dependencies are injectable only for focused tests.
 */
export async function openContentSearchMatch(
    input: OpenContentSearchMatchInput,
    dependencies: ContentSearchOpenDependencies = DEFAULT_DEPENDENCIES,
): Promise<ContentSearchOpenOutcome> {
    const { panelWorkspaceId, scope, chatId, groupBaseUrl, signal, match } = input;
    let repoLabel = match.repoLabel ?? undefined;

    if (scope === 'group') {
        let group: RepoGroupDetails;
        try {
            group = await dependencies.getGroup(panelWorkspaceId, groupBaseUrl);
        } catch {
            return unavailable('Could not refresh this repository group. Check its connection and try again.');
        }
        if (signal?.aborted) return unavailable('Opening this result was cancelled.');
        const member = group.members.find(candidate => candidate.workspaceId === match.workspaceId);
        if (!member || member.stale) {
            return unavailable('This repository is no longer available in the group. Run the search again.');
        }
        repoLabel = member.name || repoLabel;
        if (groupBaseUrl && !dependencies.hasWorkspaceRoute(match.workspaceId, groupBaseUrl)) {
            return unavailable('The repository owner is offline. Reconnect it and try again.');
        }
    }

    const ownerRoutingRef = routingRefForPanelOwner(match.routingRef, match.workspaceId);
    if (dependencies.resolveRoute(ownerRoutingRef).kind === 'unresolved-remote') {
        return unavailable('The repository owner is offline. Reconnect it and try again.');
    }

    // A result may outlive the file it names. Probe through the same exact
    // owner route the editor will use before touching panel state.
    try {
        await dependencies.readBlob(
            match.workspaceId,
            match.path,
            signal ? { signal } : {},
            ownerRoutingRef,
        );
    } catch {
        return unavailable('This file is no longer available. Run the search again.');
    }
    if (signal?.aborted) return unavailable('Opening this result was cancelled.');

    const descriptor = explorerFileTabInput(
        { path: match.path, line: match.line },
        {
            ownerWorkspaceId: match.workspaceId,
            ownerRoutingRef,
            scopeWorkspaceId: panelWorkspaceId,
            ownerLabel: repoLabel,
            chatId,
        },
    );
    if (descriptor === null) {
        return unavailable('This search result has an invalid file path. Run the search again.');
    }
    const { kind: _kind, ...preview } = descriptor;
    dependencies.openPreview(panelWorkspaceId, preview);
    return { opened: true };
}
