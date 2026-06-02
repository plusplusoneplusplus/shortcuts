import type { CLIConfig, ConfigFieldSource, ResolvedCLIConfig } from '../config';

type ConfigObject = Record<string, unknown>;

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
    | 'vimNavigation'
    | 'loops'
    | 'mcpOauth'
    | 'excalidraw'
    | 'containerDefaultAgent'
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
const PULL_REQUESTS_SOURCE_KEYS = ['pullRequests.enabled', 'pullRequests.suggestions'] as const;
const SERVERS_SOURCE_KEYS = ['servers.enabled'] as const;
const RALPH_SOURCE_KEYS = ['ralph.enabled'] as const;
const RALPH_FINAL_CHECK_SOURCE_KEYS = ['ralph.finalCheck.maxGapFixLoops'] as const;
const VIM_NAVIGATION_SOURCE_KEYS = ['vimNavigation.enabled'] as const;
const LOOPS_SOURCE_KEYS = ['loops.enabled'] as const;
const MCP_OAUTH_SOURCE_KEYS = ['mcpOauth.enabled'] as const;
const EXCALIDRAW_SOURCE_KEYS = ['excalidraw.enabled'] as const;
const CONTAINER_DEFAULT_AGENT_SOURCE_KEYS = ['containerDefaultAgent.enabled'] as const;
const CODEX_SOURCE_KEYS = ['codex.enabled'] as const;
const CLAUDE_SOURCE_KEYS = ['claude.enabled'] as const;
const FEATURES_SOURCE_KEYS = ['features.autoMemoryPromotion', 'features.focusedDiff'] as const;
const WORK_ITEMS_HIERARCHY_SOURCE_KEYS = ['workItems.hierarchy.enabled'] as const;
const WORK_ITEMS_SYNC_SOURCE_KEYS = ['workItems.sync.enabled'] as const;
const WORK_ITEMS_AI_AUTHORING_SOURCE_KEYS = ['workItems.aiAuthoring.enabled'] as const;
const EFFORT_LEVELS_SOURCE_KEYS = ['effortLevels.enabled'] as const;

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
    ...VIM_NAVIGATION_SOURCE_KEYS,
    ...LOOPS_SOURCE_KEYS,
    ...MCP_OAUTH_SOURCE_KEYS,
    ...EXCALIDRAW_SOURCE_KEYS,
    ...CONTAINER_DEFAULT_AGENT_SOURCE_KEYS,
    ...CODEX_SOURCE_KEYS,
    ...CLAUDE_SOURCE_KEYS,
    ...FEATURES_SOURCE_KEYS,
    ...MEMORY_PROMOTION_SOURCE_KEYS,
    ...MEMORY_PROMOTION_AI_NORMALIZATION_SOURCE_KEYS,
    ...WORK_ITEMS_HIERARCHY_SOURCE_KEYS,
    ...WORK_ITEMS_SYNC_SOURCE_KEYS,
    ...WORK_ITEMS_AI_AUTHORING_SOURCE_KEYS,
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
 * Registry of namespaced CoC config sections.
 *
 * To add a namespaced config section, add one descriptor here with:
 * - source descriptors for fields surfaced by getResolvedConfigWithSource()
 * - merge logic for applying partial file config on top of resolved defaults
 *
 * Top-level scalar fields remain in config.ts.
 */
