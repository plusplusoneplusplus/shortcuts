import type { AutoProviderRoutingConfig, CLIConfig, ConfigFieldSource, ResolvedCLIConfig } from '../config';
import {
    ADMIN_SETTING_DEFINITIONS,
    NAMESPACED_ADMIN_SETTING_KEYS,
    getConfigValueAtPath,
    setConfigValueAtPath,
} from './admin-setting-definitions';

type ConfigObject = Record<string, unknown>;
type ResolvedAutoProviderRoutingConfig = ResolvedCLIConfig['agentProviderRouting']['auto'];

export interface ConfigNamespaceDescriptor {
    readonly name: string;
    readonly merge: (base: ResolvedCLIConfig, override: CLIConfig | undefined) => Partial<ResolvedConfigNamespaceValues>;
}

export type ResolvedConfigNamespaceValues = Pick<
    ResolvedCLIConfig,
    | 'chat'
    | 'serve'
    | 'queue'
    | 'models'
    | 'logging'
    | 'terminal'
    | 'notes'
    | 'myWork'
    | 'myLife'
    | 'scratchpad'
    | 'workflows'
    | 'pullRequests'
    | 'servers'
    | 'ralph'
    | 'forEach'
    | 'mapReduce'
    | 'vimNavigation'
    | 'cron'
    | 'triggers'
    | 'dreams'
    | 'mcpOauth'
    | 'excalidraw'
    | 'canvas'
    | 'kusto'
    | 'containerDefaultAgent'
    | 'agentProviderRouting'
    | 'codex'
    | 'claude'
    | 'opencode'
    | 'features'
    | 'memoryPromotion'
    | 'store'
    | 'monitoring'
    | 'skills'
    | 'workItems'
    | 'effortLevels'
>;

// ── file-only config leaves ─────────────────────────────────────────────────

/**
 * A source-tracked config leaf that is NOT owned by the admin setting registry.
 *
 * File-only leaves are resolved with the same generic `override ?? base ?? default`
 * rule as admin leaves, and their defaults live here (not in a hand-written merge)
 * so CONFIG_SOURCE_KEYS, default values, and drift guards are all generated from
 * one place. A contract test asserts each default matches DEFAULT_CONFIG.
 */
export interface FileOnlyConfigLeaf {
    readonly key: string;
    readonly default: unknown;
    /**
     * Track this key in CONFIG_SOURCE_KEYS (admin source badges). Defaults to
     * true; set false for a merged-but-not-source-badged field (e.g.
     * features.gitCommitLookup, which today carries no source indicator).
     */
    readonly sourceTracked?: boolean;
}

/** Top-level (non-namespaced) file-only scalars — merged by config.ts. */
export const FILE_ONLY_TOP_LEVEL_LEAVES: readonly FileOnlyConfigLeaf[] = [
    { key: 'approvePermissions', default: false },
    { key: 'mcpConfig', default: undefined },
    { key: 'persist', default: true },
];

/**
 * Namespaced file-only leaves — resolved generically and (unless
 * `sourceTracked` is false) reported in per-field source tracking.
 */
export const FILE_ONLY_NAMESPACE_LEAVES: readonly FileOnlyConfigLeaf[] = [
    { key: 'serve.port', default: 4000 },
    { key: 'serve.host', default: '127.0.0.1' },
    { key: 'serve.dataDir', default: '~/.coc' },
    { key: 'serve.theme', default: 'auto' },
    { key: 'features.autoMemoryPromotion', default: false },
    // Merged, but intentionally not source-badged (no source indicator today).
    { key: 'features.gitCommitLookup', default: false, sourceTracked: false },
    { key: 'dreams.minIdleMs', default: 15 * 60 * 1000 },
    { key: 'dreams.confidenceThreshold', default: 0.85 },
    { key: 'dreams.maxCandidates', default: 8 },
    { key: 'dreams.conversationLimit', default: 20 },
    { key: 'memoryPromotion.batchSize', default: 50 },
    { key: 'memoryPromotion.timeoutMs', default: 90_000 },
    { key: 'memoryPromotion.model', default: undefined },
    { key: 'memoryPromotion.aiNormalization.enabled', default: false },
    { key: 'memoryPromotion.aiNormalization.timeoutMs', default: 60_000 },
    { key: 'memoryPromotion.aiNormalization.model', default: undefined },
];

