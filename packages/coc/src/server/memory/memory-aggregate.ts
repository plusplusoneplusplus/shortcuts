/**
 * Memory Aggregate — config and helper types for queued candidate promotion.
 *
 * Automatic full-list reconciliation is disabled. These helpers describe
 * the append-only candidate-selection prompt shape for future promotion work.
 */

import type { ReconciliationContext } from '@plusplusoneplusplus/forge';

// ── Configuration ──────────────────────────────────────────────────

export interface MemoryAggregateConfig {
    /** Maximum pending candidates to inspect per run (default: 50). */
    batchSize: number;
    /** Timeout for the AI reconciliation call in ms (default: 90_000). */
    timeoutMs: number;
    /** Model to use (default: use server's default model). */
    model?: string;
}

export const DEFAULT_AGGREGATE_CONFIG: MemoryAggregateConfig = {
    batchSize: 50,
    timeoutMs: 90_000,
    model: undefined,
};

// ── Prompt ─────────────────────────────────────────────────────────

/**
 * Build the system message for a promotion AI call.
 *
 * Provides the current bounded entries and pending candidates as structured
 * context so the AI can select only new entries worth appending.
 */
export function buildAggregateSystemMessage(ctx: ReconciliationContext): string {
    const parts: string[] = [
        'You are a memory promotion agent. Your job is to identify which new',
        'memory candidates are worth appending to bounded memory while staying',
        `within the character limit of ${ctx.charLimit} characters.`,
        '',
    ];

    if (ctx.currentEntries.length > 0) {
        parts.push(
            '<current_memory>',
            ...ctx.currentEntries.map((e, i) => `${i + 1}. ${e}`),
            '</current_memory>',
            '',
        );
    } else {
        parts.push('<current_memory>', '(empty)', '</current_memory>', '');
    }

    parts.push(
        '<candidates>',
        ...ctx.candidateContents.map((c, i) => `${i + 1}. ${c}`),
        '</candidates>',
    );

    return parts.join('\n');
}

export const AGGREGATE_USER_PROMPT = `\
Select candidate memory entries worth appending to the current bounded memory.

Rules:
1. Return ONLY a JSON array of strings containing new entries to append.
2. Do not return existing memory entries.
3. Drop candidates that are redundant, trivial, or already covered.
4. Merge duplicate or overlapping candidates into a single new entry.
5. Each entry must be a single, self-contained fact.
6. Stay within the remaining character budget.
7. If no candidates are worth keeping, return [].

Respond with ONLY the JSON array, no explanation or markdown fencing.`;
