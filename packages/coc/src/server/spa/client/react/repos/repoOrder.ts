import type { RepoData } from './repoGrouping';

export function getRepoId(repo: RepoData): string {
    return String(repo.workspace.id);
}

export function sanitizeRepoTabOrder(savedOrder: readonly string[] | undefined, repoIds: readonly string[]): string[] {
    if (!savedOrder) {
        return [];
    }

    const known = new Set(repoIds);
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of savedOrder) {
        if (!known.has(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        result.push(id);
    }
    return result;
}

export function resolveRepoTabOrder(repos: readonly RepoData[], savedOrder?: readonly string[]): RepoData[] {
    const byId = new Map(repos.map(repo => [getRepoId(repo), repo]));
    const orderedIds = sanitizeRepoTabOrder(savedOrder, [...byId.keys()]);
    const orderedRepos = orderedIds
        .map(id => byId.get(id))
        .filter((repo): repo is RepoData => Boolean(repo));
    const seen = new Set(orderedIds);

    for (const repo of repos) {
        const id = getRepoId(repo);
        if (!seen.has(id)) {
            orderedRepos.push(repo);
        }
    }

    return orderedRepos;
}

export function materializeRepoTabOrder(repos: readonly RepoData[]): string[] {
    return repos.map(getRepoId);
}

export function moveRepoTabOrder(
    repoIds: readonly string[],
    draggedId: string,
    targetId: string,
    position: 'before' | 'after',
): string[] {
    if (draggedId === targetId) {
        return [...repoIds];
    }
    const next = repoIds.filter(id => id !== draggedId);
    const targetIndex = next.indexOf(targetId);
    if (targetIndex === -1) {
        return [...repoIds];
    }
    next.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, draggedId);
    return next;
}

export function moveRepoTabOrderToIndex(repoIds: readonly string[], draggedId: string, targetIndex: number): string[] {
    const next = repoIds.filter(id => id !== draggedId);
    const clampedIndex = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(clampedIndex, 0, draggedId);
    return next;
}