const FILE_ONLY_NAMESPACE_SOURCE_KEYS: readonly string[] = FILE_ONLY_NAMESPACE_LEAVES
    .filter(leaf => leaf.sourceTracked !== false)
    .map(leaf => leaf.key);

/**
 * All namespaced (dot-notation) config keys with per-field source tracking:
 * every namespaced admin setting plus the source-tracked file-only leaves.
 */
export const CONFIG_NAMESPACE_SOURCE_KEYS: readonly string[] = [
    ...NAMESPACED_ADMIN_SETTING_KEYS,
    ...FILE_ONLY_NAMESPACE_SOURCE_KEYS,
];

const NAMESPACE_SOURCE_KEY_SET = new Set<string>([
    ...NAMESPACED_ADMIN_SETTING_KEYS,
    ...FILE_ONLY_NAMESPACE_SOURCE_KEYS,
]);

const DEFAULT_AUTO_PROVIDER_ROUTING: ResolvedAutoProviderRoutingConfig = {
    rules: [
        {
            provider: 'claude',
            enabled: true,
            minimumRemainingPercent: 33,
            weeklyGuard: { enabled: true, minimumRemainingPercent: 33 },
        },
        {
            provider: 'codex',
            enabled: true,
            minimumRemainingPercent: 33,
            weeklyGuard: { enabled: true, minimumRemainingPercent: 33 },
        },
        {
            provider: 'copilot',
            enabled: true,
            minimumRemainingPercent: 10,
            weeklyGuard: { enabled: true, minimumRemainingPercent: 10 },
        },
    ],
    fallbackProvider: 'copilot',
};

/**
 * Registry of namespaced CoC config sections that need HAND-WRITTEN merge
 * logic — genuinely structural sections (provider routing, model provider maps,
 * skills defaults, monitoring, store, queue) that do not fit the generic leaf
 * model.
 *
 * Admin-editable leaves and file-only leaves are merged GENERICALLY from the
 * setting registries (see mergeConfigNamespaces / applyLeafSettings) — a new
 * leaf in an existing or new namespace needs NO entry here.
 *
 * Top-level scalar fields are merged generically in config.ts.
 */
export function createConfigNamespaceRegistry(defaultBundledSkills: readonly string[]): readonly ConfigNamespaceDescriptor[] {
    return [
        {
            name: 'queue',
            merge: (base, override) => ({
                queue: (override?.queue || base.queue) ? {
                    historyLimit: override?.queue?.historyLimit ?? base.queue?.historyLimit,
                    restartPolicy: override?.queue?.restartPolicy ?? base.queue?.restartPolicy,
                    restartPickupDelayMs: override?.queue?.restartPickupDelayMs ?? base.queue?.restartPickupDelayMs,
                } : undefined,
            }),
        },
        {
            name: 'models',
            merge: (base, override) => {
                const enabled = override?.models?.enabled ?? base.models?.enabled;
                const reasoningEfforts = override?.models?.reasoningEfforts ?? base.models?.reasoningEfforts;
                const providers = override?.models?.providers ?? base.models?.providers;
                return {
                    models: (override?.models || base.models) ? {
                        ...(enabled !== undefined ? { enabled } : {}),
                        ...(reasoningEfforts !== undefined ? { reasoningEfforts } : {}),
                        ...(providers !== undefined ? { providers } : {}),
                    } : undefined,
                };
            },
        },
        {
            name: 'logging',
            merge: (base, override) => ({ logging: override?.logging ?? base.logging }),
        },
        {
            name: 'agentProviderRouting',
            merge: (base, override) => ({
                agentProviderRouting: {
                    auto: resolveAutoProviderRouting(base.agentProviderRouting?.auto, override?.agentProviderRouting?.auto),
                },
            }),
        },
        {
            name: 'store',
            merge: (base, override) => ({ store: { backend: override?.store?.backend ?? base.store?.backend ?? 'sqlite' } }),
        },
        {
            name: 'monitoring',
            merge: (base, override) => ({
                monitoring: {
                    heapCheck: {
                        enabled: override?.monitoring?.heapCheck?.enabled ?? base.monitoring?.heapCheck?.enabled ?? true,
                        intervalMs: override?.monitoring?.heapCheck?.intervalMs ?? base.monitoring?.heapCheck?.intervalMs ?? 30000,
                        warnThreshold: override?.monitoring?.heapCheck?.warnThreshold ?? base.monitoring?.heapCheck?.warnThreshold ?? 70,
                        criticalThreshold: override?.monitoring?.heapCheck?.criticalThreshold ?? base.monitoring?.heapCheck?.criticalThreshold ?? 85,
                    },
                },
            }),
        },
        {
            name: 'skills',
            merge: (base, override) => ({
                skills: {
                    autoUpdate: override?.skills?.autoUpdate ?? base.skills?.autoUpdate ?? true,
                    defaultSkills: override?.skills?.defaultSkills ?? base.skills?.defaultSkills ?? [...defaultBundledSkills],
                    globalExtraFolders: override?.skills?.globalExtraFolders ?? base.skills?.globalExtraFolders ?? [],
                    autoDetectDefaultFolders: override?.skills?.autoDetectDefaultFolders ?? base.skills?.autoDetectDefaultFolders ?? true,
                },
            }),
        },
    ];
}

