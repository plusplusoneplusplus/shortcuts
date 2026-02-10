/**
 * Token Usage Tracker
 *
 * Accumulates TokenUsage data across multiple AI calls, organized by phase.
 * Produces a per-phase and total summary for CLI display and JSON export.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import type { TokenUsage } from '@plusplusoneplusplus/pipeline-core';

// ============================================================================
// Types
// ============================================================================

/** Phases tracked by the UsageTracker */
export type TrackedPhase = 'discovery' | 'consolidation' | 'analysis' | 'writing';

/** Per-phase accumulated usage data */
export interface PhaseUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    cost: number | null;
    calls: number;
    cached: boolean;
}

/** JSON report structure */
export interface UsageReport {
    timestamp: string;
    model?: string;
    phases: Record<TrackedPhase, PhaseUsage>;
    total: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        totalTokens: number;
        cost: number | null;
        calls: number;
    };
}

// ============================================================================
// UsageTracker
// ============================================================================

/**
 * Accumulates TokenUsage across multiple AI calls, grouped by phase.
 */
export class UsageTracker {
    private phases: Map<TrackedPhase, PhaseUsage> = new Map();

    /**
     * Record token usage from a single AI call.
     */
    addUsage(phase: TrackedPhase, usage?: TokenUsage): void {
        const current = this.getOrCreatePhase(phase);
        current.calls += 1;
        if (usage) {
            current.inputTokens += usage.inputTokens;
            current.outputTokens += usage.outputTokens;
            current.cacheReadTokens += usage.cacheReadTokens;
            current.cacheWriteTokens += usage.cacheWriteTokens;
            current.totalTokens += usage.totalTokens;
            if (usage.cost != null) {
                current.cost = (current.cost ?? 0) + usage.cost;
            }
        }
    }

    /**
     * Mark a phase as having been loaded from cache (0 AI calls).
     */
    markCached(phase: TrackedPhase): void {
        const current = this.getOrCreatePhase(phase);
        current.cached = true;
    }

    /**
     * Get usage data for a specific phase.
     */
    getPhaseUsage(phase: TrackedPhase): PhaseUsage {
        return this.getOrCreatePhase(phase);
    }

    /**
     * Get the total across all phases.
     */
    getTotal(): UsageReport['total'] {
        let inputTokens = 0;
        let outputTokens = 0;
        let cacheReadTokens = 0;
        let cacheWriteTokens = 0;
        let totalTokens = 0;
        let cost: number | null = null;
        let calls = 0;

        for (const usage of this.phases.values()) {
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
            cacheReadTokens += usage.cacheReadTokens;
            cacheWriteTokens += usage.cacheWriteTokens;
            totalTokens += usage.totalTokens;
            if (usage.cost != null) {
                cost = (cost ?? 0) + usage.cost;
            }
            calls += usage.calls;
        }

        return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens, cost, calls };
    }

    /**
     * Check if any usage data has been recorded.
     */
    hasUsage(): boolean {
        const total = this.getTotal();
        return total.calls > 0 || total.totalTokens > 0;
    }

    /**
     * Build the full JSON report.
     */
    toReport(model?: string): UsageReport {
        const allPhases: TrackedPhase[] = ['discovery', 'consolidation', 'analysis', 'writing'];
        const phases = {} as Record<TrackedPhase, PhaseUsage>;
        for (const phase of allPhases) {
            phases[phase] = this.getOrCreatePhase(phase);
        }

        return {
            timestamp: new Date().toISOString(),
            model,
            phases,
            total: this.getTotal(),
        };
    }

    /**
     * Format token count with commas for CLI display.
     */
    static formatTokens(n: number): string {
        return n.toLocaleString('en-US');
    }

    /**
     * Format cost as dollar amount.
     */
    static formatCost(cost: number | null): string {
        if (cost == null) { return 'N/A'; }
        return `$${cost.toFixed(2)}`;
    }

    // ========================================================================
    // Private
    // ========================================================================

    private getOrCreatePhase(phase: TrackedPhase): PhaseUsage {
        let existing = this.phases.get(phase);
        if (!existing) {
            existing = {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
                totalTokens: 0,
                cost: null,
                calls: 0,
                cached: false,
            };
            this.phases.set(phase, existing);
        }
        return existing;
    }
}
