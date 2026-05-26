/**
 * Embedding Provider Interface
 *
 * Pluggable abstraction for text-embedding generation.
 * No hard-coded vendor default — the BM25 fallback works without any provider.
 *
 * Implementations (e.g. OpenAI, Ollama, local ONNX) are registered in the
 * CoC server layer; this package only defines the contract.
 */

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

/** A dense vector produced by an embedding model */
export interface EmbeddingVector {
    /** Raw floating-point values */
    values: Float32Array | number[];
    /** Dimensionality — must equal EmbeddingProvider.dimensions */
    dimensions: number;
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * Embedding provider interface.
 *
 * Implementors MUST:
 * - Return embeddings normalised to unit length (cosine similarity ready).
 * - Throw (or resolve with a rejected Promise) when embedding fails — callers
 *   catch the error and fall back to BM25-only ranking.
 * - Report availability accurately via `isAvailable()` before embedding calls.
 */
export interface EmbeddingProvider {
    /** Stable identifier for this provider (e.g. "openai-text-embedding-3-small") */
    readonly name: string;
    /** Fixed output dimensionality for this provider/model */
    readonly dimensions: number;

    /**
     * Return true when the provider is configured and reachable.
     * This check MUST be fast (no network call; use a cached readiness flag).
     */
    isAvailable(): Promise<boolean>;

    /**
     * Embed one or more texts.
     * - Single string → single EmbeddingVector
     * - Array → array of EmbeddingVector (same order)
     */
    embed(text: string): Promise<EmbeddingVector>;
    embed(texts: string[]): Promise<EmbeddingVector[]>;
    embed(textOrTexts: string | string[]): Promise<EmbeddingVector | EmbeddingVector[]>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Simple registry for embedding providers.
 * The CoC server registers providers at startup; `packages/coc-memory` uses
 * the active provider (if any) during search and indexing.
 */
export class EmbeddingProviderRegistry {
    private providers = new Map<string, EmbeddingProvider>();
    private activeName: string | null = null;

    /** Register a provider. Registration does not activate it. */
    register(provider: EmbeddingProvider): void {
        this.providers.set(provider.name, provider);
    }

    /** Activate a registered provider by name. */
    setActive(name: string): void {
        if (!this.providers.has(name)) {
            throw new Error(`EmbeddingProvider not registered: ${name}`);
        }
        this.activeName = name;
    }

    /** Return the active provider, or null when none is configured. */
    getActive(): EmbeddingProvider | null {
        if (!this.activeName) return null;
        return this.providers.get(this.activeName) ?? null;
    }

    /** Return a registered provider by name, or null if not found. */
    get(name: string): EmbeddingProvider | null {
        return this.providers.get(name) ?? null;
    }

    /** List all registered provider names. */
    list(): string[] {
        return [...this.providers.keys()];
    }

    /** Deactivate the current provider without removing it. */
    clearActive(): void {
        this.activeName = null;
    }
}