/**
 * Generic merge for source-tracked leaves:
 *   - admin leaves (except top-level scalars and custom-merged ones) are
 *     resolved `override ?? base ?? default` and skipped when undefined.
 *   - file-only namespace leaves are always written (preserving present-as-
 *     undefined fields such as memoryPromotion.model), so structural containers
 *     keep the same shape they had under hand-written merges.
 */
function applyLeafSettings(
    result: ConfigObject,
    base: ResolvedCLIConfig,
    override: CLIConfig | undefined
): void {
    for (const def of ADMIN_SETTING_DEFINITIONS) {
        if (!def.key.includes('.') || def.customMerge) {
            continue;
        }
        const value = getConfigValueAtPath(override, def.key)
            ?? getConfigValueAtPath(base, def.key)
            ?? def.default;
        if (value !== undefined) {
            setConfigValueAtPath(result, def.key, value);
        }
    }

    for (const leaf of FILE_ONLY_NAMESPACE_LEAVES) {
        const value = getConfigValueAtPath(override, leaf.key)
            ?? getConfigValueAtPath(base, leaf.key)
            ?? leaf.default;
        setConfigValueAtPath(result, leaf.key, value);
    }
}

export function mergeConfigNamespaces(
    base: ResolvedCLIConfig,
    override: CLIConfig | undefined,
    defaultBundledSkills: readonly string[]
): ResolvedConfigNamespaceValues {
    const merged = createConfigNamespaceRegistry(defaultBundledSkills).reduce<Partial<ResolvedConfigNamespaceValues>>(
        (merged, descriptor) => ({ ...merged, ...descriptor.merge(base, override) }),
        {}
    );
    applyLeafSettings(merged as ConfigObject, base, override);
    return merged as ResolvedConfigNamespaceValues;
}

export function getNamespaceFieldSource(key: string, fileConfig: CLIConfig | undefined): ConfigFieldSource | undefined {
    if (!fileConfig) {
        return 'default';
    }

    if (NAMESPACE_SOURCE_KEY_SET.has(key)) {
        return getConfigValueAtPath(fileConfig, key) !== undefined ? 'file' : 'default';
    }

    return undefined;
}

function resolveAutoProviderRouting(
    base: ResolvedAutoProviderRoutingConfig | undefined,
    override: AutoProviderRoutingConfig | undefined
): ResolvedAutoProviderRoutingConfig {
    const fallback = base ?? DEFAULT_AUTO_PROVIDER_ROUTING;
    if (!override) {
        return fallback;
    }

    return {
        fallbackProvider: override.fallbackProvider ?? fallback.fallbackProvider,
        rules: override.rules?.map(rule => ({
            provider: rule.provider,
            enabled: rule.enabled ?? true,
            minimumRemainingPercent: rule.minimumRemainingPercent ?? 0,
            weeklyGuard: {
                enabled: rule.weeklyGuard?.enabled ?? false,
                minimumRemainingPercent: rule.weeklyGuard?.minimumRemainingPercent ?? rule.minimumRemainingPercent ?? 0,
            },
        })) ?? fallback.rules,
    };
}
