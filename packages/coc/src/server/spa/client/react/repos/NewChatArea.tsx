/**
 * NewChatArea — empty-state chat component shown when no task is selected
 * on the Activity tab. Lets the user type a message and start a new conversation.
 */

import { useMemo, useRef, useState } from 'react';
import { RichTextInput } from '../shared/RichTextInput';
import type { RichTextInputHandle } from '../shared/RichTextInput';
import { AttachmentPreviews } from '../shared/AttachmentPreviews';
import { cn } from '../shared/cn';
import { MODE_BORDER_COLORS, MODE_ICONS, MODE_LABELS, cycleMode } from './modeConfig';
import type { ChatMode } from './modeConfig';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { getApiBase } from '../utils/config';
import { useFileAttachments } from '../hooks/useFileAttachments';
import { isQueueProcessId, toQueueProcessId } from '../utils/queue-process-id';
import { useModels } from '../hooks/useModels';
import { useSlashCommands } from './useSlashCommands';
import { useModelCommand } from './useModelCommand';
import { SlashCommandMenu } from './SlashCommandMenu';
import { ModelCommandMenu } from './ModelCommandMenu';

export interface NewChatAreaProps {
    workspaceId?: string;
    onBack?: () => void;
}

export function NewChatArea({ workspaceId, onBack }: NewChatAreaProps) {
    const [input, setInput] = useState('');
    const [selectedMode, setSelectedMode] = useState<ChatMode>('autopilot');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const richTextRef = useRef<RichTextInputHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    const { attachments, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();

    const { dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();

    // Model command support
    const { models: availableModels } = useModels();
    const enabledModels = availableModels.filter(m => m.enabled);
    const augmentedSkills = useMemo(
        () => [{ name: 'model', description: 'Switch AI model' }],
        [],
    );
    const slashCommands = useSlashCommands(augmentedSkills);
    const modelCommand = useModelCommand(enabledModels);

    async function handleSend() {
        const trimmed = input.trim();
        if ((!trimmed && attachments.length === 0) || sending) return;

        setError(null);
        setSending(true);
        abortControllerRef.current = new AbortController();

        try {
            const ws = appState.workspaces?.find((w: any) => w.id === workspaceId);
            const attachmentPayload = toPayload();
            const res = await fetch(getApiBase() + '/queue/tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: abortControllerRef.current.signal,
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: {
                        kind: 'chat',
                        mode: selectedMode,
                        prompt: trimmed,
                        workingDirectory: ws?.rootPath,
                        workspaceId,
                        ...(attachmentPayload.length > 0 ? { attachments: attachmentPayload } : {}),
                        ...(modelCommand.modelOverride ? { model: modelCommand.modelOverride } : {}),
                    },
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(errBody || `HTTP ${res.status}`);
            }

            const newTask = await res.json();
            const rawId = newTask.task?.id ?? newTask.id;
            const processId = isQueueProcessId(rawId) ? rawId : toQueueProcessId(rawId);
            queueDispatch({ type: 'SELECT_QUEUE_TASK', id: processId, repoId: workspaceId });
            if (!appState.onboardingProgress?.hasUsedChat) {
                appDispatch({ type: 'UPDATE_ONBOARDING', payload: { hasUsedChat: true } });
            }
            setInput('');
            richTextRef.current?.setValue('');
            clearAttachments();
        } catch (err: any) {
            if (err?.name !== 'AbortError') {
                setError(err.message || 'Failed to create task');
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

    return (
        <div className="flex flex-col h-full" data-testid="new-chat-area">
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
            <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3 space-y-2">
                {error && <div className="text-xs text-[#f14c4c]" data-testid="new-chat-error">{error}</div>}
                {attachmentError && (
                    <div className="text-xs text-[#f14c4c]" data-testid="new-chat-attachment-error">{attachmentError}</div>
                )}
                <AttachmentPreviews attachments={attachments} onRemove={removeAttachment} />
                <div className="flex flex-row items-center gap-2" data-testid="chat-input-bar">
                    <div className="shrink-0" data-testid="mode-selector">
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
                            onChange={e => setSelectedMode(e.target.value as ChatMode)}
                            className="hidden sm:block px-2.5 py-1.5 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-sm font-medium text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 cursor-pointer"
                            data-testid="new-chat-mode-dropdown"
                        >
                            {(Object.entries(MODE_LABELS) as [string, string][]).map(([mode, label]) => (
                                <option key={mode} value={mode}>{label}</option>
                            ))}
                        </select>
                    </div>
                    {/* Hidden file input for the + button */}
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
                    {/* Attach file button */}
                    <button
                        type="button"
                        disabled={sending}
                        onClick={() => fileInputRef.current?.click()}
                        className="shrink-0 h-[34px] w-[34px] flex items-center justify-center rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-white dark:bg-[#1f1f1f] text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] text-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#0078d4]/50 disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="new-chat-attach-btn"
                        aria-label="Attach file"
                        title="Attach files"
                    >
                        +
                    </button>
                    <div className="flex-1 min-w-0 relative">
                        <RichTextInput
                            ref={richTextRef}
                            disabled={sending}
                            placeholder="Send a message... (type / for commands)"
                            className={cn(
                                'w-full min-h-[34px] max-h-28 overflow-y-auto rounded border bg-white dark:bg-[#1f1f1f] px-2 py-1.5 text-sm text-[#1e1e1e] dark:text-[#cccccc] focus:outline-none focus:ring-2 disabled:opacity-60',
                                MODE_BORDER_COLORS[selectedMode].border,
                                MODE_BORDER_COLORS[selectedMode].ring,
                            )}
                            onChange={(val, cursorPos) => {
                                setInput(val);
                                if (modelCommand.modelMenuVisible) {
                                    modelCommand.setModelFilter(val);
                                } else {
                                    slashCommands.handleInputChange(val, cursorPos);
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
                                        }
                                    }
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
                            currentModelId={modelCommand.modelOverride ?? undefined}
                        />
                    </div>
                    {modelCommand.modelOverride && (
                        <div
                            className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-[#d0d0d0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                            data-testid="new-chat-model-badge"
                        >
                            <span className="truncate max-w-[120px]">{modelCommand.modelOverride}</span>
                            <button
                                type="button"
                                className="text-[#848484] hover:text-[#1e1e1e] dark:hover:text-[#cccccc] cursor-pointer"
                                onClick={() => modelCommand.setModelOverride(null)}
                                aria-label="Clear model override"
                            >✕</button>
                        </div>
                    )}
                    {sending ? (
                        <button
                            type="button"
                            className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#f14c4c] text-white text-sm font-medium hover:bg-[#d93636]"
                            onClick={handleStop}
                            data-testid="new-chat-stop-btn"
                        >
                            Stop
                        </button>
                    ) : (
                        <button
                            type="button"
                            disabled={!input.trim() && attachments.length === 0}
                            className="shrink-0 h-[34px] px-2 sm:px-3 rounded bg-[#0078d4] text-white text-sm font-medium hover:bg-[#106ebe] disabled:opacity-50 disabled:cursor-not-allowed"
                            onClick={() => { void handleSend(); }}
                            data-testid="new-chat-send-btn"
                            title="Send (Enter) · Shift+Enter for newline"
                        >
                            Send
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
