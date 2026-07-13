/**
 * ModalJobAiControls — compact provider/model/reasoning controls for ad hoc
 * job-submission dialogs.
 *
 * This intentionally mirrors NewChatArea's provider-first behavior so modal
 * jobs can share the same workspace-scoped provider defaults, effort-tier mode,
 * and legacy model + reasoning-effort fallback without copy-pasting composer
 * state into each dialog.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { getSpaCocClient } from '../api/cocClient';
import { useAgentProviders } from '../hooks/useAgentProviders';
import { useDefaultModelForMode } from '../hooks/useDefaultModelForMode';
import type { ChatModeForModel } from '../hooks/useDefaultModelForMode';
import { useModels } from '../hooks/useModels';
import { useProviderEffortTiers } from '../hooks/useProviderEffortTiers';
import type { EffortTierKey, LocalEffortTiersMap } from '../hooks/useProviderEffortTiers';
import { useProviderReasoningEfforts } from '../hooks/useProviderReasoningEfforts';
import { isEffortLevelsEnabled } from '../utils/config';
import { deriveEffort } from '../utils/effortUtils';
import { resolveEffectiveTier, resolveEffortTier } from '../utils/resolveEffortTier';
import { AgentSelectorChip } from '../features/chat/AgentSelectorChip';
import type { ChatProvider } from '../features/chat/AgentSelectorChip';
import {
    AUTO_EFFORT_TIER_MAP,
    getAgentSelectorProviders,
    getConcreteProviderForClientHooks,
    getSelectableComposerDefaultProvider,
    isChatProvider,
    isSelectableProvider,
    shouldSendProviderOverride,
    type AgentSelectorProvider,
    type ResolvedComposerAiSelection,
} from '../utils/providerSelection';
import { EffortPillSelector, buildEffortOptionsForModel } from '../features/chat/EffortPillSelector';
import type { EffortLevel } from '../features/chat/EffortPillSelector';
import { EffortTierSelector } from '../features/chat/EffortTierSelector';
import { ModelCommandMenu } from '../features/chat/ModelCommandMenu';
import { selectPickableModels, useModelCommand } from '../features/chat/hooks/useModelCommand';

export type ResolvedModalJobAiSelection = ResolvedComposerAiSelection;

export interface UseModalJobAiSelectionOptions {
    workspaceId?: string;
    mode?: ChatModeForModel;
    initialSelection?: ResolvedModalJobAiSelection;
    /**
     * When set, overrides the locally-fetched provider list.
     * Pass this when the available providers should come from a remote target server.
     */
    externalAgentProviders?: AgentSelectorProvider[];
    /**
     * When set, overrides the locally-fetched effort-tier map per provider.
     * Key is the concrete provider id (e.g. 'copilot', 'codex'); value is the
     * normalized tier map for that provider fetched from a remote target server.
     */
    externalEffortTierMap?: Partial<Record<string, LocalEffortTiersMap>>;
}

export interface UseModalJobAiSelectionResult {
    provider: ChatProvider;
    setProvider: (provider: ChatProvider) => void;
    agentProviders: AgentSelectorProvider[];
    providersLoading: boolean;
    useEffortTierMode: boolean;
    effortTierMap: ReturnType<typeof useProviderEffortTiers>['tiers'];
    selectedEffortTier: EffortTierKey;
    setEffortTier: (tier: EffortTierKey) => void;
    modelCommand: ReturnType<typeof useModelCommand>;
    defaultModelId: string | undefined;
    defaultModelLabel: string | undefined;
    validModelOverride: string | null;
    effortOverride: EffortLevel | null;
    setEffortOverride: (effort: EffortLevel | null) => void;
    effortOptions: ReturnType<typeof buildEffortOptionsForModel>;
    effortPickerDisabled: boolean;
    dirty: boolean;
    resolved: ResolvedModalJobAiSelection;
}

export { isChatProvider, isSelectableProvider };

function getTierStorageKey(workspaceId: string | undefined): string {
    return `coc:effort-tier:${workspaceId ?? 'default'}`;
}

