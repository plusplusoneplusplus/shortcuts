import { useEffect, useMemo, useState } from 'react';
import {
    getRalphGrillAgentDefinitions,
    type RalphGrillAgentModelSelection,
    type RalphGrillAgentProvider,
    type RalphGrillAgentRole,
    type RalphGrillDepth,
    type RalphGrillEffortTier,
    type RalphGrillSetup,
} from '../../../../../ralph/grill-planning';
import { useAgentProviders } from '../../hooks/useAgentProviders';
import { useDefaultModelForMode, type ChatModeForModel } from '../../hooks/useDefaultModelForMode';
import type { EffortTierKey, LocalEffortTiersMap } from '../../hooks/useProviderEffortTiers';
import { TIER_KEYS, useProviderEffortTiers } from '../../hooks/useProviderEffortTiers';
import { useProviderReasoningEfforts } from '../../hooks/useProviderReasoningEfforts';
import { useModels } from '../../hooks/useModels';
import { cn } from '../../ui/cn';
import { getAgentSelectorProviders, type ConcreteChatProvider } from '../../utils/providerSelection';
import { resolveEffectiveTier, resolveEffortTier } from '../../utils/resolveEffortTier';
import { deriveEffort } from '../../utils/effortUtils';
import { EffortTierSelector } from './EffortTierSelector';

const DEPTH_OPTIONS: Array<{ value: RalphGrillDepth; label: string; description: string }> = [
    { value: 'light', label: 'Light', description: 'Core product, UX, and architecture checks' },
    { value: 'standard', label: 'Standard', description: 'Balanced coverage for most goals' },
    { value: 'deep', label: 'Deep', description: 'Broadest coverage, including dedupe and provenance checks' },
];

const PROVIDER_LABELS: Record<RalphGrillAgentProvider, string> = {
    copilot: 'Copilot',
    codex: 'Codex',
    claude: 'Claude',
};

type ReasoningEffortSelection = NonNullable<RalphGrillAgentModelSelection['reasoningEffort']>;

type AgentSelectionState = Partial<Record<RalphGrillAgentRole, {
    provider?: RalphGrillAgentProvider;
    effortTier?: RalphGrillEffortTier;
}>>;

interface ProviderOption {
    id: RalphGrillAgentProvider;
    label: string;
    disabled: boolean;
    reason?: string;
}

interface ProviderResolution {
    tiers: LocalEffortTiersMap;
    hasTierMode: boolean;
    defaultModel?: string;
    defaultReasoningEffort?: ReasoningEffortSelection;
}

type ProviderResolutionMap = Record<RalphGrillAgentProvider, ProviderResolution>;

export interface RalphGrillSetupPanelProps {
    value: RalphGrillSetup;
    onChange: (setup: RalphGrillSetup) => void;
    defaultProvider?: ConcreteChatProvider;
    defaultModel?: string;
    defaultReasoningEffort?: string | null;
    defaultEffortTier?: EffortTierKey;
    /** True when Admin effort-level support is enabled. False collapses rows to depth-only inheritance. */
    effortLevelsEnabled?: boolean;
    /** Current composer tier-mode state; threaded so inherited rows track the composer selection. */
    composerUsesEffortTierMode?: boolean;
    workspaceId?: string;
    defaultModelMode?: ChatModeForModel;
    disabled?: boolean;
    testIdPrefix?: string;
}

function isRalphGrillAgentProvider(value: unknown): value is RalphGrillAgentProvider {
    return value === 'copilot' || value === 'codex' || value === 'claude';
}

function isRalphGrillEffortTier(value: unknown): value is RalphGrillEffortTier {
    return value === 'very-low' || value === 'low' || value === 'medium' || value === 'high';
}

