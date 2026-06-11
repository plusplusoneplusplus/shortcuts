/**
 * Copilot context-tier resolution.
 *
 * The Copilot runtime supports a per-session/per-model-switch
 * `contextTier: "long_context"` selection for models with tiered context
 * windows. Support is advertised only through tiered billing metadata:
 *
 * - SDK/public shape:       `model.billing.tokenPrices.longContext.contextMax`
 * - Runtime/internal shape: `model.billing.token_prices.long_context.context_max`
 *
 * Passing `long_context` for a model without this metadata can leave the
 * session on normal limits while reporting a long-context selection, so the
 * tier must only be derived from the metadata — never from model-name lists
 * or `max_context_window_tokens` alone.
 */

import type { ModelInfo } from './model-info';

/** Copilot context-window tier selection. */
export type CopilotContextTier = 'default' | 'long_context';

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined;
}

/**
 * Long-context prompt/context token limit advertised by the model's tiered
 * billing metadata, or `undefined` when the model does not advertise a
 * long-context tier. Accepts both the SDK camelCase and runtime snake_case
 * metadata shapes.
 */
export function getCopilotLongContextPromptLimit(model: ModelInfo | undefined): number | undefined {
    const billing = asRecord(model?.billing);
    const tokenPrices = asRecord(billing?.tokenPrices) ?? asRecord(billing?.token_prices);
    const longContext = asRecord(tokenPrices?.longContext) ?? asRecord(tokenPrices?.long_context);
    const contextMax = longContext?.contextMax ?? longContext?.context_max;
    return typeof contextMax === 'number' && Number.isFinite(contextMax) && contextMax > 0
        ? contextMax
        : undefined;
}

/**
 * Context tier to request for a Copilot model: `"long_context"` when the
 * model advertises long-context tier metadata, `undefined` otherwise (the
 * `contextTier` option must then be omitted entirely).
 */
export function getCopilotContextTierForModel(model: ModelInfo | undefined): CopilotContextTier | undefined {
    return getCopilotLongContextPromptLimit(model) === undefined
        ? undefined
        : 'long_context';
}
