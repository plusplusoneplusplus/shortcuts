/**
 * UsageTracker Tests
 *
 * Tests for the token usage tracking and reporting system.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UsageTracker } from '../src/usage-tracker';
import type { PhaseUsage, UsageReport, TrackedPhase } from '../src/usage-tracker';
import type { TokenUsage } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Helpers
// ============================================================================

function makeTokenUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
    return {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 150,
        turnCount: 1,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('UsageTracker', () => {
    let tracker: UsageTracker;

    beforeEach(() => {
        tracker = new UsageTracker();
    });

    // ========================================================================
    // addUsage
    // ========================================================================

    describe('addUsage', () => {
        it('should accumulate usage for a single phase', () => {
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }));
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 200, outputTokens: 100, totalTokens: 300 }));

            const usage = tracker.getPhaseUsage('discovery');
            expect(usage.inputTokens).toBe(300);
            expect(usage.outputTokens).toBe(150);
            expect(usage.totalTokens).toBe(450);
            expect(usage.calls).toBe(2);
        });

        it('should track usage per phase independently', () => {
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 100, totalTokens: 150 }));
            tracker.addUsage('analysis', makeTokenUsage({ inputTokens: 500, totalTokens: 750 }));

            expect(tracker.getPhaseUsage('discovery').inputTokens).toBe(100);
            expect(tracker.getPhaseUsage('analysis').inputTokens).toBe(500);
        });

        it('should handle undefined tokenUsage (still count the call)', () => {
            tracker.addUsage('writing', undefined);

            const usage = tracker.getPhaseUsage('writing');
            expect(usage.calls).toBe(1);
            expect(usage.inputTokens).toBe(0);
            expect(usage.totalTokens).toBe(0);
        });

        it('should accumulate cost when provided', () => {
            tracker.addUsage('analysis', makeTokenUsage({ cost: 0.10 }));
            tracker.addUsage('analysis', makeTokenUsage({ cost: 0.15 }));

            const usage = tracker.getPhaseUsage('analysis');
            expect(usage.cost).toBeCloseTo(0.25);
        });

        it('should keep cost null when never provided', () => {
            tracker.addUsage('analysis', makeTokenUsage());
            tracker.addUsage('analysis', makeTokenUsage());

            const usage = tracker.getPhaseUsage('analysis');
            expect(usage.cost).toBeNull();
        });

        it('should accumulate cache tokens', () => {
            tracker.addUsage('discovery', makeTokenUsage({ cacheReadTokens: 50, cacheWriteTokens: 30 }));
            tracker.addUsage('discovery', makeTokenUsage({ cacheReadTokens: 20, cacheWriteTokens: 10 }));

            const usage = tracker.getPhaseUsage('discovery');
            expect(usage.cacheReadTokens).toBe(70);
            expect(usage.cacheWriteTokens).toBe(40);
        });
    });

    // ========================================================================
    // markCached
    // ========================================================================

    describe('markCached', () => {
        it('should mark a phase as cached', () => {
            tracker.markCached('discovery');

            const usage = tracker.getPhaseUsage('discovery');
            expect(usage.cached).toBe(true);
            expect(usage.calls).toBe(0);
            expect(usage.totalTokens).toBe(0);
        });

        it('should not affect other phases', () => {
            tracker.markCached('discovery');

            expect(tracker.getPhaseUsage('discovery').cached).toBe(true);
            expect(tracker.getPhaseUsage('analysis').cached).toBe(false);
        });
    });

    // ========================================================================
    // getPhaseUsage
    // ========================================================================

    describe('getPhaseUsage', () => {
        it('should return zero-initialized usage for untracked phase', () => {
            const usage = tracker.getPhaseUsage('consolidation');
            expect(usage.inputTokens).toBe(0);
            expect(usage.outputTokens).toBe(0);
            expect(usage.totalTokens).toBe(0);
            expect(usage.cost).toBeNull();
            expect(usage.calls).toBe(0);
            expect(usage.cached).toBe(false);
        });
    });

    // ========================================================================
    // getTotal
    // ========================================================================

    describe('getTotal', () => {
        it('should sum across all phases', () => {
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }));
            tracker.addUsage('analysis', makeTokenUsage({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }));
            tracker.addUsage('writing', makeTokenUsage({ inputTokens: 300, outputTokens: 100, totalTokens: 400 }));

            const total = tracker.getTotal();
            expect(total.inputTokens).toBe(900);
            expect(total.outputTokens).toBe(350);
            expect(total.totalTokens).toBe(1250);
            expect(total.calls).toBe(3);
        });

        it('should handle empty tracker', () => {
            const total = tracker.getTotal();
            expect(total.inputTokens).toBe(0);
            expect(total.outputTokens).toBe(0);
            expect(total.totalTokens).toBe(0);
            expect(total.calls).toBe(0);
            expect(total.cost).toBeNull();
        });

        it('should sum cost across phases', () => {
            tracker.addUsage('discovery', makeTokenUsage({ cost: 0.05 }));
            tracker.addUsage('analysis', makeTokenUsage({ cost: 0.20 }));

            const total = tracker.getTotal();
            expect(total.cost).toBeCloseTo(0.25);
        });

        it('should return null cost when no phase has cost', () => {
            tracker.addUsage('discovery', makeTokenUsage());
            const total = tracker.getTotal();
            expect(total.cost).toBeNull();
        });
    });

    // ========================================================================
    // hasUsage
    // ========================================================================

    describe('hasUsage', () => {
        it('should return false for empty tracker', () => {
            expect(tracker.hasUsage()).toBe(false);
        });

        it('should return true after addUsage', () => {
            tracker.addUsage('discovery', makeTokenUsage());
            expect(tracker.hasUsage()).toBe(true);
        });

        it('should return true even with undefined tokenUsage (call was made)', () => {
            tracker.addUsage('discovery', undefined);
            expect(tracker.hasUsage()).toBe(true);
        });
    });

    // ========================================================================
    // toReport
    // ========================================================================

    describe('toReport', () => {
        it('should produce a report with all 4 phases', () => {
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 100, totalTokens: 150 }));

            const report = tracker.toReport('test-model');

            expect(report.model).toBe('test-model');
            expect(report.timestamp).toBeDefined();
            expect(report.phases.discovery).toBeDefined();
            expect(report.phases.consolidation).toBeDefined();
            expect(report.phases.analysis).toBeDefined();
            expect(report.phases.writing).toBeDefined();
            expect(report.total).toBeDefined();
        });

        it('should include correct totals', () => {
            tracker.addUsage('discovery', makeTokenUsage({ inputTokens: 100, outputTokens: 50, totalTokens: 150 }));
            tracker.addUsage('analysis', makeTokenUsage({ inputTokens: 500, outputTokens: 200, totalTokens: 700 }));

            const report = tracker.toReport();

            expect(report.total.inputTokens).toBe(600);
            expect(report.total.outputTokens).toBe(250);
            expect(report.total.totalTokens).toBe(850);
            expect(report.total.calls).toBe(2);
        });

        it('should show cached phases correctly', () => {
            tracker.markCached('discovery');
            tracker.addUsage('analysis', makeTokenUsage());

            const report = tracker.toReport();

            expect(report.phases.discovery.cached).toBe(true);
            expect(report.phases.discovery.calls).toBe(0);
            expect(report.phases.analysis.cached).toBe(false);
            expect(report.phases.analysis.calls).toBe(1);
        });

        it('should include timestamp as ISO string', () => {
            const report = tracker.toReport();
            expect(() => new Date(report.timestamp)).not.toThrow();
        });

        it('should serialize to valid JSON', () => {
            tracker.addUsage('discovery', makeTokenUsage({ cost: 0.05 }));
            tracker.addUsage('analysis', makeTokenUsage({ cost: 0.20, inputTokens: 500 }));

            const report = tracker.toReport('claude-sonnet');
            const json = JSON.stringify(report, null, 2);
            const parsed = JSON.parse(json) as UsageReport;

            expect(parsed.model).toBe('claude-sonnet');
            expect(parsed.phases.discovery.cost).toBeCloseTo(0.05);
            expect(parsed.total.cost).toBeCloseTo(0.25);
        });
    });

    // ========================================================================
    // Static formatting helpers
    // ========================================================================

    describe('formatTokens', () => {
        it('should format small numbers', () => {
            expect(UsageTracker.formatTokens(42)).toBe('42');
        });

        it('should format numbers with commas', () => {
            expect(UsageTracker.formatTokens(12450)).toBe('12,450');
        });

        it('should format large numbers', () => {
            expect(UsageTracker.formatTokens(1234567)).toBe('1,234,567');
        });

        it('should format zero', () => {
            expect(UsageTracker.formatTokens(0)).toBe('0');
        });
    });

    describe('formatCost', () => {
        it('should format as dollar amount', () => {
            expect(UsageTracker.formatCost(0.42)).toBe('$0.42');
        });

        it('should format zero cost', () => {
            expect(UsageTracker.formatCost(0)).toBe('$0.00');
        });

        it('should return N/A for null', () => {
            expect(UsageTracker.formatCost(null)).toBe('N/A');
        });

        it('should format large costs', () => {
            expect(UsageTracker.formatCost(12.5)).toBe('$12.50');
        });
    });

    // ========================================================================
    // Edge cases
    // ========================================================================

    describe('edge cases', () => {
        it('should handle many calls to a single phase', () => {
            for (let i = 0; i < 100; i++) {
                tracker.addUsage('analysis', makeTokenUsage({ inputTokens: 10, totalTokens: 15 }));
            }

            const usage = tracker.getPhaseUsage('analysis');
            expect(usage.calls).toBe(100);
            expect(usage.inputTokens).toBe(1000);
            expect(usage.totalTokens).toBe(1500);
        });

        it('should handle all four phases simultaneously', () => {
            const phases: TrackedPhase[] = ['discovery', 'consolidation', 'analysis', 'writing'];
            for (const phase of phases) {
                tracker.addUsage(phase, makeTokenUsage({ inputTokens: 100, totalTokens: 150 }));
            }

            const total = tracker.getTotal();
            expect(total.calls).toBe(4);
            expect(total.inputTokens).toBe(400);
        });

        it('should handle mixed cost: some phases have cost, some do not', () => {
            tracker.addUsage('discovery', makeTokenUsage()); // no cost
            tracker.addUsage('analysis', makeTokenUsage({ cost: 0.10 })); // has cost

            const total = tracker.getTotal();
            expect(total.cost).toBeCloseTo(0.10);
        });
    });
});
