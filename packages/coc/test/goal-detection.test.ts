/**
 * Tests for goal.md detection from scanned created files.
 *
 * The detection logic used in ChatDetail.tsx filters scanTurnsForCreatedFiles()
 * results to find goal.md or *.goal.md files. This test validates the filter.
 */

import { describe, it, expect } from 'vitest';
import type { CreatedFileRecord } from '../../src/server/spa/client/react/utils/conversationScan';

/** Replicates the goal file detection logic from ChatDetail.tsx */
function detectGoalFile(createdFiles: CreatedFileRecord[]): string {
    return createdFiles.find(f => {
        const lower = f.filePath.toLowerCase();
        if (lower.endsWith('.goal.md')) return true;
        const sep = lower.lastIndexOf('/') >= 0 ? '/' : '\\';
        const base = lower.slice(lower.lastIndexOf(sep) + 1);
        return base === 'goal.md';
    })?.filePath ?? '';
}

function makeRecord(filePath: string): CreatedFileRecord {
    return { filePath, toolCall: {} as any, turnIndex: 0 };
}

describe('goal.md detection', () => {
    it('detects exact "goal.md" filename (unix path)', () => {
        const files = [makeRecord('/repos/myrepo/goal.md')];
        expect(detectGoalFile(files)).toBe('/repos/myrepo/goal.md');
    });

    it('detects exact "goal.md" filename (windows path)', () => {
        const files = [makeRecord('C:\\repos\\myrepo\\goal.md')];
        expect(detectGoalFile(files)).toBe('C:\\repos\\myrepo\\goal.md');
    });

    it('detects "*.goal.md" suffix pattern', () => {
        const files = [makeRecord('/repos/myrepo/auth-refactor.goal.md')];
        expect(detectGoalFile(files)).toBe('/repos/myrepo/auth-refactor.goal.md');
    });

    it('detects case-insensitively', () => {
        const files = [makeRecord('/repos/myrepo/Goal.MD')];
        expect(detectGoalFile(files)).toBe('/repos/myrepo/Goal.MD');
    });

    it('returns empty string when no goal file exists', () => {
        const files = [
            makeRecord('/repos/myrepo/plan.md'),
            makeRecord('/repos/myrepo/readme.md'),
        ];
        expect(detectGoalFile(files)).toBe('');
    });

    it('returns first match when multiple goal files exist', () => {
        const files = [
            makeRecord('/repos/myrepo/goal.md'),
            makeRecord('/repos/myrepo/other.goal.md'),
        ];
        expect(detectGoalFile(files)).toBe('/repos/myrepo/goal.md');
    });

    it('does not match files that merely contain "goal" in path', () => {
        const files = [
            makeRecord('/repos/myrepo/goals/readme.md'),
            makeRecord('/repos/myrepo/goal-tracking.md'),
        ];
        expect(detectGoalFile(files)).toBe('');
    });

    it('handles bare filename without directory', () => {
        const files = [makeRecord('goal.md')];
        expect(detectGoalFile(files)).toBe('goal.md');
    });

    it('handles nested *.goal.md in deep paths', () => {
        const files = [makeRecord('/a/b/c/d/feature.goal.md')];
        expect(detectGoalFile(files)).toBe('/a/b/c/d/feature.goal.md');
    });
});
