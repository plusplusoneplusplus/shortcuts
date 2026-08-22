/**
 * Tests for the Git tab's AI prompt builders.
 *
 * These strings are what the queue and the floating chat actually receive, so
 * the branching that used to be buried in the tab's handlers (contiguous vs
 * interleaved squash, which ref a range falls back to, which `--continue` a
 * conflict needs) is pinned here.
 */

import { describe, it, expect } from 'vitest';
import {
    buildBranchRangeSkillPrompt, buildBranchReferencePrompt, buildCommitListSummary,
    buildCommitReferencePrompt, buildCommitSkillPrompt, buildConflictResolutionPrompt,
    buildMultiCommitReferencePrompt, buildMultiCommitSkillPrompt, buildSquashPrompt,
    conflictContinueCommand,
} from '../../../../src/server/spa/client/react/features/git/repoGitTab/gitPrompts';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { BranchRangeInfo } from '../../../../src/server/spa/client/react/features/git/branches/BranchChanges';

function commit(hash: string, subject: string): GitCommitItem {
    return {
        hash, shortHash: hash.slice(0, 7), subject,
        author: 'Ada', authorEmail: 'ada@example.com',
        date: '2026-01-01T00:00:00Z', parentHashes: [],
    };
}

const C0 = commit('000000000000', 'newest');
const C1 = commit('111111111111', 'middle');
const C2 = commit('222222222222', 'keep me');
const C3 = commit('333333333333', 'oldest');
const COMMITS = [C0, C1, C2, C3];

const RANGE: BranchRangeInfo = {
    baseRef: 'origin/main', headRef: 'feature/x', commitCount: 3,
    additions: 10, deletions: 2, mergeBase: 'abc123',
    branchName: 'feature/x', fileCount: 4,
};

describe('commit reference prompts', () => {
    it('includes the full hash and the subject', () => {
        expect(buildCommitReferencePrompt(C0)).toBe(`Commit: ${C0.hash} — newest`);
    });

    it('omits the dash when the commit has no subject', () => {
        expect(buildCommitReferencePrompt({ ...C0, subject: '' })).toBe(`Commit: ${C0.hash}`);
    });

    it('summarises a selection as short-hash lines', () => {
        expect(buildCommitListSummary([C0, C1])).toBe(
            `- ${C0.shortHash} — newest\n- ${C1.shortHash} — middle`);
    });

    it('prefixes a multi-commit prompt with the count', () => {
        expect(buildMultiCommitReferencePrompt([C0, C1])).toContain('2 commits selected:');
    });
});

describe('branch reference prompt', () => {
    it('strips the origin/ prefix from the base ref', () => {
        const prompt = buildBranchReferencePrompt({
            branchRangeData: RANGE, branchName: 'feature/x', resolvedBaseRef: null, commits: [],
        });
        expect(prompt).toContain('Branch: feature/x (main..feature/x)');
        expect(prompt).toContain('Commits: 3  +10 -2');
        expect(prompt).toContain('Files: 4');
    });

    it('appends the commit list when commits are loaded', () => {
        const prompt = buildBranchReferencePrompt({
            branchRangeData: RANGE, branchName: 'feature/x', resolvedBaseRef: null, commits: [C0],
        });
        expect(prompt).toContain(`Commit list:\n- ${C0.shortHash} — newest`);
    });

    it('falls back to the resolved base ref and zero counts without a range', () => {
        const prompt = buildBranchReferencePrompt({
            branchRangeData: null, branchName: 'feature/y', resolvedBaseRef: 'origin/develop', commits: [],
        });
        expect(prompt).toContain('Branch: feature/y (develop..HEAD)');
        expect(prompt).toContain('Commits: 0  +0 -0');
    });

    it('falls back to main when nothing resolved a base', () => {
        const prompt = buildBranchReferencePrompt({
            branchRangeData: null, branchName: '', resolvedBaseRef: null, commits: [],
        });
        expect(prompt).toContain('Branch: current branch (main..HEAD)');
    });
});

describe('skill prompts', () => {
    it('wraps a single commit in a <commit> tag', () => {
        expect(buildCommitSkillPrompt(C0)).toBe(
            `Run the selected skill on this commit:\n<commit>${C0.hash}</commit>`);
    });

    it('wraps a selection in a newline-separated <commits> tag', () => {
        expect(buildMultiCommitSkillPrompt([C0, C1])).toBe(
            `Run the selected skill on these commits:\n<commits>\n${C0.hash}\n${C1.hash}\n</commits>`);
    });

    it('wraps a range in a <commit-range> tag', () => {
        expect(buildBranchRangeSkillPrompt(RANGE)).toBe(
            'Run the selected skill on this commit range:\n<commit-range>origin/main..feature/x</commit-range>');
    });

    it('falls back to the resolved base and the branch name without a range', () => {
        expect(buildBranchRangeSkillPrompt(null, 'feature/z', 'origin/develop')).toContain(
            '<commit-range>origin/develop..feature/z</commit-range>');
    });

    it('falls back to main..HEAD when nothing is known', () => {
        expect(buildBranchRangeSkillPrompt(null)).toContain('<commit-range>main..HEAD</commit-range>');
    });
});

describe('squash prompt', () => {
    it('asks for a plain squash when the selection is contiguous', () => {
        // Selection is newest-first, so the prompt reverses it to oldest-first.
        const prompt = buildSquashPrompt(COMMITS, [C0, C1], [0, 1]);
        expect(prompt).toContain('Squash the following 2 commits into a single commit.');
        expect(prompt).toContain(`Commits (oldest first):\n- ${C1.hash} middle\n- ${C0.hash} newest`);
        expect(prompt).not.toContain('[SQUASH]');
    });

    it('marks interleaved commits to preserve when the selection is not contiguous', () => {
        const prompt = buildSquashPrompt(COMMITS, [C0, C2], [0, 2]);
        expect(prompt).toContain('non-contiguous commits');
        // Oldest-first, with the untouched middle commit flagged as KEEP.
        expect(prompt).toContain(
            `- [SQUASH] ${C2.hash} keep me\n- [KEEP] ${C1.hash} middle\n- [SQUASH] ${C0.hash} newest`);
    });
});

describe('conflict prompts', () => {
    it.each([
        ['cherry-pick', 'git cherry-pick --continue'],
        ['rebase', 'git rebase --continue'],
        ['merge', 'git merge --continue'],
    ])('maps a %s to its continue command', (operation, expected) => {
        expect(conflictContinueCommand(operation)).toBe(expected);
    });

    it('lists the conflicted files and the matching continue command', () => {
        const prompt = buildConflictResolutionPrompt({
            operation: 'rebase', conflictFiles: ['src/a.ts', 'src/b.ts'],
        });
        expect(prompt).toContain('a rebase in progress');
        expect(prompt).toContain('<files>\n- src/a.ts\n- src/b.ts\n</files>');
        expect(prompt).toContain('`git rebase --continue`');
    });
});
