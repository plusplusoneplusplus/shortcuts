/**
 * Commit identity matching across a history rewrite.
 *
 * After a rebase/amend/drop the commit hashes change but the commits are
 * "the same" commits, so commit-scoped chat bindings must follow them.
 */

import type { GitCommitItem } from '../commits/CommitList';

/**
 * Heuristic matching of old commits to new commits after a rewrite.
 * Returns an array of { oldHash, newHash } pairs where identity matched
 * but hash changed.
 *
 * Identity key: `${subject}\0${author}\0${authorEmail}\0${date}`
 *
 * Only 1:1 matches are returned — if multiple old commits share the same
 * identity key (e.g., duplicate "fix typo" commits), none of them match
 * to avoid incorrect rebinding.
 */
export function matchCommitsByIdentity(
    oldCommits: GitCommitItem[],
    newCommits: GitCommitItem[]
): Array<{ oldHash: string; newHash: string }> {
    const identityKey = (c: GitCommitItem) =>
        `${c.subject}\0${c.author}\0${c.authorEmail ?? ''}\0${c.date}`;

    const oldMap = new Map<string, GitCommitItem[]>();
    for (const c of oldCommits) {
        const key = identityKey(c);
        const arr = oldMap.get(key) || [];
        arr.push(c);
        oldMap.set(key, arr);
    }

    const newMap = new Map<string, GitCommitItem[]>();
    for (const c of newCommits) {
        const key = identityKey(c);
        const arr = newMap.get(key) || [];
        arr.push(c);
        newMap.set(key, arr);
    }

    const pairs: Array<{ oldHash: string; newHash: string }> = [];
    for (const [key, oldArr] of oldMap) {
        if (oldArr.length !== 1) continue;
        const newArr = newMap.get(key);
        if (!newArr || newArr.length !== 1) continue;
        const oldC = oldArr[0];
        const newC = newArr[0];
        if (oldC.hash !== newC.hash) {
            pairs.push({ oldHash: oldC.hash, newHash: newC.hash });
        }
    }

    return pairs;
}