function isEffortLevel(value: unknown): value is EffortLevel {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';
}

function isEffortTierKey(value: unknown): value is EffortTierKey {
    return value === 'very-low' || value === 'low' || value === 'medium' || value === 'high';
}

function getInitialProvider(selection: ResolvedModalJobAiSelection | undefined): ChatProvider | undefined {
    if (!selection) {
        return undefined;
    }
    return selection.autoProviderRouting ? 'auto' : selection.provider;
}

function getInitialSelectionKey(selection: ResolvedModalJobAiSelection | undefined): string {
    if (!selection) {
        return '';
    }
    return JSON.stringify({
        provider: selection.provider,
        model: selection.model,
        reasoningEffort: selection.reasoningEffort,
        effortTier: selection.effortTier,
        autoProviderRouting: selection.autoProviderRouting === true,
    });
}

function findMatchingEffortTier(
    selection: ResolvedModalJobAiSelection,
    tiers: ReturnType<typeof useProviderEffortTiers>['tiers'],
): EffortTierKey | undefined {
    if (!selection.model) {
        return undefined;
    }
    const expectedReasoningEffort = selection.reasoningEffort ?? '';
    for (const tier of ['very-low', 'low', 'medium', 'high'] as const) {
        const entry = tiers[tier];
        if (entry?.model === selection.model
            && (entry.reasoningEffort ?? '') === expectedReasoningEffort) {
            return tier;
        }
    }
    return undefined;
}

