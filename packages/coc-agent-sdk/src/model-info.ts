/**
 * ModelInfo types mirrored from the Copilot SDK's types.ts.
 *
 * Defined here so the rest of pipeline-core can reference them without a
 * direct dependency on the SDK package.
 */

export interface ModelBilling {
    multiplier?: number;
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
