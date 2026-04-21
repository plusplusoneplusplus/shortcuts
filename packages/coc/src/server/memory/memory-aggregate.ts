/**
 * Memory Aggregate — prompts, config, and helper types for queued
 * raw-to-bounded memory aggregation.
 *
 * The queued executor uses these to build the AI prompt that reconciles
 * raw memory records into bounded MEMORY.md.
 */

import type { ReconciliationContext } from '@plusplusoneplusplus/forge';

// ── Configuration ──────────────────────────────────────────────────

export interface MemoryAggregateConfig {
    /** Maximum raw records to claim per batch (default: 50). */
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
 * Build the system message for the reconciliation AI call.
 *
 * Provides the current bounded entries and candidate raw records as
 * structured context so the AI can produce a merged entry list.
 */
export function buildAggregateSystemMessage(ctx: ReconciliationContext): string {
    const parts: string[] = [
        'You are a memory reconciliation agent. Your job is to merge new memory',
        'candidates into the existing bounded memory while staying within the',
        `character limit of ${ctx.charLimit} characters.`,
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
Reconcile the candidate memory entries into the current bounded memory.

Rules:
1. Return ONLY a JSON array of strings — the complete final memory entry list.
2. Merge duplicate or overlapping candidates with existing entries.
3. Drop candidates that are redundant, trivial, or already covered.
4. Keep existing entries that are still relevant.
5. Each entry must be a single, self-contained fact.
6. Stay within the character limit (entries joined with "\\n§\\n").
7. If no candidates are worth keeping, return the current entries unchanged.

Respond with ONLY the JSON array, no explanation or markdown fencing.`;
