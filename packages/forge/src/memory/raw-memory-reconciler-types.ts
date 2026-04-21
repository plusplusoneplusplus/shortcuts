/**
 * Raw Memory Reconciler Types
 *
 * Defines the inputs, outputs, and validation types for the raw-to-bounded
 * reconciliation core. This layer is AI-agnostic — it prepares context for
 * prompt building and validates AI-proposed entry lists, but never invokes
 * AI itself.
 */

import type { RawMemoryRecord } from './raw-memory-record-types';
import type { MemoryUsage } from './bounded-memory-types';

// ---------------------------------------------------------------------------
// Reconciliation input
// ---------------------------------------------------------------------------

/**
 * Everything the queued executor needs to build a reconciliation prompt.
 * Assembled by the caller from raw store + bounded store state.
 */
export interface ReconciliationInput {
    /** Current bounded entries from MEMORY.md */
    currentEntries: string[];
    /** Claimed raw records to be reconciled */
    claimedRecords: RawMemoryRecord[];
    /** Character budget for the bounded memory (serialized with delimiters) */
    charLimit: number;
    /** Memory scope: 'repo' or 'system' */
    scope: string;
    /** Optional workspace identifier for metadata */
    workspaceId?: string;
}

// ---------------------------------------------------------------------------
// Prepared context (after deterministic pre-processing)
// ---------------------------------------------------------------------------

/**
 * Pre-processed reconciliation context ready for prompt assembly.
 * Produced by `prepareReconciliationContext()`.
 */
export interface ReconciliationContext {
    /** Current bounded entries (unchanged) */
    currentEntries: string[];
    /** Deduplicated, stable-sorted candidate contents from raw records */
    candidateContents: string[];
    /** Map from content string → array of raw record IDs that carried that content */
    contentToRecordIds: Map<string, string[]>;
    /** All raw record IDs in this batch */
    allRecordIds: string[];
    /** Character budget */
    charLimit: number;
    /** Current memory usage stats */
    currentUsage: MemoryUsage;
    /** Memory scope */
    scope: string;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/** Describes why a single entry was rejected. */
export interface RejectedEntry {
    entry: string;
    reason: string;
}

/**
 * Result of validating a proposed bounded entry list against constraints.
 */
export interface ReconciliationValidationResult {
    /** True if the proposed list is safe to apply */
    valid: boolean;
    /** Top-level errors (e.g. not an array, exceeds total limit) */
    errors: string[];
    /** Entries that passed all validation checks */
    validEntries: string[];
    /** Entries that were individually rejected */
    rejectedEntries: RejectedEntry[];
}

// ---------------------------------------------------------------------------
// Application plan
// ---------------------------------------------------------------------------

/**
 * A fully validated reconciliation result ready for application.
 * The queued executor uses this to atomically update both MEMORY.md and
 * raw record statuses.
 */
export interface ReconciliationApplyPlan {
    /** The validated entry list to write to MEMORY.md */
    entries: string[];
    /** Raw record IDs whose content was incorporated — mark as 'aggregated' */
    aggregatedRecordIds: string[];
    /** Raw record IDs whose content was dropped (duplicate, etc.) — mark as 'dropped' */
    droppedRecordIds: string[];
}
