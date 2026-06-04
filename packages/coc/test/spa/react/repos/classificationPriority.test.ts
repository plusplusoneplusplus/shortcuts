/**
 * Unit tests for the shared classification-priority helpers used by both the
 * file-tree badge (useClassification) and the diff viewer (computeHunkRanges).
 * Keeping these in sync is what guarantees the badge and the rendered hunk
 * never disagree on the dominant classification.
 */

import { describe, it, expect } from 'vitest';
import {
    classificationPriority,
    pickDominantClassification,
} from '../../../../src/server/spa/client/react/features/pull-requests/classification-types';
import type { HunkClassification } from '../../../../src/server/spa/client/react/features/pull-requests/classification-types';

function c(
    category: HunkClassification['category'],
    intensity: HunkClassification['intensity'],
): HunkClassification {
    return { file: 'f', hunkIndex: 0, category, intensity, reason: 'r' };
}

describe('classificationPriority', () => {
    it('ranks categories logic > test > mechanical > generated', () => {
        expect(classificationPriority(c('logic', 'low'))).toBeGreaterThan(classificationPriority(c('test', 'high')));
        expect(classificationPriority(c('test', 'low'))).toBeGreaterThan(classificationPriority(c('mechanical', 'high')));
        expect(classificationPriority(c('mechanical', 'low'))).toBeGreaterThan(classificationPriority(c('generated', 'high')));
    });

    it('uses intensity to break ties within a category', () => {
        expect(classificationPriority(c('logic', 'high'))).toBeGreaterThan(classificationPriority(c('logic', 'low')));
    });
});

describe('pickDominantClassification', () => {
    it('returns the higher-priority classification', () => {
        const logic = c('logic', 'high');
        const mechanical = c('mechanical', 'low');
        expect(pickDominantClassification(mechanical, logic)).toBe(logic);
        expect(pickDominantClassification(logic, mechanical)).toBe(logic);
    });

    it('handles undefined operands', () => {
        const logic = c('logic', 'high');
        expect(pickDominantClassification(undefined, logic)).toBe(logic);
        expect(pickDominantClassification(logic, undefined)).toBe(logic);
        expect(pickDominantClassification(undefined, undefined)).toBeUndefined();
    });

    it('keeps the first argument on a priority tie', () => {
        const a = c('logic', 'high');
        const b = c('logic', 'high');
        expect(pickDominantClassification(a, b)).toBe(a);
    });
});
