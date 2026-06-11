import type { AutoProviderRoutingConfig, CLIConfig, ConfigFieldSource, ResolvedCLIConfig } from '../config';
import { FEATURE_FLAGS, readFlagValue } from '@plusplusoneplusplus/coc-client';

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
    | 'mcpOauth'
    | 'excalidraw'
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

const CHAT_FOLLOW_UP_SOURCE_KEYS = [
    'chat.followUpSuggestions.enabled',
    'chat.followUpSuggestions.count',
] as const;

const CHAT_ASK_USER_SOURCE_KEYS = [
    'chat.askUser.enabled',
] as const;

const SERVE_SOURCE_KEYS = [
    'serve.port',
    'serve.host',
    'serve.dataDir',
    'serve.theme',
    'serve.serverName',
] as const;

const TERMINAL_SOURCE_KEYS = ['terminal.enabled'] as const;
const NOTES_SOURCE_KEYS = ['notes.enabled'] as const;
const MY_WORK_SOURCE_KEYS = ['myWork.enabled'] as const;
const MY_LIFE_SOURCE_KEYS = ['myLife.enabled'] as const;
const SCRATCHPAD_SOURCE_KEYS = ['scratchpad.enabled', 'scratchpad.layout'] as const;
const WORKFLOWS_SOURCE_KEYS = ['workflows.enabled'] as const;
const PULL_REQUESTS_SOURCE_KEYS = [
    'pullRequests.enabled',
    'pullRequests.suggestions',
    'pullRequests.autoClassifyTeam',
] as const;
const SERVERS_SOURCE_KEYS = ['servers.enabled'] as const;
const RALPH_SOURCE_KEYS = ['ralph.enabled'] as const;
const RALPH_FINAL_CHECK_SOURCE_KEYS = ['ralph.finalCheck.maxGapFixLoops'] as const;
const FOR_EACH_SOURCE_KEYS = ['forEach.enabled'] as const;
const MAP_REDUCE_SOURCE_KEYS = ['mapReduce.enabled'] as const;
const VIM_NAVIGATION_SOURCE_KEYS = ['vimNavigation.enabled'] as const;
const LOOPS_SOURCE_KEYS = ['loops.enabled'] as const;
const MCP_OAUTH_SOURCE_KEYS = ['mcpOauth.enabled'] as const;
const MCP_OAUTH_AUTO_REFRESH_SOURCE_KEYS = ['mcpOauth.autoRefresh.enabled'] as const;
const EXCALIDRAW_SOURCE_KEYS = ['excalidraw.enabled'] as const;
const CONTAINER_DEFAULT_AGENT_SOURCE_KEYS = ['containerDefaultAgent.enabled'] as const;
const AGENT_PROVIDER_ROUTING_SOURCE_KEYS = ['agentProviderRouting.auto'] as const;
const CODEX_SOURCE_KEYS = ['codex.enabled'] as const;
const CLAUDE_SOURCE_KEYS = ['claude.enabled'] as const;
const FEATURES_SOURCE_KEYS = [
    'features.autoMemoryPromotion',
    'features.focusedDiff',
    'features.gitCommitLookup',
    'features.gitCrossCloneCherryPick',
    'features.sessionContextAttachments',
    'features.commitChatLens',
    'features.commitChatLensDormantMode',
    'features.autoAgentProviderRouting',
] as const;
const WORK_ITEMS_HIERARCHY_SOURCE_KEYS = ['workItems.hierarchy.enabled'] as const;
const WORK_ITEMS_SYNC_SOURCE_KEYS = ['workItems.sync.enabled'] as const;
const WORK_ITEMS_AI_AUTHORING_SOURCE_KEYS = ['workItems.aiAuthoring.enabled'] as const;
const WORK_ITEMS_WORKFLOW_SOURCE_KEYS = ['workItems.workflow.enabled'] as const;
const EFFORT_LEVELS_SOURCE_KEYS = ['effortLevels.enabled'] as const;

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

