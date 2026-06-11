/**
 * ModelInfo types mirrored from the Copilot SDK's types.ts.
 *
 * Defined here so the rest of pipeline-core can reference them without a
 * direct dependency on the SDK package.
 */

/**
 * Long-context tier pricing metadata. Presence of a positive `contextMax`
 * is the support signal for the Copilot `contextTier: "long_context"`
 * session option.
 */
export interface ModelBillingTokenPricesLongContext {
    /** Maximum prompt/context tokens available on the long-context tier. */
    contextMax?: number;
}

/** Tiered token pricing metadata attached to a model's billing info. */
export interface ModelBillingTokenPrices {
    longContext?: ModelBillingTokenPricesLongContext;
}

export interface ModelBilling {
    multiplier?: number;
    /**
     * Tiered pricing metadata (SDK/public camelCase shape). The runtime's
     * internal snake_case shape (`token_prices.long_context.context_max`) is
     * normalized in `model-context-tier.ts` rather than typed here.
     */
    tokenPrices?: ModelBillingTokenPrices;
}

export interface ModelPolicy {
    state: 'enabled' | 'disabled' | string;
}

export interface ModelInfo {
    id: string;
    name: string;
    capabilities: {
        family?: string;
        supports: {
            vision: boolean;
            reasoningEffort: boolean;
            reasoning_effort?: string[];
        };
        limits: {
            max_context_window_tokens: number;
            max_prompt_tokens?: number;
        };
    };
    policy?: ModelPolicy;
    billing?: ModelBilling;
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
}
