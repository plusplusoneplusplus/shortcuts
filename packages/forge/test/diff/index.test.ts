/**
 * Tests for diff module barrel exports.
 *
 * Verifies that the public API is correctly re-exported from the index.
 */

import { describe, it, expect } from 'vitest';
import * as diff from '../../src/diff';

describe('diff/index barrel exports', () => {
    it('exports factory functions', () => {
        expect(typeof diff.createCommitDiffProvider).toBe('function');
        expect(typeof diff.createRangeDiffProvider).toBe('function');
        expect(typeof diff.createWorkingTreeDiffProvider).toBe('function');
    });
});