export const CONFIG_NAMESPACE_SOURCE_KEYS = [
    ...CHAT_FOLLOW_UP_SOURCE_KEYS,
    ...CHAT_ASK_USER_SOURCE_KEYS,
    ...SERVE_SOURCE_KEYS,
    ...TERMINAL_SOURCE_KEYS,
    ...NOTES_SOURCE_KEYS,
    ...MY_WORK_SOURCE_KEYS,
    ...MY_LIFE_SOURCE_KEYS,
    ...SCRATCHPAD_SOURCE_KEYS,
    ...WORKFLOWS_SOURCE_KEYS,
    ...PULL_REQUESTS_SOURCE_KEYS,
    ...SERVERS_SOURCE_KEYS,
    ...RALPH_SOURCE_KEYS,
    ...RALPH_FINAL_CHECK_SOURCE_KEYS,
    ...FOR_EACH_SOURCE_KEYS,
    ...MAP_REDUCE_SOURCE_KEYS,
    ...VIM_NAVIGATION_SOURCE_KEYS,
    ...LOOPS_SOURCE_KEYS,
    ...MCP_OAUTH_SOURCE_KEYS,
    ...MCP_OAUTH_AUTO_REFRESH_SOURCE_KEYS,
    ...EXCALIDRAW_SOURCE_KEYS,
    ...CONTAINER_DEFAULT_AGENT_SOURCE_KEYS,
    ...AGENT_PROVIDER_ROUTING_SOURCE_KEYS,
    ...CODEX_SOURCE_KEYS,
    ...CLAUDE_SOURCE_KEYS,
    ...FEATURES_SOURCE_KEYS,
    ...MEMORY_PROMOTION_SOURCE_KEYS,
    ...MEMORY_PROMOTION_AI_NORMALIZATION_SOURCE_KEYS,
    ...WORK_ITEMS_HIERARCHY_SOURCE_KEYS,
    ...WORK_ITEMS_SYNC_SOURCE_KEYS,
    ...WORK_ITEMS_AI_AUTHORING_SOURCE_KEYS,
    ...WORK_ITEMS_WORKFLOW_SOURCE_KEYS,
    ...EFFORT_LEVELS_SOURCE_KEYS,
] as const;

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
 * Namespaces whose merge is hand-written below because they carry non-flag or
 * nested fields (e.g. scratchpad.layout, ralph.finalCheck). Every other
 * FEATURE_FLAGS entry shaped as a single `<ns>.enabled` boolean directly under a
 * top-level namespace gets an auto-generated descriptor.
 */
const COMPOSITE_FLAG_NAMESPACES = new Set<string>(['scratchpad', 'pullRequests', 'ralph', 'mcpOauth']);

/**
 * Generate merge + source descriptors for simple single-boolean `<ns>.enabled`
 * namespaces straight from the feature-flag registry. Adding such a flag needs
 * no edit here — the registry entry is enough.
 */
function buildSimpleFlagNamespaceDescriptors(): ConfigNamespaceDescriptor[] {
    return FEATURE_FLAGS
        .filter(flag => flag.path.length === 2 && flag.path[1] === 'enabled' && !COMPOSITE_FLAG_NAMESPACES.has(flag.path[0]))
        .map((flag): ConfigNamespaceDescriptor => {
            const ns = flag.path[0];
            return {
                name: ns,
                sourceDescriptors: [source(`${ns}.`, [ns], [flag.key])],
                merge: (base, override) => ({
                    [ns]: {
                        enabled: readFlagValue(override, flag.path) ?? readFlagValue(base, flag.path) ?? flag.default,
                    },
                }) as Partial<ResolvedConfigNamespaceValues>,
            };
        });
}

