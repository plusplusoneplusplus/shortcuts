/**
 * Tests for fixup-utils — fixup/squash/amend detection and visual grouping.
 *
 * Validates:
 * - parseFixupSubject: prefix detection, nested unwrapping, pill labels
 * - buildFixupGroups: target matching, color slot assignment, edge cases
 */

import { describe, it, expect } from 'vitest';
import {
    parseFixupSubject,
    buildFixupGroups,
    FIXUP_GROUP_COLORS_LIGHT,
    FIXUP_GROUP_COLORS_DARK,
} from '../../../../src/server/spa/client/react/features/git/fixup-utils';
import type { FixupCommitInput } from '../../../../src/server/spa/client/react/features/git/fixup-utils';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCommit(overrides: { hash: string; subject: string }): FixupCommitInput {
    return overrides;
}

// ── parseFixupSubject ───────────────────────────────────────────────────────

describe('parseFixupSubject', () => {
    it('returns null for a regular commit subject', () => {
        expect(parseFixupSubject('Add user authentication')).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(parseFixupSubject('')).toBeNull();
    });

    it('detects fixup! prefix', () => {
        const result = parseFixupSubject('fixup! Add user authentication');
        expect(result).toEqual({
            type: 'fixup',
            innerSubject: 'Add user authentication',
            targetSubject: 'Add user authentication',
            pillLabel: 'FIX',
        });
    });

    it('detects squash! prefix', () => {
        const result = parseFixupSubject('squash! Refactor database layer');
        expect(result).toEqual({
            type: 'squash',
            innerSubject: 'Refactor database layer',
            targetSubject: 'Refactor database layer',
            pillLabel: 'SQU',
        });
    });

    it('detects amend! prefix', () => {
        const result = parseFixupSubject('amend! Fix typo in README');
        expect(result).toEqual({
            type: 'amend',
            innerSubject: 'Fix typo in README',
            targetSubject: 'Fix typo in README',
            pillLabel: 'AMD',
        });
    });

    it('unwraps nested fixup prefixes', () => {
        const result = parseFixupSubject('fixup! fixup! Add user auth');
        expect(result).toEqual({
            type: 'fixup',
            innerSubject: 'fixup! Add user auth',
            targetSubject: 'Add user auth',
            pillLabel: 'FIX',
        });
    });

    it('unwraps deeply nested mixed prefixes', () => {
        const result = parseFixupSubject('squash! fixup! amend! Core feature');
        expect(result).toEqual({
            type: 'squash',
            innerSubject: 'fixup! amend! Core feature',
            targetSubject: 'Core feature',
            pillLabel: 'SQU',
        });
    });

    it('does not match fixup without space after !', () => {
        expect(parseFixupSubject('fixup!no space')).toBeNull();
    });

    it('does not match Fixup (case-sensitive)', () => {
        expect(parseFixupSubject('Fixup! Something')).toBeNull();
    });

    it('preserves subjects with special characters', () => {
        const result = parseFixupSubject('fixup! feat(auth): add OAuth2 [WIP]');
        expect(result?.targetSubject).toBe('feat(auth): add OAuth2 [WIP]');
    });
});

// ── buildFixupGroups ────────────────────────────────────────────────────────

