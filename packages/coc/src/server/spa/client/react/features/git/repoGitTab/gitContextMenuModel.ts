/**
 * buildGitContextMenuItems — the Git tab's right-click menu, as a pure model.
 *
 * Menu availability encodes real capability rules: only unpushed commits can be
 * pushed-to or dropped, only HEAD can have its full message amended, only a
 * fixup target offers autosquash, cross-clone cherry-pick is feature-flagged,
 * and the multi-select actions only appear on touch devices. Building the items
 * as a pure function of (target, capabilities, handlers) means those rules can
 * be tested as a matrix instead of by driving the UI, and adding one entry
 * cannot disturb an unrelated branch.
 *
 * Nothing here reads component state or calls an API — every action is an
 * injected handler.
 */

import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import type { FixupGroupMap } from '../fixup-utils';
import { rankSkillsByRecency, MRU_SKILL_LIMIT } from '../skill-menu-ranking';
import type { GitCommitItem } from '../commits/CommitList';
import { buildCommitListSummary } from './gitPrompts';
import type { GitContextMenuState, SkillMenuContext } from './types';

/** A separator row. `ContextMenu` ignores the label when `separator` is set. */
const SEPARATOR: ContextMenuItem = { label: '', separator: true, onClick: () => {} };

export interface GitContextMenuHandlers {
    selectCommit: (commit: GitCommitItem) => void;
    openAsPopup: (commit: GitCommitItem) => void;
    pushToCommit: (commit: GitCommitItem) => void;
    startAmend: (commit: GitCommitItem) => void;
    startReword: (commit: GitCommitItem) => void;
    rebaseAutosquash: () => void;
    dropCommit: (commit: GitCommitItem) => void;
    hardReset: (commit: GitCommitItem) => void;
    cherryPickToBranch: (commits: GitCommitItem[]) => void;
    crossCloneCherryPick: (commits: GitCommitItem[]) => void;
    squashCommits: (commits: GitCommitItem[]) => void;
    askAboutCommit: (commit: GitCommitItem, mode: 'ask' | 'task') => void;
    askAboutCommits: (commits: GitCommitItem[], mode: 'ask' | 'task') => void;
    askAboutBranch: (mode: 'ask' | 'task') => void;
    startMobileSelection: (commit: GitCommitItem) => void;
    extendMobileSelection: (commit: GitCommitItem) => void;
    runSkill: (skillName: string, target: SkillMenuContext) => void;
    openSkillBrowser: (target: SkillMenuContext) => void;
    copyToClipboard: (text: string) => void;
    closeMenu: () => void;
}

export interface GitContextMenuInput {
    /** The open menu, or null when nothing is open. */
    menu: GitContextMenuState | null;
    /** Newest-first commit list — decides HEAD and unpushed membership. */
    commits: readonly GitCommitItem[];
    unpushedCount: number;
    /** Commits that have fixups pointing at them, for the autosquash entry. */
    fixupGroups: FixupGroupMap;
    /** Available skills, ranked by `skillUsageMap` recency. */
    skills: ReadonlyArray<{ name: string; description?: string }>;
    skillUsageMap: Record<string, string>;
    /** Whether the cross-clone cherry-pick feature flag is on. */
    crossCloneCherryPickEnabled: boolean;
    /** Whether this is a touch-only device, which gets the selection entries. */
    touchOnly: boolean;
    /** Whether a touch multi-select is already in progress. */
    mobileSelecting: boolean;
    handlers: GitContextMenuHandlers;
}

