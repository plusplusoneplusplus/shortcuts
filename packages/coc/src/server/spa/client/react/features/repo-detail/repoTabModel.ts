/**
 * repoTabModel — pure, DOM-light helpers for the repo tab strip.
 *
 * These functions own the navigation model math (visible/hidden sets, queue
 * status, overflow flags, accessible labels) so the RepoTabStrip view layer and
 * its hooks can stay composition glue. Keeping them free of React state makes
 * the "selected repo stays visible" and "overflow badge" rules independently
 * testable as repo counts grow.
 */

import type { DragEvent as ReactDragEvent } from 'react';
import type { RepoData, RepoGroup } from '../../repos/repoGrouping';
import { isHidden as isHiddenTask } from '../../queue/hooks/useRepoQueueStats';

export type RepoQueueStatus = 'idle' | 'running' | 'queued' | 'paused';

export interface RepoQueueStatusInfo {
    status: RepoQueueStatus;
    label: string;
    icon: 'play' | 'pause' | 'pending' | null;
}

export function getRepoQueueStatusInfo(status: RepoQueueStatus): RepoQueueStatusInfo {
    switch (status) {
        case 'running':
            return { status, label: 'running jobs', icon: 'play' };
        case 'queued':
            return { status, label: 'queued jobs', icon: 'pending' };
        case 'paused':
            return { status, label: 'queue paused', icon: 'pause' };
        default:
            return { status: 'idle', label: 'idle', icon: null };
    }
}

export function getRepoQueueAccessibleLabel(repoName: string, status: RepoQueueStatus): string {
    const info = getRepoQueueStatusInfo(status);
    return status === 'idle' ? repoName : `${repoName}, ${info.label}`;
}

/** Display name for a workspace: prefix agent name for container repos to disambiguate same-named repos across agents. */
export function getRepoDisplayName(ws: any): string {
    if (ws.agentName) {
        return `${ws.agentName}:${ws.name}`;
    }
    return ws.name;
}

export const REPO_TAB_DRAG_MIME = 'application/x-coc-repo-tab';

export function getHorizontalDropPosition(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
}

export function getVerticalDropPosition(event: ReactDragEvent<HTMLElement>): 'before' | 'after' {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
}

/**
 * Compute which repo IDs are visible given a container width.
 * Measures each tab's offsetWidth and accumulates until the budget runs out.
 * The selected repo is always included; if it doesn't fit naturally it replaces
 * the last visible tab.
 */
export function computeVisibleRepoIds(
    tabElements: HTMLElement[],
    containerWidth: number,
    selectedRepoId: string | null,
): Set<string> {
    if (containerWidth <= 0) {
        // Extremely narrow: show only the selected repo (if any)
        if (selectedRepoId) return new Set([selectedRepoId]);
        return new Set<string>();
    }

    const visible = new Set<string>();
    let usedWidth = 0;
    let lastVisibleId: string | null = null;

    for (const el of tabElements) {
        const id = el.getAttribute('data-repo-id');
        if (!id) continue;
        // Include the gap between tabs (approximate 2px for gap-0.5)
        const width = el.offsetWidth + 2;
        if (usedWidth + width <= containerWidth) {
            visible.add(id);
            usedWidth += width;
            lastVisibleId = id;
        } else {
            break;
        }
    }

    // Ensure selected repo is always visible
    if (selectedRepoId && !visible.has(selectedRepoId)) {
        if (lastVisibleId && visible.size > 0) {
            visible.delete(lastVisibleId);
        }
        visible.add(selectedRepoId);
    }

    return visible;
}

/**
 * Compute which agent group IDs are visible given a container width.
 * Works like computeVisibleRepoIds but for agent pill elements.
 * The agent containing the selected repo is always included.
 */
export function computeVisibleAgentIds(
    pillElements: HTMLElement[],
    containerWidth: number,
    selectedAgentId: string | null,
): Set<string> {
    if (containerWidth <= 0) {
        if (selectedAgentId) return new Set([selectedAgentId]);
        return new Set<string>();
    }

    const visible = new Set<string>();
    let usedWidth = 0;
    let lastVisibleId: string | null = null;

    for (const el of pillElements) {
        const id = el.getAttribute('data-agent-id');
        if (!id) continue;
        const width = el.offsetWidth + 2;
        if (usedWidth + width <= containerWidth) {
            visible.add(id);
            usedWidth += width;
            lastVisibleId = id;
        } else {
            break;
        }
    }

    // Ensure agent with selected repo is always visible
    if (selectedAgentId && !visible.has(selectedAgentId)) {
        if (lastVisibleId && visible.size > 0) {
            visible.delete(lastVisibleId);
        }
        visible.add(selectedAgentId);
    }

    return visible;
}

/**
 * Flatten grouped repos into a flat ordered list of repo IDs.
 */
export function flattenGroups(groups: RepoGroup[]): string[] {
    const ids: string[] = [];
    for (const g of groups) {
        for (const r of g.repos) ids.push(r.workspace.id);
    }
    return ids;
}

/**
 * Pre-compute the queue status for each repo from the queue context's repo map.
 * Paused wins over running, running over queued; hidden tasks never count.
 */
export function buildRepoQueueStatusMap(
    repos: readonly RepoData[],
    repoQueueMap: Record<string, any> | undefined,
): Record<string, RepoQueueStatus> {
    const map: Record<string, RepoQueueStatus> = {};
    for (const repo of repos) {
        const wsId = repo.workspace.id;
        const entry = repoQueueMap?.[wsId];
        if (!entry) { map[wsId] = 'idle'; continue; }
        if (entry.stats?.isPaused) { map[wsId] = 'paused'; continue; }
        const running = (entry.running ?? []).filter((t: unknown) => !isHiddenTask(t)).length;
        if (running > 0) { map[wsId] = 'running'; continue; }
        const queued = (entry.queued ?? []).filter((t: unknown) => !isHiddenTask(t)).length;
        if (queued > 0) { map[wsId] = 'queued'; continue; }
        map[wsId] = 'idle';
    }
    return map;
}

export interface RepoOverflowState {
    overflowCount: number;
    hasOverflow: boolean;
    overflowHasUnseen: boolean;
    selectedIsHidden: boolean;
}

/**
 * Derive overflow badge state from the current visible set. `visibleRepoIds` is
 * null when every tab fits (no overflow). The selected repo is flagged hidden so
 * the overflow pill can advertise it as the current-but-collapsed repo.
 */
export function computeRepoOverflowState(
    visibleRepoIds: Set<string> | null,
    allRepoIds: readonly string[],
    selectedRepoId: string | null,
    unseenCounts: Record<string, number>,
): RepoOverflowState {
    const overflowCount = visibleRepoIds ? allRepoIds.length - visibleRepoIds.size : 0;
    const hasOverflow = overflowCount > 0;
    const overflowHasUnseen = hasOverflow && allRepoIds.some(
        id => !visibleRepoIds!.has(id) && (unseenCounts[id] ?? 0) > 0,
    );
    const selectedIsHidden = hasOverflow && selectedRepoId != null && !visibleRepoIds!.has(selectedRepoId);
    return { overflowCount, hasOverflow, overflowHasUnseen, selectedIsHidden };
}
