import { useEffect, useMemo, useState } from 'react';
import {
    getRalphGrillAgentDefinitions,
    type RalphGrillAgentProvider,
    type RalphGrillAgentRole,
    type RalphGrillDepth,
    type RalphGrillSetup,
} from '../../../../../ralph/grill-planning';
import { useAgentProviders } from '../../hooks/useAgentProviders';
import { useModels } from '../../hooks/useModels';
import { cn } from '../../ui/cn';
import { getAgentSelectorProviders, type ConcreteChatProvider } from '../../utils/providerSelection';

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

type AgentSelectionState = Partial<Record<RalphGrillAgentRole, {
    provider?: RalphGrillAgentProvider;
    model?: string;
}>>;

interface ProviderOption {
    id: RalphGrillAgentProvider;
    label: string;
    disabled: boolean;
    reason?: string;
}

export interface RalphGrillSetupPanelProps {
    value: RalphGrillSetup;
    onChange: (setup: RalphGrillSetup) => void;
    defaultProvider?: ConcreteChatProvider;
    defaultModel?: string;
    disabled?: boolean;
    testIdPrefix?: string;
}

function isRalphGrillAgentProvider(value: unknown): value is RalphGrillAgentProvider {
    return value === 'copilot' || value === 'codex' || value === 'claude';
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

function buildSetup(input: {
    depth: RalphGrillDepth;
    selections: AgentSelectionState;
    defaultProvider?: ConcreteChatProvider;
    defaultModel?: string;
}): RalphGrillSetup {
    const inheritedProvider: RalphGrillAgentProvider = input.defaultProvider ?? 'copilot';
    const agents = getRalphGrillAgentDefinitions(input.depth).map((agent) => {
        const selection = input.selections[agent.role];
        const provider = selection?.provider ?? inheritedProvider;
        const model = selection?.model
            ?? (selection?.provider && selection.provider !== inheritedProvider ? undefined : input.defaultModel?.trim() || undefined);
        return {
            role: agent.role,
            provider,
            ...(model ? { model } : {}),
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
        if (!isRalphGrillAgentProvider(agent.provider) && !agent.model) {
            continue;
        }
        selections[agent.role] = {
            ...(isRalphGrillAgentProvider(agent.provider) ? { provider: agent.provider } : {}),
            ...(agent.model?.trim() ? { model: agent.model.trim() } : {}),
        };
    }
    return selections;
}

function RalphGrillAgentModelRow({
    role,
    label,
    focus,
    selection,
    defaultProvider,
    defaultModel,
    providerOptions,
    onChange,
    disabled,
    testIdPrefix,
}: {
    role: RalphGrillAgentRole;
    label: string;
    focus: string;
    selection?: { provider?: RalphGrillAgentProvider; model?: string };
    defaultProvider: RalphGrillAgentProvider;
    defaultModel?: string;
    providerOptions: ProviderOption[];
    onChange: (selection: { provider?: RalphGrillAgentProvider; model?: string }) => void;
    disabled?: boolean;
    testIdPrefix: string;
}) {
    const provider = selection?.provider ?? defaultProvider;
    const { models, loading } = useModels(provider);
    const pickableModels = models.filter(model => model.enabled !== false);
    const explicitModel = selection?.model ?? '';
    const inheritedModel = !explicitModel && (!selection?.provider || selection.provider === defaultProvider)
        ? defaultModel?.trim() || undefined
        : undefined;
    const hasExplicitModelOption = explicitModel
        ? pickableModels.some(model => model.id === explicitModel)
        : true;

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
                            onChange({ provider: nextProvider });
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
                <label className="grid gap-0.5 text-[11px] text-[#6b6b6b] dark:text-[#999999]">
                    Model
                    <select
                        value={explicitModel}
                        disabled={disabled}
                        onChange={(event) => {
                            const model = event.target.value.trim();
                            onChange({ provider, ...(model ? { model } : {}) });
                        }}
                        className="h-7 rounded border border-[#d0d0d0] bg-white px-2 text-xs text-[#1e1e1e] dark:border-[#4a4a4a] dark:bg-[#252526] dark:text-[#cccccc]"
                        data-testid={`${testIdPrefix}-agent-${role}-model`}
                    >
                        <option value="">
                            {inheritedModel ? `Use composer model (${inheritedModel})` : loading ? 'Loading models...' : 'Provider default'}
                        </option>
                        {!hasExplicitModelOption && <option value={explicitModel}>{explicitModel}</option>}
                        {pickableModels.map(model => (
                            <option key={model.id} value={model.id}>
                                {model.name || model.id}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
        </div>
    );
}

export function RalphGrillSetupPanel({
    value,
    onChange,
    defaultProvider,
    defaultModel,
    disabled = false,
    testIdPrefix = 'ralph-grill-setup',
}: RalphGrillSetupPanelProps) {
    const [depth, setDepth] = useState<RalphGrillDepth>(() => getInitialDepth(value));
    const [selections, setSelections] = useState<AgentSelectionState>(() => getInitialSelections(value));
    const { providers: rawProviders } = useAgentProviders();
    const providerOptions = useMemo(() => buildProviderOptions(rawProviders), [rawProviders]);
    const inheritedProvider: RalphGrillAgentProvider = defaultProvider ?? 'copilot';
    const agents = getRalphGrillAgentDefinitions(depth);

    const setup = useMemo(
        () => buildSetup({
            depth,
            selections,
            defaultProvider,
            defaultModel,
        }),
        [depth, selections, defaultProvider, defaultModel],
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
                        Set grilling depth and per-role provider/model.
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
            <div className="mt-1.5 grid gap-1" data-testid={`${testIdPrefix}-agents`}>
                {agents.map(agent => (
                    <RalphGrillAgentModelRow
                        key={agent.role}
                        role={agent.role}
                        label={agent.label}
                        focus={agent.focus}
                        selection={selections[agent.role]}
                        defaultProvider={inheritedProvider}
                        defaultModel={defaultModel}
                        providerOptions={providerOptions}
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
            </div>
        </div>
    );
}
