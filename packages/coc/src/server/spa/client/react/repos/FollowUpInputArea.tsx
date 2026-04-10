import { useEffect, useRef } from 'react';
import { Button, SuggestionChips } from '../shared';
import { ImagePreviews } from '../shared/ImagePreviews';
import { PastePreview } from '../shared/PastePreview';
import { cn } from '../shared/cn';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import { SlashCommandMenu } from './SlashCommandMenu';
import { useModifierKey } from '../hooks/useModifierKey';
import { MODE_BORDER_COLORS, MODE_ICONS, MODE_LABELS, cycleMode } from './modeConfig';
import type { SkillItem } from './SlashCommandMenu';
import type { DeliveryMode } from '@plusplusoneplusplus/forge';

export interface FollowUpInputAreaProps {
    richTextRef: React.RefObject<RichTextInputHandle>;
    inputDisabled: boolean;
    sending: boolean;
    error: string | null;
    resumeFeedback: { type: 'success' | 'error'; message: string; command?: string } | null;
    suggestions: string[];
    followUpInput: string;
    setFollowUpInput: (v: string) => void;
    selectedMode: 'ask' | 'plan' | 'autopilot';
    setSelectedMode: (mode: 'ask' | 'plan' | 'autopilot') => void;
    onSend: (overrideContent?: string, deliveryMode?: DeliveryMode) => Promise<void>;
    onRetry: () => void;
    skills: SkillItem[];
    images: string[];
    onImagePaste: (e: React.ClipboardEvent) => void;
    onImageRemove: (index: number) => void;
    pastePreview: {
        charCount: number;
        previewLines: string[];
        onTextPaste: (e: React.ClipboardEvent) => void;
        clearPaste: () => void;
    } | null;
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
    /** When true, the ask/plan/autopilot mode selector is hidden */
    hideModeSelector?: boolean;
}

export function FollowUpInputArea({
    richTextRef,
    inputDisabled,
    sending,
    error,
    resumeFeedback,
    suggestions,
    followUpInput,
    setFollowUpInput,
    selectedMode,
    setSelectedMode,
    onSend,
    onRetry,
    skills,
    images,
    onImagePaste,
    onImageRemove,
    pastePreview,
    task,
    slashCommands,
    hideModeSelector = false,
}: FollowUpInputAreaProps) {
    const modHeld = useModifierKey();

    // Sync programmatic followUpInput changes (draft restore, clear after send) to the editor.
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
            {suggestions.length > 0 && !sending && task?.status !== 'running' && (
                <SuggestionChips
                    suggestions={suggestions}
                    onSelect={(text, e) => {
                        if (e.ctrlKey || e.metaKey) {
                            setFollowUpInput(text);
                            richTextRef.current?.setValue(text);
                            richTextRef.current?.focus();
                        } else {
                            void onSend(text);
                        }
                    }}
                    disabled={inputDisabled}
                />
            )}
            <ImagePreviews images={images} onRemove={onImageRemove} />
            {pastePreview && pastePreview.charCount > 0 && (
                <PastePreview
                    charCount={pastePreview.charCount}
                    previewLines={pastePreview.previewLines}
                    onDismiss={pastePreview.clearPaste}
                />
            )}
            <div className="flex flex-row items-center gap-2" data-testid="chat-input-bar">
                {!hideModeSelector && <div className="shrink-0" data-testid="mode-selector">
                    {/* Mobile: icon-only button that cycles modes on tap */}
                    <button
                        type="button"
                        onClick={() => setSelectedMode(cycleMode(selectedMode))}
                        className="sm:hidden h-[34px] w-[34px] flex items-center justify-center rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-base cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50"
                        data-testid="mode-cycle-btn"
                        aria-label={`Mode: ${selectedMode}. Tap to switch.`}
                    >
                        {MODE_ICONS[selectedMode]}
                    </button>
                    {/* Desktop: full select dropdown */}
                    <select
                        value={selectedMode}
                        onChange={e => setSelectedMode(e.target.value as 'ask' | 'plan' | 'autopilot')}
                        className="hidden sm:block px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 cursor-pointer"
                        data-testid="mode-dropdown"
                    >
                        {(Object.entries(MODE_LABELS) as [string, string][]).map(([mode, label]) => (
                            <option key={mode} value={mode}>{label}</option>
                        ))}
                    </select>
                </div>}
                <div className="relative flex-1 min-w-0">
                    <RichTextInput
                        ref={richTextRef}
                        disabled={inputDisabled}
                        placeholder={inputDisabled && !sending ? 'Session expired.' : 'Send a message... (type / for skills)'}
                        className={cn(
                            'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                            MODE_BORDER_COLORS[selectedMode].border,
                            MODE_BORDER_COLORS[selectedMode].ring,
                        )}
                        onChange={(val, cursorPos) => {
                            setFollowUpInput(val);
                            slashCommands.handleInputChange(val, cursorPos);
                        }}
                        onKeyDown={(e) => {
                            if (slashCommands.handleKeyDown(e)) {
                                if (e.key === 'Enter' || e.key === 'Tab') {
                                    const skill = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                    if (skill) {
                                        skipNextSyncRef.current = true;
                                        slashCommands.selectSkill(skill.name, followUpInput, setFollowUpInput, richTextRef);
                                    }
                                }
                                return;
                            }
                            if (e.key === 'Tab' && e.shiftKey) {
                                e.preventDefault();
                                setSelectedMode(cycleMode(selectedMode));
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
                            onImagePaste(e);
                            pastePreview?.onTextPaste(e);
                        }}
                        data-testid="activity-chat-input"
                    />
                    <SlashCommandMenu
                        skills={skills}
                        filter={slashCommands.menuFilter}
                        onSelect={(name) => {
                            skipNextSyncRef.current = true;
                            slashCommands.selectSkill(name, followUpInput, setFollowUpInput, richTextRef);
                            richTextRef.current?.focus();
                        }}
                        onDismiss={slashCommands.dismissMenu}
                        visible={slashCommands.menuVisible}
                        highlightIndex={slashCommands.highlightIndex}
                    />
                </div>
                <button
                    type="button"
                    disabled={inputDisabled}
                    className={`shrink-0 h-[34px] px-2 sm:px-3 rounded text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${modHeld && sending ? 'bg-[#e8912d] hover:bg-[#c97a25]' : 'bg-[#0078d4] hover:bg-[#106ebe]'}`}
                    onClick={() => { void onSend(); }}
                    data-testid="activity-chat-send-btn"
                    title={modHeld
                        ? 'Release Ctrl to queue instead'
                        : 'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline'}
                >
                    {sending
                        ? (modHeld ? '⚡ Steer' : 'Queue')
                        : (modHeld ? '⚡ Send Now' : 'Send')}
                </button>
            </div>
        </div>
    );
}
