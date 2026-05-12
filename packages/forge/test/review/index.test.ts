/**
 * Tests for review module barrel exports.
 *
 * Ensures all expected symbols are re-exported from the index.
 */

import { describe, it, expect } from 'vitest';
import * as review from '../../src/review';

describe('review/index barrel exports', () => {
    it('exports createReviewComment', () => {
        expect(typeof review.createReviewComment).toBe('function');
    });

    it('exports computeReviewStats', () => {
        expect(typeof review.computeReviewStats).toBe('function');
    });

    it('exports deriveAssessment', () => {
        expect(typeof review.deriveAssessment).toBe('function');
    });

    it('exports buildReviewResult', () => {
        expect(typeof review.buildReviewResult).toBe('function');
    });

    it('exports mergeReviewResults', () => {
        expect(typeof review.mergeReviewResults).toBe('function');
    });

    it('exports filterBySeverity', () => {
        expect(typeof review.filterBySeverity).toBe('function');
    });

    it('exports filterByCategory', () => {
        expect(typeof review.filterByCategory).toBe('function');
    });

    it('exports filterByFile', () => {
        expect(typeof review.filterByFile).toBe('function');
    });

    it('exports groupByFile', () => {
        expect(typeof review.groupByFile).toBe('function');
    });
});
