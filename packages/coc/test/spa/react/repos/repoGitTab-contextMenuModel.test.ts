/**
 * Tests for the Git tab's context-menu capability rules.
 *
 * Menu availability encodes destructive-action safety: only unpushed commits
 * can be pushed-to or dropped, only HEAD can have its whole message amended,
 * autosquash only shows on a fixup target, cross-clone cherry-pick is
 * feature-flagged, and touch selection entries are touch-only. Because the menu
 * is a pure function of (target, capabilities, handlers), the whole matrix is
 * checked here rather than by driving the UI.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildGitContextMenuItems, type GitContextMenuHandlers } from '../../../../src/server/spa/client/react/features/git/repoGitTab/gitContextMenuModel';
import type { GitContextMenuState } from '../../../../src/server/spa/client/react/features/git/repoGitTab/types';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { FixupGroupMap } from '../../../../src/server/spa/client/react/features/git/fixup-utils';
import type { ContextMenuItem } from '../../../../src/server/spa/client/react/tasks/comments/ContextMenu';

function commit(hash: string): GitCommitItem {
    return {
        hash,
        shortHash: hash.slice(0, 7),
        subject: `subject ${hash.slice(0, 4)}`,
        author: 'Ada',
        authorEmail: 'ada@example.com',
        date: '2026-01-01T00:00:00Z',
        parentHashes: [],
    };
}

/** HEAD-first list: HEAD, one more unpushed, then two pushed commits. */
const HEAD = commit('aaaaaaaaaaaa');
const SECOND = commit('bbbbbbbbbbbb');
const PUSHED = commit('cccccccccccc');
const OLDER = commit('dddddddddddd');
const COMMITS = [HEAD, SECOND, PUSHED, OLDER];
const UNPUSHED_COUNT = 2;

const EMPTY_FIXUPS: FixupGroupMap = { targetGroups: new Map(), fixupEntries: new Map() } as unknown as FixupGroupMap;

function handlers(): GitContextMenuHandlers {
    return {
        selectCommit: vi.fn(), openAsPopup: vi.fn(), pushToCommit: vi.fn(),
        startAmend: vi.fn(), startReword: vi.fn(), rebaseAutosquash: vi.fn(),
        dropCommit: vi.fn(), hardReset: vi.fn(), cherryPickToBranch: vi.fn(),
        crossCloneCherryPick: vi.fn(), squashCommits: vi.fn(),
        askAboutCommit: vi.fn(), askAboutCommits: vi.fn(), askAboutBranch: vi.fn(),
        startMobileSelection: vi.fn(), extendMobileSelection: vi.fn(),
        runSkill: vi.fn(), openSkillBrowser: vi.fn(),
        copyToClipboard: vi.fn(), closeMenu: vi.fn(),
    };
}

function build(overrides: {
    menu: GitContextMenuState | null;
    fixupGroups?: FixupGroupMap;
    skills?: Array<{ name: string }>;
    skillUsageMap?: Record<string, string>;
    crossCloneCherryPickEnabled?: boolean;
    touchOnly?: boolean;
    mobileSelecting?: boolean;
    h?: GitContextMenuHandlers;
}) {
    const h = overrides.h ?? handlers();
    const items = buildGitContextMenuItems({
        menu: overrides.menu,
        commits: COMMITS,
        unpushedCount: UNPUSHED_COUNT,
        fixupGroups: overrides.fixupGroups ?? EMPTY_FIXUPS,
        skills: overrides.skills ?? [],
        skillUsageMap: overrides.skillUsageMap ?? {},
        crossCloneCherryPickEnabled: overrides.crossCloneCherryPickEnabled ?? false,
        touchOnly: overrides.touchOnly ?? false,
        mobileSelecting: overrides.mobileSelecting ?? false,
        handlers: h,
    });
    return { items, h };
}

/** Non-separator labels, in order. */
function labels(items: ContextMenuItem[]): string[] {
    return items.filter(i => !i.separator).map(i => i.label);
}

function clickItem(items: ContextMenuItem[], label: string) {
    const item = items.filter(i => !i.separator).find(i => i.label === label);
    expect(item, `menu item "${label}" should exist`).toBeTruthy();
    item!.onClick();
}

