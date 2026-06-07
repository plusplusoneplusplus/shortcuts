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
import type { EffortTierKey } from '../hooks/useProviderEffortTiers';
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
    resolved: ResolvedModalJobAiSelection;
}

export { isChatProvider, isSelectableProvider };

function getTierStorageKey(workspaceId: string | undefined): string {
    return `coc:effort-tier:${workspaceId ?? 'default'}`;
}

export function useModalJobAiSelection({
    workspaceId,
    mode = 'ask',
}: UseModalJobAiSelectionOptions): UseModalJobAiSelectionResult {
    const [provider, setProviderState] = useState<ChatProvider>(() => getSelectableComposerDefaultProvider([]));
    const [effortOverride, setEffortOverrideState] = useState<EffortLevel | null>(null);
    const [selectedEffortTier, setSelectedEffortTier] = useState<EffortTierKey>('medium');
    const userPickedForModelRef = useRef<{ provider: ChatProvider; modelId: string } | null>(null);

    const { providers: rawAgentProviders, loading: providersLoading } = useAgentProviders();
    const agentProviders = useMemo(() => getAgentSelectorProviders(rawAgentProviders), [rawAgentProviders]);
    const providerForClientHooks = getConcreteProviderForClientHooks(provider);
    const autoProviderSelected = provider === 'auto';
    const { models: availableModels, loading: modelsLoading } = useModels(providerForClientHooks);
    const pickableModels = selectPickableModels(availableModels);
    const modelCommand = useModelCommand(pickableModels);
    const { effectiveModel: defaultModelId, effectiveModelName: defaultModelLabel } =
        useDefaultModelForMode(workspaceId, mode, availableModels, providerForClientHooks);
    const reasoningEfforts = useProviderReasoningEfforts(providerForClientHooks);
    const { tiers: providerEffortTierMap, loading: effortTiersLoading } = useProviderEffortTiers(providerForClientHooks);
    const hasTiers = !effortTiersLoading && (['low', 'medium', 'high'] as EffortTierKey[]).some(k => !!providerEffortTierMap[k]?.model);
    const useEffortTierMode = autoProviderSelected || (isEffortLevelsEnabled() && hasTiers);
    const effortTierMap = autoProviderSelected ? AUTO_EFFORT_TIER_MAP : providerEffortTierMap;

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
        if (!useEffortTierMode) {
            return;
        }
        const effective = resolveEffectiveTier(selectedEffortTier, effortTierMap);
        if (effective !== selectedEffortTier) {
            setSelectedEffortTier(effective);
        }
    }, [useEffortTierMode, effortTierMap, selectedEffortTier]);

    useEffect(() => {
        const fallbackProvider = getSelectableComposerDefaultProvider(agentProviders);
        let cancelled = false;
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
    }, [workspaceId, agentProviders]);

    useEffect(() => {
        if (!isSelectableProvider(provider, agentProviders)) {
            setProviderState(getSelectableComposerDefaultProvider(agentProviders));
        }
    }, [agentProviders, provider]);

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
        setProviderState(nextProvider);
        if (workspaceId) {
            getSpaCocClient().preferences.patchRepo(workspaceId, { lastChatProvider: nextProvider })
                .catch(() => { /* non-fatal */ });
        }
    };

    const setEffortTier = (tier: EffortTierKey) => {
        setSelectedEffortTier(tier);
        localStorage.setItem(getTierStorageKey(workspaceId), tier);
    };

    const setEffortOverride = (effort: EffortLevel | null) => {
        setEffortOverrideState(effort);
        userPickedForModelRef.current = { provider, modelId: effectiveModelId ?? '' };
    };

    const tierPayload = useEffortTierMode ? resolveEffortTier(selectedEffortTier, effortTierMap) : null;
    const resolved = useMemo<ResolvedModalJobAiSelection>(() => {
        if (autoProviderSelected) {
            return { effortTier: selectedEffortTier, autoProviderRouting: true };
        }
        const model = tierPayload?.model ?? validModelOverride ?? undefined;
        const reasoningEffort = tierPayload !== null ? (tierPayload.reasoningEffort ?? undefined) : (effortOverride ?? undefined);
        return {
            ...(shouldSendProviderOverride(provider) ? { provider } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
        };
    }, [autoProviderSelected, effortOverride, provider, selectedEffortTier, tierPayload, validModelOverride]);

    return {
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
