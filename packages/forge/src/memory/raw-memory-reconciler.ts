/**
 * Raw Memory Reconciler
 *
 * AI-agnostic core for raw-to-bounded memory reconciliation.
 * Provides deterministic pre-processing, validation, and application
 * helpers that the queued executor orchestrates around an AI call.
 *
 * Flow:
 *   1. prepareReconciliationContext() — dedup, sort, build prompt context
 *   2. (caller invokes AI with the context to produce a proposed entry list)
 *   3. validateProposedEntries() — reject malformed/unsafe output
 *   4. buildApplyPlan() — determine which raw records to aggregate/drop
 *   5. applyReconciliation() — atomically rewrite MEMORY.md via BoundedMemoryStore
 */

import type { RawMemoryRecord } from './raw-memory-record-types';
import type { MemoryUsage } from './bounded-memory-types';
import { ENTRY_DELIMITER, DEFAULT_CHAR_LIMIT } from './bounded-memory-types';
import { scanMemoryContent } from './memory-security-scanner';
import type { BoundedMemoryStore } from './bounded-memory-store';
import type {
    ReconciliationInput,
    ReconciliationContext,
    ReconciliationValidationResult,
    ReconciliationApplyPlan,
    RejectedEntry,
} from './raw-memory-reconciler-types';

// ============================================================================
// 1. Deterministic pre-processing
// ============================================================================

/**
 * Prepare a reconciliation context from raw input.
 *
 * Deterministic steps applied before any AI invocation:
 * - Trim and filter empty content
 * - Collapse exact-duplicate content across raw records
 * - Stable sort by content (lexicographic, for reproducibility)
 * - Build content→recordId mapping for post-AI tracking
 */
export function prepareReconciliationContext(input: ReconciliationInput): ReconciliationContext {
    const { currentEntries, claimedRecords, charLimit, scope } = input;

    // Group raw records by trimmed content
    const contentToRecordIds = new Map<string, string[]>();
    const allRecordIds: string[] = [];

    for (const record of claimedRecords) {
        const trimmed = record.content.trim();
        if (!trimmed) continue;

        allRecordIds.push(record.id);
        const existing = contentToRecordIds.get(trimmed);
        if (existing) {
            existing.push(record.id);
        } else {
            contentToRecordIds.set(trimmed, [record.id]);
        }
    }

    // Stable sort by content for reproducibility
    const candidateContents = [...contentToRecordIds.keys()].sort();

    // Compute current usage
    const currentUsage = computeUsage(currentEntries, charLimit);

    return {
        currentEntries: [...currentEntries],
        candidateContents,
        contentToRecordIds,
        allRecordIds,
        charLimit,
        currentUsage,
        scope,
    };
}

// ============================================================================
// 2. Validation of AI-proposed entries
// ============================================================================

/**
 * Validate a proposed list of bounded-memory entries.
 *
 * Checks:
 * - Must be a non-null array
 * - Each entry must be a non-empty string
 * - Each entry must pass the security scanner
 * - No exact duplicates after trimming
 * - Serialized total must not exceed charLimit
 *
 * Returns a result distinguishing valid entries from rejected ones,
 * and top-level structural errors.
 */
export function validateProposedEntries(
    proposed: unknown,
    charLimit: number,
): ReconciliationValidationResult {
    const errors: string[] = [];
    const validEntries: string[] = [];
    const rejectedEntries: RejectedEntry[] = [];

    // Structural check
    if (!Array.isArray(proposed)) {
        return {
            valid: false,
            errors: ['Proposed entries must be an array.'],
            validEntries: [],
            rejectedEntries: [],
        };
    }

    if (proposed.length === 0) {
        // Empty is valid — clears memory
        return { valid: true, errors: [], validEntries: [], rejectedEntries: [] };
    }

    const seen = new Set<string>();

    for (let i = 0; i < proposed.length; i++) {
        const raw = proposed[i];

        // Type check
        if (typeof raw !== 'string') {
            rejectedEntries.push({
                entry: String(raw),
                reason: `Entry at index ${i} is not a string (got ${typeof raw}).`,
            });
            continue;
        }

        const trimmed = raw.trim();

        // Empty check
        if (!trimmed) {
            rejectedEntries.push({
                entry: raw,
                reason: `Entry at index ${i} is empty after trimming.`,
            });
            continue;
        }

        // Duplicate check
        if (seen.has(trimmed)) {
            rejectedEntries.push({
                entry: trimmed,
                reason: `Duplicate entry at index ${i}.`,
            });
            continue;
        }

        // Security scan
        const scan = scanMemoryContent(trimmed);
        if (scan.blocked) {
            rejectedEntries.push({
                entry: trimmed,
                reason: `Blocked by security scanner: ${scan.reason}`,
            });
            continue;
        }

        seen.add(trimmed);
        validEntries.push(trimmed);
    }

    // Total size check on valid entries
    if (validEntries.length > 0) {
        const serialized = validEntries.join(ENTRY_DELIMITER);
        if (serialized.length > charLimit) {
            errors.push(
                `Serialized entries (${serialized.length} chars) exceed the character limit (${charLimit}).`,
            );
            return {
                valid: false,
                errors,
                validEntries,
                rejectedEntries,
            };
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        validEntries,
        rejectedEntries,
    };
}

// ============================================================================
// 3. Build application plan
// ============================================================================

/**
 * Build a plan mapping validated entries back to raw record IDs.
 *
 * Determines which raw records were incorporated (their content appears
 * in the final entry list, possibly merged) and which were dropped.
 * The queued executor uses this to update raw record statuses.
 *
 * @param validatedEntries - entries that passed validation
 * @param context - the reconciliation context from prepareReconciliationContext
 */
export function buildApplyPlan(
    validatedEntries: string[],
    context: ReconciliationContext,
): ReconciliationApplyPlan {
    // All record IDs start as candidates for 'dropped'
    const aggregatedSet = new Set<string>();

    // A raw record is "aggregated" if its content (trimmed) is a substring
    // of any validated entry, or if any validated entry is a substring of it.
    // This handles both exact matches and content that was merged/reworded.
    for (const [content, recordIds] of context.contentToRecordIds) {
        const incorporated = validatedEntries.some(
            entry => entry.includes(content) || content.includes(entry),
        );
        if (incorporated) {
            for (const id of recordIds) {
                aggregatedSet.add(id);
            }
        }
    }

    const droppedRecordIds = context.allRecordIds.filter(id => !aggregatedSet.has(id));

    return {
        entries: validatedEntries,
        aggregatedRecordIds: [...aggregatedSet],
        droppedRecordIds,
    };
}

// ============================================================================
// 4. Apply to bounded store
// ============================================================================

/**
 * Atomically rewrite the bounded memory store with reconciled entries.
 *
 * Delegates to `BoundedMemoryStore.setEntries()` which handles security
 * scanning, char limit enforcement, and atomic file write.
 *
 * @returns The mutation result from the store
 */
export async function applyReconciliation(
    store: BoundedMemoryStore,
    entries: string[],
) {
    return store.setEntries(entries);
}

// ============================================================================
// Helpers
// ============================================================================

function computeUsage(entries: string[], charLimit: number): MemoryUsage {
    const current = entries.length > 0
        ? entries.join(ENTRY_DELIMITER).length
        : 0;
    return {
        current,
        limit: charLimit,
        percent: charLimit > 0 ? Math.min(100, Math.round((current / charLimit) * 100)) : 0,
        entryCount: entries.length,
    };
}
