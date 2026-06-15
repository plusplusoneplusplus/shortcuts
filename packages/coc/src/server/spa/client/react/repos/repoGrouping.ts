/**
 * Pure utility functions for repo grouping, URL normalization, and hashing.
 * Ported from repos.ts.
 */

// normalizeRemoteUrl is the single source of truth in pipeline-core.
// Imported here so the SPA can reuse the same canonical implementation.
import { normalizeRemoteUrl } from '@plusplusoneplusplus/forge/git/normalize-url';
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

/**
 * True when a repo's workspace is a remote checkout aggregated from another CoC
 * server (carries AC-01's `remote` marker / `baseUrl`). Inlined here as a tiny
 * pure guard so this grouping module stays dependency-light and never pulls the
 * network-aware aggregation module into classic-flow bundles.
 */
export function isRemoteRepo(repo: RepoData): boolean {
    const ws = repo.workspace as { baseUrl?: unknown; remote?: unknown } | undefined;
    return (
        !!ws &&
        typeof ws.baseUrl === 'string' &&
        typeof ws.remote === 'object' &&
        ws.remote !== null
    );
}

/**
 * Order a group's clones so LOCAL checkouts come before REMOTE ones, preserving
 * the original relative order within each partition (stable). This keeps the
 * PRIMARY marker (the first clone) on a local checkout whenever the group has
 * one, so an aggregated remote clone can never displace the local primary. A
 * remote-only group (all remote) is left as-is, so its sole/first remote clone
 * is the primary. No-op when the remote shell is off (no remote repos exist).
 */
export function sortClonesLocalFirst(repos: RepoData[]): RepoData[] {
    const locals: RepoData[] = [];
    const remotes: RepoData[] = [];
    for (const repo of repos) {
        (isRemoteRepo(repo) ? remotes : locals).push(repo);
    }
    return remotes.length === 0 ? repos : [...locals, ...remotes];
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

    // Within every group, keep LOCAL clones before REMOTE ones so the PRIMARY
    // marker (first clone) lands on a local checkout when one exists. No-op when
    // no remote checkouts are present (i.e. remote shell off / no remote repos).
    for (const g of groups.values()) {
        g.repos = sortClonesLocalFirst(g.repos);
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

/** Group repos by their agent (container mode). Each agent becomes a group. */
export function groupReposByAgent(
    repos: RepoData[],
    expandedState: Record<string, boolean>
): RepoGroup[] {
    const groups = new Map<string, RepoGroup>();
    const ungrouped: RepoData[] = [];

    for (const repo of repos) {
        const agentId = repo.workspace.agentId as string | undefined;
        const agentName = (repo.workspace.agentName as string | undefined) || agentId;
        if (!agentId) {
            ungrouped.push(repo);
            continue;
        }
        if (!groups.has(agentId)) {
            groups.set(agentId, {
                normalizedUrl: agentId,
                label: agentName || agentId,
                repos: [],
                expanded: expandedState[agentId] !== false,
            });
        }
        groups.get(agentId)!.repos.push(repo);
    }

    const result: RepoGroup[] = [];
    const sorted = [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
    result.push(...sorted);

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
    const nodeName = typeof node.name === 'string' ? node.name.toLowerCase() : '';
    const relativePath = typeof node.relativePath === 'string' ? node.relativePath.toLowerCase() : '';
    if (nodeName === 'archive' || relativePath === 'archive' || relativePath.startsWith('archive/')) {
        return 0;
    }
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
