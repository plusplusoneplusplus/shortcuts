/**
 * Tests for diff module barrel exports.
 *
 * Verifies that the public API is correctly re-exported from the index.
 */

import { describe, it, expect } from 'vitest';
import * as diff from '../../src/diff';

describe('diff/index barrel exports', () => {
    it('exports git-based factory functions', () => {
        expect(typeof diff.createCommitDiffProvider).toBe('function');
        expect(typeof diff.createRangeDiffProvider).toBe('function');
        expect(typeof diff.createWorkingTreeDiffProvider).toBe('function');
    });

    it('exports PR-based factory functions', () => {
        expect(typeof diff.createPullRequestDiffProvider).toBe('function');
        expect(typeof diff.createPullRequestDiffProviderFromParams).toBe('function');
        expect(typeof diff.createPullRequestIterationDiffProvider).toBe('function');
        expect(typeof diff.createPullRequestIterationDiffProviderFromParams).toBe('function');
    });

    it('exports diff utility functions', () => {
        expect(typeof diff.parseFullDiff).toBe('function');
        expect(typeof diff.splitDiffByFile).toBe('function');
        expect(typeof diff.makeDiffContent).toBe('function');
        expect(typeof diff.computeSummary).toBe('function');
        expect(typeof diff.splitIntoChunks).toBe('function');
        expect(typeof diff.extractBPath).toBe('function');
        expect(typeof diff.extractAPath).toBe('function');
        expect(typeof diff.inferStatusFromDiffChunk).toBe('function');
        expect(typeof diff.countAdditionsDeletions).toBe('function');
    });
});