/**
 * Registry of namespaced CoC config sections.
 *
 * Simple `<ns>.enabled` toggles are generated from the FEATURE_FLAGS registry
 * (see buildSimpleFlagNamespaceDescriptors). Composite namespaces — those with
 * non-flag or nested fields — are declared explicitly below with:
 * - source descriptors for fields surfaced by getResolvedConfigWithSource()
 * - merge logic for applying partial file config on top of resolved defaults
 *
 * Top-level scalar fields remain in config.ts.
 */
export function createConfigNamespaceRegistry(defaultBundledSkills: readonly string[]): readonly ConfigNamespaceDescriptor[] {
    return [
        ...buildSimpleFlagNamespaceDescriptors(),
        {
            name: 'chat',
            sourceDescriptors: [
                source('chat.followUpSuggestions.', ['chat', 'followUpSuggestions'], CHAT_FOLLOW_UP_SOURCE_KEYS),
                source('chat.askUser.', ['chat', 'askUser'], CHAT_ASK_USER_SOURCE_KEYS),
            ],
            merge: (base, override) => ({
                chat: {
                    followUpSuggestions: {
                        enabled: override?.chat?.followUpSuggestions?.enabled ?? base.chat.followUpSuggestions.enabled,
                        count: override?.chat?.followUpSuggestions?.count ?? base.chat.followUpSuggestions.count,
                    },
                    askUser: {
                        enabled: override?.chat?.askUser?.enabled ?? base.chat.askUser.enabled,
                    },
                },
            }),
        },
        {
            name: 'serve',
            sourceDescriptors: [source('serve.', ['serve'], SERVE_SOURCE_KEYS)],
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
            name: 'scratchpad',
            sourceDescriptors: [source('scratchpad.', ['scratchpad'], SCRATCHPAD_SOURCE_KEYS)],
            merge: (base, override) => ({
                scratchpad: {
                    enabled: override?.scratchpad?.enabled ?? base.scratchpad?.enabled ?? false,
                    layout: override?.scratchpad?.layout ?? base.scratchpad?.layout ?? 'vertical',
                },
            }),
        },
        {
            name: 'pullRequests',
            sourceDescriptors: [source('pullRequests.', ['pullRequests'], PULL_REQUESTS_SOURCE_KEYS)],
            merge: (base, override) => ({
                pullRequests: {
                    enabled: override?.pullRequests?.enabled ?? base.pullRequests?.enabled ?? true,
                    suggestions: override?.pullRequests?.suggestions ?? base.pullRequests?.suggestions ?? false,
                    autoClassifyTeam: override?.pullRequests?.autoClassifyTeam ?? base.pullRequests?.autoClassifyTeam ?? false,
                },
            }),
        },
        {
            name: 'ralph',
            sourceDescriptors: [
                source('ralph.finalCheck.', ['ralph', 'finalCheck'], RALPH_FINAL_CHECK_SOURCE_KEYS),
                source('ralph.', ['ralph'], RALPH_SOURCE_KEYS),
            ],
            merge: (base, override) => ({
                ralph: {
                    enabled: override?.ralph?.enabled ?? base.ralph?.enabled ?? false,
                    finalCheck: {
                        maxGapFixLoops: override?.ralph?.finalCheck?.maxGapFixLoops ?? base.ralph?.finalCheck?.maxGapFixLoops ?? 3,
                    },
                },
            }),
        },
        {
            name: 'mcpOauth',
            sourceDescriptors: [
                source('mcpOauth.', ['mcpOauth'], MCP_OAUTH_SOURCE_KEYS),
                source('mcpOauth.autoRefresh.', ['mcpOauth', 'autoRefresh'], MCP_OAUTH_AUTO_REFRESH_SOURCE_KEYS),
            ],
            merge: (base, override) => ({
                mcpOauth: {
                    enabled: override?.mcpOauth?.enabled ?? base.mcpOauth?.enabled ?? false,
                    autoRefresh: {
                        enabled: override?.mcpOauth?.autoRefresh?.enabled
                            ?? base.mcpOauth?.autoRefresh?.enabled
                            ?? false,
                    },
                },
            }),
        },
        {
            name: 'agentProviderRouting',
            sourceDescriptors: [source('agentProviderRouting.', ['agentProviderRouting'], AGENT_PROVIDER_ROUTING_SOURCE_KEYS)],
            merge: (base, override) => ({
                agentProviderRouting: {
                    auto: resolveAutoProviderRouting(base.agentProviderRouting?.auto, override?.agentProviderRouting?.auto),
                },
            }),
        },
        {
            name: 'features',
            sourceDescriptors: [source('features.', ['features'], FEATURES_SOURCE_KEYS)],
            merge: (base, override) => ({
                features: {
                    autoMemoryPromotion: override?.features?.autoMemoryPromotion ?? base.features?.autoMemoryPromotion ?? false,
                    focusedDiff: override?.features?.focusedDiff ?? base.features?.focusedDiff ?? false,
                    gitCommitLookup: override?.features?.gitCommitLookup ?? base.features?.gitCommitLookup ?? false,
                    gitCrossCloneCherryPick: override?.features?.gitCrossCloneCherryPick ?? base.features?.gitCrossCloneCherryPick ?? true,
                    sessionContextAttachments: override?.features?.sessionContextAttachments ?? base.features?.sessionContextAttachments ?? false,
                    commitChatLens: override?.features?.commitChatLens ?? base.features?.commitChatLens ?? false,
                    commitChatLensDormantMode: override?.features?.commitChatLensDormantMode ?? base.features?.commitChatLensDormantMode ?? 'ghost',
                    autoAgentProviderRouting: override?.features?.autoAgentProviderRouting ?? base.features?.autoAgentProviderRouting ?? false,
                },
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
        {
            name: 'workItems',
            sourceDescriptors: [
                source('workItems.hierarchy.', ['workItems', 'hierarchy'], WORK_ITEMS_HIERARCHY_SOURCE_KEYS),
                source('workItems.sync.', ['workItems', 'sync'], WORK_ITEMS_SYNC_SOURCE_KEYS),
                source('workItems.aiAuthoring.', ['workItems', 'aiAuthoring'], WORK_ITEMS_AI_AUTHORING_SOURCE_KEYS),
                source('workItems.workflow.', ['workItems', 'workflow'], WORK_ITEMS_WORKFLOW_SOURCE_KEYS),
            ],
            merge: (base, override) => ({
                workItems: {
                    hierarchy: {
                        enabled: override?.workItems?.hierarchy?.enabled ?? base.workItems?.hierarchy?.enabled ?? false,
                    },
                    sync: {
                        enabled: override?.workItems?.sync?.enabled ?? base.workItems?.sync?.enabled ?? false,
                    },
                    aiAuthoring: {
                        enabled: override?.workItems?.aiAuthoring?.enabled ?? base.workItems?.aiAuthoring?.enabled ?? false,
                    },
                    workflow: {
                        enabled: override?.workItems?.workflow?.enabled ?? base.workItems?.workflow?.enabled ?? false,
                    },
                },
            }),
        },
    ];
}

export const CONFIG_NAMESPACE_SOURCE_DESCRIPTORS = createConfigNamespaceRegistry([])
    .flatMap(descriptor => descriptor.sourceDescriptors)
    .sort((a, b) => b.prefix.length - a.prefix.length);

export function mergeConfigNamespaces(
    base: ResolvedCLIConfig,
    override: CLIConfig | undefined,
    defaultBundledSkills: readonly string[]
): ResolvedConfigNamespaceValues {
    const merged = createConfigNamespaceRegistry(defaultBundledSkills).reduce<Partial<ResolvedConfigNamespaceValues>>(
        (merged, descriptor) => ({ ...merged, ...descriptor.merge(base, override) }),
        {}
    );
    return merged as ResolvedConfigNamespaceValues;
}

export function getNamespaceFieldSource(key: string, fileConfig: CLIConfig | undefined): ConfigFieldSource | undefined {
    if (!fileConfig) {
        return 'default';
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