export function createConfigNamespaceRegistry(defaultBundledSkills: readonly string[]): readonly ConfigNamespaceDescriptor[] {
    return [
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
            name: 'terminal',
            sourceDescriptors: [source('terminal.', ['terminal'], TERMINAL_SOURCE_KEYS)],
            merge: (base, override) => ({ terminal: { enabled: override?.terminal?.enabled ?? base.terminal?.enabled ?? true } }),
        },
        {
            name: 'notes',
            sourceDescriptors: [source('notes.', ['notes'], NOTES_SOURCE_KEYS)],
            merge: (base, override) => ({ notes: { enabled: override?.notes?.enabled ?? base.notes?.enabled ?? true } }),
        },
        {
            name: 'myWork',
            sourceDescriptors: [source('myWork.', ['myWork'], MY_WORK_SOURCE_KEYS)],
            merge: (base, override) => ({ myWork: { enabled: override?.myWork?.enabled ?? base.myWork?.enabled ?? false } }),
        },
        {
            name: 'myLife',
            sourceDescriptors: [source('myLife.', ['myLife'], MY_LIFE_SOURCE_KEYS)],
            merge: (base, override) => ({ myLife: { enabled: override?.myLife?.enabled ?? base.myLife?.enabled ?? false } }),
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
            name: 'workflows',
            sourceDescriptors: [source('workflows.', ['workflows'], WORKFLOWS_SOURCE_KEYS)],
            merge: (base, override) => ({ workflows: { enabled: override?.workflows?.enabled ?? base.workflows?.enabled ?? false } }),
        },
        {
            name: 'pullRequests',
            sourceDescriptors: [source('pullRequests.', ['pullRequests'], PULL_REQUESTS_SOURCE_KEYS)],
            merge: (base, override) => ({ pullRequests: { enabled: override?.pullRequests?.enabled ?? base.pullRequests?.enabled ?? true, suggestions: override?.pullRequests?.suggestions ?? base.pullRequests?.suggestions ?? false } }),
        },
        {
            name: 'servers',
            sourceDescriptors: [source('servers.', ['servers'], SERVERS_SOURCE_KEYS)],
            merge: (base, override) => ({ servers: { enabled: override?.servers?.enabled ?? base.servers?.enabled ?? true } }),
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
            name: 'vimNavigation',
            sourceDescriptors: [source('vimNavigation.', ['vimNavigation'], VIM_NAVIGATION_SOURCE_KEYS)],
            merge: (base, override) => ({ vimNavigation: { enabled: override?.vimNavigation?.enabled ?? base.vimNavigation?.enabled ?? false } }),
        },
        {
            name: 'loops',
            sourceDescriptors: [source('loops.', ['loops'], LOOPS_SOURCE_KEYS)],
            merge: (base, override) => ({ loops: { enabled: override?.loops?.enabled ?? base.loops?.enabled ?? false } }),
        },
        {
            name: 'mcpOauth',
            sourceDescriptors: [source('mcpOauth.', ['mcpOauth'], MCP_OAUTH_SOURCE_KEYS)],
            merge: (base, override) => ({ mcpOauth: { enabled: override?.mcpOauth?.enabled ?? base.mcpOauth?.enabled ?? false } }),
        },
        {
            name: 'excalidraw',
            sourceDescriptors: [source('excalidraw.', ['excalidraw'], EXCALIDRAW_SOURCE_KEYS)],
            merge: (base, override) => ({ excalidraw: { enabled: override?.excalidraw?.enabled ?? base.excalidraw?.enabled ?? false } }),
        },
        {
            name: 'containerDefaultAgent',
            sourceDescriptors: [source('containerDefaultAgent.', ['containerDefaultAgent'], CONTAINER_DEFAULT_AGENT_SOURCE_KEYS)],
            merge: (base, override) => ({ containerDefaultAgent: { enabled: override?.containerDefaultAgent?.enabled ?? base.containerDefaultAgent?.enabled ?? false } }),
        },
        {
            name: 'codex',
            sourceDescriptors: [source('codex.', ['codex'], CODEX_SOURCE_KEYS)],
            merge: (base, override) => ({ codex: { enabled: override?.codex?.enabled ?? base.codex?.enabled ?? false } }),
        },
        {
            name: 'claude',
            sourceDescriptors: [source('claude.', ['claude'], CLAUDE_SOURCE_KEYS)],
            merge: (base, override) => ({ claude: { enabled: override?.claude?.enabled ?? base.claude?.enabled ?? false } }),
        },
        {
            name: 'features',
            sourceDescriptors: [source('features.', ['features'], FEATURES_SOURCE_KEYS)],
            merge: (base, override) => ({
                features: {
                    autoMemoryPromotion: override?.features?.autoMemoryPromotion ?? base.features?.autoMemoryPromotion ?? false,
                    focusedDiff: override?.features?.focusedDiff ?? base.features?.focusedDiff ?? false,
                    gitCommitLookup: override?.features?.gitCommitLookup ?? base.features?.gitCommitLookup ?? false,
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
                },
            }),
        },
        {
            name: 'effortLevels',
            sourceDescriptors: [source('effortLevels.', ['effortLevels'], EFFORT_LEVELS_SOURCE_KEYS)],
            merge: (base, override) => ({ effortLevels: { enabled: override?.effortLevels?.enabled ?? base.effortLevels?.enabled ?? false } }),
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
