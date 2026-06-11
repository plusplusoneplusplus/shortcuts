/**
 * NewChatArea — empty-state chat component shown when no task is selected
 * on the Activity tab. Lets the user type a message and start a new conversation.
 *
 * Visual layout matches the FollowUpInputArea redesign: a horizontal mode
 * pill row above an input card whose bottom toolbar holds the model picker,
 * inline tool buttons, and the "Send" button.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { RichTextInput } from '../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../shared/RichTextInput';
import { AttachmentPreviews } from '../../ui/AttachmentPreviews';
import { cn } from '../../ui/cn';
import { MODE_BORDER_COLORS, cycleMode, normalizeChatMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useFileAttachments } from './hooks/useFileAttachments';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { useModels } from '../../hooks/useModels';
import { useDefaultModelForMode } from '../../hooks/useDefaultModelForMode';
import { useSlashCommands } from './hooks/useSlashCommands';
import { useModelCommand, selectPickableModels } from './hooks/useModelCommand';
import { SlashCommandMenu, getMetaSkillItems, mergeSkillsWithMeta, type SkillItem } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import { ModePillSelector, getVisibleModePillOptions } from './ModePillSelector';
import { EffortPillSelector, buildEffortOptionsForModel } from './EffortPillSelector';
import type { EffortLevel } from './EffortPillSelector';
import { useOnboardingPreferences } from '../../hooks/useOnboardingPreferences';
import { usePromptAutocomplete } from '../../hooks/usePromptAutocomplete';
import { usePromptAutocompleteEnabled } from '../../hooks/usePromptAutocompleteEnabled';
import { useChatPromptHistory } from '../../hooks/useChatPromptHistory';
import { isRalphEnabled, isRalphMultiAgentGrillEnabled, isForEachEnabled, isMapReduceEnabled, isLoopsEnabled, isEffortLevelsEnabled, isSessionContextAttachmentsEnabled } from '../../utils/config';
import { useProviderEffortTiers } from '../../hooks/useProviderEffortTiers';
import type { EffortTierKey } from '../../hooks/useProviderEffortTiers';
import { EffortTierSelector } from './EffortTierSelector';
import { resolveEffortTier, resolveEffectiveTier } from '../../utils/resolveEffortTier';
import { getDraft, setDraft, clearDraft, newChatDraftKey } from './hooks/useDraftStore';
import { useAgentProviders } from '../../hooks/useAgentProviders';
import { AgentSelectorChip } from './AgentSelectorChip';
import type { ChatProvider } from './AgentSelectorChip';
import { useProviderReasoningEfforts } from '../../hooks/useProviderReasoningEfforts';
import { deriveEffort } from '../../utils/effortUtils';
import {
    AUTO_EFFORT_TIER_MAP,
    getAgentSelectorProviders,
    getConcreteProviderForClientHooks,
    getSelectableComposerDefaultProvider,
    isChatProvider,
    isSelectableProvider,
    mergeAutoProviderRoutingContext,
    shouldSendProviderOverride,
} from '../../utils/providerSelection';
import {
    cycleChatProvider,
    cycleConfiguredEffortTier,
    cycleReasoningEffort,
    getComposerArrowCycleDirection,
    isEffortCycleShortcut,
    isProviderCycleShortcut,
} from '../../utils/composerKeyboardShortcuts';
import { RalphLaunchDialog } from '../../shared/RalphLaunchDialog';
import type { ResolvedModalJobAiSelection } from '../../shared/ModalJobAiControls';
import type { RalphGrillSetup } from '../../../../../ralph/grill-planning';
import { RalphGrillSetupPanel } from './RalphGrillSetupPanel';
import { AttachedContextPreviews } from '../../ui/AttachedContextPreviews';
import { formatAttachedContext, useAttachedContext } from './hooks/useAttachedContext';
import type { AttachmentPayload } from '../../types/attachments';
import {
    dataTransferHasAnyData,
    dataTransferHasSessionContext,
    readSessionContextDropPayload,
    useConversationRetrievalCapability,
    validateSessionContextAttachmentsForSend,
    validateSessionContextDrop,
} from './sessionContextDrop';
import { useContainerWidth } from './hooks/useContainerWidth';

export interface NewChatAreaProps {
    workspaceId?: string;
    onBack?: () => void;
}

export interface InitialChatComposerSubmission {
    mode: string;
    prompt: string;
    workspaceId?: string;
    workingDirectory?: string;
    context?: Record<string, unknown>;
    attachments?: AttachmentPayload[];
    provider?: ChatProvider;
    model?: string;
    reasoningEffort?: EffortLevel;
    config?: { effortTier?: EffortTierKey };
}

export type InitialChatComposerSettingsLayout = 'full' | 'compact' | 'responsive';

export interface InitialChatComposerProps {
    workspaceId?: string;
    workspaceRoot?: string;
    onBack?: () => void;
    onSubmit: (submission: InitialChatComposerSubmission) => Promise<string | null | void>;
    onSubmitted?: (taskId: string | null) => Promise<void> | void;
    heroTitle?: string;
    heroDescription?: string;
    placeholder?: string;
    testIdPrefix?: string;
    draftKey?: string;
    sourceLabel?: string;
    enableRalphDirectGoal?: boolean;
    settingsLayout?: InitialChatComposerSettingsLayout;
}

const PROVIDER_LABELS: Record<ChatProvider, string> = {
    auto: 'Auto',
    copilot: 'Copilot',
    codex: 'Codex',
    claude: 'Claude',
};

const EFFORT_TIER_LABELS: Record<EffortTierKey, string> = {
    'very-low': 'Very Low',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
};

const EFFORT_LEVEL_LABELS: Record<EffortLevel, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra High',
};
const COMPACT_SETTINGS_POPOVER_WIDTH = 360;
const COMPACT_SETTINGS_POPOVER_MIN_CONTAINER_WIDTH = COMPACT_SETTINGS_POPOVER_WIDTH + 24;

function getEffortLabel(effort: EffortLevel | null): string {
    return effort ? EFFORT_LEVEL_LABELS[effort] : 'Auto';
}

export function NewChatArea({ workspaceId, onBack }: NewChatAreaProps) {
    const { dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();

    function getSelectedWorkspaceRoot(): string | undefined {
        const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
        return ws?.rootPath;
    }

    async function handleSubmit(submission: InitialChatComposerSubmission): Promise<string | null> {
        const result = await getSpaCocClient().queue.enqueue({
            type: 'chat',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: submission.mode as any,
                prompt: submission.prompt,
                workingDirectory: submission.workingDirectory,
                workspaceId: submission.workspaceId,
                ...(submission.context ? { context: submission.context } : {}),
                ...(submission.attachments && submission.attachments.length > 0 ? { attachments: submission.attachments } : {}),
                ...(submission.model ? { model: submission.model } : {}),
                ...(submission.reasoningEffort ? { reasoningEffort: submission.reasoningEffort } : {}),
                ...(submission.provider ? { provider: submission.provider } : {}),
            } as any,
            ...(submission.config ? { config: submission.config } : {}),
        });

        const rawId = result.task?.id ?? (result as any).id;
        return isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);
    }

    async function handleSubmitted(processId: string | null) {
        if (processId) {
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
        }
        if (!appState.onboardingProgress?.hasUsedChat) {
            await updateOnboarding({ hasUsedChat: true }).catch(() => {});
        }
    }

    return (
        <InitialChatComposer
            workspaceId={workspaceId}
            workspaceRoot={getSelectedWorkspaceRoot()}
            onBack={onBack}
            onSubmit={handleSubmit}
            onSubmitted={handleSubmitted}
            settingsLayout="responsive"
        />
    );
}

export function InitialChatComposer({
    workspaceId,
    workspaceRoot,
    onBack,
    onSubmit,
    onSubmitted,
    heroTitle = 'Start a new conversation',
    heroDescription = 'Type a message below to begin',
    placeholder = 'Reply to CoC, or type / for commands...',
    testIdPrefix = 'new-chat',
    draftKey,
    sourceLabel = 'New Chat composer',
    enableRalphDirectGoal = true,
    settingsLayout = 'full',
}: InitialChatComposerProps) {
    const [input, setInput] = useState('');
    const [cursorPos, setCursorPos] = useState(0);
    const [selectedMode, setSelectedMode] = useState<ChatMode>('ask');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionContextDropError, setSessionContextDropError] = useState<string | null>(null);
    const [sessionContextDragActive, setSessionContextDragActive] = useState(false);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(() => getSelectableComposerDefaultProvider([]));
    const [effortOverride, setEffortOverride] = useState<EffortLevel | null>(null);
    const [selectedEffortTier, setSelectedEffortTier] = useState<EffortTierKey>('medium');
    const [ralphDirectGoalDraft, setRalphDirectGoalDraft] = useState<string | null>(null);
    const [ralphGrillSetup, setRalphGrillSetup] = useState<RalphGrillSetup>({ enabled: true, depth: 'standard', agents: [] });
    const [settingsEditorOpen, setSettingsEditorOpen] = useState(false);
    const composerRootRef = useRef<HTMLDivElement>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const settingsEditorRef = useRef<HTMLDivElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const sessionContextDragDepthRef = useRef(0);
    /** Tracks the (provider, modelId) for which the user last explicitly picked an effort.
     *  When set, prevents auto-derive from overwriting the user's pick for the same model.
     *  Cleared on provider or model change (triggering re-derive for the new model). */
    const userPickedForModelRef = useRef<{ provider: ChatProvider; modelId: string } | null>(null);

    const { attachments, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();
    const attachedContext = useAttachedContext();
    const sessionContextAttachmentsEnabled = isSessionContextAttachmentsEnabled();
    const canRetrieveConversations = useConversationRetrievalCapability(workspaceId, sessionContextAttachmentsEnabled);
    const composerWidth = useContainerWidth(composerRootRef);
    const effectiveSettingsLayout: Exclude<InitialChatComposerSettingsLayout, 'responsive'> =
        settingsLayout === 'responsive'
            ? (composerWidth.width > 0 && composerWidth.isNarrow ? 'compact' : 'full')
            : settingsLayout;
    const compactSettingsEditorPlacement =
        composerWidth.width > 0 && composerWidth.width < COMPACT_SETTINGS_POPOVER_MIN_CONTAINER_WIDTH
            ? 'sheet'
            : 'popover';

    // Agent providers for the agent selector chip
    const { providers: rawAgentProviders, loading: providersLoading } = useAgentProviders();
    const agentProviders = useMemo(() => getAgentSelectorProviders(rawAgentProviders), [rawAgentProviders]);
    const selectedProviderForClientHooks = getConcreteProviderForClientHooks(selectedProvider);
    const autoProviderSelected = selectedProvider === 'auto';

    // Per-provider, per-model reasoning-effort preferences (from Admin → AI Provider → Models).
    // Used to auto-fill the effort picker when the user changes provider or model.
    const reasoningEfforts = useProviderReasoningEfforts(selectedProviderForClientHooks);

    // Per-provider effort tier map (from Admin → AI Provider → Effort Tiers).
    // Used when effortLevels.enabled is true to supply model + reasoning effort from a single tier pick.
    const { tiers: providerEffortTierMap, loading: effortTiersLoading } = useProviderEffortTiers(selectedProviderForClientHooks);
    const hasTiers = !effortTiersLoading && (['low', 'medium', 'high'] as EffortTierKey[]).some(k => !!providerEffortTierMap[k]?.model);
    const useEffortTierMode = autoProviderSelected || (isEffortLevelsEnabled() && hasTiers);
    const effortTierMap = autoProviderSelected ? AUTO_EFFORT_TIER_MAP : providerEffortTierMap;

    // Model command support
    const { models: availableModels, loading: modelsLoading } = useModels(selectedProviderForClientHooks);
    const pickableModels = selectPickableModels(availableModels);
    const augmentedSkills = useMemo(() => mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled())), [skills]);
    const slashCommands = useSlashCommands(augmentedSkills);
    const modelCommand = useModelCommand(pickableModels);
    const { effectiveModel: defaultModelId, effectiveModelName: defaultModelLabel } = useDefaultModelForMode(workspaceId, selectedMode, availableModels, selectedProviderForClientHooks);
    const validModelOverride = useMemo(() => {
        const override = modelCommand.modelOverride;
        if (!override) return null;
        return pickableModels.some(model => model.id === override) ? override : null;
    }, [modelCommand.modelOverride, pickableModels]);

    const modeFeatureFlags = useMemo(
        () => ({
            ralph: isRalphEnabled(),
            'for-each': isForEachEnabled(),
            'map-reduce': isMapReduceEnabled(),
        }),
        [],
    );
    const modePillOptions = useMemo(
        () => getVisibleModePillOptions({
            surface: 'new-chat',
            category: 'primary',
            featureFlags: modeFeatureFlags,
        }),
        [modeFeatureFlags],
    );
    const workflowModeOptions = useMemo(
        () => getVisibleModePillOptions({
            surface: 'new-chat',
            category: 'workflow',
            featureFlags: modeFeatureFlags,
        }),
        [modeFeatureFlags],
    );
    const visibleModes = useMemo(
        () => [...modePillOptions, ...workflowModeOptions].map(opt => opt.value),
        [modePillOptions, workflowModeOptions],
    );
    const activeModeLabel = useMemo(
        () => [...modePillOptions, ...workflowModeOptions].find(opt => opt.value === selectedMode)?.label ?? selectedMode,
        [modePillOptions, selectedMode, workflowModeOptions],
    );
    const compactSettingsLabel = [
        PROVIDER_LABELS[selectedProvider],
        activeModeLabel,
        useEffortTierMode ? EFFORT_TIER_LABELS[selectedEffortTier] : getEffortLabel(effortOverride),
    ].join(' · ');

    useEffect(() => {
        if (!settingsEditorOpen) return;
        const closeEditor = () => {
            setSettingsEditorOpen(false);
            if (modelCommand.modelMenuVisible) {
                modelCommand.dismissModelMenu();
            }
        };
        const handleMouseDown = (event: MouseEvent) => {
            if (settingsEditorRef.current && !settingsEditorRef.current.contains(event.target as Node)) {
                closeEditor();
            }
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeEditor();
            }
        };
        document.addEventListener('mousedown', handleMouseDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleMouseDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [modelCommand.dismissModelMenu, modelCommand.modelMenuVisible, settingsEditorOpen]);

    useEffect(() => {
        if (effectiveSettingsLayout === 'compact' || !settingsEditorOpen) return;
        setSettingsEditorOpen(false);
        if (modelCommand.modelMenuVisible) {
            modelCommand.dismissModelMenu();
        }
    }, [effectiveSettingsLayout, modelCommand.dismissModelMenu, modelCommand.modelMenuVisible, settingsEditorOpen]);

    // Restore draft from localStorage on mount / workspace switch.
    // effortOverride is intentionally NOT restored from the draft — it is
    // always re-derived from the current provider/model preferences so that
    // Admin → AI Provider settings updated since the last draft take effect.
    const draftStorageKey = useMemo(() => draftKey ?? newChatDraftKey(workspaceId), [draftKey, workspaceId]);
    useEffect(() => {
        const draft = getDraft(draftStorageKey);
        if (draft) {
            setInput(draft.text);
            setCursorPos(draft.text.length);
            richTextRef.current?.setValue(draft.text, draft.text.length);
            const draftMode = normalizeChatMode(draft.mode);
            if (draftMode) {
                setSelectedMode(visibleModes.includes(draftMode) ? draftMode : 'ask');
            }
            if (draft.modelOverride) {
                modelCommand.setModelOverride(draft.modelOverride);
            }
            // effortOverride is NOT restored — auto-derive handles it
        } else {
            setInput('');
            setCursorPos(0);
            setSelectedMode('ask');
        }
    }, [draftStorageKey, visibleModes]); // eslint-disable-line react-hooks/exhaustive-deps

    // Restore last-picked effort tier from localStorage on mount / workspace switch.
    useEffect(() => {
        const key = `coc:effort-tier:${workspaceId ?? 'default'}`;
        const stored = localStorage.getItem(key);
        if (stored === 'low' || stored === 'medium' || stored === 'high') {
            setSelectedEffortTier(stored);
        } else {
            setSelectedEffortTier('medium');
        }
    }, [workspaceId]);

    // When the selected tier becomes unconfigured (e.g., admin removed it), fall back
    // to the first available configured tier so the composer stays functional.
    useEffect(() => {
        if (!useEffortTierMode) return;
        const effective = resolveEffectiveTier(selectedEffortTier, effortTierMap);
        if (effective !== selectedEffortTier) {
            setSelectedEffortTier(effective);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [useEffortTierMode, effortTierMap]);

    // Persist draft to localStorage on input/mode/model changes (debounced)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            setDraft(draftStorageKey, input, selectedMode, modelCommand.modelOverride, effortOverride);
        }, 300);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [draftStorageKey, input, selectedMode, modelCommand.modelOverride, effortOverride]);

    // Fetch skills when workspaceId changes
    useEffect(() => {
        setSkills([]);
        if (!workspaceId) return;
        getSpaCocClient().skills.listAllWorkspace(workspaceId)
            .then((data: any) => {
                if (data?.merged && Array.isArray(data.merged)) {
                    setSkills(data.merged);
                } else if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    const getSelectableDefaultProvider = () => {
        return getSelectableComposerDefaultProvider(agentProviders);
    };

    // Load last-used provider preference for this workspace on mount / workspace switch.
    // Falls back to the configured default provider when unset, disabled, or unavailable.
    useEffect(() => {
        const fallbackProvider = getSelectableDefaultProvider();
        let cancelled = false;
        if (!workspaceId) {
            setSelectedProvider(fallbackProvider);
            return;
        }
        getSpaCocClient().preferences.getRepo(workspaceId)
            .then((prefs: any) => {
                if (cancelled) return;
                const last = prefs?.lastChatProvider;
                if (isChatProvider(last) && isSelectableProvider(last, agentProviders)) {
                    setSelectedProvider(last);
                    return;
                }
                setSelectedProvider(fallbackProvider);
            })
            .catch(() => {
                if (!cancelled) setSelectedProvider(fallbackProvider);
            });
        return () => { cancelled = true; };
    }, [workspaceId, agentProviders]);

    // When agentProviders load and selected provider becomes unavailable, fall back to the default provider.
    useEffect(() => {
        if (!isSelectableProvider(selectedProvider, agentProviders)) {
            setSelectedProvider(getSelectableDefaultProvider());
        }
    }, [agentProviders, selectedProvider]);

    // Keep model overrides scoped to the selected provider catalog. While a
    // provider's models are loading, the override is hidden and omitted from
    // sends; once loading settles, invalid overrides are cleared from state.
    useEffect(() => {
        if (autoProviderSelected) {
            if (modelCommand.modelOverride) {
                modelCommand.setModelOverride(null);
            }
            return;
        }
        if (modelsLoading || !modelCommand.modelOverride) return;
        if (!validModelOverride) {
            modelCommand.setModelOverride(null);
        }
    }, [autoProviderSelected, modelsLoading, modelCommand.modelOverride, modelCommand.setModelOverride, validModelOverride]);

    // Derive effort options from the currently effective model's supported efforts.
    const effectiveModelId = validModelOverride ?? defaultModelId;
    const effectiveModelInfo = availableModels.find(m => m.id === effectiveModelId);
    const effortOptions = buildEffortOptionsForModel(effectiveModelInfo?.supportedReasoningEfforts);
    // Disable the effort picker when the model's capabilities explicitly report no reasoning support.
    const effortPickerDisabled = Boolean(effectiveModelInfo && effectiveModelInfo.capabilities?.supports.reasoningEffort === false);

    // Auto-derive the effort override whenever the provider, effective model, or the
    // stored preferences change.  Stable string keys are used in deps so the effect
    // only fires when values actually change, not on every render.
    //
    // If the user has explicitly picked an effort for the current (provider, model)
    // combo (tracked via userPickedForModelRef), their pick is preserved.  Any
    // provider or model change clears the ref and re-derives.
    const _supportedEffortsKey = effectiveModelInfo?.supportedReasoningEfforts?.join(',') ?? '';
    const _capSupportsReasoning = !effectiveModelInfo || effectiveModelInfo.capabilities?.supports.reasoningEffort !== false;
    useEffect(() => {
        if (autoProviderSelected) {
            setEffortOverride(null);
            userPickedForModelRef.current = null;
            return;
        }
        const currentModelId = effectiveModelId ?? '';
        const pick = userPickedForModelRef.current;
        if (pick && pick.provider === selectedProvider && pick.modelId === currentModelId) {
            // User explicitly picked for this (provider, model) — preserve their choice.
            return;
        }
        const preferred = reasoningEfforts[currentModelId];
        const derived = deriveEffort(
            preferred,
            effectiveModelInfo?.supportedReasoningEfforts,
            _capSupportsReasoning,
        );
        setEffortOverride(derived);
        userPickedForModelRef.current = null;
        if (derived !== null) {
            console.debug('[coc-effort-auto-derive]', {
                trigger: pick ? 'model-or-provider-swap' : 'init',
                provider: selectedProvider,
                modelId: currentModelId,
                derivedEffort: derived,
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoProviderSelected, selectedProvider, effectiveModelId, reasoningEfforts, _supportedEffortsKey, _capSupportsReasoning]);

    /** Wraps setEffortOverride to record that the user explicitly picked for the
     *  current (provider, model) combo, preventing auto-derive from overwriting. */
    function handleEffortChange(effort: EffortLevel | null) {
        setEffortOverride(effort);
        userPickedForModelRef.current = { provider: selectedProvider, modelId: effectiveModelId ?? '' };
    }

    function handleProviderChange(provider: ChatProvider) {
        setSelectedProvider(provider);
        if (workspaceId) {
            getSpaCocClient().preferences.patchRepo(workspaceId, { lastChatProvider: provider })
                .catch(() => { /* non-fatal */ });
        }
    }

    function handleEffortTierChange(tier: EffortTierKey) {
        setSelectedEffortTier(tier);
        localStorage.setItem(`coc:effort-tier:${workspaceId ?? 'default'}`, tier);
    }

    function handleEffortShortcut(e: React.KeyboardEvent<HTMLElement>): boolean {
        if (!isEffortCycleShortcut(e)) {
            return false;
        }
        if (slashCommands.menuVisible || modelCommand.modelMenuVisible) {
            return false;
        }

        const direction = getComposerArrowCycleDirection(e.key);
        if (direction === null) {
            return false;
        }

        if (useEffortTierMode) {
            const next = cycleConfiguredEffortTier(selectedEffortTier, effortTierMap, direction);
            if (next.changed) {
                handleEffortTierChange(next.value);
            }
            e.preventDefault();
            return true;
        }

        if (!effortPickerDisabled) {
            const next = cycleReasoningEffort(effortOverride, effortOptions, direction);
            if (next.changed) {
                handleEffortChange(next.value);
            }
        }
        e.preventDefault();
        return true;
    }

    function handleProviderShortcut(e: React.KeyboardEvent<HTMLElement>): boolean {
        if (!isProviderCycleShortcut(e)) {
            return false;
        }
        if (slashCommands.menuVisible || modelCommand.modelMenuVisible) {
            return false;
        }

        const direction = getComposerArrowCycleDirection(e.key);
        if (direction === null) {
            return false;
        }

        const next = cycleChatProvider(selectedProvider, agentProviders, direction);
        if (next.changed) {
            handleProviderChange(next.value);
        }
        e.preventDefault();
        return true;
    }

    function getSelectedWorkspaceRoot(): string | undefined {
        return workspaceRoot;
    }

    function resolveComposerAiSelection(): ResolvedModalJobAiSelection {
        if (autoProviderSelected) {
            return { effortTier: selectedEffortTier, autoProviderRouting: true };
        }
        const tierPayload = useEffortTierMode ? resolveEffortTier(selectedEffortTier, effortTierMap) : null;
        const model = tierPayload?.model ?? validModelOverride ?? undefined;
        const reasoningEffort = tierPayload !== null
            ? tierPayload.reasoningEffort ?? undefined
            : effortOverride ?? undefined;
        return {
            ...(shouldSendProviderOverride(selectedProvider) ? { provider: selectedProvider } : {}),
            ...(model ? { model } : {}),
            ...(reasoningEffort ? { reasoningEffort } : {}),
        };
    }

    // Inline ghost-text autocomplete (matches FollowUpInputArea + EnqueueDialog).
    const promptAutocompleteEnabled = usePromptAutocompleteEnabled();
    const autocomplete = usePromptAutocomplete({
        text: input,
        cursorPos,
        enabled:
            promptAutocompleteEnabled
            && !sending
            && !slashCommands.menuVisible
            && !modelCommand.modelMenuVisible,
        workspaceId,
        surface: 'queue',
    });

    // Bash-style up/down history navigation through past initial prompts.
    const promptHistory = useChatPromptHistory({
        workspaceId,
        value: input,
        cursorPos,
        enabled: !sending,
        setValue: (next) => {
            setInput(next);
            setCursorPos(next.length);
            richTextRef.current?.setValue(next, next.length);
        },
    });

    async function handleSend() {
        const trimmed = input.trim();
        const contextItems = attachedContext.getItems();
        if ((!trimmed && attachments.length === 0 && contextItems.length === 0) || sending) return;
        if (selectedMode === 'for-each' || selectedMode === 'map-reduce') {
            if (!workspaceId) {
                setError(selectedMode === 'for-each'
                    ? 'Select a workspace before starting a For Each run.'
                    : 'Select a workspace before starting a Map Reduce run.');
                setSessionContextDropError(null);
                return;
            }
        }
        const sessionContextSendError = validateSessionContextAttachmentsForSend({
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId,
            currentProcessId: null,
            items: contextItems,
            canRetrieveConversations,
        });
        if (sessionContextSendError) {
            setError(null);
            setSessionContextDropError(sessionContextSendError);
            return;
        }

        setError(null);
        setSessionContextDropError(null);
        setSending(true);
        abortControllerRef.current = new AbortController();

        try {
            const workspaceRoot = getSelectedWorkspaceRoot();
            const attachmentPayload = toPayload();
            const { skills: extractedSkills, prompt: cleanedPrompt } = slashCommands.parseAndExtract(trimmed);
            const promptAfterSkillExtraction = extractedSkills.length > 0 ? cleanedPrompt : trimmed;

            let mode: string = selectedMode;
            let contextOverride: Record<string, unknown> | undefined;

            if (selectedMode === 'ralph') {
                // Grilling phase: submit as ask mode with ralph context.
                // maxIterations is intentionally omitted — the server resolves
                // it from per-repo preferences, falling back to the default.
                const grillSetup = isRalphMultiAgentGrillEnabled() ? ralphGrillSetup : undefined;
                mode = 'ask';
                contextOverride = {
                    skills: [...extractedSkills, 'grill-me'],
                    ralph: {
                        phase: 'grilling',
                        sessionId: `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        ...(grillSetup ? { grill: grillSetup } : {}),
                    },
                };
            } else if (selectedMode === 'for-each') {
                mode = 'ask';
                contextOverride = {
                    ...(extractedSkills.length > 0 ? { skills: extractedSkills } : {}),
                    forEach: {
                        kind: 'generation',
                        workspaceId,
                        generationId: `for-each-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        childMode: 'ask',
                        originalRequest: promptAfterSkillExtraction,
                        status: 'draft',
                    },
                };
            } else if (selectedMode === 'map-reduce') {
                mode = 'ask';
                contextOverride = {
                    ...(extractedSkills.length > 0 ? { skills: extractedSkills } : {}),
                    mapReduce: {
                        kind: 'generation',
                        workspaceId,
                        generationId: `map-reduce-gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                        childMode: 'ask',
                        originalRequest: promptAfterSkillExtraction,
                        status: 'draft',
                    },
                };
            } else if (extractedSkills.length > 0) {
                contextOverride = { skills: extractedSkills };
            }

            let basePrompt = promptAfterSkillExtraction;

            if (selectedMode === 'ralph') {
                basePrompt += '\n\nWhen you\'ve finished grilling me and have a clear understanding of the goal, write the final goal specification to a `.goal.md` file (e.g. `feature-name.goal.md`).';
            }
            const effectivePrompt = formatAttachedContext(contextItems) + basePrompt;

            const resolvedAi = resolveComposerAiSelection();
            const context = mergeAutoProviderRoutingContext(resolvedAi, contextOverride);
            const config = resolvedAi.effortTier ? { effortTier: resolvedAi.effortTier } : undefined;

            const submittedTaskId = await onSubmit({
                mode,
                prompt: effectivePrompt,
                workingDirectory: workspaceRoot,
                workspaceId,
                ...(context ? { context } : {}),
                ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
                ...(resolvedAi.model ? { model: resolvedAi.model } : {}),
                ...(resolvedAi.reasoningEffort ? { reasoningEffort: resolvedAi.reasoningEffort } : {}),
                ...(resolvedAi.provider ? { provider: resolvedAi.provider } : {}),
                ...(config ? { config } : {}),
            });
            await onSubmitted?.(typeof submittedTaskId === 'string' ? submittedTaskId : null);
            setInput('');
            setCursorPos(0);
            richTextRef.current?.setValue('');
            clearAttachments();
            attachedContext.clear();
            promptHistory.reset();
            clearDraft(draftStorageKey);
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setError(getSpaCocClientErrorMessage(err, 'Failed to create task'));
            }
        } finally {
            setSending(false);
            abortControllerRef.current = null;
        }
    }

    function handleOpenRalphDirectGoalDialog() {
        if (sending) return;
        setError(null);
        setRalphDirectGoalDraft(input);
    }

    async function handleRalphDirectGoalLaunched(processId: string) {
        await onSubmitted?.(processId);
        setRalphDirectGoalDraft(null);
        setInput('');
        setCursorPos(0);
        richTextRef.current?.setValue('');
        clearAttachments();
        attachedContext.clear();
        promptHistory.reset();
        clearDraft(draftStorageKey);
    }

    function handleStop() {
        abortControllerRef.current?.abort();
        setSending(false);
    }

    function resetSessionContextDragState() {
        sessionContextDragDepthRef.current = 0;
        setSessionContextDragActive(false);
    }

    function getUnsupportedSessionContextDropError(): string {
        const validation = validateSessionContextDrop({
            payload: null,
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId,
            currentProcessId: null,
            existingItems: attachedContext.getItems(),
            canRetrieveConversations,
        });
        return validation.ok ? 'Drop a supported CoC context item from this workspace to attach it as context.' : validation.error;
    }

    function handleSessionContextDragEnter(e: React.DragEvent<HTMLElement>) {
        if (!sessionContextAttachmentsEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        sessionContextDragDepthRef.current += 1;
        setSessionContextDragActive(true);
    }

    function handleSessionContextDragOver(e: React.DragEvent<HTMLElement>) {
        if (!sessionContextAttachmentsEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setSessionContextDragActive(true);
    }

    function handleSessionContextDragLeave(e: React.DragEvent<HTMLElement>) {
        if (!sessionContextAttachmentsEnabled || !dataTransferHasSessionContext(e.dataTransfer)) return;
        sessionContextDragDepthRef.current = Math.max(0, sessionContextDragDepthRef.current - 1);
        if (sessionContextDragDepthRef.current === 0) {
            setSessionContextDragActive(false);
        }
    }

    function handleSessionContextDrop(e: React.DragEvent<HTMLElement>) {
        if (!sessionContextAttachmentsEnabled) return;
        if (!dataTransferHasSessionContext(e.dataTransfer)) {
            if (dataTransferHasAnyData(e.dataTransfer)) {
                e.preventDefault();
                resetSessionContextDragState();
                setSessionContextDropError(getUnsupportedSessionContextDropError());
            }
            return;
        }
        e.preventDefault();
        resetSessionContextDragState();
        const validation = validateSessionContextDrop({
            payload: readSessionContextDropPayload(e.dataTransfer),
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId: workspaceId,
            currentProcessId: null,
            existingItems: attachedContext.getItems(),
            canRetrieveConversations,
        });
        if (!validation.ok) {
            setSessionContextDropError(validation.error);
            return;
        }
        attachedContext.addSessionContext(validation.payload);
        setSessionContextDropError(null);
    }

    function focusInputAndInsertSlash() {
        const cur = richTextRef.current?.getValue() ?? input;
        const next = cur === '' ? '/' : (cur.endsWith('/') ? cur : cur + ' /');
        setInput(next);
        richTextRef.current?.setValue(next, next.length);
        setCursorPos(next.length);
        richTextRef.current?.focus();
        slashCommands.handleInputChange(next, next.length);
    }

    function renderModelPicker(expanded = false) {
        return (
            <div className={cn('relative shrink-0', expanded && 'w-full')} data-testid="model-picker-chip-container">
                <button
                    type="button"
                    className={cn(
                        'ctool inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 min-w-0 transition-colors',
                        expanded ? 'w-full max-w-none justify-between' : 'max-w-[40vw] sm:max-w-[180px]',
                    )}
                    onClick={() => {
                        if (modelCommand.modelMenuVisible) {
                            modelCommand.dismissModelMenu();
                        } else {
                            modelCommand.showModelMenu();
                        }
                    }}
                    title={validModelOverride
                        ? `Override active: ${validModelOverride} (click to change or clear)`
                        : defaultModelLabel
                            ? `Default: ${defaultModelLabel} (click to override)`
                            : 'Pick a model'}
                    data-testid="model-picker-chip"
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
                    <svg
                        width="7" height="7"
                        viewBox="0 0 8 6"
                        fill="none"
                        aria-hidden="true"
                        className="shrink-0 opacity-60"
                    >
                        <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
                <ModelCommandMenu
                    models={modelCommand.filteredModels}
                    filter={modelCommand.modelFilter}
                    onSelect={(modelId) => {
                        modelCommand.handleModelSelect(modelId);
                        richTextRef.current?.focus();
                    }}
                    onDismiss={modelCommand.dismissModelMenu}
                    visible={modelCommand.modelMenuVisible}
                    highlightIndex={modelCommand.modelHighlightIndex}
                    currentModelId={validModelOverride ?? defaultModelId}
                    onClearOverride={modelCommand.modelOverride
                        ? () => modelCommand.setModelOverride(null)
                        : undefined}
                />
            </div>
        );
    }

    function renderEffortControl(className?: string) {
        if (useEffortTierMode) {
            return (
                <EffortTierSelector
                    tiers={effortTierMap}
                    selectedTier={selectedEffortTier}
                    onChange={handleEffortTierChange}
                    disabled={sending}
                    data-testid="effort-tier-selector"
                    className={className}
                    autoProviderMode={autoProviderSelected}
                />
            );
        }

        return (
            <EffortPillSelector
                value={effortOverride}
                onChange={handleEffortChange}
                options={effortOptions}
                disabled={effortPickerDisabled}
                disabledTitle="This model does not support reasoning effort selection"
                className={className}
            />
        );
    }

    function renderCompactSettingsEditor() {
        if (!settingsEditorOpen) return null;
        return (
            <div
                role="dialog"
                aria-label="AI settings"
                data-testid="compact-ai-settings-editor"
                data-placement={compactSettingsEditorPlacement}
                className={cn(
                    'z-[10000] max-h-[70vh] overflow-y-auto rounded-lg border border-[#d0d7de] bg-white p-2 shadow-xl dark:border-[#3c3c3c] dark:bg-[#252526]',
                    compactSettingsEditorPlacement === 'sheet'
                        ? 'fixed inset-x-2 bottom-2'
                        : 'absolute bottom-full left-0 mb-1 w-[360px]',
                )}
            >
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                        <div className="text-[11px] font-semibold text-[#1e1e1e] dark:text-[#cccccc]">AI settings</div>
                        <div className="text-[10px] text-[#6e7781] dark:text-[#9e9e9e]">Provider, mode, model, and effort</div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setSettingsEditorOpen(false);
                            if (modelCommand.modelMenuVisible) {
                                modelCommand.dismissModelMenu();
                            }
                        }}
                        className="rounded px-1.5 py-0.5 text-xs text-[#848484] hover:bg-black/[0.06] hover:text-[#1e1e1e] dark:hover:bg-white/[0.08] dark:hover:text-white"
                        data-testid="compact-ai-settings-close-btn"
                        aria-label="Close AI settings"
                    >
                        ✕
                    </button>
                </div>
                <div className="space-y-2">
                    <div className="space-y-1" data-testid="compact-ai-settings-provider-control">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[#6e7781] dark:text-[#9e9e9e]">Provider</div>
                        <AgentSelectorChip
                            providers={agentProviders}
                            loading={providersLoading}
                            selected={selectedProvider}
                            onChange={handleProviderChange}
                            disabled={sending}
                            mobileTapTarget
                        />
                    </div>
                    <div className="space-y-1" data-testid="compact-ai-settings-mode-control">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[#6e7781] dark:text-[#9e9e9e]">Mode / workflow</div>
                        <ModePillSelector
                            options={modePillOptions}
                            workflowOptions={workflowModeOptions}
                            value={selectedMode}
                            onChange={setSelectedMode}
                        />
                    </div>
                    {!autoProviderSelected && (
                        <div className="space-y-1" data-testid="compact-ai-settings-model-control">
                            <div className="text-[10px] font-medium uppercase tracking-wide text-[#6e7781] dark:text-[#9e9e9e]">Model</div>
                            {renderModelPicker(true)}
                        </div>
                    )}
                    <div className="space-y-1" data-testid="compact-ai-settings-effort-control">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-[#6e7781] dark:text-[#9e9e9e]">Effort</div>
                        {renderEffortControl()}
                    </div>
                </div>
            </div>
        );
    }

    function renderCompactSettingsChip() {
        return (
            <div ref={settingsEditorRef} className="relative min-w-0 shrink-0" data-testid="compact-ai-settings-container">
                <button
                    type="button"
                    disabled={sending}
                    onClick={() => setSettingsEditorOpen(open => !open)}
                    className={cn(
                        'ctool inline-flex h-[24px] max-w-[52vw] items-center gap-1 rounded-md border border-[#d0d7de] bg-white px-2 text-[11px] text-[#1e1e1e] shadow-sm transition-colors dark:border-[#3c3c3c] dark:bg-[#1f1f1f] dark:text-[#cccccc]',
                        'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                    )}
                    title={`${compactSettingsLabel} (click to edit AI settings)`}
                    aria-label={`AI settings: ${compactSettingsLabel}`}
                    aria-haspopup="dialog"
                    aria-expanded={settingsEditorOpen}
                    data-testid="compact-ai-settings-chip"
                >
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-[#0078d4] dark:text-[#3794ff]">
                        <path d="M3 4h10M5 8h6M7 12h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                    <span data-testid="compact-ai-settings-label" className="truncate font-mono text-[10.5px] font-medium text-[#5a5a5a] dark:text-[#cccccc]">
                        {compactSettingsLabel}
                    </span>
                    <svg
                        width="7" height="7"
                        viewBox="0 0 8 6"
                        fill="none"
                        aria-hidden="true"
                        className="shrink-0 opacity-60"
                    >
                        <path d="M1 1l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
                {renderCompactSettingsEditor()}
            </div>
        );
    }

    function renderSlashButton() {
        return (
            <button
                type="button"
                className="ctool shrink-0 inline-flex items-center gap-0.5 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
                onClick={focusInputAndInsertSlash}
                aria-label="Insert slash command"
                title="Insert slash command (/)"
                data-testid="chat-toolbar-slash-btn"
            >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 13l4-10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <span aria-hidden="true" className="font-mono text-[9px] text-[#848484]">/</span>
            </button>
        );
    }

    function renderMentionButton() {
        return (
            <button
                type="button"
                className="ctool shrink-0 inline-flex items-center gap-0.5 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
                onClick={focusInputAndInsertSlash}
                aria-label="Mention a skill"
                title="Mention a skill (@) — opens the skill picker"
                data-testid="chat-toolbar-mention-btn"
            >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 2L3 5v6l5 3 5-3V5z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                </svg>
                <span aria-hidden="true" className="font-mono text-[9px] text-[#848484]">@</span>
            </button>
        );
    }

    function renderAttachButton() {
        return (
            <button
                type="button"
                disabled={sending}
                onClick={() => fileInputRef.current?.click()}
                className="ctool shrink-0 inline-flex items-center justify-center h-[22px] w-[22px] rounded-sm text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                data-testid={`${testIdPrefix}-attach-btn`}
                aria-label="Attach file"
                title="Attach files"
            >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                        d="M10.5 4.5 5 10a2 2 0 0 0 2.83 2.83L13 7.66a3.5 3.5 0 0 0-4.95-4.95L3 7.76"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
        );
    }

    return (
        <div
            ref={composerRootRef}
            className="flex flex-col h-full bg-white dark:bg-[#1e1e1e]"
            data-testid={`${testIdPrefix}-area`}
            data-settings-layout={effectiveSettingsLayout}
        >
            {enableRalphDirectGoal && ralphDirectGoalDraft !== null && (
                <RalphLaunchDialog
                    open={ralphDirectGoalDraft !== null}
                    workspaceId={workspaceId ?? ''}
                    sourceLabel={sourceLabel}
                    goalSpec={ralphDirectGoalDraft}
                    folderPath={getSelectedWorkspaceRoot()}
                    workingDirectory={getSelectedWorkspaceRoot()}
                    editable
                    resolvedAiSelection={resolveComposerAiSelection()}
                    attachmentCount={attachments.length + attachedContext.items.length}
                    title="🔄 Start Ralph from Goal"
                    confirmLabel="🔄 Start Ralph"
                    onClose={() => setRalphDirectGoalDraft(null)}
                    onLaunched={handleRalphDirectGoalLaunched}
                />
            )}
            {/* Back button — rendered when a back handler is provided (mobile new-chat flow) */}
            {onBack && (
                <div className="flex items-center border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2">
                    <button
                        type="button"
                        onClick={onBack}
                        data-testid={`${testIdPrefix}-back-btn`}
                        aria-label="Back to list"
                        className="inline-flex items-center gap-1 text-sm text-[#0078d4] hover:text-[#005a9e] dark:text-[#3794ff] dark:hover:text-[#60aeff]"
                    >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        Back
                    </button>
                </div>
            )}
            {/* Hero area */}
            <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-[#848484]">
                    <div className="text-3xl mb-2">💬</div>
                    <div className="text-sm font-medium mb-1">{heroTitle}</div>
                    <div className="text-xs">{heroDescription}</div>
                </div>
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2 space-y-1.5">
                {error && <div className="text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-error`}>{error}</div>}
                {attachmentError && (
                    <div className="text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-attachment-error`}>{attachmentError}</div>
                )}
                {sessionContextDropError && (
                    <div className="text-xs text-[#f14c4c]" data-testid={`${testIdPrefix}-session-context-error`}>{sessionContextDropError}</div>
                )}
                <AttachedContextPreviews
                    items={attachedContext.items}
                    onRemove={attachedContext.remove}
                    data-testid={`${testIdPrefix}-attached-context-previews`}
                />
                {selectedMode === 'ralph' && isRalphMultiAgentGrillEnabled() && (
                    <RalphGrillSetupPanel
                        value={ralphGrillSetup}
                        onChange={setRalphGrillSetup}
                        defaultProvider={selectedProviderForClientHooks}
                        defaultModel={validModelOverride ?? defaultModelId}
                        defaultReasoningEffort={(useEffortTierMode
                            ? resolveEffortTier(selectedEffortTier, effortTierMap)?.reasoningEffort
                            : effortOverride) ?? undefined}
                        defaultEffortTier={selectedEffortTier}
                        effortLevelsEnabled={isEffortLevelsEnabled()}
                        composerUsesEffortTierMode={useEffortTierMode}
                        workspaceId={workspaceId}
                        disabled={sending}
                        testIdPrefix={`${testIdPrefix}-ralph-grill`}
                    />
                )}
                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    data-testid={`${testIdPrefix}-file-input-hidden`}
                    onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                            addFromFileInput(e.target.files);
                        }
                        e.target.value = '';
                    }}
                />
                <div
                    data-testid="chat-input-stack"
                    className="space-y-1"
                    onDragEnter={handleSessionContextDragEnter}
                    onDragOver={handleSessionContextDragOver}
                    onDragLeave={handleSessionContextDragLeave}
                    onDragEnd={resetSessionContextDragState}
                    onDrop={handleSessionContextDrop}
                >
                <div
                    data-testid="chat-input-bar"
                    className={cn(
                        'relative flex flex-col rounded-lg border bg-white dark:bg-[#1f1f1f] focus-within:ring-2 transition-[box-shadow,border-color]',
                        MODE_BORDER_COLORS[selectedMode].border,
                        MODE_BORDER_COLORS[selectedMode].ring,
                        sessionContextDragActive && 'border-[#0078d4] ring-2 ring-[#0078d4]/60 shadow-sm',
                    )}
                >
                    {sessionContextDragActive && (
                        <div
                            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-[#0078d4]/70 bg-[#eaf4ff]/80 text-xs font-medium text-[#005a9e] dark:bg-[#06314f]/80 dark:text-[#9cdcfe]"
                            data-testid="session-context-drop-hint"
                        >
                            Drop to copy context
                        </div>
                    )}
                    <RichTextInput
                        ref={richTextRef}
                        disabled={sending}
                        value={input}
                        ghostText={slashCommands.activeCommandHint ?? autocomplete.completion}
                        placeholder={placeholder}
                        // border-transparent + focus:ring-transparent neutralize the
                        // base RichTextInput's 1px gray border and default blue
                        // focus:ring-2, so the inner contenteditable adds no visible
                        // border or ring inside the outer card. The card itself owns
                        // the visible mode-coloured focus-within ring (see
                        // chat-input-bar above).
                        className="w-full min-h-[28px] max-h-40 overflow-y-auto rounded-t-lg border-transparent bg-transparent px-3 pt-2 pb-1 text-[13.5px] leading-[1.55] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-transparent disabled:opacity-60"
                        onChange={(val, pos) => {
                            setInput(val);
                            setCursorPos(pos);
                            if (modelCommand.modelMenuVisible) {
                                modelCommand.setModelFilter(val);
                            } else {
                                slashCommands.handleInputChange(val, pos);
                            }
                        }}
                        onKeyDown={(e) => {
                            // Priority 1: model command menu
                            if (modelCommand.handleModelKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const model = modelCommand.filteredModels[modelCommand.modelHighlightIndex];
                                    if (model) {
                                        modelCommand.handleModelSelect(model.id);
                                    }
                                }
                                return;
                            }
                            // Priority 2: slash command menu
                            if (slashCommands.handleKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                    if (skill?.name === 'model') {
                                        setInput('');
                                        richTextRef.current?.setValue('');
                                        slashCommands.dismissMenu();
                                        modelCommand.showModelMenu();
                                    } else if (skill) {
                                        slashCommands.selectSkill(skill.name, input, setInput, richTextRef);
                                        richTextRef.current?.focus();
                                    }
                                }
                                return;
                            }
                            // Priority 3: inline ghost-text accept (Tab, no modifiers).
                            if (
                                e.key === 'Tab'
                                && !e.shiftKey
                                && !e.ctrlKey && !e.metaKey && !e.altKey
                                && autocomplete.completion
                            ) {
                                e.preventDefault();
                                const next = autocomplete.accept();
                                setInput(next);
                                richTextRef.current?.setValue(next, next.length);
                                setCursorPos(next.length);
                                autocomplete.dismiss();
                                return;
                            }
                            if (e.key === 'Escape' && autocomplete.completion) {
                                e.preventDefault();
                                autocomplete.dismiss();
                                return;
                            }
                            // Priority 4: modified-arrow composer shortcuts.
                            if (handleEffortShortcut(e) || handleProviderShortcut(e)) {
                                return;
                            }
                            // Priority 5: bash-style up/down history navigation.
                            if (promptHistory.handleKeyDown(e)) {
                                return;
                            }
                            if (e.key === 'Tab' && e.shiftKey) {
                                e.preventDefault();
                                setSelectedMode(cycleMode(selectedMode, visibleModes));
                                return;
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend();
                            }
                        }}
                        onPaste={addFromPaste}
                        data-testid={`${testIdPrefix}-input`}
                    />
                    <div
                        className="flex flex-wrap items-center gap-x-px gap-y-0.5 pl-2 pr-1.5 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="chat-input-toolbar"
                    >
                        {effectiveSettingsLayout === 'compact' ? (
                            renderCompactSettingsChip()
                        ) : (
                            <>
                                {/* Provider selector — leftmost: reads as "who's running this".
                                     Followed by a divider that separates the provider zone
                                     from the mode + model + tools zones (matches the
                                     OpenDesign provider-first composer reference). */}
                                <AgentSelectorChip
                                    providers={agentProviders}
                                    loading={providersLoading}
                                    selected={selectedProvider}
                                    onChange={handleProviderChange}
                                    disabled={sending}
                                />
                                <span aria-hidden="true" data-testid="chat-toolbar-divider-provider" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                                <div data-testid="mode-selector" className="shrink-0 mr-0.5">
                                    <ModePillSelector
                                        options={modePillOptions}
                                        workflowOptions={workflowModeOptions}
                                        value={selectedMode}
                                        onChange={setSelectedMode}
                                    />
                                </div>
                                <span aria-hidden="true" data-testid="chat-toolbar-divider-mode" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                                {/* Model picker + effort pill (legacy) vs Effort Tier selector.
                                     When effortLevels.enabled is true and the active provider has
                                     at least one tier configured, the tier selector replaces both
                                     legacy controls. Falls back to legacy when flag is off or when
                                     the provider has zero tiers configured. */}
                                {useEffortTierMode ? renderEffortControl('ml-0.5') : (
                                    <>
                                        {renderModelPicker()}
                                        {/* Effort pill — picks `task.config.reasoningEffort` for
                                             models that support extended thinking. `null`
                                             (no button selected) leaves the override unset
                                             and lets the executor fall back to the model's
                                             persisted/SDK default. */}
                                        {renderEffortControl('ml-0.5')}
                                    </>
                                )}
                            </>
                        )}
                        <div className="flex-1 min-w-0" />
                        {/* Tools zone — slash/mention/attach live on the right of
                             the spacer (matches the OpenDesign composer ordering:
                             provider · mode · model · tools · send). */}
                        {effectiveSettingsLayout === 'compact' ? (
                            <>
                                {renderAttachButton()}
                                {renderSlashButton()}
                            </>
                        ) : (
                            <>
                                {renderSlashButton()}
                                {renderMentionButton()}
                                {renderAttachButton()}
                            </>
                        )}
                        <span aria-hidden="true" data-testid="chat-toolbar-divider-send" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                        {sending ? (
                            <button
                                type="button"
                                className="shrink-0 h-[24px] px-1.5 rounded-md bg-[#f14c4c] text-white text-[11px] font-medium hover:bg-[#d93636]"
                                onClick={handleStop}
                                data-testid={`${testIdPrefix}-stop-btn`}
                                title="Stop generation"
                            >
                                Stop
                            </button>
                        ) : selectedMode === 'ralph' && isRalphEnabled() ? (
                            enableRalphDirectGoal ? (
                                <div
                                    className="shrink-0 inline-flex h-[24px] rounded-md shadow-sm"
                                    data-testid={`${testIdPrefix}-ralph-submit-split`}
                                >
                                    <button
                                        type="button"
                                        disabled={!input.trim() && attachments.length === 0 && attachedContext.items.length === 0}
                                        className="inline-flex items-center gap-1 h-[24px] pl-2 pr-2 rounded-l-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        onClick={() => { void handleSend(); }}
                                        data-testid={`${testIdPrefix}-send-btn`}
                                        title="Grill (Enter) · Shift+Enter for newline"
                                    >
                                        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                            <path
                                                d="M3 4h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                                                stroke="currentColor"
                                                strokeWidth="1.2"
                                                strokeLinejoin="round"
                                            />
                                        </svg>
                                        <span>Grill</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="inline-flex items-center h-[24px] px-2 -ml-px rounded-r-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
                                        onClick={handleOpenRalphDirectGoalDialog}
                                        data-testid={`${testIdPrefix}-ralph-start-from-goal-btn`}
                                        title="Review pasted goal text and start Ralph execution"
                                    >
                                        Start from goal...
                                    </button>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    disabled={!input.trim() && attachments.length === 0 && attachedContext.items.length === 0}
                                    className="shrink-0 inline-flex items-center gap-1 h-[24px] pl-2 pr-1.5 rounded-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    onClick={() => { void handleSend(); }}
                                    data-testid={`${testIdPrefix}-send-btn`}
                                    title="Grill (Enter) · Shift+Enter for newline"
                                >
                                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                        <path
                                            d="M3 4h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                                            stroke="currentColor"
                                            strokeWidth="1.2"
                                            strokeLinejoin="round"
                                        />
                                    </svg>
                                    <span>Grill</span>
                                </button>
                            )
                        ) : selectedMode === 'for-each' && isForEachEnabled() ? (
                            <button
                                type="button"
                                disabled={!input.trim() && attachments.length === 0 && attachedContext.items.length === 0}
                                className="shrink-0 inline-flex items-center gap-1 h-[24px] pl-2 pr-1.5 rounded-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => { void handleSend(); }}
                                data-testid={`${testIdPrefix}-send-btn`}
                                title="Generate a reviewed For Each item plan"
                            >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path
                                        d="M4 3.5h8M4 8h8M4 12.5h8"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinecap="round"
                                    />
                                    <path
                                        d="M2.5 3.5h.01M2.5 8h.01M2.5 12.5h.01"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                    />
                                </svg>
                                <span>Plan items</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={!input.trim() && attachments.length === 0 && attachedContext.items.length === 0}
                                className="shrink-0 inline-flex items-center gap-1 h-[24px] pl-2 pr-1.5 rounded-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => { void handleSend(); }}
                                data-testid={`${testIdPrefix}-send-btn`}
                                title="Send (Enter) · Shift+Enter for newline"
                            >
                                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                                    <path
                                        d="M3 4h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H6.5L4 13v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
                                        stroke="currentColor"
                                        strokeWidth="1.2"
                                        strokeLinejoin="round"
                                    />
                                </svg>
                                <span>Send</span>
                                <span
                                    aria-hidden="true"
                                    className="hidden sm:inline-flex items-center pl-1.5 ml-1 border-l border-[#e0e0e0] dark:border-[#3c3c3c] text-[9px] text-[#848484] font-mono"
                                >
                                    &#x2318;&#x21B5;
                                </span>
                            </button>
                        )}
                    </div>
                    <SlashCommandMenu
                        skills={augmentedSkills}
                        filter={slashCommands.menuFilter}
                        onSelect={(name) => {
                            if (name === 'model') {
                                setInput('');
                                richTextRef.current?.setValue('');
                                slashCommands.dismissMenu();
                                modelCommand.showModelMenu();
                                richTextRef.current?.focus();
                            } else {
                                slashCommands.selectSkill(name, input, setInput, richTextRef);
                                richTextRef.current?.focus();
                            }
                        }}
                        onDismiss={slashCommands.dismissMenu}
                        visible={slashCommands.menuVisible}
                        highlightIndex={slashCommands.highlightIndex}
                    />
                </div>
                </div>
            </div>
        </div>
    );
}
