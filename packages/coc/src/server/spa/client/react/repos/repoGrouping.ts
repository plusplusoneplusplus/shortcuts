/**
 * Pure utility functions for repo grouping, URL normalization, and hashing.
 * Ported from repos.ts.
 */

export interface PipelineInfo {
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
    pipelines?: PipelineInfo[];
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
 * Normalize a git remote URL for grouping purposes.
 * SSH: `git@github.com:user/repo.git` → `github.com/user/repo`
 * HTTPS: `https://github.com/user/repo.git` → `github.com/user/repo`
 */
export function normalizeRemoteUrl(rawUrl: string): string {
    let u = rawUrl.trim();
    const sshMatch = u.match(/^[\w.-]+@([\w.-]+):(.+)$/);
    if (sshMatch) {
        u = sshMatch[1] + '/' + sshMatch[2];
    } else {
        u = u.replace(/^(?:https?|ssh|git):\/\//, '');
        u = u.replace(/^[^@]+@/, '');
    }
    u = u.replace(/\.git\/?$/, '');
    u = u.replace(/\/+$/, '');
    return u;
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
