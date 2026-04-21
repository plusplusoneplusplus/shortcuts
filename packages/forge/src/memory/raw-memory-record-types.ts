/**
 * Raw Memory Record Types
 *
 * Defines the row shape, batch envelope, status lifecycle, and query
 * interfaces for the append-only raw memory record store.
 *
 * The raw record store is the durable landing zone for memory candidates
 * before they are aggregated into bounded MEMORY.md.
 */

// ---------------------------------------------------------------------------
// Status lifecycle
// ---------------------------------------------------------------------------

/**
 * Status transitions:
 *   pending → claimed → aggregated
 *                     → dropped
 *   claimed → pending  (via releaseClaim)
 */
export type RawMemoryRecordStatus = 'pending' | 'claimed' | 'aggregated' | 'dropped';

// ---------------------------------------------------------------------------
// Record shape (mirrors the SQLite row)
// ---------------------------------------------------------------------------

export interface RawMemoryRecord {
    /** Auto-generated UUID */
    id: string;
    /** Memory scope: 'repo' or 'system' */
    target: string;
    /** The memory content to be stored */
    content: string;

    // Provenance
    /** Where the record originated (e.g. 'chat', 'write_memory') */
    source: string;
    /** Workspace that produced the record */
    workspaceId: string;
    /** Process that produced the record */
    processId: string | null;
    /** Turn index within the process conversation */
    turnIndex: number | null;
    /** ISO 8601 creation timestamp */
    createdAt: string;

    // Batching lifecycle
    status: RawMemoryRecordStatus;
    /** UUID of the batch that claimed this record */
    batchId: string | null;
    /** ISO 8601 timestamp when this record was claimed */
    claimedAt: string | null;
    /** ISO 8601 timestamp when this record was aggregated into MEMORY.md */
    aggregatedAt: string | null;
    /** ISO 8601 timestamp when this record was dropped */
    droppedAt: string | null;

    // Dedupe / debug
    /** Content fingerprint for deduplication hints (not enforced as unique) */
    fingerprint: string | null;
    /** Arbitrary JSON metadata */
    metadataJson: string | null;
}

// ---------------------------------------------------------------------------
// Input type for appending new records
// ---------------------------------------------------------------------------

export interface RawMemoryRecordInput {
    target: string;
    content: string;
    source: string;
    workspaceId: string;
    processId?: string | null;
    turnIndex?: number | null;
    fingerprint?: string | null;
    metadataJson?: string | null;
}

// ---------------------------------------------------------------------------
// Batch envelope returned by claimPending
// ---------------------------------------------------------------------------

export interface RawMemoryBatch {
    /** Unique batch identifier */
    batchId: string;
    /** Records claimed in this batch */
    records: RawMemoryRecord[];
}

// ---------------------------------------------------------------------------
// Query / filter types
// ---------------------------------------------------------------------------

export interface RawMemoryRecordFilter {
    /** Filter by status */
    status?: RawMemoryRecordStatus;
    /** Filter by workspace */
    workspaceId?: string;
    /** Maximum number of records to return */
    limit?: number;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface RawMemoryRecordStats {
    pending: number;
    claimed: number;
    aggregated: number;
    dropped: number;
    total: number;
}
