import type { AutoProviderRoutingConfig, CLIConfig, ConfigFieldSource, ResolvedCLIConfig } from '../config';
import {
    ADMIN_SETTING_DEFINITIONS,
    NAMESPACED_ADMIN_SETTING_KEYS,
    getConfigValueAtPath,
    setConfigValueAtPath,
} from './admin-setting-definitions';

type ConfigObject = Record<string, unknown>;
type ResolvedAutoProviderRoutingConfig = ResolvedCLIConfig['agentProviderRouting']['auto'];

export interface ConfigNamespaceSourceDescriptor {
    readonly prefix: string;
    readonly sourceKeys: readonly string[];
    readonly path: readonly string[];
}

export interface ConfigNamespaceDescriptor {
    readonly name: string;
    readonly sourceDescriptors: readonly ConfigNamespaceSourceDescriptor[];
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
    | 'loops'
    | 'dreams'
    | 'mcpOauth'
    | 'excalidraw'
    | 'canvas'
    | 'containerDefaultAgent'
    | 'agentProviderRouting'
    | 'codex'
    | 'claude'
    | 'features'
    | 'memoryPromotion'
    | 'store'
    | 'monitoring'
    | 'skills'
    | 'workItems'
    | 'effortLevels'
>;

// ── hand-tracked source keys (fields NOT covered by the admin setting registry) ──

const SERVE_BASE_SOURCE_KEYS = [
    'serve.port',
    'serve.host',
    'serve.dataDir',
    'serve.theme',
] as const;

const FEATURES_BASE_SOURCE_KEYS = [
    'features.autoMemoryPromotion',
] as const;

const DREAMS_BASE_SOURCE_KEYS = [
    'dreams.idleCheckIntervalMs',
    'dreams.minIdleMs',
    'dreams.confidenceThreshold',
    'dreams.maxCandidates',
    'dreams.conversationLimit',
] as const;

const MEMORY_PROMOTION_SOURCE_KEYS = [
    'memoryPromotion.batchSize',
    'memoryPromotion.timeoutMs',
    'memoryPromotion.model',
] as const;

const MEMORY_PROMOTION_AI_NORMALIZATION_SOURCE_KEYS = [
    'memoryPromotion.aiNormalization.enabled',
    'memoryPromotion.aiNormalization.timeoutMs',
    'memoryPromotion.aiNormalization.model',
] as const;

/**
 * All namespaced (dot-notation) config keys with per-field source tracking:
 * every namespaced admin setting plus the hand-tracked non-admin fields above.
 */
export const CONFIG_NAMESPACE_SOURCE_KEYS: readonly string[] = [
    ...NAMESPACED_ADMIN_SETTING_KEYS,
    ...SERVE_BASE_SOURCE_KEYS,
    ...FEATURES_BASE_SOURCE_KEYS,
    ...DREAMS_BASE_SOURCE_KEYS,
    ...MEMORY_PROMOTION_SOURCE_KEYS,
    ...MEMORY_PROMOTION_AI_NORMALIZATION_SOURCE_KEYS,
];

const NAMESPACED_ADMIN_SETTING_KEY_SET = new Set(NAMESPACED_ADMIN_SETTING_KEYS);

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

const source = (
    prefix: string,
    path: readonly string[],
    sourceKeys: readonly string[]
): ConfigNamespaceSourceDescriptor => ({
    prefix,
    path,
    sourceKeys,
});

/**
 * Registry of namespaced CoC config sections that need HAND-WRITTEN merge
 * logic — sections that are not (or not fully) admin-editable, plus custom
 * resolution like agentProviderRouting.
 *
 * Admin-editable leaves are merged GENERICALLY from the setting registry in
 * admin-setting-definitions.ts (see mergeConfigNamespaces) — a new admin
 * setting in an existing or new namespace needs NO entry here.
 *
 * Top-level scalar fields remain in config.ts.
 */
export function createConfigNamespaceRegistry(defaultBundledSkills: readonly string[]): readonly ConfigNamespaceDescriptor[] {
    return [
        {
            name: 'serve',
            sourceDescriptors: [source('serve.', ['serve'], SERVE_BASE_SOURCE_KEYS)],
            merge: (base, override) => ({
                serve: {
                    port: override?.serve?.port ?? base.serve?.port ?? 4000,
                    host: override?.serve?.host ?? base.serve?.host ?? '127.0.0.1',
                    dataDir: override?.serve?.dataDir ?? base.serve?.dataDir ?? '~/.coc',
                    theme: override?.serve?.theme ?? base.serve?.theme ?? 'auto',
                    serverName: override?.serve?.serverName ?? base.serve?.serverName,
                },
            }),
        },
        {
            name: 'queue',
            sourceDescriptors: [],
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
            sourceDescriptors: [],
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
            sourceDescriptors: [],
            merge: (base, override) => ({ logging: override?.logging ?? base.logging }),
        },
        {
            name: 'agentProviderRouting',
            sourceDescriptors: [],
            merge: (base, override) => ({
                agentProviderRouting: {
                    auto: resolveAutoProviderRouting(base.agentProviderRouting?.auto, override?.agentProviderRouting?.auto),
                },
            }),
        },
        {
            name: 'features',
            sourceDescriptors: [source('features.', ['features'], FEATURES_BASE_SOURCE_KEYS)],
            merge: (base, override) => ({
                // Admin-editable features.* leaves are filled in by the generic
                // registry merge pass; only file-only flags are merged here.
                features: {
                    autoMemoryPromotion: override?.features?.autoMemoryPromotion ?? base.features?.autoMemoryPromotion ?? false,
                    gitCommitLookup: override?.features?.gitCommitLookup ?? base.features?.gitCommitLookup ?? false,
                } as ResolvedCLIConfig['features'],
            }),
        },
        {
            name: 'dreams',
            sourceDescriptors: [source('dreams.', ['dreams'], DREAMS_BASE_SOURCE_KEYS)],
            merge: (base, override) => ({
                // dreams.enabled is admin-editable and filled in by the generic
                // registry merge pass; only file-only tuning knobs are merged here.
                dreams: {
                    idleCheckIntervalMs: override?.dreams?.idleCheckIntervalMs ?? base.dreams?.idleCheckIntervalMs ?? 5 * 60 * 1000,
                    minIdleMs: override?.dreams?.minIdleMs ?? base.dreams?.minIdleMs ?? 15 * 60 * 1000,
                    confidenceThreshold: override?.dreams?.confidenceThreshold ?? base.dreams?.confidenceThreshold ?? 0.85,
                    maxCandidates: override?.dreams?.maxCandidates ?? base.dreams?.maxCandidates ?? 8,
                    conversationLimit: override?.dreams?.conversationLimit ?? base.dreams?.conversationLimit ?? 20,
                } as ResolvedCLIConfig['dreams'],
            }),
        },
        {
            name: 'memoryPromotion',
            sourceDescriptors: [
                source('memoryPromotion.aiNormalization.', ['memoryPromotion', 'aiNormalization'], MEMORY_PROMOTION_AI_NORMALIZATION_SOURCE_KEYS),
                source('memoryPromotion.', ['memoryPromotion'], MEMORY_PROMOTION_SOURCE_KEYS),
            ],
            merge: (base, override) => {
                const baseMemoryPromotion = base.memoryPromotion ?? {
                    batchSize: 50,
                    timeoutMs: 90_000,
                    model: undefined,
                    aiNormalization: {
                        enabled: false,
                        timeoutMs: 60_000,
                        model: undefined,
                    },
                };

                return {
                    memoryPromotion: {
                        batchSize: override?.memoryPromotion?.batchSize ?? baseMemoryPromotion.batchSize,
                        timeoutMs: override?.memoryPromotion?.timeoutMs ?? baseMemoryPromotion.timeoutMs,
                        model: override?.memoryPromotion?.model ?? baseMemoryPromotion.model,
                        aiNormalization: {
                            enabled: override?.memoryPromotion?.aiNormalization?.enabled ?? baseMemoryPromotion.aiNormalization.enabled,
                            timeoutMs: override?.memoryPromotion?.aiNormalization?.timeoutMs ?? baseMemoryPromotion.aiNormalization.timeoutMs,
                            model: override?.memoryPromotion?.aiNormalization?.model ?? baseMemoryPromotion.aiNormalization.model,
                        },
                    },
                };
            },
        },
        {
            name: 'store',
            sourceDescriptors: [],
            merge: (base, override) => ({ store: { backend: override?.store?.backend ?? base.store?.backend ?? 'sqlite' } }),
        },
        {
            name: 'monitoring',
            sourceDescriptors: [],
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
            sourceDescriptors: [],
            merge: (base, override) => ({
                skills: {
                    autoUpdate: override?.skills?.autoUpdate ?? base.skills?.autoUpdate ?? true,
                    defaultSkills: override?.skills?.defaultSkills ?? base.skills?.defaultSkills ?? [...defaultBundledSkills],
                },
            }),
        },
    ];
}

export const CONFIG_NAMESPACE_SOURCE_DESCRIPTORS = createConfigNamespaceRegistry([])
    .flatMap(descriptor => descriptor.sourceDescriptors)
    .sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Generic merge for namespaced admin settings: for every dot-notation setting
 * in the registry (except custom-merged ones), resolve
 * `override ?? base ?? default` and write it into the result, creating
 * namespace containers as needed.
 */
function applyAdminSettingLeaves(
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
    applyAdminSettingLeaves(merged as ConfigObject, base, override);
    return merged as ResolvedConfigNamespaceValues;
}

export function getNamespaceFieldSource(key: string, fileConfig: CLIConfig | undefined): ConfigFieldSource | undefined {
    if (!fileConfig) {
        return 'default';
    }

    if (NAMESPACED_ADMIN_SETTING_KEY_SET.has(key)) {
        return getConfigValueAtPath(fileConfig, key) !== undefined ? 'file' : 'default';
    }

    for (const descriptor of CONFIG_NAMESPACE_SOURCE_DESCRIPTORS) {
        if (key.startsWith(descriptor.prefix)) {
            const subKey = key.slice(descriptor.prefix.length);
            const container = getNestedObject(fileConfig, descriptor.path);
            return container?.[subKey] !== undefined ? 'file' : 'default';
        }
    }

    return undefined;
}

function getNestedObject(config: CLIConfig, path: readonly string[]): ConfigObject | undefined {
    let current: unknown = config;
    for (const segment of path) {
        if (!isObject(current)) {
            return undefined;
        }
        current = current[segment];
    }
    return isObject(current) ? current : undefined;
}

function isObject(value: unknown): value is ConfigObject {
    return typeof value === 'object' && value !== null;
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
