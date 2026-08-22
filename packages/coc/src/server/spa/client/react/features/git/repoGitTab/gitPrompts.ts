/**
 * Pure prompt builders for the Git tab's AI actions.
 *
 * Every string handed to the queue or the floating chat is built here, so the
 * wording is testable without mounting the tab and without a queue double.
 */

import type { GitCommitItem } from '../commits/CommitList';
import type { BranchRangeInfo } from '../branches/BranchChanges';
import type { GitRepoStateInfo } from './types';

/** `Commit: <hash> — <subject>` — the Ask AI / Queue Task seed for one commit. */
export function buildCommitReferencePrompt(commit: GitCommitItem): string {
    return `Commit: ${commit.hash}${commit.subject ? ` — ${commit.subject}` : ''}`;
}

/** `- <shortHash> — <subject>` lines, used for multi-commit prompts and clipboard. */
export function buildCommitListSummary(commits: readonly GitCommitItem[]): string {
    return commits.map(c => `- ${c.shortHash} — ${c.subject}`).join('\n');
}

/** The Ask AI / Queue Task seed for a multi-commit selection. */
export function buildMultiCommitReferencePrompt(commits: readonly GitCommitItem[]): string {
    return `${commits.length} commits selected:\n${buildCommitListSummary(commits)}`;
}

/** Branch summary (range, counts, commit list) for branch-scoped Ask AI / Queue Task. */
export function buildBranchReferencePrompt(input: {
    branchRangeData: BranchRangeInfo | null;
    branchName: string;
    resolvedBaseRef: string | null;
    commits: readonly GitCommitItem[];
}): string {
    const { branchRangeData, branchName, resolvedBaseRef, commits } = input;
    const branchLabel = branchRangeData?.branchName || branchRangeData?.headRef || branchName || 'current branch';
    const baseShort = (branchRangeData?.baseRef ?? resolvedBaseRef ?? 'main').replace(/^origin\//, '');
    const headShort = branchRangeData?.headRef ?? 'HEAD';
    const commitCount = branchRangeData?.commitCount ?? 0;
    const additions = branchRangeData?.additions ?? 0;
    const deletions = branchRangeData?.deletions ?? 0;
    const fileCount = branchRangeData?.fileCount ?? 0;

    let prompt = `Branch: ${branchLabel} (${baseShort}..${headShort})\nCommits: ${commitCount}  +${additions} -${deletions}\nFiles: ${fileCount}`;

    if (commits.length > 0) {
        prompt += `\n\nCommit list:\n${buildCommitListSummary(commits)}`;
    }

    return prompt;
}

/** The `<commit-range>` skill prompt for the current branch range. */
export function buildBranchRangeSkillPrompt(
    branchRangeData: Pick<BranchRangeInfo, 'baseRef' | 'headRef'> | null | undefined,
    branchName?: string,
    /** Base ref reported by the server when there's no range object to read it from. */
    resolvedBaseRef?: string | null
): string {
    const base = branchRangeData?.baseRef ?? resolvedBaseRef ?? 'main';
    const head = branchRangeData?.headRef ?? branchName ?? 'HEAD';
    return `Run the selected skill on this commit range:\n<commit-range>${base}..${head}</commit-range>`;
}

/** The `<commit>` skill prompt for a single commit. */
export function buildCommitSkillPrompt(commit: GitCommitItem): string {
    return `Run the selected skill on this commit:\n<commit>${commit.hash}</commit>`;
}

/** The `<commits>` skill prompt for a multi-commit selection. */
export function buildMultiCommitSkillPrompt(commits: readonly GitCommitItem[]): string {
    return `Run the selected skill on these commits:\n<commits>\n${commits.map(c => c.hash).join('\n')}\n</commits>`;
}

/**
 * Squash instructions for a selection of unpushed commits.
 *
 * Contiguous selections get a plain squash prompt. A non-contiguous selection
 * also lists the interleaved commits marked `[KEEP]`, so the agent knows what
 * must survive the rebase.
 *
 * @param commits  The full newest-first commit list (index space for `indices`).
 * @param selectedCommits  The selection, newest-first.
 * @param indices  Ascending indices of the selection within `commits`.
 */
export function buildSquashPrompt(
    commits: readonly GitCommitItem[],
    selectedCommits: readonly GitCommitItem[],
    indices: readonly number[],
): string {
    const isContiguous = indices.every((v, i) => i === 0 || v === indices[i - 1] + 1);
    // Sort oldest-first for the prompt (unpushed list is newest-first)
    const oldestFirst = [...selectedCommits].reverse();
    const commitList = oldestFirst.map(c => `- ${c.hash} ${c.subject}`).join('\n');

    if (isContiguous) {
        return `Squash the following ${oldestFirst.length} commits into a single commit. Preserve the intent of all changes.\n\nCommits (oldest first):\n${commitList}\n\nWrite a clear combined commit message summarizing all changes.`;
    }

    // Include interleaved commits so the AI knows what to preserve
    const minIdx = indices[0];
    const maxIdx = indices[indices.length - 1];
    const selectedSet = new Set(indices);
    const interleavedList = [];
    for (let i = minIdx; i <= maxIdx; i++) {
        const c = commits[i];
        const marker = selectedSet.has(i) ? '[SQUASH]' : '[KEEP]';
        interleavedList.push(`- ${marker} ${c.hash} ${c.subject}`);
    }
    // Reverse to oldest-first (commits array is newest-first)
    interleavedList.reverse();
    const fullRange = interleavedList.join('\n');
    return `Squash the following ${oldestFirst.length} non-contiguous commits into a single commit. The selected commits are NOT adjacent — there are interleaved commits that must be preserved.\n\nUse an appropriate strategy such as interactive rebase with reordering, or sequential cherry-pick onto a new base.\n\nFull commit range (oldest first, [SQUASH] = selected, [KEEP] = preserve):\n${fullRange}\n\nWrite a clear combined commit message summarizing all squashed changes.`;
}

/** The `git <op> --continue` command matching an in-progress operation. */
export function conflictContinueCommand(operation: string): string {
    if (operation === 'cherry-pick') return 'git cherry-pick --continue';
    if (operation === 'rebase') return 'git rebase --continue';
    return 'git merge --continue';
}

/** Resolve-with-AI instructions for an in-progress merge/rebase/cherry-pick. */
export function buildConflictResolutionPrompt(repoState: GitRepoStateInfo): string {
    const files = repoState.conflictFiles.map(f => `- ${f}`).join('\n');
    const continueCmd = conflictContinueCommand(repoState.operation);
    return `The repository has a ${repoState.operation} in progress with conflicts in the following files:\n<files>\n${files}\n</files>\n\nFor each conflicted file, resolve the conflict markers (<<<<<<< / ======= / >>>>>>>) by choosing the best resolution that preserves both sides' intent. Then stage the resolved files with \`git add\`. After staging all resolved files, run \`${continueCmd}\`. If new conflicts arise, repeat the resolution and continue cycle until the entire operation completes successfully.`;
}