describe('buildFixupGroups', () => {
    it('returns empty maps when there are no fixup commits', () => {
        const commits = [
            makeCommit({ hash: 'aaa1', subject: 'Add feature' }),
            makeCommit({ hash: 'bbb2', subject: 'Fix bug' }),
        ];
        const result = buildFixupGroups(commits);
        expect(result.targetGroups.size).toBe(0);
        expect(result.fixupEntries.size).toBe(0);
    });

    it('returns empty maps for an empty commit list', () => {
        const result = buildFixupGroups([]);
        expect(result.targetGroups.size).toBe(0);
        expect(result.fixupEntries.size).toBe(0);
    });

    it('matches a fixup to its nearest earlier target', () => {
        const commits = [
            makeCommit({ hash: 'def2', subject: 'fixup! Add user authentication' }),
            makeCommit({ hash: 'abc1', subject: 'Add user authentication' }),
            makeCommit({ hash: 'ghi3', subject: 'Other commit' }),
        ];
        const result = buildFixupGroups(commits);

        // Target should not be in fixupEntries
        expect(result.fixupEntries.has('abc1')).toBe(false);
        // Fixup should be in fixupEntries
        expect(result.fixupEntries.has('def2')).toBe(true);
        expect(result.fixupEntries.get('def2')?.targetHash).toBe('abc1');
        expect(result.fixupEntries.get('def2')?.type).toBe('fixup');
        expect(result.fixupEntries.get('def2')?.displaySubject).toBe('Add user authentication');
        expect(result.fixupEntries.get('def2')?.pillLabel).toBe('FIX');

        // Target should be in targetGroups
        expect(result.targetGroups.has('abc1')).toBe(true);
        expect(result.targetGroups.get('abc1')?.fixupHashes).toEqual(['def2']);
    });

    it('matches squash commit correctly', () => {
        const commits = [
            makeCommit({ hash: 'def2', subject: 'squash! Refactor DB' }),
            makeCommit({ hash: 'abc1', subject: 'Refactor DB' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.fixupEntries.get('def2')?.type).toBe('squash');
        expect(result.fixupEntries.get('def2')?.pillLabel).toBe('SQU');
    });

    it('matches amend commit correctly', () => {
        const commits = [
            makeCommit({ hash: 'def2', subject: 'amend! Fix README' }),
            makeCommit({ hash: 'abc1', subject: 'Fix README' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.fixupEntries.get('def2')?.type).toBe('amend');
        expect(result.fixupEntries.get('def2')?.pillLabel).toBe('AMD');
    });

    it('groups multiple fixups for the same target', () => {
        const commits = [
            makeCommit({ hash: 'ghi3', subject: 'squash! Add auth' }),
            makeCommit({ hash: 'def2', subject: 'fixup! Add auth' }),
            makeCommit({ hash: 'abc1', subject: 'Add auth' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.targetGroups.get('abc1')?.fixupHashes).toEqual(['ghi3', 'def2']);
        // Both fixups should share the same color slot
        expect(result.fixupEntries.get('def2')?.colorSlot).toBe(
            result.fixupEntries.get('ghi3')?.colorSlot
        );
    });

    it('assigns different color slots to different groups', () => {
        const commits = [
            makeCommit({ hash: 'def2', subject: 'fixup! Feature A' }),
            makeCommit({ hash: 'abc1', subject: 'Feature A' }),
            makeCommit({ hash: 'jkl4', subject: 'fixup! Feature B' }),
            makeCommit({ hash: 'ghi3', subject: 'Feature B' }),
        ];
        const result = buildFixupGroups(commits);

        const slotA = result.targetGroups.get('abc1')?.colorSlot;
        const slotB = result.targetGroups.get('ghi3')?.colorSlot;
        expect(slotA).not.toBe(slotB);
    });

    it('wraps color slots around after palette size', () => {
        // Create 7 distinct groups (palette has 6 colors)
        // Fixup must come before its target (lower index = newer)
        const commits: FixupCommitInput[] = [];
        for (let i = 0; i < 7; i++) {
            commits.push(makeCommit({ hash: `fixup${i}`, subject: `fixup! Feature ${i}` }));
            commits.push(makeCommit({ hash: `target${i}`, subject: `Feature ${i}` }));
        }
        const result = buildFixupGroups(commits);

        const slot0 = result.targetGroups.get('target0')?.colorSlot;
        const slot6 = result.targetGroups.get('target6')?.colorSlot;
        expect(slot0).toBe(slot6); // wraps around
    });

    it('finds nearest earlier target (not a more distant one)', () => {
        // Two commits with the same subject — fixup should match the nearer one
        const commits = [
            makeCommit({ hash: 'abc1', subject: 'Fix bug' }),
            makeCommit({ hash: 'def2', subject: 'fixup! Fix bug' }),
            makeCommit({ hash: 'ghi3', subject: 'Fix bug' }),
        ];
        const result = buildFixupGroups(commits);

        // def2 is at index 1, abc1 at index 0 (earlier=higher index), ghi3 at index 2
        // Nearest earlier = next in list (higher index) = ghi3 (index 2)
        // Wait — "earlier" in git means older = later in the list (since commits are newest-first)
        // So index 2 (ghi3) is earlier than index 0 (abc1) in time
        // The fixup at index 1 should find the nearest earlier = index 2 (ghi3)
        expect(result.fixupEntries.get('def2')?.targetHash).toBe('ghi3');
    });

    it('skips fixup when no target found in the list', () => {
        const commits = [
            makeCommit({ hash: 'abc1', subject: 'fixup! Non-existent commit' }),
            makeCommit({ hash: 'def2', subject: 'Other commit' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.fixupEntries.size).toBe(0);
        expect(result.targetGroups.size).toBe(0);
    });

    it('handles interleaved fixups from different groups', () => {
        // Newest-first: all fixups must precede (lower index) their targets
        const commits = [
            makeCommit({ hash: 'def2', subject: 'fixup! Feature A' }),
            makeCommit({ hash: 'mno5', subject: 'squash! Feature A' }),
            makeCommit({ hash: 'abc1', subject: 'Feature A' }),
            makeCommit({ hash: 'jkl4', subject: 'fixup! Feature B' }),
            makeCommit({ hash: 'ghi3', subject: 'Feature B' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.targetGroups.get('abc1')?.fixupHashes).toEqual(['def2', 'mno5']);
        expect(result.targetGroups.get('ghi3')?.fixupHashes).toEqual(['jkl4']);
    });

    it('handles nested fixup by matching the unwrapped target subject', () => {
        const commits = [
            makeCommit({ hash: 'def2', subject: 'fixup! fixup! Add feature' }),
            makeCommit({ hash: 'abc1', subject: 'Add feature' }),
        ];
        const result = buildFixupGroups(commits);

        expect(result.fixupEntries.get('def2')?.targetHash).toBe('abc1');
        expect(result.fixupEntries.get('def2')?.displaySubject).toBe('Add feature');
    });

    it('does not match a fixup to itself', () => {
        const commits = [
            makeCommit({ hash: 'abc1', subject: 'fixup! fixup! Something' }),
        ];
        const result = buildFixupGroups(commits);
        expect(result.fixupEntries.size).toBe(0);
    });
});

// ── Color palettes ──────────────────────────────────────────────────────────

describe('color palettes', () => {
    it('light palette has 6 colors', () => {
        expect(FIXUP_GROUP_COLORS_LIGHT).toHaveLength(6);
    });

    it('dark palette has 6 colors', () => {
        expect(FIXUP_GROUP_COLORS_DARK).toHaveLength(6);
    });

    it('all palette colors are valid hex strings', () => {
        for (const color of [...FIXUP_GROUP_COLORS_LIGHT, ...FIXUP_GROUP_COLORS_DARK]) {
            expect(color).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });
});
