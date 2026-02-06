/**
 * Central AI Model Registry
 *
 * Single source of truth for all AI model definitions used across the codebase.
 * When adding, updating, or removing a model, only this file needs to change
 * (plus `package.json` enum for VS Code settings UI).
 *
 * Design:
 * - `MODEL_REGISTRY` is the authoritative list of supported models.
 * - `VALID_MODELS` and `AIModel` are derived from the registry.
 * - Helper functions provide display labels, descriptions, and lookups.
 * - The first model in the registry is considered the default/recommended model.
 */

// ============================================================================
// Model Definition Interface
// ============================================================================

/**
 * Complete definition of an AI model.
 */
export interface ModelDefinition {
    /** Unique model identifier sent to the API (e.g., 'claude-sonnet-4.5') */
    readonly id: string;
    /** Human-readable display label (e.g., 'Claude Sonnet 4.5') */
    readonly label: string;
    /** Short description for UI display (e.g., '(Recommended)') */
    readonly description: string;
    /** Performance/cost tier */
    readonly tier: 'fast' | 'standard' | 'premium';
    /** Whether the model is deprecated but kept for backward compatibility */
    readonly deprecated?: boolean;
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
 * 2. Update the `package.json` enum (for VS Code settings UI)
 * 3. All types, helpers, and tests will automatically pick it up
 */
const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
    {
        id: 'claude-sonnet-4.5',
        label: 'Claude Sonnet 4.5',
        description: '(Recommended)',
        tier: 'standard',
    },
    {
        id: 'claude-haiku-4.5',
        label: 'Claude Haiku 4.5',
        description: '(Fast)',
        tier: 'fast',
    },
    {
        id: 'claude-opus-4.6',
        label: 'Claude Opus 4.6',
        description: '(Premium)',
        tier: 'premium',
    },
    {
        id: 'gpt-5.2',
        label: 'GPT-5.2',
        description: '',
        tier: 'standard',
    },
    {
        id: 'gpt-5.1-codex-max',
        label: 'GPT-5.1 Codex Max',
        description: '',
        tier: 'premium',
    },
    {
        id: 'gemini-3-pro-preview',
        label: 'Gemini 3 Pro',
        description: '(Preview)',
        tier: 'standard',
    },
] as const;

/**
 * The model registry indexed by model ID for fast lookups.
 */
export const MODEL_REGISTRY: ReadonlyMap<string, ModelDefinition> = new Map(
    MODEL_DEFINITIONS.map(m => [m.id, m])
);

// ============================================================================
// Derived Constants (used across the codebase)
// ============================================================================

/**
 * All valid model IDs as a tuple. Derived from MODEL_REGISTRY.
 * This replaces the previously hand-maintained VALID_MODELS array.
 */
export const VALID_MODELS = MODEL_DEFINITIONS.map(m => m.id) as unknown as readonly [
    'claude-sonnet-4.5',
    'claude-haiku-4.5',
    'claude-opus-4.6',
    'gpt-5.2',
    'gpt-5.1-codex-max',
    'gemini-3-pro-preview',
];

/**
 * Union type of all valid model IDs.
 */
export type AIModel = typeof VALID_MODELS[number];

/**
 * The default/recommended model ID (first entry in registry).
 */
export const DEFAULT_MODEL_ID: AIModel = MODEL_DEFINITIONS[0].id as AIModel;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the display label for a model ID.
 * @returns The label, or the raw ID if not found in registry
 */
export function getModelLabel(modelId: string): string {
    return MODEL_REGISTRY.get(modelId)?.label ?? modelId;
}

/**
 * Get the description for a model ID.
 * @returns The description, or empty string if not found
 */
export function getModelDescription(modelId: string): string {
    return MODEL_REGISTRY.get(modelId)?.description ?? '';
}

/**
 * Get the full model definition for a model ID.
 * @returns The definition, or undefined if not found
 */
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

/**
 * Check if a string is a valid model ID.
 */
export function isValidModelId(id: string): id is AIModel {
    return MODEL_REGISTRY.has(id);
}

/**
 * Get model count.
 */
export function getModelCount(): number {
    return MODEL_DEFINITIONS.length;
}

/**
 * Get models filtered by tier.
 */
export function getModelsByTier(tier: ModelDefinition['tier']): readonly ModelDefinition[] {
    return MODEL_DEFINITIONS.filter(m => m.tier === tier);
}
