/**
 * Admin Config Field Registry
 *
 * Source of truth for editable admin config fields. Each entry defines the flat
 * key, a validator, and an apply function.
 *
 * Boolean feature-flag fields are GENERATED from the FEATURE_FLAGS registry
 * (packages/coc-client/src/contracts/feature-flags.ts) — to add an editable
 * boolean flag, add ONE entry there and it is picked up automatically here, in
 * the runtime config handler, in the client contracts, and in the Admin UI.
 *
 * Only bespoke scalar/enum fields (model, output, scratchpad.layout,
 * defaultProvider, …) are declared explicitly below.
 *
 * To add a new editable admin config field that is NOT a simple boolean flag:
 *   1. Add the field to CLIConfig / ResolvedCLIConfig + DEFAULT_CONFIG in config.ts
 *   2. Add schema validation in config/schema.ts
 *   3. Add namespace tracking in config/namespace-registry.ts (for nested fields)
 *   4. Add ONE bespoke entry here
 *   5. Update AdminResolvedConfig / AdminConfigUpdate in coc-client/src/contracts/admin.ts
 *   6. Add UI in AdminPanel.tsx
 */

import type { AutoProviderRoutingConfig, CLIConfig, ConcreteAgentProvider, DefaultAgentProvider } from '../../config';
import { FEATURE_FLAGS, setFlagValue } from '@plusplusoneplusplus/coc-client';

/** Runtime behavior classification for admin-editable config fields. */
export type AdminConfigFieldRuntime = 'live' | 'reloadable' | 'restartRequired';

export interface AdminConfigFieldSpec {
    /** Flat key used in the PUT /api/admin/config request body, e.g. 'loops.enabled' */
    key: string;
    /** Runtime behavior: 'live' (immediate), 'reloadable', or 'restartRequired' */
    runtime: AdminConfigFieldRuntime;
    /** Return an error message string if invalid, undefined if valid */
    validate: (value: unknown) => string | undefined;
    /** Write the (already-validated) value into the CLIConfig that will be persisted */
    apply: (config: CLIConfig, value: unknown) => void;
}

// ── helpers ──────────────────────────────────────────────────────────────────

const bool = (key: string, set: (cfg: CLIConfig, v: boolean) => void, runtime: AdminConfigFieldRuntime = 'live'): AdminConfigFieldSpec => ({
    key,
    runtime,
    validate: (v) => typeof v === 'boolean' ? undefined : `${key} must be a boolean`,
    apply: (cfg, v) => set(cfg, v as boolean),
});

const VALID_OUTPUT_VALUES = ['table', 'json', 'csv', 'markdown'] as const;
const VALID_DEFAULT_PROVIDER_VALUES = ['copilot', 'codex', 'claude'] as const;
const VALID_CONCRETE_PROVIDER_VALUES = ['copilot', 'codex', 'claude'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConcreteProvider(value: unknown): value is ConcreteAgentProvider {
    return typeof value === 'string' && (VALID_CONCRETE_PROVIDER_VALUES as readonly string[]).includes(value);
}

function validatePercent(value: unknown, key: string): string | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
        ? undefined
        : `${key} must be an integer between 0 and 100`;
}

function validateAutoProviderRouting(value: unknown): string | undefined {
    if (!isObject(value)) {
        return 'agentProviderRouting.auto must be an object';
    }
    const rules = value.rules;
    if (rules !== undefined) {
        if (!Array.isArray(rules)) {
            return 'agentProviderRouting.auto.rules must be an array';
        }
        for (const [index, rule] of rules.entries()) {
            if (!isObject(rule)) {
                return `agentProviderRouting.auto.rules[${index}] must be an object`;
            }
            if (!isConcreteProvider(rule.provider)) {
                return `agentProviderRouting.auto.rules[${index}].provider must be one of: ${VALID_CONCRETE_PROVIDER_VALUES.join(', ')}`;
            }
            if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
                return `agentProviderRouting.auto.rules[${index}].enabled must be a boolean`;
            }
            if (rule.minimumRemainingPercent !== undefined) {
                const err = validatePercent(rule.minimumRemainingPercent, `agentProviderRouting.auto.rules[${index}].minimumRemainingPercent`);
                if (err) { return err; }
            }
            if (rule.weeklyGuard !== undefined) {
                if (!isObject(rule.weeklyGuard)) {
                    return `agentProviderRouting.auto.rules[${index}].weeklyGuard must be an object`;
                }
                if (rule.weeklyGuard.enabled !== undefined && typeof rule.weeklyGuard.enabled !== 'boolean') {
                    return `agentProviderRouting.auto.rules[${index}].weeklyGuard.enabled must be a boolean`;
                }
                if (rule.weeklyGuard.minimumRemainingPercent !== undefined) {
                    const err = validatePercent(rule.weeklyGuard.minimumRemainingPercent, `agentProviderRouting.auto.rules[${index}].weeklyGuard.minimumRemainingPercent`);
                    if (err) { return err; }
                }
            }
        }
    }
    if (value.fallbackProvider !== undefined && !isConcreteProvider(value.fallbackProvider)) {
        return `agentProviderRouting.auto.fallbackProvider must be one of: ${VALID_CONCRETE_PROVIDER_VALUES.join(', ')}`;
    }
    return undefined;
}

