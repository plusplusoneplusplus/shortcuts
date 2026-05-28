import { useState, useRef, useMemo, useEffect } from 'react';
import { useNotesChat } from '../hooks/useNotesChat';
import type { ChatScope } from '../hooks/useNotesChat';
import { ChatDetail } from '../../chat/ChatDetail';
import { ChatPreferencesProvider } from '../../../contexts/ChatPreferencesContext';
import { RichTextInput } from '../../../shared/RichTextInput';
import type { RichTextInputHandle } from '../../../shared/RichTextInput';
import { NoteContextBanner } from './NoteContextBanner';
import { useModels } from '../../../hooks/useModels';
import { useSlashCommands } from '../../chat/hooks/useSlashCommands';
import { useModelCommand, selectPickableModels } from '../../chat/hooks/useModelCommand';
import { SlashCommandMenu, getMetaSkillItems, mergeSkillsWithMeta, type SkillItem } from '../../chat/SlashCommandMenu';
import { ModelCommandMenu } from '../../chat/ModelCommandMenu';
import { NoteReferenceChips } from './NoteReferenceChips';
import { formatNoteReferences } from './useNoteReferences';
import type { NoteTextReference } from './useNoteReferences';
import type { ChatMode } from '../../../repos/modeConfig';
import { getSpaCocClient } from '../../../api/cocClient';
import { isLoopsEnabled } from '../../../utils/config';
import { useFileAttachments } from '../../chat/hooks/useFileAttachments';
import { AttachmentPreviews } from '../../../ui/AttachmentPreviews';

export interface NoteChatPanelProps {
    workspaceId: string;
    /** Currently selected note path — used as context for the initial message */
    notePath: string | null;
    noteTitle?: string;
    onClose: () => void;
    /** Called before creating a new chat to flush pending editor saves. */
    onBeforeSend?: () => Promise<void>;
    /** Default chat scope. Defaults to 'per-workspace'. */
    defaultScope?: ChatScope;
    /** Note text references to prepend to the next message. */
    references?: NoteTextReference[];
    /** Called to remove a reference chip. */
    onRemoveReference?: (id: string) => void;
    /** Called to clear all reference chips after send. */
    onClearReferences?: () => void;
    /** Called whenever the chat existence state changes (taskId goes from null→set or set→null). */
    onHasChatChange?: (hasChat: boolean) => void;
}