describe('buildGitContextMenuItems', () => {
    it('returns nothing when no menu is open', () => {
        expect(build({ menu: null }).items).toEqual([]);
    });

    describe('single commit — capability rules', () => {
        it('offers Push to Here and Drop Commit for an unpushed commit', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: SECOND } });
            expect(labels(items)).toContain('Push to Here');
            expect(labels(items)).toContain('Drop Commit');
        });

        it('hides Push to Here and Drop Commit for a pushed commit', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: PUSHED } });
            expect(labels(items)).not.toContain('Push to Here');
            expect(labels(items)).not.toContain('Drop Commit');
        });

        it('offers Amend Message (not Amend Title) on HEAD', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD } });
            expect(labels(items)).toContain('Amend Message…');
            expect(labels(items)).not.toContain('Amend Title…');
        });

        it('offers Amend Title (not Amend Message) on a non-HEAD commit', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: SECOND } });
            expect(labels(items)).toContain('Amend Title…');
            expect(labels(items)).not.toContain('Amend Message…');
        });

        it('offers autosquash only on a commit that has fixups pointing at it', () => {
            const withFixups = { targetGroups: new Map([[SECOND.hash, {}]]), fixupEntries: new Map() } as unknown as FixupGroupMap;
            const target = build({ menu: { x: 0, y: 0, type: 'commit', commit: SECOND }, fixupGroups: withFixups });
            expect(labels(target.items)).toContain('Rebase Autosquash from Here');

            const nonTarget = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, fixupGroups: withFixups });
            expect(labels(nonTarget.items)).not.toContain('Rebase Autosquash from Here');
        });

        it('always offers hard reset and same-clone cherry-pick', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: PUSHED } });
            expect(labels(items)).toContain('Hard Reset to Here');
            expect(labels(items)).toContain('Cherry-pick to branch…');
        });

        it('gates cross-clone cherry-pick behind the feature flag', () => {
            const off = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, crossCloneCherryPickEnabled: false });
            expect(labels(off.items)).not.toContain('Cherry-pick to another clone...');

            const on = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, crossCloneCherryPickEnabled: true });
            expect(labels(on.items)).toContain('Cherry-pick to another clone...');
        });

        it('orders Open as Popup after View Diff', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD } });
            const names = labels(items);
            expect(names.indexOf('Open as Popup')).toBeGreaterThan(names.indexOf('View Diff'));
        });

        it('routes each action to its handler with the menu target', () => {
            const { items, h } = build({
                menu: { x: 0, y: 0, type: 'commit', commit: SECOND },
                crossCloneCherryPickEnabled: true,
            });
            clickItem(items, 'View Diff');
            expect(h.selectCommit).toHaveBeenCalledWith(SECOND);
            clickItem(items, 'Push to Here');
            expect(h.pushToCommit).toHaveBeenCalledWith(SECOND);
            clickItem(items, 'Drop Commit');
            expect(h.dropCommit).toHaveBeenCalledWith(SECOND);
            clickItem(items, 'Hard Reset to Here');
            expect(h.hardReset).toHaveBeenCalledWith(SECOND);
            clickItem(items, 'Cherry-pick to branch…');
            expect(h.cherryPickToBranch).toHaveBeenCalledWith([SECOND]);
            clickItem(items, 'Cherry-pick to another clone...');
            expect(h.crossCloneCherryPick).toHaveBeenCalledWith([SECOND]);
            clickItem(items, 'Ask AI');
            expect(h.askAboutCommit).toHaveBeenCalledWith(SECOND, 'ask');
            clickItem(items, 'Queue Task');
            expect(h.askAboutCommit).toHaveBeenCalledWith(SECOND, 'task');
        });

        it('copies the hash and the formatted row', () => {
            const { items, h } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD } });
            clickItem(items, 'Copy Hash');
            expect(h.copyToClipboard).toHaveBeenCalledWith(HEAD.hash);
            clickItem(items, 'Copy Row');
            expect(h.copyToClipboard).toHaveBeenCalledWith(`${HEAD.shortHash} — ${HEAD.subject} — ${HEAD.author}`);
        });
    });

    describe('touch selection entries', () => {
        it('adds no selection entries on a pointer device', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, touchOnly: false });
            expect(labels(items)).not.toContain('Select');
            expect(labels(items)).not.toContain('Select to here');
        });

        it('offers Select when touch selection has not started', () => {
            const { items, h } = build({
                menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, touchOnly: true, mobileSelecting: false,
            });
            expect(labels(items)).toContain('Select');
            expect(labels(items)).not.toContain('Select to here');
            clickItem(items, 'Select');
            expect(h.closeMenu).toHaveBeenCalled();
            expect(h.startMobileSelection).toHaveBeenCalledWith(HEAD);
        });

        it('offers Select to here once a touch selection is in progress', () => {
            const { items, h } = build({
                menu: { x: 0, y: 0, type: 'commit', commit: PUSHED }, touchOnly: true, mobileSelecting: true,
            });
            expect(labels(items)).toContain('Select to here');
            expect(labels(items)).not.toContain('Select');
            clickItem(items, 'Select to here');
            expect(h.extendMobileSelection).toHaveBeenCalledWith(PUSHED);
        });
    });

    describe('multi-commit selection', () => {
        it('offers Squash only for two or more commits', () => {
            const two = build({ menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD, SECOND] } });
            expect(labels(two.items)).toContain('Squash 2 Commits');

            const one = build({ menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD] } });
            expect(labels(one.items).some(l => l.startsWith('Squash'))).toBe(false);
        });

        it('never offers single-commit-only actions', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD, SECOND] } });
            const names = labels(items);
            expect(names).not.toContain('Open as Popup');
            expect(names).not.toContain('Hard Reset to Here');
            expect(names).not.toContain('Drop Commit');
            expect(names).not.toContain('Push to Here');
        });

        it('gates its cross-clone cherry-pick behind the same flag', () => {
            const off = build({ menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD, SECOND] } });
            expect(labels(off.items)).not.toContain('Cherry-pick to another clone...');

            const on = build({
                menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD, SECOND] },
                crossCloneCherryPickEnabled: true,
            });
            expect(labels(on.items)).toContain('Cherry-pick to another clone...');
        });

        it('routes its actions to the whole selection', () => {
            const selection = [HEAD, SECOND];
            const { items, h } = build({ menu: { x: 0, y: 0, type: 'multi-commit', commits: selection } });
            clickItem(items, 'Squash 2 Commits');
            expect(h.squashCommits).toHaveBeenCalledWith(selection);
            clickItem(items, 'Cherry-pick to branch…');
            expect(h.cherryPickToBranch).toHaveBeenCalledWith(selection);
            clickItem(items, 'Ask AI');
            expect(h.askAboutCommits).toHaveBeenCalledWith(selection, 'ask');
            clickItem(items, 'Copy Commits Info');
            expect(h.copyToClipboard).toHaveBeenCalledWith(
                `- ${HEAD.shortHash} — ${HEAD.subject}\n- ${SECOND.shortHash} — ${SECOND.subject}`);
        });
    });

    describe('branch range', () => {
        it('offers only the AI actions', () => {
            const { items, h } = build({ menu: { x: 0, y: 0, type: 'branch-range' } });
            expect(labels(items)).toEqual(['Ask AI', 'Queue Task']);
            clickItem(items, 'Queue Task');
            expect(h.askAboutBranch).toHaveBeenCalledWith('task');
        });
    });

    describe('skills submenu', () => {
        const manySkills = Array.from({ length: 12 }, (_, i) => ({ name: `skill-${i}` }));

        it('adds nothing when the workspace has no skills', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, skills: [] });
            expect(labels(items)).not.toContain('Use Skill');
        });

        it('lists every skill inline when the list is short', () => {
            const skills = [{ name: 'review' }, { name: 'test' }];
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, skills });
            const useSkill = items.find(i => i.label === 'Use Skill')!;
            expect(useSkill.children!.map(c => c.label).sort()).toEqual(['review', 'test']);
            expect(useSkill.children!.some(c => c.label.startsWith('Browse all skills'))).toBe(false);
        });

        it('truncates to the MRU list plus a browse entry when the list is long', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'commit', commit: HEAD }, skills: manySkills });
            const children = items.find(i => i.label === 'Use Skill')!.children!;
            const browse = children.find(c => c.label.startsWith('Browse all skills'));
            expect(browse).toBeTruthy();
            // Everything not shown inline is reachable through the browse dialog.
            const inline = children.filter(c => !c.separator && c !== browse);
            expect(inline.length).toBeLessThan(manySkills.length);
            expect(browse!.label).toContain(`${manySkills.length - inline.length} more`);
        });

        it('ranks recently used skills first', () => {
            const skills = [{ name: 'alpha' }, { name: 'beta' }, { name: 'gamma' }];
            const { items } = build({
                menu: { x: 0, y: 0, type: 'commit', commit: HEAD },
                skills,
                skillUsageMap: { gamma: '2026-02-01T00:00:00Z' },
            });
            const children = items.find(i => i.label === 'Use Skill')!.children!;
            expect(children[0].label).toBe('gamma');
        });

        it('runs a skill against the menu target', () => {
            const { items, h } = build({
                menu: { x: 0, y: 0, type: 'commit', commit: SECOND },
                skills: [{ name: 'review' }],
            });
            items.find(i => i.label === 'Use Skill')!.children!
                .find(c => c.label === 'review')!.onClick();
            expect(h.runSkill).toHaveBeenCalledWith('review', {
                type: 'commit', commit: SECOND, commits: undefined,
            });
        });

        it('hands the browse dialog the same target', () => {
            const { items, h } = build({
                menu: { x: 0, y: 0, type: 'multi-commit', commits: [HEAD, SECOND] },
                skills: manySkills,
            });
            items.find(i => i.label === 'Use Skill')!.children!
                .find(c => c.label.startsWith('Browse all skills'))!.onClick();
            expect(h.openSkillBrowser).toHaveBeenCalledWith({
                type: 'multi-commit', commit: undefined, commits: [HEAD, SECOND],
            });
        });

        it('offers skills on the branch-range menu too', () => {
            const { items } = build({ menu: { x: 0, y: 0, type: 'branch-range' }, skills: [{ name: 'review' }] });
            expect(labels(items)).toContain('Use Skill');
        });
    });
});
