import {
    CLAUDE_PROVIDER,
    CODEX_PROVIDER,
    COPILOT_PROVIDER,
    OPENCODE_PROVIDER,
} from './sdk-service-registry';

export type SupportedProvider = typeof COPILOT_PROVIDER | typeof CODEX_PROVIDER | typeof CLAUDE_PROVIDER | typeof OPENCODE_PROVIDER;

export interface ProviderModelResolution {
    /** Model that is safe to send to the provider. Omitted means provider default. */
    model?: string;
    /** True when a requested model was invalid for the provider and was dropped. */
    coerced: boolean;
    /** Original non-empty requested model, when present. */
    requestedModel?: string;
}

const PROVIDER_DEFAULT_MODELS: Readonly<Record<SupportedProvider, ReadonlySet<string>>> = {
    [COPILOT_PROVIDER]: new Set(['copilot-default', 'provider-default', 'default']),
    [CODEX_PROVIDER]: new Set(['codex-default', 'provider-default', 'default']),
    [CLAUDE_PROVIDER]: new Set(['claude-provider-default', 'provider-default', 'default']),
    [OPENCODE_PROVIDER]: new Set(['opencode-default', 'provider-default', 'default']),
};

const CLAUDE_FAMILY_ALIAS_PATTERN = /^(opus|sonnet|haiku|fable)(\[[^\]]+\])?$/;

function isProviderDefault(provider: SupportedProvider, normalizedModel: string): boolean {
    return PROVIDER_DEFAULT_MODELS[provider].has(normalizedModel);
}

function isValidModelForProvider(provider: SupportedProvider, normalizedModel: string): boolean {
    if (isProviderDefault(provider, normalizedModel)) return true;
    switch (provider) {
        case CODEX_PROVIDER:
            return normalizedModel.startsWith('gpt-');
        case CLAUDE_PROVIDER:
            return normalizedModel.startsWith('claude-') || CLAUDE_FAMILY_ALIAS_PATTERN.test(normalizedModel);
        case OPENCODE_PROVIDER:
            // OpenCode accepts provider/model composite IDs (e.g. anthropic/claude-3-5-sonnet)
            // as well as bare model names. Accept anything — the server resolves.
            return true;
        case COPILOT_PROVIDER:
            return !normalizedModel.startsWith('codex-') && !normalizedModel.startsWith('claude-provider-');
    }
}

export function resolveModelForProvider(
    provider: SupportedProvider,
    requestedModel: string | undefined | null,
): ProviderModelResolution {
    const trimmed = typeof requestedModel === 'string' ? requestedModel.trim() : '';
    if (!trimmed) return { coerced: false };

    const normalized = trimmed.toLowerCase();
    if (isProviderDefault(provider, normalized)) {
        return { coerced: false, requestedModel: trimmed };
    }

    if (isValidModelForProvider(provider, normalized)) {
        return { model: trimmed, coerced: false, requestedModel: trimmed };
    }

    return { coerced: true, requestedModel: trimmed };
}
