/**
 * CommitRowBadges — the right-hand mini-flag cluster on a commit row:
 * active comment count, fixup count, merge, unpushed, and classified.
 */

import type { GitCommitItem } from './commitListTypes';
import type { CommitRowViewModel } from './commitRowViewModel';

export function CommitRowBadges({ commit, vm }: { commit: GitCommitItem; vm: CommitRowViewModel }) {
    const { commentCount, hasFixups, targetGroup, groupColor, isMerge, isUnpushed, isClassified } = vm;
    return (
        <span className="flex items-center gap-1 flex-shrink-0 self-center">
            {commentCount > 0 && (
                <span
                    className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-semibold border border-[#0078d4]/30 dark:border-[#3794ff]/35 bg-[#ddf4ff] dark:bg-[#3794ff]/15 text-[#0078d4] dark:text-[#3794ff] tabular-nums"
                    title={`${commentCount} active comment${commentCount > 1 ? 's' : ''}`}
                    data-testid={`commit-comment-badge-${commit.hash}`}
                >
                    {commentCount}
                </span>
            )}
            {hasFixups && (
                <span
                    className="inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-semibold border border-[#f5d9a1] bg-[#fff8c5] dark:bg-[#9a6700]/25 text-[#9a6700] dark:text-[#ffb74d] tabular-nums whitespace-nowrap"
                    style={{ color: groupColor }}
                    title={`Fixups: ${targetGroup!.fixupHashes.map(h => h.substring(0, 7)).join(', ')}`}
                    data-testid={`fixup-count-${commit.shortHash}`}
                >
                    ×{targetGroup!.fixupHashes.length} fix
                </span>
            )}
            {isMerge && (
                <span
                    className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#8250df]/30 dark:border-[#a371f7]/35 bg-[#f3e8ff] dark:bg-[#a371f7]/15 text-[#8250df] dark:text-[#a371f7]"
                    title="Merge commit"
                    data-testid={`commit-merge-flag-${commit.shortHash}`}
                    aria-label="Merge commit"
                >
                    M
                </span>
            )}
            {isUnpushed && (
                <span
                    className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#f5d9a1] bg-[#fff8c5] dark:bg-[#9a6700]/25 text-[#9a6700] dark:text-[#ffb74d]"
                    title="Unpushed commit"
                    data-testid={`commit-unpushed-flag-${commit.shortHash}`}
                    aria-label="Unpushed commit"
                >
                    ↑
                </span>
            )}
            {isClassified && (
                <span
                    className="inline-flex items-center justify-center w-[15px] h-[15px] rounded-full text-[9px] font-semibold border border-[#a7f3d0]/60 bg-[#d1fae5] dark:bg-[#064e3b]/25 text-[#047857] dark:text-[#34d399]"
                    title="Diff classified"
                    data-testid={`commit-classified-flag-${commit.shortHash}`}
                    aria-label="Diff classified"
                >
                    ✓
                </span>
            )}
        </span>
    );
}
