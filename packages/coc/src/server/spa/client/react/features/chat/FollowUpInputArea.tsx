import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, SuggestionChips, SendButton, QueueFollowUpButton } from '../../ui';
import { AttachmentPreviews } from '../../ui/AttachmentPreviews';
import { PastePreview } from '../../ui/PastePreview';
import { AttachedContextPreviews } from '../../ui/AttachedContextPreviews';
import { cn } from '../../ui/cn';
import { RichTextInput } from '../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../shared/RichTextInput';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import { AgentSelectorChip } from './AgentSelectorChip';
import { ModePillSelector, getVisibleModePillOptions } from './ModePillSelector';
import type { ModePillOption } from './ModePillSelector';
import { EffortPillSelector } from './EffortPillSelector';
import type { EffortLevel, EffortPillOption } from './EffortPillSelector';
import { EffortTierSelector } from './EffortTierSelector';
import type { EffortTierKey, LocalEffortTiersMap } from '../../hooks/useProviderEffortTiers';
import { ComposerMetaStrip } from './ComposerMetaStrip';
import { useModifierKey } from '../../hooks/ui/useModifierKey';
import { usePromptAutocomplete } from '../../hooks/usePromptAutocomplete';
import { usePromptAutocompleteEnabled } from '../../hooks/usePromptAutocompleteEnabled';
import { useWarmClientStatus } from './hooks/useWarmClientStatus';
import { useTypingPrewarmClient } from './hooks/useTypingPrewarmClient';
import { WarmIndicatorDot } from './WarmIndicatorDot';
import { useChatPromptHistory } from '../../hooks/useChatPromptHistory';
import { MODE_BORDER_COLORS, MODE_ICONS, MODE_TOOLTIPS, cycleMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';
import type { SkillItem } from './SlashCommandMenu';
import type { ModelInfo } from '../../hooks/useModels';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import {
    cycleConfiguredEffortTier,
    cycleReasoningEffort,
    getComposerArrowCycleDirection,
    isEffortCycleShortcut,
} from '../../utils/composerKeyboardShortcuts';
import type { AttachedContextItem } from './hooks/useAttachedContext';
import type { ChatAttachment } from '../../types/attachments';
import { getPrewarmDebounceMs, isForEachEnabled, isRalphEnabled, isSessionContextAttachmentsEnabled } from '../../utils/config';
import type { SessionContextAttachmentDragPayload } from './sessionContextDrag';
import {
    dataTransferHasAnyData,
    dataTransferHasSessionContext,
    readSessionContextDropPayload,
    useConversationRetrievalCapability,
    validateSessionContextDrop,
} from './sessionContextDrop';
import type { RalphGrillSetup } from '../../../../../ralph/grill-planning';
import { RalphGrillSetupPanel } from './RalphGrillSetupPanel';
import type { ConcreteChatProvider } from '../../utils/providerSelection';

export interface FollowUpInputAreaProps {
    richTextRef: React.RefObject<RichTextInputHandle>;
    inputDisabled: boolean;
    sending: boolean;
    isActiveGeneration: boolean;
    isCancelling: boolean;
    error: string | null;
    /** Inline error that should not expose the retry affordance. */
    nonRetryableError?: string | null;
    /** Placeholder to show while disabled for a known non-expiry reason. */
    disabledPlaceholder?: string;
    resumeFeedback: { type: 'success' | 'error'; message: string; command?: string } | null;
    /** Called when the user clicks the dismiss (✕) button on the resume feedback banner. */
    onDismissResumeFeedback?: () => void;
    suggestions: string[];
    followUpInput: string;
    setFollowUpInput: (v: string) => void;
    selectedMode: ChatMode;
    setSelectedMode: (mode: ChatMode) => void;
    onSend: (overrideContent?: string, deliveryMode?: DeliveryMode) => Promise<void>;
    onRetry: () => void;
    onStop?: () => void;
    skills: SkillItem[];
    attachments: ChatAttachment[];
    onAttachmentPaste: (e: React.ClipboardEvent) => void;
    onAttachmentRemove: (id: string) => void;
    onAttachmentFiles: (files: FileList) => void;
    attachmentError: string | null;
    pastePreview: {
        charCount: number;
        previewLines: string[];
        onTextPaste: (e: React.ClipboardEvent) => void;
        clearPaste: () => void;
    } | null;
    attachedContext?: AttachedContextItem[];
    onRemoveAttachedContext?: (id: string) => void;
    onAttachSessionContext?: (payload: SessionContextAttachmentDragPayload) => void;
    /**
     * PR context chips docked inside the composer card, above the textarea
     * (design 01·B). Rendered only in the stacked layout. Pass a connected
     * `<ChatComposerPrChips />`; it self-hides when no PR is associated.
     */
    prComposerChips?: React.ReactNode;
    workspaceId?: string;
    currentProcessId?: string | null;
    sessionContextAttachmentsEnabled?: boolean;
    canRetrieveConversations?: boolean | null;
    task: any;
    slashCommands: {
        handleInputChange: (val: string, cursor: number) => void;
        handleKeyDown: (e: React.KeyboardEvent) => boolean;
        selectSkill: (
            name: string,
            input: string,
            setInput: (v: string) => void,
            ref?: React.RefObject<RichTextInputHandle>,
        ) => void;
        dismissMenu: () => void;
        menuVisible: boolean;
        menuFilter: string;
        filteredSkills: SkillItem[];
        highlightIndex: number;
        activeCommandHint?: string | null;
    };
    /** Model command state for the /model meta-command */
    modelCommand?: {
        modelMenuVisible: boolean;
        modelFilter: string;
        filteredModels: ModelInfo[];
        modelHighlightIndex: number;
        modelOverride: string | null;
        setModelOverride: (model: string | null) => void;
        handleModelSelect: (modelId: string) => void;
        showModelMenu: (filter?: string) => void;
        dismissModelMenu: () => void;
        handleModelKeyDown: (e: React.KeyboardEvent<HTMLElement>) => boolean;
        setModelFilter: (filter: string) => void;
    };
    /** Current session model ID (for showing checkmark in model picker) */
    sessionModel?: string;
    /** When true, the ask/autopilot mode selector is hidden */
    hideModeSelector?: boolean;
    /** When set, restricts mode selector to only these modes */
    allowedModes?: ChatMode[];
    /**
     * When true, the mode selector renders as a single icon-only cycling
     * button laid out alongside the input on one row (legacy compact layout).
     * Use in narrow side-by-side contexts (e.g. NoteChatPanel) where the new
     * stacked layout would not fit.
     */
    compactModeSelector?: boolean;
    /** Working directory the chat operates in. Drives the cwd chip in the toolbar's meta strip. */
    workingDirectory?: string;
    /** Total context window size in tokens. Drives the ctx fuel gauge. */
    sessionTokenLimit?: number;
    /** Tokens currently occupying the context. Drives the ctx fuel gauge fill + percent. */
    sessionCurrentTokens?: number;
    /** System-prompt token count (Copilot SDK only). */
    sessionSystemTokens?: number;
    /** Tool-definition token count (Copilot SDK only). */
    sessionToolTokens?: number;
    /** Conversation-history token count (Copilot SDK only). */
    sessionConversationTokens?: number;
    /** Active AI provider — shown as a read-only badge in the toolbar when set to 'codex' or 'claude'. */
    activeProvider?: 'copilot' | 'codex' | 'claude';
    /**
     * Current per-turn reasoning-effort override (`'low' | 'medium' | 'high' | 'xhigh'`).
     * `null` means no override — the executor falls back to the persisted
     * per-model effort, then the SDK default. When omitted, the effort pill
     * is rendered as an unselected control. Wired via `onEffortChange`.
     */
    effortOverride?: EffortLevel | null;
    /** Called when the user picks (or clears) a reasoning-effort level. */
    onEffortChange?: (value: EffortLevel | null) => void;
    /** When true, the reasoning-effort pill is visible but not selectable. */
    effortDisabled?: boolean;
    /**
     * Model-specific effort options. Pass `buildEffortOptionsForModel(model.supportedReasoningEfforts)`
     * to show only the efforts supported by the active session model.
     * Defaults to all four options when omitted.
     */
    effortOptions?: readonly EffortPillOption[];
    /**
     * When true, the Effort Tier selector replaces the model picker and effort
     * pill. Requires `effortTierMap`, `selectedEffortTier`, and
     * `onEffortTierChange` to be set.
     */
    useEffortTierMode?: boolean;
    /** Tier map for the active provider. Used when `useEffortTierMode` is true. */
    effortTierMap?: LocalEffortTiersMap;
    /** Currently selected effort tier. Used when `useEffortTierMode` is true. */
    selectedEffortTier?: EffortTierKey;
    /** Called when the user picks a tier. Used when `useEffortTierMode` is true. */
    onEffortTierChange?: (tier: EffortTierKey) => void;
    /** Enables the gated Ralph multi-agent grill setup UI for promotion. */
    ralphMultiAgentGrillEnabled?: boolean;
    /** Current multi-agent grill setup state for promotion. */
    ralphGrillSetup?: RalphGrillSetup;
    /** Called when the user edits the promotion grill setup. */
    onRalphGrillSetupChange?: (setup: RalphGrillSetup) => void;
    /** Provider inherited by agent rows before the user customizes a row. */
    ralphGrillDefaultProvider?: ConcreteChatProvider;
    /** Model inherited by agent rows before the user customizes a row. */
    ralphGrillDefaultModel?: string;
    /** Reasoning effort inherited by agent rows when effort levels are disabled. */
    ralphGrillDefaultReasoningEffort?: string | null;
    /** Effort tier inherited by agent rows before the user customizes a row. */
    ralphGrillDefaultEffortTier?: EffortTierKey;
    /** Whether effort levels are enabled globally for the grill setup panel. */
    ralphGrillEffortLevelsEnabled?: boolean;
    /** Whether the composer currently resolves model/effort through effort tiers. */
    ralphGrillComposerUsesEffortTierMode?: boolean;
}

export function FollowUpInputArea({
    richTextRef,
    inputDisabled,
    sending,
    isActiveGeneration,
    isCancelling,
    error,
    nonRetryableError = null,
    disabledPlaceholder,
    resumeFeedback,
    onDismissResumeFeedback,
    suggestions,
    followUpInput,
    setFollowUpInput,
    selectedMode,
    setSelectedMode,
    onSend,
    onRetry,
    onStop,
    skills,
    attachments,
    onAttachmentPaste,
    onAttachmentRemove,
    onAttachmentFiles,
    attachmentError,
    pastePreview,
    attachedContext,
    onRemoveAttachedContext,
    onAttachSessionContext,
    prComposerChips,
    workspaceId,
    currentProcessId,
    sessionContextAttachmentsEnabled: sessionContextAttachmentsEnabledProp,
    canRetrieveConversations: canRetrieveConversationsProp,
    task,
    slashCommands,
    modelCommand,
    sessionModel,
    hideModeSelector = false,
    allowedModes,
    compactModeSelector = false,
    workingDirectory,
    sessionTokenLimit,
    sessionCurrentTokens,
    sessionSystemTokens,
    sessionToolTokens,
    sessionConversationTokens,
    activeProvider,
    effortOverride = null,
    onEffortChange,
    effortOptions,
    effortDisabled = false,
    useEffortTierMode = false,
    effortTierMap,
    selectedEffortTier,
    onEffortTierChange,
    ralphMultiAgentGrillEnabled = false,
    ralphGrillSetup,
    onRalphGrillSetupChange,
    ralphGrillDefaultProvider,
    ralphGrillDefaultModel,
    ralphGrillDefaultReasoningEffort,
    ralphGrillDefaultEffortTier,
    ralphGrillEffortLevelsEnabled = true,
    ralphGrillComposerUsesEffortTierMode = false,
}: FollowUpInputAreaProps) {
    const inputWrapperRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const modHeld = useModifierKey(inputWrapperRef as RefObject<HTMLElement>);
    // Global (unscoped) detection so chips show the "send" state even when input isn't focused.
    const chipsCtrlHeld = useModifierKey();

    const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
    const [sessionContextDropError, setSessionContextDropError] = useState<string | null>(null);
    const [sessionContextDragActive, setSessionContextDragActive] = useState(false);
    const sessionContextDragDepthRef = useRef(0);
    const activeWorkspaceId = workspaceId ?? task?.metadata?.workspaceId ?? task?.workspaceId ?? task?.payload?.workspaceId;
    const activeProcessId = currentProcessId ?? task?.processId ?? task?.id ?? null;
    const sessionContextAttachmentsEnabled = sessionContextAttachmentsEnabledProp ?? isSessionContextAttachmentsEnabled();
    const localCanRetrieveConversations = useConversationRetrievalCapability(
        activeWorkspaceId,
        sessionContextAttachmentsEnabled && canRetrieveConversationsProp === undefined,
    );
    const canRetrieveConversations = canRetrieveConversationsProp ?? localCanRetrieveConversations;

    // Subscribe to the conversation process's real-time warm status, pushed from the
    // backend WarmClientRegistry over a warm-only SSE channel (AC-02). The
    // returned status feeds the tiny warm indicator next to the send
    // button. The subscription stays open across an active turn (so the dot
    // shows green while a reply is generating) and across completion (so it
    // catches the active → warm transition on a finished conversation); only the
    // absence of a process gates it. The stream is the single source of truth for
    // the dot — providers that never warm (e.g. Claude) emit only `cold`.
    const warmStatus = useWarmClientStatus({
        workspaceId: activeWorkspaceId,
        processId: activeProcessId,
    });

    // Side-effect half: prewarm the backend client while the user types a
    // follow-up, so a cold completed chat actually warms (and the stream above
    // can then show the transition). Gated off while the session is unavailable
    // or a turn is already in flight; the prewarm response never sets the dot.
    useTypingPrewarmClient({
        input: followUpInput,
        workspaceId: activeWorkspaceId,
        processId: activeProcessId,
        enabled: !inputDisabled && !sending && !isActiveGeneration,
        debounceMs: getPrewarmDebounceMs(),
    });

    // Reset dismiss state whenever a new set of suggestions arrives.
    useEffect(() => { setSuggestionsDismissed(false); }, [suggestions]);

    // Mobile/tablet (≤1023px) overflow ("⋯") menu state for the inner
    // toolbar's low-priority tool actions (slash / mention / attach). On
    // desktop (lg+) those actions render inline and this menu is hidden, so
    // the desktop layout is unchanged.
    const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
    const toolsMenuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!toolsMenuOpen) return;
        function handleClick(e: MouseEvent) {
            if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
                setToolsMenuOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [toolsMenuOpen]);

    // Sync programmatic followUpInput changes(draft restore, clear after send) to the editor.
    // Guard prevents re-setting when the change originated from the user typing.
    // skipNextSyncRef is set by selectSkill callers so the effect does not overwrite the cursor
    // position that selectSkill already placed synchronously via ref.current.setValue(text, cursor).
    const skipNextSyncRef = useRef(false);
    useEffect(() => {
        if (skipNextSyncRef.current) {
            skipNextSyncRef.current = false;
            return;
        }
        if (richTextRef.current && richTextRef.current.getValue() !== followUpInput) {
            richTextRef.current.setValue(followUpInput);
        }
    }, [followUpInput]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Inline ghost-text autocomplete ──
    const [followUpCursorPos, setFollowUpCursorPos] = useState(0);
    const promptAutocompleteEnabled = usePromptAutocompleteEnabled();
    const autocomplete = usePromptAutocomplete({
        text: followUpInput,
        cursorPos: followUpCursorPos,
        enabled:
            promptAutocompleteEnabled
            && !inputDisabled
            && !slashCommands.menuVisible
            && !(modelCommand?.modelMenuVisible ?? false),
        workspaceId: task?.metadata?.workspaceId,
        processId: task?.id,
        surface: 'follow-up',
    });

    const pillOptions: ModePillOption[] = (() => {
        return [...getVisibleModePillOptions({
            surface: 'follow-up',
            featureFlags: {
                ralph: isRalphEnabled(),
                'for-each': isForEachEnabled(),
            },
            allowedModes,
        })];
    })();

    // ── Bash-style up/down history navigation through past user prompts ──
    const promptHistory = useChatPromptHistory({
        workspaceId: task?.metadata?.workspaceId,
        value: followUpInput,
        cursorPos: followUpCursorPos,
        enabled: !inputDisabled,
        setValue: (next) => {
            setFollowUpInput(next);
            setFollowUpCursorPos(next.length);
            richTextRef.current?.setValue(next, next.length);
        },
    });

    // Shared handler for the editor key events, used by both layouts.
    function handleEditorKeyDown(e: React.KeyboardEvent<HTMLElement>) {
        // Priority 1: model command menu
        if (modelCommand?.handleModelKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const model = modelCommand.filteredModels[modelCommand.modelHighlightIndex];
                if (model) {
                    modelCommand.handleModelSelect(model.id);
                }
            }
            return;
        }
        // Priority 2: slash command menu (skills + /model entry)
        if (slashCommands.handleKeyDown(e)) {
            if (e.key === 'Enter' || e.key === 'Tab') {
                const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                if (skill) {
                    if (skill.name === 'model' && modelCommand) {
                        setFollowUpInput('');
                        richTextRef.current?.setValue('');
                        slashCommands.dismissMenu();
                        modelCommand.showModelMenu();
                    } else {
                        skipNextSyncRef.current = true;
                        slashCommands.selectSkill(skill.name, followUpInput, setFollowUpInput, richTextRef);
                    }
                }
            }
            return;
        }
        // Priority 3: inline ghost-text accept (Tab, no modifiers).
        if (
            e.key === 'Tab'
            && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
            && autocomplete.completion
        ) {
            e.preventDefault();
            const next = autocomplete.accept();
            skipNextSyncRef.current = true;
            setFollowUpInput(next);
            richTextRef.current?.setValue(next, next.length);
            setFollowUpCursorPos(next.length);
            autocomplete.dismiss();
            return;
        }
        if (e.key === 'Escape' && autocomplete.completion) {
            e.preventDefault();
            autocomplete.dismiss();
            return;
        }
        // Priority 4: modified-arrow composer shortcuts.
        if (handleEffortShortcut(e)) {
            return;
        }
        // Priority 5: bash-style up/down history navigation.
        if (promptHistory.handleKeyDown(e)) {
            return;
        }
        if (e.key === 'Tab' && e.shiftKey) {
            e.preventDefault();
            setSelectedMode(cycleMode(selectedMode, allowedModes));
            return;
        }
        if (e.key === 'Enter') {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                void onSend(undefined, 'immediate');
            } else if (!e.shiftKey) {
                e.preventDefault();
                void onSend(undefined, 'enqueue');
            }
        }
    }

    function handleEffortShortcut(e: React.KeyboardEvent<HTMLElement>): boolean {
        if (!isEffortCycleShortcut(e)) {
            return false;
        }
        if (slashCommands.menuVisible || (modelCommand?.modelMenuVisible ?? false)) {
            return false;
        }

        const direction = getComposerArrowCycleDirection(e.key);
        if (direction === null) {
            return false;
        }

        if (useEffortTierMode) {
            if (!selectedEffortTier || !onEffortTierChange || !effortTierMap) {
                return false;
            }
            const next = cycleConfiguredEffortTier(selectedEffortTier, effortTierMap, direction);
            if (next.changed) {
                onEffortTierChange(next.value);
            }
            e.preventDefault();
            return true;
        }

        if (!onEffortChange) {
            return false;
        }
        if (!effortDisabled) {
            const next = cycleReasoningEffort(effortOverride, effortOptions, direction);
            if (next.changed) {
                onEffortChange(next.value);
            }
        }
        e.preventDefault();
        return true;
    }

    function handleEditorChange(val: string, cursorPos: number) {
        setFollowUpInput(val);
        setFollowUpCursorPos(cursorPos);
        if (modelCommand?.modelMenuVisible) {
            modelCommand.setModelFilter(val);
        } else {
            slashCommands.handleInputChange(val, cursorPos);
        }
    }

    function handleSlashSelect(name: string) {
        if (name === 'model' && modelCommand) {
            setFollowUpInput('');
            richTextRef.current?.setValue('');
            slashCommands.dismissMenu();
            modelCommand.showModelMenu();
            richTextRef.current?.focus();
        } else {
            skipNextSyncRef.current = true;
            slashCommands.selectSkill(name, followUpInput, setFollowUpInput, richTextRef);
            richTextRef.current?.focus();
        }
    }

    function resetSessionContextDragState() {
        sessionContextDragDepthRef.current = 0;
        setSessionContextDragActive(false);
    }

    function getUnsupportedSessionContextDropError(): string {
        const validation = validateSessionContextDrop({
            payload: null,
            featureEnabled: sessionContextAttachmentsEnabled,
            activeWorkspaceId,
            currentProcessId: activeProcessId,
            existingItems: attachedContext ?? [],
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
            activeWorkspaceId,
            currentProcessId: activeProcessId,
            existingItems: attachedContext ?? [],
            canRetrieveConversations,
        });
        if (!validation.ok) {
            setSessionContextDropError(validation.error);
            return;
        }
        onAttachSessionContext?.(validation.payload);
        setSessionContextDropError(null);
    }

    function focusInputAndInsertSlash() {
        const cur = richTextRef.current?.getValue() ?? followUpInput;
        const next = cur.endsWith('/') || cur === '' ? (cur === '' ? '/' : cur) : cur + ' /';
        skipNextSyncRef.current = true;
        setFollowUpInput(next);
        richTextRef.current?.setValue(next, next.length);
        setFollowUpCursorPos(next.length);
        richTextRef.current?.focus();
        slashCommands.handleInputChange(next, next.length);
    }

    const stopButton = (
        <button
            type="button"
            className={cn(
                'shrink-0 rounded bg-[#f14c4c] text-white font-medium hover:bg-[#d93636] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-[#f14c4c]',
                compactModeSelector
                    ? 'h-[34px] px-2 sm:px-3 text-sm'
                    : 'h-8 px-2 lg:h-[24px] lg:px-1.5 text-[11px]',
            )}
            onClick={() => {
                if (!isCancelling) onStop?.();
            }}
            disabled={isCancelling}
            data-testid="activity-chat-stop-btn"
            title={isCancelling ? 'Stopping generation' : 'Stop generation'}
        >
            {isCancelling ? 'Stopping...' : 'Stop'}
        </button>
    );

    const compactPlaceholder = inputDisabled && !isActiveGeneration
        ? (disabledPlaceholder ?? 'Session expired.')
        : 'Send a message... (type / for commands)';
    const stackedPlaceholder = inputDisabled && !isActiveGeneration
        ? (disabledPlaceholder ?? 'Session expired.')
        : 'Reply to CoC, or type / for commands...';

    const hiddenFileInput = (
        <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="follow-up-file-input-hidden"
            onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                    onAttachmentFiles(e.target.files);
                }
                e.target.value = '';
            }}
        />
    );

    return (
        <div
            className={cn(
                'border-t border-[#e0e0e0] dark:border-[#3c3c3c]',
                compactModeSelector ? 'p-3 space-y-2' : 'px-3 py-2 space-y-1.5',
            )}
        >
            {resumeFeedback && (
                <div className={`flex items-start gap-1 text-xs ${resumeFeedback.type === 'error' ? 'text-[#f14c4c]' : 'text-[#6a9955] dark:text-[#89d185]'}`}>
                    <span className="flex-1">
                        {resumeFeedback.message}
                        {resumeFeedback.command && (
                            <div className="mt-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] px-2 py-1 font-mono text-[11px] break-all text-[#1e1e1e] dark:text-[#cccccc]">
                                {resumeFeedback.command}
                            </div>
                        )}
                    </span>
                    {onDismissResumeFeedback && (
                        <button
                            type="button"
                            className="shrink-0 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] cursor-pointer leading-none"
                            onClick={onDismissResumeFeedback}
                            aria-label="Dismiss"
                            title="Dismiss"
                        >✕</button>
                    )}
                </div>
            )}
            {nonRetryableError && (
                <div
                    className="chat-error-bubble bubble-error text-xs text-[#f14c4c]"
                    data-testid="follow-up-inline-error"
                >
                    {nonRetryableError}
                </div>
            )}
            {error && <div className="chat-error-bubble bubble-error text-xs text-[#f14c4c]">{error}</div>}
            {error && (
                <Button
                    variant="danger"
                    size="sm"
                    data-testid="retry-btn"
                    loading={sending}
                    disabled={sending}
                    onClick={onRetry}
                >
                    Retry
                </Button>
            )}
            {suggestions.length > 0 && !sending && !isActiveGeneration && !suggestionsDismissed && (
                <div className="relative">
                    <SuggestionChips
                        suggestions={suggestions}
                        onSelect={(text, e) => {
                            if (e.ctrlKey || e.metaKey) {
                                void onSend(text);
                            } else {
                                setFollowUpInput(text);
                                richTextRef.current?.setValue(text);
                                richTextRef.current?.focus();
                            }
                        }}
                        disabled={inputDisabled}
                        ctrlHeld={chipsCtrlHeld}
                    />
                    <button
                        type="button"
                        className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] hover:bg-[#c8c8c8] dark:hover:bg-[#4e4e4e] text-[10px] leading-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0078d4]/50"
                        onClick={() => setSuggestionsDismissed(true)}
                        aria-label="Dismiss suggestions"
                        title="Dismiss suggestions"
                        data-testid="dismiss-suggestions-btn"
                    >
                        ✕
                    </button>
                </div>
            )}
            {attachedContext && onRemoveAttachedContext && (
                <AttachedContextPreviews items={attachedContext} onRemove={onRemoveAttachedContext} />
            )}
            {sessionContextDropError && (
                <div className="text-xs text-[#f14c4c]" data-testid="follow-up-session-context-error">{sessionContextDropError}</div>
            )}
            {attachmentError && (
                <div className="text-xs text-[#f14c4c]" data-testid="follow-up-attachment-error">{attachmentError}</div>
            )}
            <AttachmentPreviews attachments={attachments} onRemove={onAttachmentRemove} />
            {pastePreview && pastePreview.charCount > 0 && (
                <PastePreview
                    charCount={pastePreview.charCount}
                    previewLines={pastePreview.previewLines}
                    onDismiss={pastePreview.clearPaste}
                />
            )}
            {compactModeSelector ? (
                /* ── Legacy compact single-row layout for narrow side panels ── */
                <div
                    className={cn(
                        'relative flex flex-row items-center gap-2',
                        sessionContextDragActive && 'border-[#0078d4] ring-2 ring-[#0078d4]/60 shadow-sm',
                    )}
                    data-testid="chat-input-bar"
                    onDragEnter={handleSessionContextDragEnter}
                    onDragOver={handleSessionContextDragOver}
                    onDragLeave={handleSessionContextDragLeave}
                    onDragEnd={resetSessionContextDragState}
                    onDrop={handleSessionContextDrop}
                >
                    {sessionContextDragActive && (
                        <div
                            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded border-2 border-dashed border-[#0078d4]/70 bg-[#eaf4ff]/80 text-xs font-medium text-[#005a9e] dark:bg-[#06314f]/80 dark:text-[#9cdcfe]"
                            data-testid="session-context-drop-hint"
                        >
                            Drop to copy context
                        </div>
                    )}
                    {hiddenFileInput}
                    <button
                        type="button"
                        disabled={inputDisabled}
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0 h-[34px] w-[34px] flex items-center justify-center rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="follow-up-attach-btn"
                        aria-label="Attach file"
                        title="Attach files"
                    >
                        +
                    </button>
                    {!hideModeSelector && (
                        <div className="shrink-0" data-testid="mode-selector">
                            <button
                                type="button"
                                onClick={() => setSelectedMode(cycleMode(selectedMode, allowedModes))}
                                className="h-[34px] px-2 flex items-center gap-0.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-base cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50"
                                data-testid="mode-cycle-btn"
                                aria-label={`Mode: ${selectedMode}. Tap to switch.`}
                                title={MODE_TOOLTIPS[selectedMode] + ' (Shift+Tab to cycle)'}
                            >
                                <span>{MODE_ICONS[selectedMode]}</span>
                                <span className="text-[10px] text-[#848484] leading-none" aria-hidden="true">▾</span>
                            </button>
                        </div>
                    )}
                    <div ref={inputWrapperRef} className="relative flex-1 min-w-0">
                        <RichTextInput
                            ref={richTextRef}
                            disabled={inputDisabled}
                            value={followUpInput}
                            ghostText={slashCommands.activeCommandHint ?? autocomplete.completion}
                            placeholder={compactPlaceholder}
                            className={cn(
                                'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                                MODE_BORDER_COLORS[selectedMode].border,
                                MODE_BORDER_COLORS[selectedMode].ring,
                            )}
                            onChange={handleEditorChange}
                            onKeyDown={handleEditorKeyDown}
                            onPaste={(e: React.ClipboardEvent) => {
                                onAttachmentPaste(e);
                                pastePreview?.onTextPaste(e);
                            }}
                            data-testid="activity-chat-input"
                        />
                        <SlashCommandMenu
                            skills={skills}
                            filter={slashCommands.menuFilter}
                            onSelect={handleSlashSelect}
                            onDismiss={slashCommands.dismissMenu}
                            visible={slashCommands.menuVisible}
                            highlightIndex={slashCommands.highlightIndex}
                        />
                        {modelCommand && (
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
                                currentModelId={modelCommand.modelOverride || sessionModel}
                                onClearOverride={modelCommand.modelOverride
                                    ? () => modelCommand.setModelOverride(null)
                                    : undefined}
                            />
                        )}
                    </div>
                    {modelCommand?.modelOverride && (
                        <div
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="model-override-badge"
                        >
                            <span className="truncate max-w-[120px]">{modelCommand.modelOverride}</span>
                            <button
                                type="button"
                                className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] cursor-pointer"
                                onClick={() => modelCommand.setModelOverride(null)}
                                aria-label="Clear model override"
                                title="Clear model override"
                            >✕</button>
                        </div>
                    )}
                    <WarmIndicatorDot status={warmStatus} className="mx-1" />
                    {isActiveGeneration ? stopButton : (
                        <SendButton
                            disabled={inputDisabled || sending}
                            ctrlHeld={modHeld}
                            onSend={(dm) => { void onSend(undefined, dm); }}
                        />
                    )}
                </div>
            ) : (
                /* ── Stacked layout: input card whose bottom toolbar holds the
                     mode pill selector (first), model picker, slash/mention/
                     attach buttons, and the QueueFollowUpButton. The toolbar
                     wraps vertically on narrow screens (mobile-responsive).
                     Visual style mirrors the OpenDesign chats.html reference:
                     uniform h-[26px] ctool buttons with rounded-sm corners,
                     subtle hover, and a darker focus-within ring. ── */
                <div className="space-y-1" data-testid="chat-input-stack">
                    {hiddenFileInput}
                    {selectedMode === 'ralph' && (
                        <div
                            className="text-[11px] text-purple-600 dark:text-purple-400 px-1"
                            data-testid="follow-up-ralph-hint"
                        >
                            Promotes this chat to a Ralph session. Optional: type a one-line hint to focus the goal.
                        </div>
                    )}
                    {selectedMode === 'ralph' && ralphMultiAgentGrillEnabled && ralphGrillSetup && onRalphGrillSetupChange && (
                        <RalphGrillSetupPanel
                            value={ralphGrillSetup}
                            onChange={onRalphGrillSetupChange}
                            defaultProvider={ralphGrillDefaultProvider}
                            defaultModel={ralphGrillDefaultModel}
                            defaultReasoningEffort={ralphGrillDefaultReasoningEffort}
                            defaultEffortTier={ralphGrillDefaultEffortTier}
                            effortLevelsEnabled={ralphGrillEffortLevelsEnabled}
                            composerUsesEffortTierMode={ralphGrillComposerUsesEffortTierMode}
                            workspaceId={activeWorkspaceId}
                            disabled={sending || inputDisabled}
                            testIdPrefix="follow-up-ralph-grill"
                        />
                    )}
                    <div
                        ref={inputWrapperRef}
                        data-testid="chat-input-bar"
                        onDragEnter={handleSessionContextDragEnter}
                        onDragOver={handleSessionContextDragOver}
                        onDragLeave={handleSessionContextDragLeave}
                        onDragEnd={resetSessionContextDragState}
                        onDrop={handleSessionContextDrop}
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
                        {prComposerChips}
                        <RichTextInput
                            ref={richTextRef}
                            disabled={inputDisabled}
                            value={followUpInput}
                            ghostText={slashCommands.activeCommandHint ?? autocomplete.completion}
                            placeholder={stackedPlaceholder}
                            // border-transparent + focus:ring-transparent neutralize the
                            // base RichTextInput's 1px gray border and default blue
                            // focus:ring-2, so the inner contenteditable adds no visible
                            // border or ring inside the outer card. The card itself
                            // owns the visible mode-coloured focus-within ring (see
                            // chat-input-bar above), and the toolbar above carries
                            // the only horizontal divider via its own border-t.
                            className="w-full min-h-[28px] max-h-40 overflow-y-auto rounded-t-lg border-transparent bg-transparent px-3 pt-2 pb-1 text-[13.5px] leading-[1.55] text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-transparent disabled:opacity-60"
                            onChange={handleEditorChange}
                            onKeyDown={handleEditorKeyDown}
                            onPaste={(e: React.ClipboardEvent) => {
                                onAttachmentPaste(e);
                                pastePreview?.onTextPaste(e);
                            }}
                            data-testid="activity-chat-input"
                        />
                        <div
                            className="flex flex-nowrap lg:flex-wrap items-center gap-x-px gap-y-0.5 pl-2 pr-1.5 py-1 border-t border-[#e0e0e0] dark:border-[#3c3c3c]"
                            data-testid="chat-input-toolbar"
                        >
                            {/* Agent provider chip — leftmost, always disabled because
                                 agent switching mid-session is not yet supported. The chip
                                 mirrors the NewChatArea layout ("provider · mode · model")
                                 so both composers share the same visual order. */}
                            <AgentSelectorChip
                                providers={[]}
                                loading={false}
                                selected={activeProvider ?? 'copilot'}
                                onChange={() => {}}
                                disabled={true}
                                disabledReason="locked to this conversation"
                                mobileTapTarget={true}
                            />
                            <span aria-hidden="true" data-testid="chat-toolbar-divider-provider" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                            {/* Mode pill selector — first in toolbar (desktop ≥1024px). */}
                            {!hideModeSelector && (
                                <div data-testid="mode-selector" className="shrink-0 mr-0.5 hidden lg:flex">
                                    <ModePillSelector
                                        options={pillOptions}
                                        value={selectedMode}
                                        onChange={(m) => setSelectedMode(m)}
                                    />
                                </div>
                            )}
                            {/* Compact mode cycle button — mobile/tablet (≤1023px)
                                 only. The segmented ModePillSelector is too wide for
                                 a single row on phones, so it collapses to a single
                                 tap-to-cycle button here. */}
                            {!hideModeSelector && (
                                <button
                                    type="button"
                                    onClick={() => setSelectedMode(cycleMode(selectedMode, allowedModes))}
                                    className="ctool lg:hidden shrink-0 inline-flex items-center gap-0.5 h-8 px-2 mr-0.5 rounded-sm border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
                                    data-testid="mode-cycle-btn-compact"
                                    aria-label={`Mode: ${selectedMode}. Tap to switch.`}
                                    title={MODE_TOOLTIPS[selectedMode] + ' (tap to cycle)'}
                                >
                                    <span>{MODE_ICONS[selectedMode]}</span>
                                    <span className="text-[10px] text-[#848484] leading-none" aria-hidden="true">▾</span>
                                </button>
                            )}
                            {/* Divider between the mode zone and the model/tier zone. */}
                            {!hideModeSelector && (modelCommand || useEffortTierMode) && (
                                <span aria-hidden="true" data-testid="chat-toolbar-divider-mode" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                            )}
                            {/* Effort Tier selector — shown when effortLevels.enabled is true
                                 and the active provider has at least one configured tier.
                                 Replaces the model picker chip and effort pill. */}
                            {useEffortTierMode && selectedEffortTier && onEffortTierChange && effortTierMap && (
                                <EffortTierSelector
                                    tiers={effortTierMap}
                                    selectedTier={selectedEffortTier}
                                    onChange={onEffortTierChange}
                                    data-testid="follow-up-effort-tier-selector"
                                    mobileTapTarget={true}
                                />
                            )}
                            {/* Model selector chip — shows the active model
                                 (override or session). Hidden when tier mode is active. */}
                            {!useEffortTierMode && modelCommand && (
                                <div className="relative shrink-0" data-testid="model-picker-chip-container">
                                    <button
                                        type="button"
                                        className="ctool inline-flex items-center gap-1 h-8 px-2 lg:h-[22px] lg:px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 min-w-0 max-w-[40vw] sm:max-w-[180px] transition-colors"
                                        onClick={() => {
                                            if (modelCommand.modelMenuVisible) {
                                                modelCommand.dismissModelMenu();
                                            } else {
                                                modelCommand.showModelMenu();
                                            }
                                        }}
                                        title={modelCommand.modelOverride
                                            ? `Override active: ${modelCommand.modelOverride} (click to change or clear)`
                                            : (sessionModel ? `Session model: ${sessionModel}` : 'Pick a model')}
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
                                            {modelCommand.modelOverride || sessionModel || 'model'}
                                        </span>
                                        {/* Mirrors AgentSelectorChip: chevron
                                             only, no inline ✕ clear. The
                                             override is cleared via the "Use
                                             default" entry rendered at the top
                                             of ModelCommandMenu when an
                                             override is set. */}
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
                                        currentModelId={modelCommand.modelOverride || sessionModel}
                                        onClearOverride={modelCommand.modelOverride
                                            ? () => modelCommand.setModelOverride(null)
                                            : undefined}
                                    />
                                </div>
                            )}
                            {/* Effort pill — picks the per-turn
                                 `reasoningEffort` sent with this follow-up.
                                 Hidden when the parent has not wired
                                 `onEffortChange` or when tier mode is active. */}
                            {!useEffortTierMode && onEffortChange && (
                                <EffortPillSelector
                                    value={effortOverride}
                                    onChange={onEffortChange}
                                    options={effortOptions}
                                    disabled={effortDisabled}
                                    disabledTitle="This model does not support reasoning effort selection"
                                    className="ml-0.5"
                                />
                            )}
                            <div className="flex-1 min-w-0" />
                            {/* Tools zone — slash/mention/attach live on the
                                 right of the spacer (matches the OpenDesign
                                 composer ordering: mode · model · tools · send).
                                 On mobile/tablet (≤1023px) these collapse into a
                                 single overflow ("⋯") menu so the toolbar stays
                                 on one row; on desktop (lg+) they render inline. */}
                            <div ref={toolsMenuRef} className="relative shrink-0 lg:hidden" data-testid="chat-toolbar-overflow">
                                <button
                                    type="button"
                                    className="ctool inline-flex items-center justify-center h-8 w-8 rounded-sm text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
                                    onClick={() => setToolsMenuOpen(o => !o)}
                                    aria-label="More actions"
                                    title="More actions (slash, mention, attach)"
                                    aria-haspopup="menu"
                                    aria-expanded={toolsMenuOpen}
                                    data-testid="chat-toolbar-overflow-btn"
                                >
                                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                        <circle cx="3" cy="8" r="1.4" />
                                        <circle cx="8" cy="8" r="1.4" />
                                        <circle cx="13" cy="8" r="1.4" />
                                    </svg>
                                </button>
                                {toolsMenuOpen && (
                                    <div
                                        className="absolute bottom-full mb-1 right-0 z-[10000] min-w-[160px] py-0.5 rounded-md shadow-lg bg-white dark:bg-[#252526] border border-[#e0e0e0] dark:border-[#3c3c3c]"
                                        role="menu"
                                        aria-label="More composer actions"
                                        data-testid="chat-toolbar-overflow-menu"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] cursor-pointer"
                                            onClick={() => { focusInputAndInsertSlash(); setToolsMenuOpen(false); }}
                                            data-testid="chat-toolbar-overflow-slash"
                                        >
                                            <span aria-hidden="true" className="font-mono text-[12px] w-4 text-center text-[#848484]">/</span>
                                            Slash command
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] cursor-pointer"
                                            onClick={() => { focusInputAndInsertSlash(); setToolsMenuOpen(false); }}
                                            data-testid="chat-toolbar-overflow-mention"
                                        >
                                            <span aria-hidden="true" className="font-mono text-[12px] w-4 text-center text-[#848484]">@</span>
                                            Mention a skill
                                        </button>
                                        <button
                                            type="button"
                                            role="menuitem"
                                            disabled={inputDisabled}
                                            className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-[12px] text-[#1e1e1e] dark:text-[#cccccc] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                                            onClick={() => { fileInputRef.current?.click(); setToolsMenuOpen(false); }}
                                            data-testid="chat-toolbar-overflow-attach"
                                        >
                                            <span aria-hidden="true" className="w-4 text-center text-[#848484]">＋</span>
                                            Attach files
                                        </button>
                                    </div>
                                )}
                            </div>
                            <button
                                type="button"
                                className="ctool shrink-0 hidden lg:inline-flex items-center gap-0.5 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
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
                                className="ctool shrink-0 hidden lg:inline-flex items-center gap-0.5 h-[22px] px-1.5 rounded-sm text-[11px] text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 transition-colors"
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
                                disabled={inputDisabled}
                                onClick={() => fileInputRef.current?.click()}
                                className="ctool shrink-0 hidden lg:inline-flex items-center justify-center h-[22px] w-[22px] rounded-sm text-[#5a5a5a] dark:text-[#999999] hover:bg-[#f3f3f3] dark:hover:bg-[#2a2d2e] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                data-testid="follow-up-attach-btn"
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
                            {/* Live metadata: cwd + context-window fuel gauge.
                                 Sits next to send so its provider/cwd/ctx info
                                 reads as status, not as an interactive chip.
                                 Hidden on mobile/tablet (≤1023px) — it is
                                 non-interactive status and its width would force
                                 the compact toolbar to wrap. */}
                            <div className="hidden lg:flex items-center">
                                <ComposerMetaStrip
                                    className="mx-1"
                                    workingDirectory={workingDirectory}
                                    sessionTokenLimit={sessionTokenLimit}
                                    sessionCurrentTokens={sessionCurrentTokens}
                                    sessionModel={sessionModel}
                                    sessionSystemTokens={sessionSystemTokens}
                                    sessionToolTokens={sessionToolTokens}
                                    sessionConversationTokens={sessionConversationTokens}
                                />
                            </div>
                            <span aria-hidden="true" data-testid="chat-toolbar-divider-send" className="inline-block w-px h-[14px] bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center shrink-0" />
                            <WarmIndicatorDot status={warmStatus} className="mr-1 self-center" />
                            {isActiveGeneration ? stopButton : (
                                <QueueFollowUpButton
                                    disabled={inputDisabled || sending}
                                    ctrlHeld={modHeld}
                                    onSend={(dm) => { void onSend(undefined, dm); }}
                                    label={selectedMode === 'ralph' ? 'Promote to Ralph' : 'Send'}
                                    mobileTapTarget={true}
                                />
                            )}
                        </div>
                        <SlashCommandMenu
                            skills={skills}
                            filter={slashCommands.menuFilter}
                            onSelect={handleSlashSelect}
                            onDismiss={slashCommands.dismissMenu}
                            visible={slashCommands.menuVisible}
                            highlightIndex={slashCommands.highlightIndex}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
