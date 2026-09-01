/**
 * Central AI Model Registry
 *
 * Single source of truth for all AI model definitions used across the codebase.
 * When adding, updating, or removing a model, only this file needs to change
 *
 * Design:
 * - `MODEL_REGISTRY` is the authoritative list of supported models.
 * - `VALID_MODELS` and `AIModel` are derived from the registry.
 * - Helper functions provide display labels, descriptions, and lookups.
 * - The first model in the registry is considered the default/recommended model.
 * - `fetchModelsFromClient` handles live model listing via the SDK client.
 */

import { ModelInfo } from './model-info';

// ============================================================================
// Model Definition Interface
// ============================================================================

export interface ModelDefinition {
    /** Unique model identifier sent to the API (e.g., 'claude-sonnet-4.6') */
    readonly id: string;
    /** Human-readable display label (e.g., 'Claude Sonnet 4.5') */
    readonly label: string;
    /** Short description for UI display (e.g., '(Recommended)') */
    readonly description: string;
    /** Performance/cost tier */
    readonly tier: 'fast' | 'standard' | 'premium';
    /** Whether the model is deprecated but kept for backward compatibility */
    readonly deprecated?: boolean;
    /** Known context window size in tokens (used as fallback before session.usage_info arrives) */
    readonly contextWindow?: number;
}

// ============================================================================
// Model Registry (Source of Truth)
// ============================================================================

/**
 * The authoritative list of all supported AI models.
 * Order matters: the first entry is the default/recommended model.
 *
 * To add a new model:
 * 1. Add an entry here
 * 2. All types, helpers, and tests will automatically pick it up
 */
const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
    {
        id: 'claude-sonnet-4.6',
        label: 'Claude Sonnet 4.6',
        description: '(Recommended)',
        tier: 'standard',
        contextWindow: 200_000,
    },
    {
        id: 'claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        description: '(Fast)',
        tier: 'fast',
        contextWindow: 200_000,
    },
    {
        id: 'claude-opus-4.6',
        label: 'Claude Opus 4.6',
        description: '(Premium)',
        tier: 'premium',
        contextWindow: 200_000,
    },
    {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: '',
        tier: 'standard',
        // Sourced from Codex's own model catalog (~/.codex/models_cache.json,
        // context_window field) — the whole GPT-5.x Codex family reports 272k.
        contextWindow: 272_000,
    },
    {
        id: 'gpt-5.3-codex',
        label: 'GPT-5.3 Codex',
        description: '',
        tier: 'premium',
        // Same GPT-5.x Codex family context window as gpt-5.4 (272k). See the
        // Codex model catalog note above.
        contextWindow: 272_000,
    },
    {
        id: 'gemini-3-pro-preview',
        label: 'Gemini 3 Pro',
        description: '(Preview)',
        tier: 'standard',
        contextWindow: 128_000,
    },
] as const;

export const MODEL_REGISTRY: ReadonlyMap<string, ModelDefinition> = new Map(
    MODEL_DEFINITIONS.map(m => [m.id, m])
);

// ============================================================================
// Derived Constants (used across the codebase)
// ============================================================================

/** All valid model IDs as a tuple, derived from MODEL_DEFINITIONS. */
export const VALID_MODELS = MODEL_DEFINITIONS.map(m => m.id) as unknown as readonly [
    'claude-sonnet-4.6',
    'claude-haiku-4.5',
    'claude-opus-4.6',
    'gpt-5.4',
    'gpt-5.3-codex',
    'gemini-3-pro-preview',
];

export type AIModel = typeof VALID_MODELS[number];

export const DEFAULT_MODEL_ID: AIModel = MODEL_DEFINITIONS[0].id as AIModel;

// ============================================================================
// Helper Functions
// ============================================================================

/** The display label for a model ID, or the raw ID when unknown. */
export function getModelLabel(modelId: string): string {
    return MODEL_REGISTRY.get(modelId)?.label ?? modelId;
}

/** The description for a model ID, or an empty string when unknown. */
export function getModelDescription(modelId: string): string {
    return MODEL_REGISTRY.get(modelId)?.description ?? '';
}

export function getModelDefinition(modelId: string): ModelDefinition | undefined {
    return MODEL_REGISTRY.get(modelId);
}

/**
 * Get all model definitions (ordered).
 */
export function getAllModels(): readonly ModelDefinition[] {
    return MODEL_DEFINITIONS;
}

/**
 * Get all active (non-deprecated) model definitions.
 */
export function getActiveModels(): readonly ModelDefinition[] {
    return MODEL_DEFINITIONS.filter(m => !m.deprecated);
}

export function isValidModelId(id: string): id is AIModel {
    return MODEL_REGISTRY.has(id);
}

export function getModelCount(): number {
    return MODEL_DEFINITIONS.length;
}

export function getModelsByTier(tier: ModelDefinition['tier']): readonly ModelDefinition[] {
    return MODEL_DEFINITIONS.filter(m => m.tier === tier);
}

/**
 * Get the known context window size for a model.
 * Returns the static value from the registry, or `undefined` if not known.
 * Use as a fallback when `session.usage_info` has not been received yet.
 */
export function getModelContextWindow(modelId: string): number | undefined {
    return MODEL_REGISTRY.get(modelId)?.contextWindow;
}

// ============================================================================
// Live Model Listing (SDK Client Integration)
// ============================================================================

/**
 * Minimal interface for an SDK client that supports model listing.
 * Defined here so `model-registry` has no dependency on `CopilotSDKService`.
 */
export interface IModelListClient {
    start(): Promise<void>;
    stop(): Promise<Error[] | void>;
    listModels(): Promise<ModelInfo[]>;
}

/**
 * Fetch the list of models available to the authenticated user via the Copilot API.
 *
 * Accepts a pre-constructed (but not yet started) SDK client, starts it,
 * calls `listModels()`, and stops the client in a `finally` block.
 *
 * @param client - A fresh, not-yet-started client instance.
 */
export async function fetchModelsFromClient(client: IModelListClient): Promise<ModelInfo[]> {
    // Pre-emptively suppress EPIPE re-throws from the SDK's connectViaStdio() stdin
    // error handler. When the CLI exits unexpectedly (e.g., in test environments
    // where the host process.execPath is used to spawn the CLI, causing argument
    // parsing failures), writing to its stdin raises EPIPE. The SDK re-throws that
    // error inside the stdin 'error' listener unless forceStopping is true, which
    // makes it an uncaughtException that bypasses normal promise-rejection handling.
    // Setting forceStopping=true here prevents the re-throw; write failures still
    // propagate as rejected Promises and are absorbed by StreamErrorGuard.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).forceStopping = true;
    try {
        await client.start();
        return await client.listModels();
    } finally {
        client.stop().catch(() => {});
    }
}