export function NoteChatPanel({ workspaceId, notePath, noteTitle, onClose, onBeforeSend, defaultScope, references, onRemoveReference, onClearReferences, onHasChatChange }: NoteChatPanelProps) {
    const { taskId, chatNoteContext, createChat, resetChat, scope, setScope } = useNotesChat({
        workspaceId,
        notePath,
        noteTitle,
        defaultScope,
    });
    const [input, setInput] = useState('');
    const [selectedMode, setSelectedMode] = useState<'ask' | 'autopilot'>('ask');
    const richTextRef = useRef<RichTextInputHandle>(null);
    const { attachments, addFromPaste, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();

    const { models: availableModels } = useModels();
    const pickableModels = selectPickableModels(availableModels);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const augmentedSkills = useMemo(() => mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled())), [skills]);
    const slashCommands = useSlashCommands(augmentedSkills);
    const modelCommand = useModelCommand(pickableModels);

    useEffect(() => {
        onHasChatChange?.(!!taskId);
    }, [taskId, onHasChatChange]);

    // Fetch skills when workspaceId changes
    useEffect(() => {
        setSkills([]);
        getSpaCocClient().skills.listAllWorkspace(workspaceId)
            .then((data) => {
                if (data?.merged && Array.isArray(data.merged)) {
                    setSkills(data.merged);
                } else if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    const handleSend = async () => {
        const text = input.trim();
        const activeRefs = references ?? [];
        if (!text && activeRefs.length === 0 && attachments.length === 0) return;

        // Intercept /new and /clear commands
        if (/^\/(new|clear)$/i.test(text)) {
            setInput('');
            richTextRef.current?.setValue('');
            resetChat();
            return;
        }

        const { skills: extractedSkills } = slashCommands.parseAndExtract(text);
        const attachmentPayload = toPayload();
        setInput('');
        richTextRef.current?.setValue('');
        clearAttachments();
        await onBeforeSend?.();
        const prompt = formatNoteReferences(activeRefs) + text;
        onClearReferences?.();
        await createChat(prompt, modelCommand.modelOverride, selectedMode, extractedSkills.length > 0 ? extractedSkills : undefined, attachmentPayload.length > 0 ? attachmentPayload : undefined);
    };

    const noNoteSelected = scope === 'per-note' && !notePath;

    const emptyStateText = scope === 'per-note'
        ? 'Ask about this note…'
        : 'Ask about your notes — one chat per workspace';

    return (
        <div className="flex flex-col bg-[#f8f8f8] dark:bg-[#1e1e1e] overflow-hidden h-full w-full"
             data-testid="note-chat-panel">

            {/* Empty state / no-note state — no chat yet */}
            {!taskId && (
                <>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="text-xs font-semibold text-[#1e1e1e] dark:text-[#cccccc]">🤖 Notes Chat</span>
                        <ScopeToggle scope={scope} onScopeChange={setScope} />
                        <NoteModeToggle mode={selectedMode} onModeChange={setSelectedMode} />
                        <button onClick={onClose} className="text-xs px-1 text-[#848484] hover:text-[#1e1e1e] dark:hover:text-white"
                                data-testid="note-chat-close-btn" title="Close">✕</button>
                    </div>

                    {noNoteSelected ? (
                        <div className="flex-1 flex items-center justify-center">
                            <div className="text-center text-[#848484]">
                                <div className="text-3xl mb-2">📝</div>
                                <div className="text-sm font-medium mb-1">No note selected</div>
                                <div className="text-xs">Select a note to start chatting</div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className="flex-1 flex items-center justify-center">
                                <div className="text-center text-[#848484]">
                                    <div className="text-3xl mb-2">🤖</div>
                                    <div className="text-sm font-medium mb-1">Notes Chat</div>
                                    <div className="text-xs">{emptyStateText}</div>
                                </div>
                            </div>
                            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                                {references && references.length > 0 && (
                                    <NoteReferenceChips
                                        references={references}
                                        onRemove={onRemoveReference ?? (() => {})}
                                        className="mb-2"
                                    />
                                )}
                                {attachmentError && (
                                    <div className="text-xs text-[#f14c4c]" data-testid="note-chat-attachment-error">{attachmentError}</div>
                                )}
                                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                                <div className="flex items-center gap-2">
                                    <div className="flex-1 min-w-0 relative">
                                        <RichTextInput
                                            ref={richTextRef}
                                            placeholder="Ask about your notes..."
                                            ghostText={slashCommands.activeCommandHint ?? undefined}
                                            className="w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm"
                                            onChange={(val, cursorPos) => {
                                                setInput(val);
                                                if (modelCommand.modelMenuVisible) {
                                                    modelCommand.setModelFilter(val);
                                                } else {
                                                    slashCommands.handleInputChange(val, cursorPos ?? val.length);
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
                                                        }
                                                    }
                                                    return;
                                                }
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
                                            }}
                                            onPaste={addFromPaste}
                                            data-testid="note-chat-input"
                                        />
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
                                                    slashCommands.dismissMenu();
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
                                                richTextRef.current?.focus();
                                            }}
                                            onDismiss={modelCommand.dismissModelMenu}
                                            visible={modelCommand.modelMenuVisible}
                                            highlightIndex={modelCommand.modelHighlightIndex}
                                            currentModelId={modelCommand.modelOverride ?? undefined}
                                        />
                                    </div>
                                    {modelCommand.modelOverride && (
                                        <div
                                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                                            data-testid="note-chat-model-badge"
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
                                    <button
                                        disabled={!input.trim() && !(references && references.length > 0) && attachments.length === 0}
                                        onClick={handleSend}
                                        className="h-[34px] px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50"
                                        data-testid="note-chat-send-btn"
                                        title="Send (Enter)"
                                    >Send</button>
                                </div>
                            </div>
                        </>
                    )}
                </>
            )}

            {/* Active chat */}
            {taskId && (
                <ChatPreferencesProvider workspaceId={workspaceId}>
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                        <span className="text-[10px] text-[#848484]">🤖 Notes Chat</span>
                        <ScopeToggle scope={scope} onScopeChange={setScope} />
                        <button
                            onClick={resetChat}
                            className="text-[10px] px-1.5 py-0.5 rounded text-[#0078d4] hover:bg-[#e8e8e8] dark:hover:bg-[#333]"
                            data-testid="note-chat-new-btn"
                            title="Start a new chat (current chat is kept in history)"
                        >
                            🔄 New Chat
                        </button>
                    </div>

                    {scope === 'per-note' && (
                        <NoteContextBanner
                            chatNotePath={chatNoteContext?.notePath}
                            chatNoteTitle={chatNoteContext?.noteTitle}
                            currentNotePath={notePath}
                        />
                    )}
                    {references && references.length > 0 && (
                        <div className="px-3 pt-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <NoteReferenceChips
                                references={references}
                                onRemove={onRemoveReference ?? (() => {})}
                                className="mb-2"
                            />
                        </div>
                    )}
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId}
                        variant="floating"
                        standalone
                        title="Notes Chat"
                        allowedModes={NOTE_CHAT_ALLOWED_MODES}
                        compactModeSelector
                        disableScratchpad
                        onBack={onClose}
                        pendingPrefix={references && references.length > 0 ? formatNoteReferences(references) : undefined}
                        onClearPendingPrefix={onClearReferences}
                    />
                </ChatPreferencesProvider>
            )}
        </div>
    );
}

