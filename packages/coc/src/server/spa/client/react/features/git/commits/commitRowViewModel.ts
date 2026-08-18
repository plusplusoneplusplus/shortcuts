/**
 * Derived, presentation-only data for a commit row.
 *
 * `buildCommitRowViewModel` is the single place that turns list-level inputs
 * (selection sets, unpushed count, fixup groups, comment totals) into the flags
 * a row renders. Keeping it pure means badge and layout changes never have to
 * touch the gesture or fetching code paths.
 */

import type { FixupGroupMap, FixupEntry, FixupGroupTarget } from '../fixup-utils';
import type { GitCommitItem } from './commitListTypes';

// Deterministic-color palette used for author avatar badges.
const AVATAR_PALETTE: ReadonlyArray<{ bg: string; fg: string }> = [
    { bg: 'linear-gradient(135deg, #6366f1, #3730a3)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #1a7f37, #14532d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #cf222e, #7f1d1d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #f59e0b, #b45309)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #06b6d4, #155e75)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #8b5cf6, #5b21b6)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #ec4899, #9d174d)', fg: '#fff' },
    { bg: 'linear-gradient(135deg, #0078d4, #0050b3)', fg: '#fff' },
];

export function getAuthorInitials(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return '?';
    const parts = trimmed.split(/[\s/_\-.]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return trimmed.slice(0, 2).toUpperCase();
}

export function getAuthorPalette(name: string): { bg: string; fg: string } {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

export interface CommitGroup {
    label: string;
    isUnpushed: boolean;
    startIdx: number;
    count: number;
}

/** Group commits into Unpushed / Today / Yesterday / This week / This month / Older. */
export function computeCommitGroups(commits: GitCommitItem[], unpushedCount: number): CommitGroup[] {
    const groups: CommitGroup[] = [];
    if (unpushedCount > 0) {
        groups.push({ label: 'Unpushed', isUnpushed: true, startIdx: 0, count: Math.min(unpushedCount, commits.length) });
    }
    const startOfToday = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    })();
    const startOfYesterday = startOfToday - 86_400_000;
    const weekStart = startOfToday - 7 * 86_400_000;
    const monthStart = startOfToday - 30 * 86_400_000;

    let lastLabel: string | null = null;
    let groupStart = unpushedCount;
    for (let i = unpushedCount; i < commits.length; i++) {
        const parsed = new Date(commits[i].date).getTime();
        let label: string;
        if (!Number.isFinite(parsed)) label = 'Older';
        else if (parsed >= startOfToday) label = 'Today';
        else if (parsed >= startOfYesterday) label = 'Yesterday';
        else if (parsed >= weekStart) label = 'This week';
        else if (parsed >= monthStart) label = 'This month';
        else label = 'Older';
        if (label !== lastLabel) {
            if (lastLabel !== null) {
                groups.push({ label: lastLabel, isUnpushed: false, startIdx: groupStart, count: i - groupStart });
            }
            lastLabel = label;
            groupStart = i;
        }
    }
    if (lastLabel !== null) {
        groups.push({ label: lastLabel, isUnpushed: false, startIdx: groupStart, count: commits.length - groupStart });
    }
    return groups;
}

/** Everything a row needs to render, derived once per commit per render. */
export interface CommitRowViewModel {
    isSelected: boolean;
    isUnpushed: boolean;
    isMerge: boolean;
    /** Last row of its date/unpushed group — suppresses the graph connector line. */
    isLastInGroup: boolean;
    fixupEntry: FixupEntry | undefined;
    targetGroup: FixupGroupTarget | undefined;
    isFixup: boolean;
    hasFixups: boolean;
    groupColor: string | undefined;
    commentCount: number;
    isClassified: boolean;
    avatar: { initials: string; palette: { bg: string; fg: string } };
}

export function buildCommitRowViewModel(input: {
    commit: GitCommitItem;
    index: number;
    commitCount: number;
    selectedHash?: string | null;
    selectedHashes?: ReadonlySet<string>;
    unpushedCount: number;
    group: CommitGroup | undefined;
    hasGroupAtNextIndex: boolean;
    fixupGroups: FixupGroupMap;
    groupColors: readonly string[];
    commentCount: number;
    classifiedHashes?: ReadonlySet<string>;
}): CommitRowViewModel {
    const {
        commit, index, commitCount, selectedHash, selectedHashes, unpushedCount,
        group, hasGroupAtNextIndex, fixupGroups, groupColors, commentCount, classifiedHashes,
    } = input;

    const fixupEntry = fixupGroups.fixupEntries.get(commit.hash);
    const targetGroup = fixupGroups.targetGroups.get(commit.hash);

    return {
        isSelected: selectedHashes ? selectedHashes.has(commit.hash) : commit.hash === selectedHash,
        isUnpushed: unpushedCount > 0 && index < unpushedCount,
        isMerge: (commit.parentHashes?.length ?? 0) > 1,
        isLastInGroup: group
            ? index === group.startIdx + group.count - 1
            : index === commitCount - 1 || hasGroupAtNextIndex,
        fixupEntry,
        targetGroup,
        isFixup: !!fixupEntry,
        hasFixups: !!targetGroup,
        groupColor: fixupEntry
            ? groupColors[fixupEntry.colorSlot]
            : targetGroup
                ? groupColors[targetGroup.colorSlot]
                : undefined,
        commentCount,
        isClassified: !!classifiedHashes?.has(commit.hash),
        avatar: { initials: getAuthorInitials(commit.author), palette: getAuthorPalette(commit.author) },
    };
}