export function useModalJobAiSelection({
    workspaceId,
    mode = 'ask',
    initialSelection,
    externalAgentProviders,
    externalEffortTierMap,
}: UseModalJobAiSelectionOptions): UseModalJobAiSelectionResult {
    const [provider, setProviderState] = useState<ChatProvider>(() => getSelectableComposerDefaultProvider([]));
    const [effortOverride, setEffortOverrideState] = useState<EffortLevel | null>(null);
    const [selectedEffortTier, setSelectedEffortTier] = useState<EffortTierKey>('medium');
    const [dirty, setDirty] = useState(false);
    const userPickedForModelRef = useRef<{ provider: ChatProvider; modelId: string } | null>(null);
    const appliedInitialSelectionKeyRef = useRef<string | null>(null);
    const initialProvider = getInitialProvider(initialSelection);
    const initialSelectionKey = getInitialSelectionKey(initialSelection);

    const { providers: rawAgentProviders, loading: rawProvidersLoading } = useAgentProviders();
    const agentProviders = useMemo(
        () => externalAgentProviders ?? getAgentSelectorProviders(rawAgentProviders),
        [externalAgentProviders, rawAgentProviders],
    );
    const providersLoading = externalAgentProviders !== undefined ? false : rawProvidersLoading;
    const providerForClientHooks = getConcreteProviderForClientHooks(provider);
    const autoProviderSelected = provider === 'auto';
    const { models: availableModels, loading: modelsLoading } = useModels(providerForClientHooks);
    const pickableModels = selectPickableModels(availableModels);
    const modelCommand = useModelCommand(pickableModels);
    const { effectiveModel: defaultModelId, effectiveModelName: defaultModelLabel } =
        useDefaultModelForMode(workspaceId, mode, availableModels, providerForClientHooks);
    const reasoningEfforts = useProviderReasoningEfforts(providerForClientHooks);
    const { tiers: localEffortTierMap, loading: rawEffortTiersLoading } = useProviderEffortTiers(providerForClientHooks);
    // When external tier data is provided for this provider, use it instead of the local fetch.
    const resolvedEffortTierMap = externalEffortTierMap !== undefined
        ? (externalEffortTierMap[providerForClientHooks] ?? {})
        : localEffortTierMap;
    const effortTiersLoading = externalEffortTierMap !== undefined ? false : rawEffortTiersLoading;
    const hasTiers = !effortTiersLoading && (['low', 'medium', 'high'] as EffortTierKey[]).some(k => !!resolvedEffortTierMap[k]?.model);
    const useEffortTierMode = autoProviderSelected || (isEffortLevelsEnabled() && hasTiers);
    const effortTierMap = autoProviderSelected ? AUTO_EFFORT_TIER_MAP : resolvedEffortTierMap;

    const validModelOverride = useMemo(() => {
        const override = modelCommand.modelOverride;
        if (!override) {
            return null;
        }
        return pickableModels.some(model => model.id === override) ? override : null;
    }, [modelCommand.modelOverride, pickableModels]);

    useEffect(() => {
        const stored = localStorage.getItem(getTierStorageKey(workspaceId));
        setSelectedEffortTier(stored === 'low' || stored === 'medium' || stored === 'high' ? stored : 'medium');
    }, [workspaceId]);

    useEffect(() => {
        if (!initialSelection) {
            appliedInitialSelectionKeyRef.current = null;
            return;
        }
        if (appliedInitialSelectionKeyRef.current === initialSelectionKey) {
            return;
        }
        appliedInitialSelectionKeyRef.current = initialSelectionKey;
        setDirty(false);
        if (initialProvider) {
            setProviderState(initialProvider);
        }
        if (isEffortTierKey(initialSelection.effortTier)) {
            setSelectedEffortTier(initialSelection.effortTier);
        }
        modelCommand.setModelOverride(initialSelection.model ?? null);
        const initialEffort = isEffortLevel(initialSelection.reasoningEffort)
            ? initialSelection.reasoningEffort
            : null;
        setEffortOverrideState(initialEffort);
        userPickedForModelRef.current = initialSelection.model
            ? { provider: initialProvider ?? provider, modelId: initialSelection.model }
            : null;
    }, [initialProvider, initialSelection, initialSelectionKey, modelCommand.setModelOverride, provider]);

    useEffect(() => {
        if (!useEffortTierMode) {
            return;
        }
        const effective = resolveEffectiveTier(selectedEffortTier, effortTierMap);
        if (effective !== selectedEffortTier) {
            setSelectedEffortTier(effective);
        }
    }, [useEffortTierMode, effortTierMap, selectedEffortTier]);

    useEffect(() => {
        if (!initialSelection || initialSelection.effortTier || !useEffortTierMode || dirty) {
            return;
        }
        const matchingTier = findMatchingEffortTier(initialSelection, effortTierMap);
        if (matchingTier && matchingTier !== selectedEffortTier) {
            setSelectedEffortTier(matchingTier);
        }
    }, [dirty, effortTierMap, initialSelection, selectedEffortTier, useEffortTierMode]);

    useEffect(() => {
        const fallbackProvider = getSelectableComposerDefaultProvider(agentProviders);
        let cancelled = false;
        if (initialProvider) {
            return;
        }
        if (!workspaceId) {
            setProviderState(fallbackProvider);
            return;
        }
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then((prefs: unknown) => {
                if (cancelled) {
                    return;
                }
                const last = typeof prefs === 'object' && prefs !== null
                    ? (prefs as { lastChatProvider?: unknown }).lastChatProvider
                    : undefined;
                setProviderState(isChatProvider(last) && isSelectableProvider(last, agentProviders) ? last : fallbackProvider);
            })
            .catch(() => {
                if (!cancelled) {
                    setProviderState(fallbackProvider);
                }
            });
        return () => { cancelled = true; };
    }, [workspaceId, agentProviders, initialProvider]);

    useEffect(() => {
        if (!isSelectableProvider(provider, agentProviders)) {
            if (initialProvider === provider) {
                return;
            }
            setProviderState(getSelectableComposerDefaultProvider(agentProviders));
        }
    }, [agentProviders, provider, initialProvider]);

    useEffect(() => {
        if (autoProviderSelected) {
            if (modelCommand.modelOverride) {
                modelCommand.setModelOverride(null);
            }
            return;
        }
        if (modelsLoading || !modelCommand.modelOverride) {
            return;
        }
        if (!validModelOverride) {
            modelCommand.setModelOverride(null);
        }
    }, [autoProviderSelected, modelsLoading, modelCommand.modelOverride, modelCommand.setModelOverride, validModelOverride]);

    const effectiveModelId = validModelOverride ?? defaultModelId;
    const effectiveModelInfo = availableModels.find(m => m.id === effectiveModelId);
    const effortOptions = buildEffortOptionsForModel(effectiveModelInfo?.supportedReasoningEfforts);
    const effortPickerDisabled = Boolean(effectiveModelInfo && effectiveModelInfo.capabilities?.supports.reasoningEffort === false);
    const supportedEffortsKey = effectiveModelInfo?.supportedReasoningEfforts?.join(',') ?? '';
    const capabilitySupportsReasoning = !effectiveModelInfo || effectiveModelInfo.capabilities?.supports.reasoningEffort !== false;

    useEffect(() => {
        if (autoProviderSelected) {
            setEffortOverrideState(null);
            userPickedForModelRef.current = null;
            return;
        }
        const currentModelId = effectiveModelId ?? '';
        const pick = userPickedForModelRef.current;
        if (pick && pick.provider === provider && pick.modelId === currentModelId) {
            return;
        }
        const preferred = reasoningEfforts[currentModelId];
        setEffortOverrideState(deriveEffort(
            preferred,
            effectiveModelInfo?.supportedReasoningEfforts,
            capabilitySupportsReasoning,
        ));
        userPickedForModelRef.current = null;
    }, [autoProviderSelected, provider, effectiveModelId, reasoningEfforts, supportedEffortsKey, capabilitySupportsReasoning, effectiveModelInfo]);

    const setProvider = (nextProvider: ChatProvider) => {
        setDirty(true);
        setProviderState(nextProvider);
        if (workspaceId) {
            getSpaCocClient().preferences.patchRepo(workspaceId, { lastChatProvider: nextProvider })
                .catch(() => { /* non-fatal */ });
        }
    };

    const setEffortTier = (tier: EffortTierKey) => {
        setDirty(true);
        setSelectedEffortTier(tier);
        localStorage.setItem(getTierStorageKey(workspaceId), tier);
    };

    const setEffortOverride = (effort: EffortLevel | null) => {
        setDirty(true);
        setEffortOverrideState(effort);
        userPickedForModelRef.current = { provider, modelId: effectiveModelId ?? '' };
    };

    const modalModelCommand = useMemo<ReturnType<typeof useModelCommand>>(() => ({
        ...modelCommand,
        setModelOverride: (model: string | null) => {
            setDirty(true);
            modelCommand.setModelOverride(model);
        },
        handleModelSelect: (modelId: string) => {
            setDirty(true);
            modelCommand.handleModelSelect(modelId);
        },
    }), [modelCommand]);

    const tierPayload = useEffortTierMode ? resolveEffortTier(selectedEffortTier, effortTierMap) : null;
    const resolved = useMemo<ResolvedModalJobAiSelection>(() => {
        if (autoProviderSelected) {
            return { effortTier: selectedEffortTier, autoProviderRouting: true };
        }
        const model = useEffortTierMode ? (tierPayload?.model ?? undefined) : (validModelOverride ?? undefined);
        const reasoningEffort = useEffortTierMode
            ? (tierPayload?.reasoningEffort ?? undefined)
            : (effortOverride ?? undefined);
        return {
            ...(shouldSendProviderOverride(provider) ? { provider } : {}),
            ...(useEffortTierMode ? { effortTier: selectedEffortTier } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
        };
    }, [autoProviderSelected, effortOverride, provider, selectedEffortTier, tierPayload, useEffortTierMode, validModelOverride]);

    return {
        provider,
        setProvider,
        agentProviders,
        providersLoading,
        useEffortTierMode,
        effortTierMap,
        selectedEffortTier,
        setEffortTier,
        modelCommand: modalModelCommand,
        defaultModelId,
        defaultModelLabel,
        validModelOverride,
        effortOverride,
        setEffortOverride,
        effortOptions,
        effortPickerDisabled,
        dirty,
        resolved,
    };
}

export interface ModalJobAiControlsProps {
    selection: UseModalJobAiSelectionResult;
    disabled?: boolean;
    className?: string;
    testIdPrefix?: string;
}

export function ModalJobAiControls({
    selection,
    disabled = false,
    className = 'flex flex-wrap items-center gap-x-px gap-y-0.5',
    testIdPrefix = 'modal-job',
}: ModalJobAiControlsProps) {
    const {
        provider,
        setProvider,
        agentProviders,
        providersLoading,
        useEffortTierMode,
        effortTierMap,
        selectedEffortTier,
        setEffortTier,
        modelCommand,
        defaultModelId,
        defaultModelLabel,
        validModelOverride,
        effortOverride,
        setEffortOverride,
        effortOptions,
        effortPickerDisabled,
    } = selection;

    return (
        <div className={className} data-testid={`${testIdPrefix}-ai-controls`}>
            <AgentSelectorChip
                providers={agentProviders}
                loading={providersLoading}
                selected={provider}
                onChange={setProvider}
                disabled={disabled}
            />
            <span
                aria-hidden="true"
                data-testid={`${testIdPrefix}-provider-divider`}
                className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0"
            />
            {useEffortTierMode ? (
                <EffortTierSelector
                    tiers={effortTierMap}
                    selectedTier={selectedEffortTier}
                    onChange={setEffortTier}
                    disabled={disabled}
                    data-testid={`${testIdPrefix}-effort-tier-selector`}
                    className="ml-0.5"
                    autoProviderMode={provider === 'auto'}
                />
            ) : (
                <>
                    <div className="relative shrink-0" data-testid={`${testIdPrefix}-model-picker-chip-container`}>
                        <button
                            type="button"
                            className="ctool inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 min-w-0 max-w-[40vw] sm:max-w-[180px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => {
                                if (modelCommand.modelMenuVisible) {
                                    modelCommand.dismissModelMenu();
                                } else {
                                    modelCommand.showModelMenu();
                                }
                            }}
                            disabled={disabled}
                            title={validModelOverride
                                ? `Override active: ${validModelOverride} (click to change or clear)`
                                : defaultModelLabel
                                    ? `Default: ${defaultModelLabel} (click to override)`
                                    : 'Pick a model'}
                            data-testid={`${testIdPrefix}-model-picker-chip`}
                            aria-haspopup="listbox"
                            aria-expanded={modelCommand.modelMenuVisible}
                        >
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
                                <polygon
                                    points="8,1 14,4.5 14,11.5 8,15 2,11.5 2,4.5"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinejoin="round"
                                />
                            </svg>
                            <span className="truncate font-mono text-[10.5px] font-medium text-[#848484] dark:text-[#999]">
                                {validModelOverride || defaultModelLabel || 'model'}
                            </span>
                            <svg width="7" height="7" viewBox="0 0 8 6" fill="none" aria-hidden="true" className="shrink-0 opacity-60">
                                <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </button>
                        <ModelCommandMenu
                            models={modelCommand.filteredModels}
                            filter={modelCommand.modelFilter}
                            onSelect={modelCommand.handleModelSelect}
                            onDismiss={modelCommand.dismissModelMenu}
                            visible={modelCommand.modelMenuVisible}
                            highlightIndex={modelCommand.modelHighlightIndex}
                            currentModelId={validModelOverride ?? defaultModelId}
                            onClearOverride={modelCommand.modelOverride ? () => modelCommand.setModelOverride(null) : undefined}
                        />
                    </div>
                    <EffortPillSelector
                        value={effortOverride}
                        onChange={setEffortOverride}
                        options={effortOptions}
                        disabled={disabled || effortPickerDisabled}
                        disabledTitle="This model does not support reasoning effort selection"
                        className="ml-0.5"
                    />
                </>
            )}
        </div>
    );
}