/** Build the items for the currently open context menu. Empty when none is open. */
export function buildGitContextMenuItems(input: GitContextMenuInput): ContextMenuItem[] {
    const { menu, commits, unpushedCount, fixupGroups, skills, skillUsageMap,
        crossCloneCherryPickEnabled, touchOnly, mobileSelecting, handlers: h } = input;
    if (!menu) return [];

    const items: ContextMenuItem[] = [];

    if (menu.type === 'commit' && menu.commit) {
        const commit = menu.commit;
        const isHead = commits.length > 0 && commits[0].hash === commit.hash;
        const commitIndex = commits.findIndex(c => c.hash === commit.hash);
        const isUnpushed = commitIndex >= 0 && commitIndex < unpushedCount;

        items.push({ label: 'Copy Hash', icon: '📋', onClick: () => h.copyToClipboard(commit.hash) });
        items.push({
            label: 'Copy Row',
            icon: '📋',
            onClick: () => h.copyToClipboard(`${commit.shortHash} — ${commit.subject} — ${commit.author}`),
        });
        items.push({ label: 'View Diff', icon: '🔍', onClick: () => h.selectCommit(commit) });
        items.push({ label: 'Open as Popup', icon: '↗', onClick: () => h.openAsPopup(commit) });

        // "Push to Here" — only for unpushed commits
        if (isUnpushed) {
            items.push(SEPARATOR);
            items.push({ label: 'Push to Here', icon: '📤', onClick: () => h.pushToCommit(commit) });
        }
        // Only HEAD can have its full message rewritten; older commits get a title-only reword.
        if (isHead) {
            items.push(SEPARATOR);
            items.push({ label: 'Amend Message…', icon: '✏️', onClick: () => { h.closeMenu(); h.startAmend(commit); } });
        }
        if (!isHead) {
            items.push(SEPARATOR);
            items.push({ label: 'Amend Title…', icon: '✏️', onClick: () => { h.closeMenu(); h.startReword(commit); } });
        }
        // Show "Rebase autosquash from here" on target commits that have fixups
        if (fixupGroups.targetGroups.has(commit.hash)) {
            items.push(SEPARATOR);
            items.push({
                label: 'Rebase Autosquash from Here',
                icon: '📦',
                onClick: () => { h.closeMenu(); h.rebaseAutosquash(); },
            });
        }
        if (isUnpushed) {
            items.push({ label: 'Drop Commit', icon: '🗑️', onClick: () => h.dropCommit(commit) });
        }
        items.push(SEPARATOR);
        items.push({ label: 'Hard Reset to Here', icon: '⏪', onClick: () => h.hardReset(commit) });
        items.push({ label: 'Cherry-pick to branch…', icon: '🍒', onClick: () => h.cherryPickToBranch([commit]) });
        if (crossCloneCherryPickEnabled) {
            items.push({
                label: 'Cherry-pick to another clone...',
                icon: '🍒',
                onClick: () => h.crossCloneCherryPick([commit]),
            });
        }
        items.push(SEPARATOR);
        items.push({ label: 'Ask AI', icon: '💡', onClick: () => h.askAboutCommit(commit, 'ask') });
        items.push({ label: 'Queue Task', icon: '🤖', onClick: () => h.askAboutCommit(commit, 'task') });

        // Mobile selection items (touch devices only) — a pointer device uses
        // shift/ctrl-click on the list instead, so these would be dead weight.
        if (touchOnly) {
            items.push(SEPARATOR);
            if (!mobileSelecting) {
                items.push({
                    label: 'Select',
                    icon: '☐',
                    onClick: () => { h.closeMenu(); h.startMobileSelection(commit); },
                });
            } else {
                items.push({
                    label: 'Select to here',
                    icon: '☰',
                    onClick: () => { h.closeMenu(); h.extendMobileSelection(commit); },
                });
            }
        }
    }

    if (menu.type === 'multi-commit' && menu.commits?.length) {
        const selectedCommits = menu.commits;
        const commitList = buildCommitListSummary(selectedCommits);

        items.push({ label: 'Copy Commits Info', icon: '📋', onClick: () => h.copyToClipboard(commitList) });
        if (selectedCommits.length >= 2) {
            items.push({
                label: `Squash ${selectedCommits.length} Commits`,
                icon: '📦',
                onClick: () => h.squashCommits(selectedCommits),
            });
        }
        items.push({
            label: 'Cherry-pick to branch…',
            icon: '🍒',
            onClick: () => h.cherryPickToBranch(selectedCommits),
        });
        if (crossCloneCherryPickEnabled) {
            items.push({
                label: 'Cherry-pick to another clone...',
                icon: '🍒',
                onClick: () => h.crossCloneCherryPick(selectedCommits),
            });
        }
        items.push({ label: 'Ask AI', icon: '💡', onClick: () => h.askAboutCommits(selectedCommits, 'ask') });
        items.push({ label: 'Queue Task', icon: '🤖', onClick: () => h.askAboutCommits(selectedCommits, 'task') });
    }

    if (menu.type === 'branch-range') {
        items.push({ label: 'Ask AI', icon: '💡', onClick: () => { void h.askAboutBranch('ask'); } });
        items.push({ label: 'Queue Task', icon: '🤖', onClick: () => { void h.askAboutBranch('task'); } });
    }

    if (skills.length > 0) {
        const target: SkillMenuContext = { type: menu.type, commit: menu.commit, commits: menu.commits };
        if (items.length > 0) {
            items.push(SEPARATOR);
        }
        const ranked = rankSkillsByRecency(skills as Array<{ name: string; description?: string }>, skillUsageMap);
        const skillEntry = (skill: { name: string }) => ({
            label: skill.name,
            onClick: () => h.runSkill(skill.name, target),
        });
        if (ranked.length <= MRU_SKILL_LIMIT) {
            items.push({
                label: 'Use Skill',
                icon: '⚡',
                onClick: () => {},
                children: ranked.map(skillEntry),
            });
        } else {
            const top = ranked.slice(0, MRU_SKILL_LIMIT);
            const restCount = ranked.length - MRU_SKILL_LIMIT;
            items.push({
                label: 'Use Skill',
                icon: '⚡',
                onClick: () => {},
                children: [
                    ...top.map(skillEntry),
                    SEPARATOR,
                    {
                        // A flat third-tier hover submenu is unreachable near a
                        // screen edge with this many skills — open a searchable
                        // modal instead.
                        label: `Browse all skills… (${restCount} more)`,
                        icon: '🔍',
                        onClick: () => h.openSkillBrowser(target),
                    },
                ],
            });
        }
    }

    return items;
}
