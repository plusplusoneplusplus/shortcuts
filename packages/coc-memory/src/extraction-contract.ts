/**
 * Extraction Contracts
 *
 * Interfaces and types for automatic memory extraction after successful turns.
 * Extraction is always async and never blocks the user response.
 *
 * Key constraints:
 * - Extraction MUST NOT run on interrupted, cancelled, partial, or failed turns.
 * - High-confidence results (>= threshold) become active immediately after safety scan.
 * - Low-confidence or sensitive-looking results enter the review queue.
 * - Ralph iterations produce episode summaries and may also extract facts.
 */
import type { MemoryEpisodeInput, MemoryFactInput, MemoryScope } from './types';

// ---------------------------------------------------------------------------
// Extraction context
// ---------------------------------------------------------------------------

/**
 * Describes the completed turn that is eligible for extraction.
 */
export interface ExtractionContext {
    /** CoC process ID */
    processId: string;
    /** Ralph session ID, when applicable */
    ralphId?: string;
    /** Zero-based turn index */
    turnIndex?: number;
    /** Ralph iteration number */
    iterationIndex?: number;
    /** User message text */
    userMessage: string;
    /** AI/assistant response text */
    assistantResponse: string;
    /** Tool call summaries included in the turn, if any */
    toolSummaries?: string[];
    /** Memory scope to write extracted items into */
    scope: MemoryScope;
    /** Required when scope === 'workspace' */
    workspaceId?: string;
    /** Model that produced the response */
    model?: string;
}

// ---------------------------------------------------------------------------
// Extraction result
// ---------------------------------------------------------------------------

/**
 * A candidate fact produced by extraction before safety scanning and
 * confidence gating.
 */
export interface ExtractedFactCandidate {
    /** Proposed fact content */
    content: string;
    /** Extraction confidence in [0, 1] */
    confidence: number;
    /** Suggested importance in [0, 1] */
    importance: number;
    /** Suggested tags */
    tags: string[];
}

/**
 * Outcome of a single extraction run.
 */
export interface ExtractionResult {
    /** Candidate facts immediately activated (high-confidence, safety passed) */
    activatedFacts: MemoryFactInput[];
    /** Candidate facts sent to the review queue (low-confidence or sensitive) */
    reviewFacts: MemoryFactInput[];
    /** Candidate facts blocked by the safety scanner (not persisted at all) */
    blockedFacts: Array<{ content: string; reason: string }>;
    /** Episode summary produced for this turn */
    episode: MemoryEpisodeInput | null;
}

// ---------------------------------------------------------------------------
// Extractor contract
// ---------------------------------------------------------------------------

/**
 * Threshold below which a candidate fact is routed to review instead of
 * being activated immediately.
 */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Contract for a component that extracts memory items from a completed turn.
 *
 * Implementations use LLM calls or heuristics; the CoC server injects a
 * concrete instance into the post-turn executor hook.
 */
export interface IMemoryExtractor {
    /**
     * Extract facts and an optional episode summary from a completed turn.
     * MUST resolve — never throw; use an empty result on failure.
     */
    extract(context: ExtractionContext): Promise<ExtractionResult>;
}