/**
 * Generate admin field specs for every editable boolean flag in the registry.
 * Each validates a boolean and writes the value into the CLIConfig at the
 * flag's path (creating intermediate objects as needed).
 */
function buildFeatureFlagFieldSpecs(): AdminConfigFieldSpec[] {
    return FEATURE_FLAGS
        .filter(flag => flag.editable)
        .map((flag): AdminConfigFieldSpec => ({
            key: flag.key,
            runtime: flag.runtime,
            validate: (v) => typeof v === 'boolean' ? undefined : `${flag.key} must be a boolean`,
            apply: (cfg, v) => setFlagValue(cfg as unknown as Record<string, unknown>, flag.path, v as boolean),
        }));
}

// ── registry ─────────────────────────────────────────────────────────────────

/**
 * All admin-editable config fields.
 * The admin handler derives editableKeys, validation, and merge entirely from this list.
 */
export const ADMIN_CONFIG_FIELDS: readonly AdminConfigFieldSpec[] = [
    // ── AI execution ──────────────────────────────────────────────────────────
    {
        key: 'model',
        runtime: 'live',
        validate: (v) => typeof v === 'string' && v.length > 0 ? undefined : 'model must be a non-empty string',
        apply: (cfg, v) => { cfg.model = v as string; },
    },
    {
        key: 'parallel',
        runtime: 'live',
        validate: (v) => typeof v === 'number' && v > 0 ? undefined : 'parallel must be a number greater than 0',
        apply: (cfg, v) => { cfg.parallel = v as number; },
    },
    {
        key: 'timeout',
        runtime: 'live',
        validate: (v) => v === null || (typeof v === 'number' && v > 0)
            ? undefined
            : 'timeout must be a number greater than 0, or null to clear',
        apply: (cfg, v) => {
            if (v === null) { delete cfg.timeout; } else { cfg.timeout = v as number; }
        },
    },
    {
        key: 'output',
        runtime: 'live',
        validate: (v) => typeof v === 'string' && (VALID_OUTPUT_VALUES as readonly string[]).includes(v)
            ? undefined
            : `output must be one of: ${VALID_OUTPUT_VALUES.join(', ')}`,
        apply: (cfg, v) => { cfg.output = v as CLIConfig['output']; },
    },

    // ── display / UI ──────────────────────────────────────────────────────────
    bool('showReportIntent', (cfg, v) => { cfg.showReportIntent = v; }),
    {
        key: 'toolCompactness',
        runtime: 'live',
        validate: (v) =>
            typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 3
                ? undefined
                : 'toolCompactness must be 0, 1, 2, or 3',
        apply: (cfg, v) => { cfg.toolCompactness = v as CLIConfig['toolCompactness']; },
    },
    {
        key: 'taskCardDensity',
        runtime: 'live',
        validate: (v) => v === 'compact' || v === 'dense'
            ? undefined
            : 'taskCardDensity must be "compact" or "dense"',
        apply: (cfg, v) => { cfg.taskCardDensity = v as CLIConfig['taskCardDensity']; },
    },
    bool('groupSingleLineMessages', (cfg, v) => { cfg.groupSingleLineMessages = v; }),

    // ── serve ─────────────────────────────────────────────────────────────────
    {
        key: 'serve.serverName',
        runtime: 'live',
        validate: (v) => v === null || v === undefined || (typeof v === 'string' && v.length <= 64)
            ? undefined
            : 'serve.serverName must be a string of at most 64 characters, or null to clear',
        apply: (cfg, v) => {
            if (v === null || v === '') {
                if (cfg.serve) { delete cfg.serve.serverName; }
            } else {
                if (!cfg.serve) { cfg.serve = {}; }
                cfg.serve.serverName = v as string;
            }
        },
    },

    // ── chat ─────────────────────────────────────────────────────────────────
    bool('chat.followUpSuggestions.enabled', (cfg, v) => {
        if (!cfg.chat) { cfg.chat = {}; }
        if (!cfg.chat.followUpSuggestions) { cfg.chat.followUpSuggestions = {}; }
        cfg.chat.followUpSuggestions.enabled = v;
    }),
    {
        key: 'chat.followUpSuggestions.count',
        runtime: 'live',
        validate: (v) =>
            typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
                ? undefined
                : 'chat.followUpSuggestions.count must be an integer between 1 and 5',
        apply: (cfg, v) => {
            if (!cfg.chat) { cfg.chat = {}; }
            if (!cfg.chat.followUpSuggestions) { cfg.chat.followUpSuggestions = {}; }
            cfg.chat.followUpSuggestions.count = v as number;
        },
    },
    bool('chat.askUser.enabled', (cfg, v) => {
        if (!cfg.chat) { cfg.chat = {}; }
        if (!cfg.chat.askUser) { cfg.chat.askUser = {}; }
        cfg.chat.askUser.enabled = v;
    }),

    // ── scratchpad layout (enum; the scratchpad.enabled toggle is a feature flag) ─
    {
        key: 'scratchpad.layout',
        runtime: 'live',
        validate: (v) => v === 'horizontal' || v === 'vertical'
            ? undefined
            : 'scratchpad.layout must be "horizontal" or "vertical"',
        apply: (cfg, v) => {
            if (!cfg.scratchpad) { cfg.scratchpad = {}; }
            cfg.scratchpad.layout = v as 'horizontal' | 'vertical';
        },
    },

    // ── ralph final-check (numeric; ralph.enabled is a feature flag) ────────────
    {
        key: 'ralph.finalCheck.maxGapFixLoops',
        runtime: 'live' as AdminConfigFieldRuntime,
        validate: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1
            ? undefined
            : 'ralph.finalCheck.maxGapFixLoops must be a positive integer (≥ 1)',
        apply: (cfg, v) => {
            if (!cfg.ralph) { cfg.ralph = {}; }
            if (!cfg.ralph.finalCheck) { cfg.ralph.finalCheck = {}; }
            cfg.ralph.finalCheck.maxGapFixLoops = v as number;
        },
    },

    // ── AI provider (enums; codex/claude/autoAgentProviderRouting are feature flags) ─
    {
        key: 'defaultProvider',
        runtime: 'restartRequired',
        validate: (v) => typeof v === 'string' && (VALID_DEFAULT_PROVIDER_VALUES as readonly string[]).includes(v)
            ? undefined
            : 'defaultProvider must be "copilot", "codex", or "claude"',
        apply: (cfg, v) => { cfg.defaultProvider = v as DefaultAgentProvider; },
    },
    {
        key: 'agentProviderRouting.auto',
        runtime: 'restartRequired',
        validate: validateAutoProviderRouting,
        apply: (cfg, v) => {
            if (!cfg.agentProviderRouting) { cfg.agentProviderRouting = {}; }
            cfg.agentProviderRouting.auto = v as AutoProviderRoutingConfig;
        },
    },

    // ── commit chat lens dormant mode (enum; commitChatLens is a feature flag) ──
    {
        key: 'features.commitChatLensDormantMode',
        runtime: 'live' as AdminConfigFieldRuntime,
        validate: (v) => (v === 'ghost' || v === 'pill') ? undefined : `features.commitChatLensDormantMode must be 'ghost' or 'pill'`,
        apply: (cfg, v) => {
            if (!cfg.features) { cfg.features = {}; }
            cfg.features.commitChatLensDormantMode = v as 'ghost' | 'pill';
        },
    },

    // ── boolean feature flags (generated from FEATURE_FLAGS registry) ───────────
    ...buildFeatureFlagFieldSpecs(),
];

/** Flat keys accepted by PUT /api/admin/config — derived from the registry. */
export const ADMIN_EDITABLE_KEYS: readonly string[] = ADMIN_CONFIG_FIELDS.map(f => f.key);

/** Build a key→metadata map for API responses. */
export function getAdminFieldMetadata(): Record<string, { runtime: AdminConfigFieldRuntime }> {
    const meta: Record<string, { runtime: AdminConfigFieldRuntime }> = {};
    for (const field of ADMIN_CONFIG_FIELDS) {
        meta[field.key] = { runtime: field.runtime };
    }
    return meta;
}
