/**
 * Memory Capture Service (AC-04)
 *
 * Orchestrates explicit and automatic memory capture, including:
 * - Explicit writes from user/AI intent (activate immediately after safety scan)
 * - Automatic post-turn/session extraction (async, never blocks user response)
 * - Confidence-gated routing: high-confidence → active; low-confidence or
 *   sensitive-looking → review queue
 * - Interrupted/cancelled/failed turn guard (never extract from partial turns)
 * - Review queue management: approve, reject, edit-and-approve
 *
 * Key constraints enforced:
 * - Secrets and raw credentials are never persisted.
 * - Extraction MUST NOT run on interrupted, cancelled, partial, or failed turns.
 * - Explicit writes become active immediately after safety scanning.
 * - High-confidence extracted facts become active after safety validation.
 * - Low-confidence or sensitive-looking extracted facts go to review.
 */

import { randomUUID } from 'crypto';
import type { ExtractionContext, ExtractionResult, IMemoryExtractor } from './extraction-contract';
import { DEFAULT_CONFIDENCE_THRESHOLD } from './extraction-contract';
import { redactSensitiveValues, scanMemoryContent } from './safety-scanner';
import type { IMemoryEpisodeStore, IMemoryFactStore } from './store-interface';
import type { MemoryEpisode, MemoryFact, MemoryFactInput, MemoryProvenance, MemoryScope } from './types';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for an explicit, user- or AI-initiated memory write */
export interface CaptureExplicitInput {
    /** The content to store as a fact */
    content: string;
    /** Memory scope: 'global' or 'workspace' */
    scope: MemoryScope;
    /** Required when scope === 'workspace' */
    workspaceId?: string;
    /** Importance weight in [0, 1]; defaults to 0.5 */
    importance?: number;
    /** Free-form tags */
    tags?: string[];
    /** Provenance metadata */
    provenance: MemoryProvenance;
    /** Source process ID, when known */
    sourceProcessId?: string;
    /** Zero-based turn index within the source process */
    sourceTurnIndex?: number;
    /** Ralph iteration number, when applicable */
    sourceRalphIteration?: number;
}

/** Summary of an auto-extraction run */
export interface CaptureFromTurnResult {
    /** IDs of facts that were immediately activated */
    activatedFactIds: string[];
    /** IDs of facts routed to the review queue */
    reviewFactIds: string[];
    /** Candidate fact contents that were blocked by the safety scanner */
    blockedFacts: Array<{ content: string; reason: string }>;
    /** ID of the episode created for this turn; null if no episode was produced */
    episodeId: string | null;
}

// ---------------------------------------------------------------------------
// MemoryCaptureService
// ---------------------------------------------------------------------------

/**
 * Service that handles all memory capture paths: explicit writes, auto-
 * extraction from completed turns, and review queue management.
 *
 * The caller is responsible for injecting the correct store instances (global
 * or workspace-scoped stores depending on the workspace configuration).
 */
export class MemoryCaptureService {
    constructor(
        private readonly factStore: IMemoryFactStore,
        private readonly episodeStore: IMemoryEpisodeStore,
        private readonly confidenceThreshold: number = DEFAULT_CONFIDENCE_THRESHOLD,
    ) {}

    // -----------------------------------------------------------------------
    // Explicit writes
    // -----------------------------------------------------------------------

    /**
     * Capture an explicitly authored fact (user or AI intent).
     *
     * The fact is activated immediately after safety scanning.
     * Returns null when the safety scanner blocks the content.
     */
    async captureExplicit(input: CaptureExplicitInput): Promise<MemoryFact | null> {
        const scanResult = scanMemoryContent(input.content);
        if (scanResult.blocked) {
            return null;
        }

        const factInput: MemoryFactInput = {
            scope: input.scope,
            workspaceId: input.workspaceId,
            content: input.content,
            importance: input.importance ?? 0.5,
            confidence: 1.0,
            status: 'active',
            tags: input.tags ?? [],
            source: 'explicit',
            sourceProcessId: input.sourceProcessId,
            sourceTurnIndex: input.sourceTurnIndex,
            sourceRalphIteration: input.sourceRalphIteration,
        };

        return this.factStore.addFact(factInput);
    }

    // -----------------------------------------------------------------------
    // Auto-extraction from completed turns
    // -----------------------------------------------------------------------

    /**
     * Extract and persist memory from a completed turn.
     *
     * MUST be called only for turns that completed successfully without
     * interruption. Pass `didComplete = false` to skip extraction entirely
     * (e.g., for cancelled, interrupted, or failed turns).
     *
     * Extraction is designed to run asynchronously after the user response
     * is delivered; the caller must not `await` this inside the critical path.
     */
    async captureFromTurn(
        context: ExtractionContext,
        extractor: IMemoryExtractor,
        didComplete: boolean,
    ): Promise<CaptureFromTurnResult> {
        if (!didComplete) {
            return {
                activatedFactIds: [],
                reviewFactIds: [],
                blockedFacts: [],
                episodeId: null,
            };
        }

        let extractionResult: ExtractionResult;
        try {
            extractionResult = await extractor.extract(context);
        } catch {
            // Extraction must never throw; defensive catch to protect the turn pipeline.
            return {
                activatedFactIds: [],
                reviewFactIds: [],
                blockedFacts: [],
                episodeId: null,
            };
        }

        const activatedFactIds: string[] = [];
        const reviewFactIds: string[] = [];
        const blockedFacts: Array<{ content: string; reason: string }> = [
            ...extractionResult.blockedFacts,
        ];

        // Process facts that the extractor already gated as high-confidence / active
        for (const factInput of extractionResult.activatedFacts) {
            const persisted = await this._persistExtractedFact(
                factInput,
                'active',
                activatedFactIds,
                reviewFactIds,
                blockedFacts,
            );
            void persisted;
        }

        // Process facts that the extractor gated as needing review
        for (const factInput of extractionResult.reviewFacts) {
            const persisted = await this._persistExtractedFact(
                factInput,
                'review',
                activatedFactIds,
                reviewFactIds,
                blockedFacts,
            );
            void persisted;
        }

        // Persist episode if produced
        let episodeId: string | null = null;
        if (extractionResult.episode) {
            const episode = await this.episodeStore.addEpisode(extractionResult.episode);
            episodeId = episode.id;
        }

        return { activatedFactIds, reviewFactIds, blockedFacts, episodeId };
    }

