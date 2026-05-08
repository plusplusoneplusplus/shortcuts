import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, SuggestionChips, SendButton } from '../../ui';
import { AttachmentPreviews } from '../../ui/AttachmentPreviews';
import { PastePreview } from '../../ui/PastePreview';
import { AttachedContextPreviews } from '../../ui/AttachedContextPreviews';
import { cn } from '../../ui/cn';
import { RichTextInput } from '../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../shared/RichTextInput';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';
import { useModifierKey } from '../../hooks/ui/useModifierKey';
import { usePromptAutocomplete } from '../../hooks/usePromptAutocomplete';
import { usePromptAutocompleteEnabled } from '../../hooks/usePromptAutocompleteEnabled';
import { MODE_BORDER_COLORS, MODE_ICONS, MODE_LABELS, MODE_TOOLTIPS, cycleMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';
import type { SkillItem } from './SlashCommandMenu';
import type { ModelInfo } from '../../hooks/useModels';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';
import type { AttachedContextItem } from './hooks/useAttachedContext';
import type { ChatAttachment } from '../../types/attachments';

export interface FollowUpInputAreaProps {
    richTextRef: React.RefObject<RichTextInputHandle>;
    inputDisabled: boolean;
    sending: boolean;
    isActiveGeneration: boolean;
    isCancelling: boolean;
    error: string | null;
    resumeFeedback: { type: 'success' | 'error'; message: string; command?: string } | null;
    suggestions: string[];
    followUpInput: string;
    setFollowUpInput: (v: string) => void;
    selectedMode: 'ask' | 'plan' | 'autopilot';
    setSelectedMode: (mode: 'ask' | 'plan' | 'autopilot') => void;
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
    /** When true, the ask/plan/autopilot mode selector is hidden */
    hideModeSelector?: boolean;
    /** When set, restricts mode selector to only these modes */
    allowedModes?: ChatMode[];
    /**
     * When true, the mode selector always renders as the icon-only cycling
     * button at all viewport sizes (no `<select>` dropdown). Use in narrow
     * side-by-side contexts (e.g. NoteChatPanel) where horizontal space is
     * scarce.
     */
    compactModeSelector?: boolean;
}

export function FollowUpInputArea({
    richTextRef,
    inputDisabled,
    sending,
    isActiveGeneration,
    isCancelling,
    error,
    resumeFeedback,
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
    task,
    slashCommands,
    modelCommand,
    sessionModel,
    hideModeSelector = false,
    allowedModes,
    compactModeSelector = false,
}: FollowUpInputAreaProps) {
    const inputWrapperRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const modHeld = useModifierKey(inputWrapperRef as RefObject<HTMLElement>);
    // Global (unscoped) detection so chips show the "send" state even when input isn't focused.
    const chipsCtrlHeld = useModifierKey();

    const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
    // Reset dismiss state whenever a new set of suggestions arrives.
    useEffect(() => { setSuggestionsDismissed(false); }, [suggestions]);

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

    return (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
            {resumeFeedback && (
                <div className={`text-xs ${resumeFeedback.type === 'error' ? 'text-[#f14c4c]' : 'text-[#6a9955] dark:text-[#89d185]'}`}>
                    {resumeFeedback.message}
                    {resumeFeedback.command && (
                        <div className="mt-1 rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] px-2 py-1 font-mono text-[11px] break-all text-[#1e1e1e] dark:text-[#cccccc]">
                            {resumeFeedback.command}
                        </div>
                    )}
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
            <div className="flex flex-row items-center gap-2" data-testid="chat-input-bar">
                {/* Hidden file input for the + button */}
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
                {/* Attach file button */}
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
                {!hideModeSelector && <div className="shrink-0" data-testid="mode-selector">
                    {compactModeSelector ? (
                        /* Compact: icon-only cycling button at all viewport sizes */
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
                    ) : (
                        <>
                            {/* Mobile: icon-only button that cycles modes on tap */}
                            <button
                                type="button"
                                onClick={() => setSelectedMode(cycleMode(selectedMode, allowedModes))}
                                className="sm:hidden h-[34px] w-[34px] flex items-center justify-center rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-base cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50"
                                data-testid="mode-cycle-btn"
                                aria-label={`Mode: ${selectedMode}. Tap to switch.`}
                                title={MODE_TOOLTIPS[selectedMode] + ' (Shift+Tab to cycle)'}
                            >
                                {MODE_ICONS[selectedMode]}
                            </button>
                            {/* Desktop: full select dropdown */}
                            <select
                                value={selectedMode}
                                onChange={e => setSelectedMode(e.target.value as 'ask' | 'plan' | 'autopilot')}
                                className="hidden sm:block px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 cursor-pointer"
                                data-testid="mode-dropdown"
                                title="Select chat mode (Shift+Tab to cycle)"
                            >
                                {(Object.entries(MODE_LABELS) as [string, string][])
                                    .filter(([mode]) => !allowedModes || allowedModes.includes(mode as ChatMode))
                                    .map(([mode, label]) => (
                                    <option key={mode} value={mode}>{label}</option>
                                ))}
                            </select>
                        </>
                    )}
                </div>}
                <div ref={inputWrapperRef} className="relative flex-1 min-w-0">
                    <RichTextInput
                        ref={richTextRef}
                        disabled={inputDisabled}
                        value={followUpInput}
                        ghostText={autocomplete.completion}
                        placeholder={inputDisabled && !isActiveGeneration ? 'Session expired.' : 'Send a message... (type / for commands)'}
                        className={cn(
                            'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                            MODE_BORDER_COLORS[selectedMode].border,
                            MODE_BORDER_COLORS[selectedMode].ring,
                        )}
                        onChange={(val, cursorPos) => {
                            setFollowUpInput(val);
                            setFollowUpCursorPos(cursorPos);
                            if (modelCommand?.modelMenuVisible) {
                                // Route typing to model filter when model picker is open
                                modelCommand.setModelFilter(val);
                            } else {
                                slashCommands.handleInputChange(val, cursorPos);
                            }
                        }}
                        onKeyDown={(e) => {
                            // Priority 1: model command menu
                            if (modelCommand?.handleModelKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const model = modelCommand.filteredModels[modelCommand.modelHighlightIndex];
                                    if (model) {
                                        modelCommand.handleModelSelect(model.id);
                                        // Clear the input text (the /model prefix)
                                        setFollowUpInput('');
                                        richTextRef.current?.setValue('');
                                    }
                                }
                                return;
                            }
                            // Priority 2: slash command menu (skills + /model entry)
                            if (slashCommands.handleKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                    if (skill) {
                                        // Check if the selected "skill" is actually the /model meta-command
                                        if (skill.name === 'model' && modelCommand) {
                                            // Transition to model picker mode
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
                            // Only fires when neither menu is visible (handled above).
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
                        }}
                        onPaste={(e: React.ClipboardEvent) => {
                            onAttachmentPaste(e);
                            pastePreview?.onTextPaste(e);
                        }}
                        data-testid="activity-chat-input"
                    />
                    <SlashCommandMenu
                        skills={skills}
                        filter={slashCommands.menuFilter}
                        onSelect={(name) => {
                            if (name === 'model' && modelCommand) {
                                // Transition to model picker mode
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
                        }}
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
                                setFollowUpInput('');
                                richTextRef.current?.setValue('');
                                richTextRef.current?.focus();
                            }}
                            onDismiss={modelCommand.dismissModelMenu}
                            visible={modelCommand.modelMenuVisible}
                            highlightIndex={modelCommand.modelHighlightIndex}
                            currentModelId={modelCommand.modelOverride || sessionModel}
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
                {isActiveGeneration ? (
                    <button
                        type="button"
                        className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#f14c4c] text-white text-sm font-medium hover:bg-[#d93636] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-[#f14c4c]"
                        onClick={() => {
                            if (!isCancelling) onStop?.();
                        }}
                        disabled={isCancelling}
                        data-testid="activity-chat-stop-btn"
                        title={isCancelling ? 'Stopping generation' : 'Stop generation'}
                    >
                        {isCancelling ? 'Stopping...' : 'Stop'}
                    </button>
                ) : (
                    <SendButton
                        disabled={inputDisabled || sending}
                        ctrlHeld={modHeld}
                        onSend={(dm) => { void onSend(undefined, dm); }}
                    />
                )}
            </div>
        </div>
    );
}
