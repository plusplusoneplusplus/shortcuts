/**
 * Repository -> file -> match grouping for the content-search overlay (AC-03).
 *
 * The request layer hands the overlay a flat, ordered list of match rows. This
 * module is the only place that turns that list into the two-level tree the
 * dialog draws, and back into the flat list the keyboard model walks.
 *
 * Two rules make the round trip safe:
 *
 *  1. **Order is the server's.** Groups appear in first-seen order — membership
 *     order for repositories, and the server's file order within each — so a
 *     re-render can never reshuffle what the user is looking at.
 *  2. **Only what is on screen is selectable.** `visibleMatches` flattens the
 *     tree with collapsed repositories and files skipped, so an arrow key never
 *     walks into a row that is not rendered.
 *
 * Identity is clone-qualified by construction: every key starts with the
 * match's member workspace id, so the same relative path in two members of a
 * group stays two distinct file groups.
 */
import type { ContentSearchOverlayMatch } from './ContentSearchOverlay';

/** One file inside one repository. */
export interface ContentSearchFileGroup {
    /** Unique across the whole result set: member workspace id + path. */
    key: string;
    workspaceId: string;
    path: string;
    matches: ContentSearchOverlayMatch[];
}

/** One repository. A single-repo search produces exactly one of these. */
export interface ContentSearchRepoGroup {
    /** Unique across the whole result set: the member workspace id. */
    key: string;
    workspaceId: string;
    /** Member display name; absent in a single-repo search. */
    repoLabel?: string | null;
    files: ContentSearchFileGroup[];
    matchCount: number;
}

const SEPARATOR = ' ';

/** Key a file group by member workspace id + repo-relative path. */
export function fileGroupKey(workspaceId: string, path: string): string {
    return `${workspaceId}${SEPARATOR}${path}`;
}

/**
 * Bucket matches into repository -> file groups, preserving the order the rows
 * arrived in at every level.
 */
export function groupOverlayMatches(
    matches: readonly ContentSearchOverlayMatch[],
): ContentSearchRepoGroup[] {
    const repos: ContentSearchRepoGroup[] = [];
    const repoByKey = new Map<string, ContentSearchRepoGroup>();
    const fileByKey = new Map<string, ContentSearchFileGroup>();

    for (const match of matches) {
        let repo = repoByKey.get(match.workspaceId);
        if (repo === undefined) {
            repo = {
                key: match.workspaceId,
                workspaceId: match.workspaceId,
                repoLabel: match.repoLabel ?? null,
                files: [],
                matchCount: 0,
            };
            repoByKey.set(match.workspaceId, repo);
            repos.push(repo);
        }
        repo.matchCount += 1;

        const key = fileGroupKey(match.workspaceId, match.path);
        let file = fileByKey.get(key);
        if (file === undefined) {
            file = { key, workspaceId: match.workspaceId, path: match.path, matches: [] };
            fileByKey.set(key, file);
            repo.files.push(file);
        }
        file.matches.push(match);
    }

    return repos;
}

/**
 * The rows the user can actually reach right now, in render order. A collapsed
 * repository hides its files and their matches; a collapsed file hides only its
 * own matches.
 */
export function visibleMatches(
    repos: readonly ContentSearchRepoGroup[],
    collapsed: ReadonlySet<string>,
): ContentSearchOverlayMatch[] {
    const rows: ContentSearchOverlayMatch[] = [];
    for (const repo of repos) {
        if (collapsed.has(repo.key)) continue;
        for (const file of repo.files) {
            if (collapsed.has(file.key)) continue;
            rows.push(...file.matches);
        }
    }
    return rows;
}

/** Toggle one group key, returning a new set so React sees the change. */
export function toggleCollapsed(collapsed: ReadonlySet<string>, key: string): Set<string> {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
}
