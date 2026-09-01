/**
 * Owns per-wiki generation state and the start/cancel/finish transitions.
 * State lives on an instance rather than a module-level Map, so a server can
 * hold its own registry and tests can run in parallel without cross-talk.
 *
 * Cancellation is exposed as a token (`GenerationHandle.isCancelled`) rather
 * than a raw mutable flag shared with callers.
 */

// ============================================================================
// Types
// ============================================================================

export interface GenerationState {
    running: boolean;
    currentPhase: number;
    cancelled: boolean;
    startTime: number;
}

/** Live handle for one in-flight generation. */
export interface GenerationHandle {
    readonly wikiId: string;
    /** True once someone cancelled this run. Checked before each phase. */
    isCancelled(): boolean;
    /** Record which phase is executing (surfaced by the status endpoint). */
    setPhase(phase: number): void;
    /** Release the wiki so a new generation can start. Idempotent. */
    finish(): void;
}

// ============================================================================
// Registry
// ============================================================================

export class WikiGenerationRegistry {
    private readonly states = new Map<string, GenerationState>();

    /** Current state for a wiki, or null when nothing is registered. */
    get(wikiId: string): GenerationState | null {
        return this.states.get(wikiId) ?? null;
    }

    /** True when a generation is in flight for this wiki. */
    isRunning(wikiId: string): boolean {
        return this.states.get(wikiId)?.running ?? false;
    }

    /**
     * Claim the wiki for a new generation.
     * Returns null when one is already running — callers reject with 409.
     */
    start(wikiId: string, startPhase: number, startTime: number = Date.now()): GenerationHandle | null {
        if (this.isRunning(wikiId)) {
            return null;
        }

        const state: GenerationState = {
            running: true,
            currentPhase: startPhase,
            cancelled: false,
            startTime,
        };
        this.states.set(wikiId, state);

        return {
            wikiId,
            isCancelled: () => state.cancelled,
            setPhase: (phase: number) => { state.currentPhase = phase; },
            finish: () => {
                state.running = false;
                // Only drop the entry if this run still owns it.
                if (this.states.get(wikiId) === state) {
                    this.states.delete(wikiId);
                }
            },
        };
    }

    /** Request cancellation. Returns false when nothing is running. */
    cancel(wikiId: string): boolean {
        const state = this.states.get(wikiId);
        if (!state?.running) {
            return false;
        }
        state.cancelled = true;
        return true;
    }

    /** Forget one wiki's state. */
    reset(wikiId: string): void {
        this.states.delete(wikiId);
    }

    /** Forget every wiki's state. */
    resetAll(): void {
        this.states.clear();
    }

    /** Cancel everything in flight and clear state — server shutdown hook. */
    dispose(): void {
        for (const state of this.states.values()) {
            state.cancelled = true;
            state.running = false;
        }
        this.states.clear();
    }
}

/**
 * Registry used when a caller does not inject one.
 * The standalone deep-wiki server and the legacy handler exports share it.
 */
export const defaultGenerationRegistry = new WikiGenerationRegistry();
