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
import { MODE_BORDER_COLORS, cycleMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { useFileAttachments } from './hooks/useFileAttachments';
import { isQueueProcessId, toQueueProcessId } from '../../utils/queue-process-id';
import { useModels } from '../../hooks/useModels';
import { useDefaultModelForMode } from '../../hooks/useDefaultModelForMode';
import { useSlashCommands } from './hooks/useSlashCommands';
import { useModelCommand } from './hooks/useModelCommand';
import { SlashCommandMenu, getMetaSkillItems, mergeSkillsWithMeta, type SkillItem } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import { ModePillSelector, DEFAULT_MODE_PILL_OPTIONS, RALPH_MODE_PILL_OPTION } from './ModePillSelector';
import { EffortPillSelector } from './EffortPillSelector';
import type { EffortLevel } from './EffortPillSelector';
import { useOnboardingPreferences } from '../../hooks/useOnboardingPreferences';
import { usePromptAutocomplete } from '../../hooks/usePromptAutocomplete';
import { usePromptAutocompleteEnabled } from '../../hooks/usePromptAutocompleteEnabled';
import { useChatPromptHistory } from '../../hooks/useChatPromptHistory';
import { getDefaultProvider, isRalphEnabled, isLoopsEnabled } from '../../utils/config';
import { getDraft, setDraft, clearDraft, newChatDraftKey } from './hooks/useDraftStore';
import { useAgentProviders } from '../../hooks/useAgentProviders';
import { AgentSelectorChip } from './AgentSelectorChip';
import type { ChatProvider } from './AgentSelectorChip';

export interface NewChatAreaProps {
    workspaceId?: string;
    onBack?: () => void;
}

function isChatProvider(value: unknown): value is ChatProvider {
    return value === 'copilot' || value === 'codex' || value === 'claude';
}

function isSelectableProvider(provider: ChatProvider, providers: Array<{ id: string; enabled: boolean; available: boolean }>): boolean {
    if (provider === 'copilot') return true;
    const status = providers.find(p => p.id === provider);
    return status?.enabled === true && status?.available === true;
}

export function NewChatArea({ workspaceId, onBack }: NewChatAreaProps) {
    const [input, setInput] = useState('');
    const [cursorPos, setCursorPos] = useState(0);
    const [selectedMode, setSelectedMode] = useState<ChatMode>('ask');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(() => getDefaultProvider());
    const [effortOverride, setEffortOverride] = useState<EffortLevel | null>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { attachments, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState } = useApp();
    const { updateOnboarding } = useOnboardingPreferences();

    // Agent providers for the agent selector chip
    const { providers: agentProviders, loading: providersLoading } = useAgentProviders();

    // Model command support
    const { models: availableModels } = useModels();
    const enabledModels = availableModels.filter(m => m.enabled);
    const augmentedSkills = useMemo(() => mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled())), [skills]);
    const slashCommands = useSlashCommands(augmentedSkills);
    const modelCommand = useModelCommand(enabledModels);
    const { effectiveModel: defaultModelId, effectiveModelName: defaultModelLabel } = useDefaultModelForMode(workspaceId, selectedMode, availableModels);

    const VALID_MODES: ChatMode[] = ['ask', 'plan', 'autopilot', 'ralph'];

    // Restore draft from localStorage on mount / workspace switch
    const draftKey = useMemo(() => newChatDraftKey(workspaceId), [workspaceId]);
    useEffect(() => {
        const draft = getDraft(draftKey);
        if (draft) {
            setInput(draft.text);
            setCursorPos(draft.text.length);
            richTextRef.current?.setValue(draft.text, draft.text.length);
            if (VALID_MODES.includes(draft.mode as ChatMode)) {
                setSelectedMode(draft.mode as ChatMode);
            }
            if (draft.modelOverride) {
                modelCommand.setModelOverride(draft.modelOverride);
            }
            if (draft.effortOverride === 'low' || draft.effortOverride === 'medium' || draft.effortOverride === 'high') {
                setEffortOverride(draft.effortOverride);
            } else {
                setEffortOverride(null);
            }
        } else {
            setInput('');
            setCursorPos(0);
            setSelectedMode('ask');
            setEffortOverride(null);
        }
    }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // Persist draft to localStorage on input/mode/model changes (debounced)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
            setDraft(draftKey, input, selectedMode, modelCommand.modelOverride, effortOverride);
        }, 300);
        return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    }, [draftKey, input, selectedMode, modelCommand.modelOverride, effortOverride]);

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
        const configuredDefault = getDefaultProvider();
        return isSelectableProvider(configuredDefault, agentProviders) ? configuredDefault : 'copilot';
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
        if (selectedProvider === 'copilot') return;
        if (!isSelectableProvider(selectedProvider, agentProviders)) {
            setSelectedProvider(getSelectableDefaultProvider());
        }
    }, [agentProviders, selectedProvider]);

    function handleProviderChange(provider: ChatProvider) {
        setSelectedProvider(provider);
        if (workspaceId) {
            getSpaCocClient().preferences.patchRepo(workspaceId, { lastChatProvider: provider })
                .catch(() => { /* non-fatal */ });
        }
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
        if ((!trimmed && attachments.length === 0) || sending) return;

        setError(null);
        setSending(true);
        abortControllerRef.current = new AbortController();

        try {
            const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
            const attachmentPayload = toPayload();
            const { skills: extractedSkills, prompt: cleanedPrompt } = slashCommands.parseAndExtract(trimmed);

            let mode: string = selectedMode;
            let contextOverride: Record<string, unknown> | undefined;

            if (selectedMode === 'ralph') {
                // Grilling phase: submit as ask mode with ralph context.
                // maxIterations is intentionally omitted — the server resolves
                // it from per-repo preferences, falling back to the default.
                mode = 'ask';
                contextOverride = {
                    skills: [...extractedSkills, 'grill-me'],
                    ralph: {
                        phase: 'grilling',
                        sessionId: `ralph-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    },
                };
            } else if (extractedSkills.length > 0) {
                contextOverride = { skills: extractedSkills };
            }

            let effectivePrompt = extractedSkills.length > 0 ? cleanedPrompt : trimmed;

            if (selectedMode === 'ralph') {
                effectivePrompt += '\n\nWhen you\'ve finished grilling me and have a clear understanding of the goal, write the final goal specification to a `.goal.md` file (e.g. `feature-name.goal.md`).';
            }

            const result = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: mode as any,
                    prompt: effectivePrompt,
                    workingDirectory: ws?.rootPath,
                    workspaceId,
                    ...(contextOverride ? { context: contextOverride } : {}),
                    ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
                    ...(modelCommand.modelOverride ? { model: modelCommand.modelOverride } : {}),
                    ...(effortOverride ? { reasoningEffort: effortOverride } : {}),
                    provider: selectedProvider,
                } as any,
            });

            const rawId = result.task?.id ?? (result as any).id;
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
            if (!appState.onboardingProgress?.hasUsedChat) {
                await updateOnboarding({ hasUsedChat: true }).catch(() => {});
            }
            setInput('');
            setCursorPos(0);
            richTextRef.current?.setValue('');
            clearAttachments();
            promptHistory.reset();
            clearDraft(draftKey);
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setError(getSpaCocClientErrorMessage(err, 'Failed to create task'));
            }
        } finally {
            setSending(false);
            abortControllerRef.current = null;
        }
    }

    function handleStop() {
        abortControllerRef.current?.abort();
        setSending(false);
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

    return (
        <div className="flex flex-col h-full bg-white dark:bg-[#1e1e1e]" data-testid="new-chat-area">
            {/* Back button — rendered when a back handler is provided (mobile new-chat flow) */}
            {onBack && (
                <div className="flex items-center border-b border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2">
                    <button
                        type="button"
                        onClick={onBack}
                        data-testid="new-chat-back-btn"
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
                    <div className="text-sm font-medium mb-1">Start a new conversation</div>
                    <div className="text-xs">Type a message below to begin</div>
                </div>
            </div>

            {/* Input area */}
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] px-3 py-2 space-y-1.5">
                {error && <div className="text-xs text-[#f14c4c]" data-testid="new-chat-error">{error}</div>}
                {attachmentError && (
                    <div className="text-xs text-[#f14c4c]" data-testid="new-chat-attachment-error">{attachmentError}</div>
                )}
                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    data-testid="new-chat-file-input-hidden"
                    onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                            addFromFileInput(e.target.files);
                        }
                        e.target.value = '';
                    }}
                />
                <div data-testid="chat-input-stack" className="space-y-1">
                <div
                    data-testid="chat-input-bar"
                    className={cn(
                        'relative flex flex-col rounded-lg border bg-white dark:bg-[#1f1f1f] focus-within:ring-2 transition-[box-shadow,border-color]',
                        MODE_BORDER_COLORS[selectedMode].border,
                        MODE_BORDER_COLORS[selectedMode].ring,
                    )}
                >
                    <RichTextInput
                        ref={richTextRef}
                        disabled={sending}
                        value={input}
                        ghostText={slashCommands.activeCommandHint ?? autocomplete.completion}
                        placeholder="Reply to CoC, or type / for commands..."
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
                            if (e.key === 'Tab' && e.shiftKey) {
                                e.preventDefault();
                                setSelectedMode(cycleMode(selectedMode));
                                return;
                            }
                            // Priority 1: model command menu
                            if (modelCommand.handleModelKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const model = modelCommand.filteredModels[modelCommand.modelHighlightIndex];
                                    if (model) {
                                        modelCommand.handleModelSelect(model.id);
                                        setInput('');
                                        richTextRef.current?.setValue('');
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
                            // Priority 4: bash-style up/down history navigation.
                            if (promptHistory.handleKeyDown(e)) {
                                return;
                            }
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSend();
                            }
                        }}
                        onPaste={addFromPaste}
                        data-testid="new-chat-input"
                    />
                    <div
                        className="flex flex-wrap items-center gap-x-px gap-y-0.5 pl-2 pr-1.5 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                        data-testid="chat-input-toolbar"
                    >
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
                                options={isRalphEnabled()
                                    ? [...DEFAULT_MODE_PILL_OPTIONS, RALPH_MODE_PILL_OPTION]
                                    : DEFAULT_MODE_PILL_OPTIONS}
                                value={selectedMode}
                                onChange={setSelectedMode}
                            />
                        </div>
                        <span aria-hidden="true" data-testid="chat-toolbar-divider-mode" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                        <button
                            type="button"
                            className="ctool shrink-0 inline-flex items-center gap-1 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 min-w-0 max-w-[40vw] sm:max-w-[180px] transition-colors"
                            onClick={() => {
                                if (modelCommand.modelMenuVisible) {
                                    modelCommand.dismissModelMenu();
                                } else {
                                    modelCommand.showModelMenu();
                                }
                            }}
                            title={modelCommand.modelOverride
                                ? `Override active: ${modelCommand.modelOverride} (click to change or clear)`
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
                                {modelCommand.modelOverride || defaultModelLabel || 'model'}
                            </span>
                            {/* Mirrors AgentSelectorChip: chevron only, no
                                 inline ✕ clear. The override is cleared via
                                 the "Use default" entry that ModelCommandMenu
                                 renders at the top when an override is set. */}
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
                        {/* Effort pill — picks `task.config.reasoningEffort` for
                             models that support extended thinking. `null`
                             (no button selected) leaves the override unset
                             and lets the executor fall back to the model's
                             persisted/SDK default. */}
                        <EffortPillSelector
                            value={effortOverride}
                            onChange={setEffortOverride}
                            className="ml-0.5"
                        />
                        <div className="flex-1 min-w-0" />
                        {/* Tools zone — slash/mention/attach live on the right of
                             the spacer (matches the OpenDesign composer ordering:
                             provider · mode · model · tools · send). */}
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
                        <button
                            type="button"
                            disabled={sending}
                            onClick={() => fileInputRef.current?.click()}
                            className="ctool shrink-0 inline-flex items-center justify-center h-[22px] w-[22px] rounded-sm text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            data-testid="new-chat-attach-btn"
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
                        <span aria-hidden="true" data-testid="chat-toolbar-divider-send" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                        {sending ? (
                            <button
                                type="button"
                                className="shrink-0 h-[24px] px-1.5 rounded-md bg-[#f14c4c] text-white text-[11px] font-medium hover:bg-[#d93636]"
                                onClick={handleStop}
                                data-testid="new-chat-stop-btn"
                                title="Stop generation"
                            >
                                Stop
                            </button>
                        ) : (
                            <button
                                type="button"
                                disabled={!input.trim() && attachments.length === 0}
                                className="shrink-0 inline-flex items-center gap-1 h-[24px] pl-2 pr-1.5 rounded-md bg-white dark:bg-[#1f1f1f] border border-[#d0d0d0] dark:border-[#3c3c3c] text-[11px] font-medium -tracking-[0.005em] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                onClick={() => { void handleSend(); }}
                                data-testid="new-chat-send-btn"
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
                    <ModelCommandMenu
                        models={modelCommand.filteredModels}
                        filter={modelCommand.modelFilter}
                        onSelect={(modelId) => {
                            modelCommand.handleModelSelect(modelId);
                            setInput('');
                            richTextRef.current?.setValue('');
                            richTextRef.current?.focus();
                        }}
                        onDismiss={modelCommand.dismissModelMenu}
                        visible={modelCommand.modelMenuVisible}
                        highlightIndex={modelCommand.modelHighlightIndex}
                        currentModelId={modelCommand.modelOverride ?? defaultModelId}
                        onClearOverride={modelCommand.modelOverride
                            ? () => modelCommand.setModelOverride(null)
                            : undefined}
                    />
                </div>
                </div>
            </div>
        </div>
    );
}
