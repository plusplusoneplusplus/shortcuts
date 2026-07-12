/**
 * Hardcoded default effort-tier mappings per provider.
 *
 * Each provider exposes four tiers — `very-low`, `low`, `medium`, `high` —
 * each pinned to a default model and reasoning-effort. These defaults are
 * surfaced by the admin GET endpoint so the UI is always pre-populated and
 * chat resolution never sees an empty tier map.
 *
 * Stored config wins per-tier: defaults only fill in tiers the user has not
 * explicitly configured. Defaults are intentionally NOT baked into stored
 * config on save (see PUT route), so future default changes flow through
 * automatically and unknown default models do not block save validation.
 *
 * `reasoningEffort: null` means "Auto" / no preference (the SDK chooses).
 */

export type EffortTierKey = 'very-low' | 'low' | 'medium' | 'high';

export interface EffortTierDefaultEntry {
    model: string;
    reasoningEffort: string | null;
}

export type EffortTierDefaultsMap = Record<EffortTierKey, EffortTierDefaultEntry>;

/** Known provider IDs that ship hardcoded defaults. */
export type DefaultedProvider = 'copilot' | 'codex' | 'claude' | 'opencode';

const COPILOT_DEFAULTS: EffortTierDefaultsMap = {
    'very-low': { model: 'gpt-5.6-luna',      reasoningEffort: 'xhigh' },
    low:    { model: 'gpt-5.6-terra',     reasoningEffort: 'xhigh' },
    medium: { model: 'claude-opus-4.8',   reasoningEffort: 'xhigh' },
    high:   { model: 'gpt-5.6-sol',       reasoningEffort: 'xhigh' },
};

const CODEX_DEFAULTS: EffortTierDefaultsMap = {
    'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low'   },
    low:    { model: 'gpt-5.4-mini',  reasoningEffort: 'xhigh' },
    medium: { model: 'gpt-5.5',       reasoningEffort: 'high'  },
    high:   { model: 'gpt-5.5',       reasoningEffort: 'xhigh' },
};

// Claude tier models use the Claude CLI catalog aliases ('opus', 'sonnet',
// 'haiku') — the ids the CLI's initialize response advertises and accepts as
// `--model` values. Haiku advertises no effort levels, so its tier pins no
// reasoning effort.
const CLAUDE_DEFAULTS: EffortTierDefaultsMap = {
    'very-low': { model: 'haiku',  reasoningEffort: null     },
    low:    { model: 'sonnet', reasoningEffort: 'high'   },
    medium: { model: 'opus',   reasoningEffort: 'medium' },
    high:   { model: 'opus',   reasoningEffort: 'xhigh'  },
};

// OpenCode uses provider/model composite IDs. These defaults use well-known
// model references; the opencode server resolves the provider prefix.
const OPENCODE_DEFAULTS: EffortTierDefaultsMap = {
    'very-low': { model: 'anthropic/claude-haiku',    reasoningEffort: null    },
    low:    { model: 'anthropic/claude-sonnet',   reasoningEffort: null    },
    medium: { model: 'anthropic/claude-sonnet',   reasoningEffort: 'high'  },
    high:   { model: 'anthropic/claude-opus',     reasoningEffort: null    },
};

const PROVIDER_DEFAULTS: Record<DefaultedProvider, EffortTierDefaultsMap> = {
    copilot: COPILOT_DEFAULTS,
    codex:   CODEX_DEFAULTS,
    claude:  CLAUDE_DEFAULTS,
    opencode: OPENCODE_DEFAULTS,
};

/**
 * Returns the hardcoded default tier map for a provider. Returns `null` for
 * unknown providers so callers can fall back to an empty map without surfacing
 * defaults from another provider.
 */
export function getDefaultEffortTiers(provider: string): EffortTierDefaultsMap | null {
    if (provider in PROVIDER_DEFAULTS) {
        const map = PROVIDER_DEFAULTS[provider as DefaultedProvider];
        // Return a shallow clone so callers cannot mutate the module-level constants.
        return {
            'very-low': { ...map['very-low'] },
            low:    { ...map.low },
            medium: { ...map.medium },
            high:   { ...map.high },
        };
    }
    return null;
}

export type EffortTierSource = 'config' | 'default';

export interface MergedEffortTierEntry {
    model: string;
    reasoningEffort: string | null;
    source: EffortTierSource;
}

export type MergedEffortTiersMap = Partial<Record<EffortTierKey, MergedEffortTierEntry>>;

export interface StoredEffortTierEntry {
    model: string;
    reasoningEffort?: string | null;
}

export type StoredEffortTiersMap = Partial<Record<EffortTierKey, StoredEffortTierEntry>>;

/**
 * Merges stored config with provider defaults. Stored entries win per-tier;
 * any tier missing from stored config falls back to the provider default and
 * is marked `source: 'default'`. Unknown providers receive no defaults — only
 * stored entries appear in the result.
 */
export function mergeEffortTiersWithDefaults(
    provider: string,
    stored: StoredEffortTiersMap | undefined | null,
): MergedEffortTiersMap {
    const defaults = getDefaultEffortTiers(provider);
    const result: MergedEffortTiersMap = {};
    const tiers: EffortTierKey[] = ['very-low', 'low', 'medium', 'high'];

    for (const tier of tiers) {
        const storedEntry = stored?.[tier];
        if (storedEntry && typeof storedEntry.model === 'string' && storedEntry.model.length > 0) {
            result[tier] = {
                model: storedEntry.model,
                reasoningEffort: storedEntry.reasoningEffort ?? null,
                source: 'config',
            };
            continue;
        }
        const defaultEntry = defaults?.[tier];
        if (defaultEntry) {
            result[tier] = {
                model: defaultEntry.model,
                reasoningEffort: defaultEntry.reasoningEffort,
                source: 'default',
            };
        }
    }
    return result;
}