// ── Allowed modes for Note Chat ──────────────────────────────────────────────

const NOTE_CHAT_ALLOWED_MODES: ChatMode[] = ['ask', 'autopilot'];

// ── Scope toggle segmented control ───────────────────────────────────────────

interface ScopeToggleProps {
    scope: ChatScope;
    onScopeChange: (scope: ChatScope) => void;
}

function ScopeToggle({ scope, onScopeChange }: ScopeToggleProps) {
    return (
        <div
            className="flex items-center gap-0.5"
            data-testid="chat-scope-toggle"
        >
            <button
                type="button"
                className={
                    'text-[10px] px-2 py-0.5 rounded transition-colors ' +
                    (scope === 'per-note'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onScopeChange('per-note')}
                data-testid="chat-scope-per-note"
                title="One chat per note"
            >
                📝 This Note
            </button>
            <button
                type="button"
                className={
                    'text-[10px] px-2 py-0.5 rounded transition-colors ' +
                    (scope === 'per-workspace'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onScopeChange('per-workspace')}
                data-testid="chat-scope-per-workspace"
                title="One chat for the whole workspace"
            >
                🗂️ Workspace
            </button>
        </div>
    );
}

// ── Mode toggle segmented control ────────────────────────────────────────────

interface NoteModeToggleProps {
    mode: 'ask' | 'autopilot';
    onModeChange: (mode: 'ask' | 'autopilot') => void;
}

function NoteModeToggle({ mode, onModeChange }: NoteModeToggleProps) {
    return (
        <div
            className="flex items-center gap-0.5"
            data-testid="note-mode-toggle"
        >
            <button
                type="button"
                className={
                    'text-[10px] px-1.5 py-0.5 rounded transition-colors ' +
                    (mode === 'ask'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onModeChange('ask')}
                data-testid="note-mode-ask"
                title="Ask mode — conversational Q&A"
            >
                💡
            </button>
            <button
                type="button"
                className={
                    'text-[10px] px-1.5 py-0.5 rounded transition-colors ' +
                    (mode === 'autopilot'
                        ? 'bg-[#0078d4] text-white font-medium'
                        : 'text-[#848484] hover:text-[#333] dark:hover:text-white hover:bg-[#e8e8e8] dark:hover:bg-[#333]')
                }
                onClick={() => onModeChange('autopilot')}
                data-testid="note-mode-autopilot"
                title="Autopilot mode — agentic edits"
            >
                🤖
            </button>
        </div>
    );
}
