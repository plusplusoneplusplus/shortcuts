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
});