function isReasoningEffort(value: unknown): value is ReasoningEffortSelection {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function buildProviderOptions(rawProviders: ReturnType<typeof useAgentProviders>['providers']): ProviderOption[] {
    const selectorProviders = getAgentSelectorProviders(rawProviders);
    const byId = new Map(
        selectorProviders
            .filter(provider => isRalphGrillAgentProvider(provider.id))
            .map(provider => [provider.id, provider] as const),
    );

    return (['copilot', 'codex', 'claude'] as const).map((id) => {
        const provider = byId.get(id);
        const disabled = id !== 'copilot' && (provider?.enabled !== true || provider?.available !== true);
        return {
            id,
            label: provider?.label ?? PROVIDER_LABELS[id],
            disabled,
            reason: provider?.reason,
        };
    });
}

function useProviderResolution(
    provider: RalphGrillAgentProvider,
    workspaceId: string | undefined,
    defaultModelMode: ChatModeForModel,
): ProviderResolution {
    const { models } = useModels(provider);
    const { effectiveModel } = useDefaultModelForMode(workspaceId, defaultModelMode, models, provider);
    const reasoningEfforts = useProviderReasoningEfforts(provider);
    const { tiers, loading: tiersLoading } = useProviderEffortTiers(provider);
    const hasTierMode = !tiersLoading && TIER_KEYS.some(tier => !!tiers[tier]?.model);

    const defaultModelInfo = effectiveModel
        ? models.find(model => model.id === effectiveModel)
        : undefined;
    const capabilitySupportsReasoning = !defaultModelInfo || defaultModelInfo.capabilities?.supports.reasoningEffort !== false;
    const derivedReasoningEffort = deriveEffort(
        effectiveModel ? reasoningEfforts[effectiveModel] : undefined,
        defaultModelInfo?.supportedReasoningEfforts,
        capabilitySupportsReasoning,
    );

    return useMemo(() => ({
        tiers,
        hasTierMode,
        ...(effectiveModel ? { defaultModel: effectiveModel } : {}),
        ...(derivedReasoningEffort ? { defaultReasoningEffort: derivedReasoningEffort } : {}),
    }), [tiers, hasTierMode, effectiveModel, derivedReasoningEffort]);
}

function buildProviderResolutionMap(
    copilot: ProviderResolution,
    codex: ProviderResolution,
    claude: ProviderResolution,
): ProviderResolutionMap {
    return { copilot, codex, claude };
}

function resolveRoleAiSelection(input: {
    provider: RalphGrillAgentProvider;
    desiredTier: EffortTierKey;
    providerResolution: ProviderResolution;
    effortLevelsEnabled: boolean;
    inheritedModel?: string;
    inheritedReasoningEffort?: ReasoningEffortSelection;
}): {
    model?: string;
    reasoningEffort?: ReasoningEffortSelection;
    effortTier?: RalphGrillEffortTier;
} {
    if (!input.effortLevelsEnabled) {
        return {
            ...(input.inheritedModel ? { model: input.inheritedModel } : {}),
            ...(input.inheritedReasoningEffort ? { reasoningEffort: input.inheritedReasoningEffort } : {}),
        };
    }

    if (input.providerResolution.hasTierMode) {
        const effectiveTier = resolveEffectiveTier(input.desiredTier, input.providerResolution.tiers);
        const tierPayload = resolveEffortTier(effectiveTier, input.providerResolution.tiers);
        const tierReasoningEffort = tierPayload?.reasoningEffort;
        return {
            ...(tierPayload?.model ? { model: tierPayload.model } : {}),
            ...(isReasoningEffort(tierReasoningEffort) ? { reasoningEffort: tierReasoningEffort } : {}),
            effortTier: effectiveTier,
        };
    }

    return {
        ...(input.providerResolution.defaultModel ? { model: input.providerResolution.defaultModel } : {}),
        ...(input.providerResolution.defaultReasoningEffort ? { reasoningEffort: input.providerResolution.defaultReasoningEffort } : {}),
    };
}

function buildSetup(input: {
    depth: RalphGrillDepth;
    selections: AgentSelectionState;
    defaultProvider?: ConcreteChatProvider;
    defaultModel?: string;
    defaultReasoningEffort?: ReasoningEffortSelection;
    defaultEffortTier: EffortTierKey;
    effortLevelsEnabled: boolean;
    providerResolutions: ProviderResolutionMap;
}): RalphGrillSetup {
    const inheritedProvider: RalphGrillAgentProvider = input.defaultProvider ?? 'copilot';
    const agents = getRalphGrillAgentDefinitions(input.depth).map((agent) => {
        const selection = input.effortLevelsEnabled ? input.selections[agent.role] : undefined;
        const provider = selection?.provider ?? inheritedProvider;
        const aiSelection = resolveRoleAiSelection({
            provider,
            desiredTier: selection?.effortTier ?? input.defaultEffortTier,
            providerResolution: input.providerResolutions[provider],
            effortLevelsEnabled: input.effortLevelsEnabled,
            inheritedModel: input.defaultModel?.trim() || undefined,
            inheritedReasoningEffort: input.defaultReasoningEffort,
        });
        return {
            role: agent.role,
            provider,
            ...aiSelection,
        };
    });

    return {
        enabled: true,
        depth: input.depth,
        agents,
    };
}

function getInitialDepth(value: RalphGrillSetup): RalphGrillDepth {
    return value.depth === 'light' || value.depth === 'deep' || value.depth === 'standard'
        ? value.depth
        : 'standard';
}

function getInitialSelections(value: RalphGrillSetup): AgentSelectionState {
    const selections: AgentSelectionState = {};
    for (const agent of value.agents ?? []) {
        if (!isRalphGrillAgentProvider(agent.provider) && !isRalphGrillEffortTier(agent.effortTier)) {
            continue;
        }
        selections[agent.role] = {
            ...(isRalphGrillAgentProvider(agent.provider) ? { provider: agent.provider } : {}),
            ...(isRalphGrillEffortTier(agent.effortTier) ? { effortTier: agent.effortTier } : {}),
        };
    }
    return selections;
}

function RalphGrillAgentTierRow({
    role,
    label,
    focus,
    selection,
    defaultProvider,
    defaultEffortTier,
    providerOptions,
    providerResolutions,
    onChange,
    disabled,
    testIdPrefix,
}: {
    role: RalphGrillAgentRole;
    label: string;
    focus: string;
    selection?: { provider?: RalphGrillAgentProvider; effortTier?: RalphGrillEffortTier };
    defaultProvider: RalphGrillAgentProvider;
    defaultEffortTier: EffortTierKey;
    providerOptions: ProviderOption[];
    providerResolutions: ProviderResolutionMap;
    onChange: (selection: { provider?: RalphGrillAgentProvider; effortTier?: RalphGrillEffortTier }) => void;
    disabled?: boolean;
    testIdPrefix: string;
}) {
    const provider = selection?.provider ?? defaultProvider;
    const resolution = providerResolutions[provider];
    const desiredTier = selection?.effortTier ?? defaultEffortTier;
    const selectedTier = resolution.hasTierMode
        ? resolveEffectiveTier(desiredTier, resolution.tiers)
        : desiredTier;

    return (
        <div
            className="grid gap-1 rounded-md border border-[#e6e6e6] bg-white/70 px-2 py-1.5 dark:border-[#3c3c3c] dark:bg-[#1f1f1f]/70"
            data-testid={`${testIdPrefix}-agent-${role}`}
            title={focus}
        >
            <div className="flex flex-wrap items-center justify-between gap-1">
                <div className="min-w-0 truncate text-xs font-medium text-[#1e1e1e] dark:text-[#cccccc]">{label}</div>
                <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
                    {label.replace(/ Agent$/, '')}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                <label className="grid gap-0.5 text-[11px] text-[#6b6b6b] dark:text-[#999999]">
                    Provider
                    <select
                        value={provider}
                        disabled={disabled}
                        onChange={(event) => {
                            const nextProvider = event.target.value;
                            if (!isRalphGrillAgentProvider(nextProvider)) return;
                            onChange({ ...selection, provider: nextProvider });
                        }}
                        className="h-7 rounded border border-[#d0d0d0] bg-white px-2 text-xs text-[#1e1e1e] dark:border-[#4a4a4a] dark:bg-[#252526] dark:text-[#cccccc]"
                        data-testid={`${testIdPrefix}-agent-${role}-provider`}
                    >
                        {providerOptions.map(option => (
                            <option key={option.id} value={option.id} disabled={option.disabled} title={option.reason}>
                                {option.label}{option.disabled ? ' (unavailable)' : ''}
                            </option>
                        ))}
                    </select>
                </label>
                <div className="grid gap-0.5 text-[11px] text-[#6b6b6b] dark:text-[#999999]">
                    Effort tier
                    {resolution.hasTierMode ? (
                        <EffortTierSelector
                            tiers={resolution.tiers}
                            selectedTier={selectedTier}
                            onChange={(tier) => onChange({ ...selection, effortTier: tier })}
                            disabled={disabled}
                            data-testid={`${testIdPrefix}-agent-${role}-tier`}
                            className="min-w-0"
                        />
                    ) : (
                        <span
                            className="flex h-7 items-center rounded border border-[#d0d0d0] bg-white px-2 text-xs text-[#6b6b6b] dark:border-[#4a4a4a] dark:bg-[#252526] dark:text-[#999999]"
                            data-testid={`${testIdPrefix}-agent-${role}-tier-unavailable`}
                            title="This provider has no effort tiers configured; its provider default model and reasoning effort will be used."
                        >
                            Provider default
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}

export function RalphGrillSetupPanel({
    value,
    onChange,
    defaultProvider,
    defaultModel,
    defaultReasoningEffort,
    defaultEffortTier = 'medium',
    effortLevelsEnabled = true,
    composerUsesEffortTierMode = false,
    workspaceId,
    defaultModelMode = 'ralph',
    disabled = false,
    testIdPrefix = 'ralph-grill-setup',
}: RalphGrillSetupPanelProps) {
    const [depth, setDepth] = useState<RalphGrillDepth>(() => getInitialDepth(value));
    const [selections, setSelections] = useState<AgentSelectionState>(() => getInitialSelections(value));
    const { providers: rawProviders } = useAgentProviders();
    const providerOptions = useMemo(() => buildProviderOptions(rawProviders), [rawProviders]);
    const inheritedProvider: RalphGrillAgentProvider = defaultProvider ?? 'copilot';
    const agents = getRalphGrillAgentDefinitions(depth);

    const copilotResolution = useProviderResolution('copilot', workspaceId, defaultModelMode);
    const codexResolution = useProviderResolution('codex', workspaceId, defaultModelMode);
    const claudeResolution = useProviderResolution('claude', workspaceId, defaultModelMode);
    const providerResolutions = useMemo(
        () => buildProviderResolutionMap(copilotResolution, codexResolution, claudeResolution),
        [copilotResolution, codexResolution, claudeResolution],
    );

    const setup = useMemo(
        () => buildSetup({
            depth,
            selections,
            defaultProvider,
            defaultModel,
            defaultReasoningEffort: isReasoningEffort(defaultReasoningEffort) ? defaultReasoningEffort : undefined,
            defaultEffortTier,
            effortLevelsEnabled,
            providerResolutions,
        }),
        [depth, selections, defaultProvider, defaultModel, defaultReasoningEffort, defaultEffortTier, effortLevelsEnabled, providerResolutions],
    );

    useEffect(() => {
        onChange(setup);
    }, [onChange, setup]);

    return (
        <div
            className="rounded-lg border border-purple-200 bg-purple-50/70 text-left dark:border-purple-500/30 dark:bg-purple-500/10"
            data-testid={`${testIdPrefix}-panel`}
        >
            <div
                className="max-h-[55vh] overflow-y-auto overscroll-contain p-2"
                data-testid={`${testIdPrefix}-scroll`}
            >
            <div className="flex flex-wrap items-start justify-between gap-1.5">
                <div className="min-w-0">
                    <div className="text-xs font-semibold text-purple-800 dark:text-purple-200">
                        Question planning setup
                    </div>
                    <div className="text-[10px] leading-snug text-purple-700/80 dark:text-purple-200/75">
                        {effortLevelsEnabled
                            ? composerUsesEffortTierMode
                                ? 'Set grilling depth and per-role provider/tier.'
                                : 'Set grilling depth and per-role provider/tier where the provider supports tiers.'
                            : 'Set grilling depth. Roles inherit the composer AI settings.'}
                    </div>
                </div>
                <div className="inline-flex overflow-hidden rounded-md border border-purple-200 bg-white dark:border-purple-500/30 dark:bg-[#1f1f1f]">
                    {DEPTH_OPTIONS.map(option => {
                        const selected = depth === option.value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={disabled}
                                title={option.description}
                                onClick={() => setDepth(option.value)}
                                className={cn(
                                    'px-2 py-1 text-[11px] font-medium transition-colors',
                                    selected
                                        ? 'bg-purple-600 text-white dark:bg-purple-500'
                                        : 'text-purple-700 hover:bg-purple-50 dark:text-purple-200 dark:hover:bg-purple-500/10',
                                    disabled && 'cursor-not-allowed opacity-60',
                                )}
                                data-testid={`${testIdPrefix}-depth-${option.value}`}
                                data-selected={selected ? 'true' : 'false'}
                            >
                                {option.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {effortLevelsEnabled ? (
                <div className="mt-1.5 grid gap-1" data-testid={`${testIdPrefix}-agents`}>
                    {agents.map(agent => (
                        <RalphGrillAgentTierRow
                            key={agent.role}
                            role={agent.role}
                            label={agent.label}
                            focus={agent.focus}
                            selection={selections[agent.role]}
                            defaultProvider={inheritedProvider}
                            defaultEffortTier={defaultEffortTier}
                            providerOptions={providerOptions}
                            providerResolutions={providerResolutions}
                            disabled={disabled}
                            testIdPrefix={testIdPrefix}
                            onChange={(nextSelection) => {
                                setSelections(prev => ({
                                    ...prev,
                                    [agent.role]: nextSelection,
                                }));
                            }}
                        />
                    ))}
                </div>
            ) : (
                <div
                    className="mt-1.5 rounded-md border border-purple-200 bg-white/70 px-2 py-1.5 text-[11px] text-purple-700/80 dark:border-purple-500/30 dark:bg-[#1f1f1f]/70 dark:text-purple-200/75"
                    data-testid={`${testIdPrefix}-agents-hidden`}
                >
                    Per-role overrides are hidden because effort levels are disabled; all grill roles inherit the composer provider, model, and reasoning effort.
                </div>
            )}
            </div>
        </div>
    );
}
