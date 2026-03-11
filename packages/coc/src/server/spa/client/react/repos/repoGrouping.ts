/**
 * Pure utility functions for repo grouping, URL normalization, and hashing.
 * Ported from repos.ts.
 */

// normalizeRemoteUrl is the single source of truth in pipeline-core.
// Imported here so the SPA can reuse the same canonical implementation.
import { normalizeRemoteUrl } from '@plusplusoneplusplus/pipeline-core/git/normalize-url';
export { normalizeRemoteUrl };

export interface WorkflowInfo {
    name: string;
    path: string;
    description?: string;
    isValid?: boolean;
    validationErrors?: string[];
}

export interface RepoData {
    workspace: any;
    gitInfo?: {
        branch: string | null;
        dirty: boolean;
        isGitRepo: boolean;
        remoteUrl?: string | null;
        ahead?: number;
        behind?: number;
    };
    gitInfoLoading?: boolean;
    workflows?: WorkflowInfo[];
    stats?: { success: number; failed: number; running: number };
    taskCount?: number;
}

export interface RepoGroup {
    normalizedUrl: string | null;
    label: string;
    repos: RepoData[];
    expanded: boolean;
}

/** Extract a short display label from a normalized remote URL. */
export function remoteUrlLabel(normalized: string): string {
    const parts = normalized.split('/');
    if (parts.length >= 3) {
        return parts.slice(1).join('/');
    }
    return normalized;
}

/** Group repos by their normalized remote URL. */
export function groupReposByRemote(
    repos: RepoData[],
    expandedState: Record<string, boolean>
): RepoGroup[] {
    const groups = new Map<string, RepoGroup>();
    const ungrouped: RepoData[] = [];

    for (const repo of repos) {
        const rawUrl = repo.workspace.remoteUrl || repo.gitInfo?.remoteUrl;
        if (!rawUrl) {
            ungrouped.push(repo);
            continue;
        }
        const normalized = normalizeRemoteUrl(rawUrl);
        if (!normalized) {
            // normalizeRemoteUrl returned empty — fall back to treating as ungrouped
            // so the repo still renders visibly rather than as a group with falsy key.
            ungrouped.push(repo);
            continue;
        }
        if (!groups.has(normalized)) {
            groups.set(normalized, {
                normalizedUrl: normalized,
                label: remoteUrlLabel(normalized),
                repos: [],
                expanded: expandedState[normalized] !== false,
            });
        }
        groups.get(normalized)!.repos.push(repo);
    }

    const result: RepoGroup[] = [];

    // Groups with 2+ repos come first (interesting clones)
    const multiClone: RepoGroup[] = [];
    const singleClone: RepoGroup[] = [];
    for (const g of groups.values()) {
        if (g.repos.length >= 2) {
            multiClone.push(g);
        } else {
            singleClone.push(g);
        }
    }

    multiClone.sort((a, b) => a.label.localeCompare(b.label));
    result.push(...multiClone);

    for (const g of singleClone) {
        result.push(g);
    }
    if (ungrouped.length > 0) {
        for (const repo of ungrouped) {
            result.push({
                normalizedUrl: null,
                label: repo.workspace.name,
                repos: [repo],
                expanded: true,
            });
        }
    }

    return result;
}

/** djb2-style hash → base36 string. Used for deterministic workspace IDs. */
export function hashString(s: string): string {
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return Math.abs(hash).toString(36);
}

/** Recursively count tasks from the server task tree response. */
export function countTasks(node: any): number {
    if (!node) return 0;
    let count = 0;
    if (node.singleDocuments) count += node.singleDocuments.length;
    if (node.documentGroups) count += node.documentGroups.length;
    if (node.children) {
        for (const child of node.children) {
            count += countTasks(child);
        }
    }
    return count;
}

/** Truncate a path from the front: `/very/long/path` → `...ong/path`. */
export function truncatePath(p: string, max: number): string {
    if (p.length <= max) return p;
    return '...' + p.slice(p.length - max + 3);
}

/**
 * Stable key for a group:
 * - normalizedUrl for multi-repo groups
 * - 'workspace:{id}' for ungrouped (no remote URL) repos
 */
export function groupKey(group: RepoGroup): string {
    return group.normalizedUrl ?? `workspace:${group.repos[0]?.workspace.id ?? 'unknown'}`;
}

/**
 * Reorder groups according to a saved order array.
 * Groups whose key appears in `order` are sorted to that position.
 * Groups not in `order` are appended at the end in their original relative order.
 */
export function applyGroupOrder(groups: RepoGroup[], order: string[]): RepoGroup[] {
    if (!order || order.length === 0) return groups;

    const ranked = new Map<string, number>();
    order.forEach((key, i) => ranked.set(key, i));

    return [...groups].sort((a, b) => {
        const ai = ranked.get(groupKey(a)) ?? Number.MAX_SAFE_INTEGER;
        const bi = ranked.get(groupKey(b)) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
    });
}