    // -----------------------------------------------------------------------
    // Review queue management
    // -----------------------------------------------------------------------

    /**
     * Approve a review-queue fact, promoting it to 'active'.
     * Returns the updated fact, or null when not found or not in review status.
     */
    async approveReviewFact(factId: string): Promise<MemoryFact | null> {
        const fact = await this.factStore.getFact(factId);
        if (!fact || fact.status !== 'review') {
            return null;
        }
        return this.factStore.updateFact(factId, { status: 'active' });
    }

    /**
     * Reject a review-queue fact, marking it 'rejected' (never recalled).
     * Returns the updated fact, or null when not found or not in review status.
     */
    async rejectReviewFact(factId: string): Promise<MemoryFact | null> {
        const fact = await this.factStore.getFact(factId);
        if (!fact || fact.status !== 'review') {
            return null;
        }
        return this.factStore.updateFact(factId, { status: 'rejected' });
    }

    /**
     * Edit the content of a review-queue fact and approve it.
     * The edited content is re-scanned before activation.
     * Returns the updated fact, or null if not found, not in review, or blocked.
     */
    async editAndApproveReviewFact(factId: string, newContent: string): Promise<MemoryFact | null> {
        const fact = await this.factStore.getFact(factId);
        if (!fact || fact.status !== 'review') {
            return null;
        }

        const scanResult = scanMemoryContent(newContent);
        if (scanResult.blocked) {
            return null;
        }

        return this.factStore.updateFact(factId, { content: newContent, status: 'active' });
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /**
     * Safety-scan and persist a single extracted fact.
     *
     * Order of operations:
     * 1. Try to redact sensitive values from the raw content.
     * 2. Scan the (possibly redacted) content for remaining threats.
     * 3. If still blocked → add to blockedFacts and return.
     * 4. If redaction changed the content → route to review (human must verify).
     * 5. Otherwise → persist with the caller's intended targetStatus.
     */
    private async _persistExtractedFact(
        factInput: MemoryFactInput,
        targetStatus: 'active' | 'review',
        activatedFactIds: string[],
        reviewFactIds: string[],
        blockedFacts: Array<{ content: string; reason: string }>,
    ): Promise<void> {
        // Step 1: attempt redaction before security scanning so that
        // credential-bearing content can be salvaged into review.
        const { redacted, changed } = redactSensitiveValues(factInput.content);
        const contentToStore = changed ? redacted : factInput.content;

        // Step 2: scan the (possibly redacted) content.
        const scanResult = scanMemoryContent(contentToStore);
        if (scanResult.blocked) {
            // Even after redaction the content is dangerous — block entirely.
            blockedFacts.push({ content: factInput.content, reason: scanResult.reason! });
            return;
        }

        // Step 3: if redaction modified the content, route to review so a
        // human can verify that the redaction is correct and the fact is safe.
        const finalStatus: 'active' | 'review' = changed ? 'review' : targetStatus;

        const toStore: MemoryFactInput = {
            ...factInput,
            content: contentToStore,
            status: finalStatus,
        };

        const fact = await this.factStore.addFact(toStore);

        if (finalStatus === 'active') {
            activatedFactIds.push(fact.id);
        } else {
            reviewFactIds.push(fact.id);
        }
    }
}

// ---------------------------------------------------------------------------
// Guard helper
// ---------------------------------------------------------------------------

/**
 * Returns true when a turn qualifies for auto-extraction.
 *
 * Callers should pass the canonical status string from their turn/process
 * tracking system.  The strings 'completed' and 'success' are considered
 * eligible; anything else (interrupted, cancelled, failed, partial, etc.)
 * is ineligible.
 */
export function isTurnEligibleForExtraction(turnStatus: string): boolean {
    return turnStatus === 'completed' || turnStatus === 'success';
}

// ---------------------------------------------------------------------------
// Noop extractor (useful for testing explicit writes in isolation)
// ---------------------------------------------------------------------------

/** An extractor that always returns an empty extraction result. */
export const noopExtractor: IMemoryExtractor = {
    async extract(_ctx: ExtractionContext): Promise<ExtractionResult> {
        return { activatedFacts: [], reviewFacts: [], blockedFacts: [], episode: null };
    },
};

// ---------------------------------------------------------------------------
// Stub extractor factory (for unit tests / injection)
// ---------------------------------------------------------------------------

/**
 * Create an IMemoryExtractor from a simple function.
 * Useful in tests and lightweight integrations where a full LLM call is
 * not required.
 */
export function createFnExtractor(
    fn: (ctx: ExtractionContext) => Promise<ExtractionResult>,
): IMemoryExtractor {
    return { extract: fn };
}
