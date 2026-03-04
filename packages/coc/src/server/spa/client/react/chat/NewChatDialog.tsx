/**
 * NewChatDialog — floating dialog for starting a new chat session.
 *
 * Opens as a draggable, resizable, minimizable overlay (FloatingDialog on
 * desktop, Dialog on mobile) so the user can start a new chat without leaving
 * their current tab. Handles the full lifecycle: start screen → conversation
 * with SSE streaming → follow-up messages.
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FloatingDialog, Dialog, Button, Spinner, SuggestionChips } from '../shared';
import { ImagePreviews } from '../shared/ImagePreviews';
import { ConversationTurnBubble } from '../processes/ConversationTurnBubble';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useImagePaste } from '../hooks/useImagePaste';
import { usePreferences } from '../hooks/usePreferences';
import { useMinimizedDialog } from '../context/MinimizedDialogsContext';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { cn } from '../shared/cn';
import { SlashCommandMenu } from '../repos/SlashCommandMenu';
import { useSlashCommands } from '../repos/useSlashCommands';
import type { SkillItem } from '../repos/SlashCommandMenu';
import type { ClientConversationTurn } from '../types/dashboard';

export interface NewChatDialogProps {
    workspaceId: string;
    workspacePath?: string;
    readOnly?: boolean;
    minimized?: boolean;
    onMinimize: () => void;
    onRestore: () => void;
    onClose: () => void;
    /** Called after a new chat task is created, e.g. to refresh the session list */
    onChatCreated?: (taskId: string) => void;
}

function getConversationTurns(data: any): ClientConversationTurn[] {
    const process = data?.process;
    if (process?.conversationTurns && Array.isArray(process.conversationTurns) && process.conversationTurns.length > 0) {
        return process.conversationTurns;
    }
    if (Array.isArray(data?.conversation) && data.conversation.length > 0) {
        return data.conversation;
    }
    if (Array.isArray(data?.turns) && data.turns.length > 0) {
        return data.turns;
    }
    if (process) {
        const synthetic: ClientConversationTurn[] = [];
        const userContent = process.fullPrompt || process.promptPreview;
        if (userContent) {
            synthetic.push({ role: 'user', content: userContent, timestamp: process.startTime || undefined, timeline: [] });
        }
        if (process.result) {
            synthetic.push({ role: 'assistant', content: process.result, timestamp: process.endTime || undefined, timeline: [] });
        }
        return synthetic;
    }
    return [];
}

export function NewChatDialog({
    workspaceId,
    workspacePath,
    readOnly: initialReadOnly = false,
    minimized = false,
    onMinimize,
    onRestore,
    onClose,
    onChatCreated,
}: NewChatDialogProps) {
    const { isMobile } = useBreakpoint();
    const { model: savedModel, setModel: persistModel } = usePreferences();

    // Chat state
    const [inputValue, setInputValue] = useState('');
    const [model, setModel] = useState('');
    const [models, setModels] = useState<string[]>([]);
    const [readOnly, setReadOnly] = useState(initialReadOnly);
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Conversation state (post-start)
    const [chatTaskId, setChatTaskId] = useState<string | null>(null);
    const [processId, setProcessId] = useState<string | null>(null);
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);

    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);
    const conversationRef = useRef<HTMLDivElement>(null);

    const imagePaste = useImagePaste();
    const followUpImagePaste = useImagePaste();
    const slashCommands = useSlashCommands(skills);

    const chatStarted = chatTaskId !== null;
    const inputDisabled = sending || isStreaming;

    // Fetch models on mount
    useEffect(() => {
        fetchApi('/queue/models')
            .then((data: any) => {
                if (Array.isArray(data)) setModels(data);
                else if (data?.models && Array.isArray(data.models)) setModels(data.models);
            })
            .catch(() => {});
    }, []);

    // Fetch skills when workspaceId changes
    useEffect(() => {
        if (!workspaceId) return;
        fetchApi(`/workspaces/${encodeURIComponent(workspaceId)}/skills`)
            .then((data: any) => {
                if (Array.isArray(data?.skills)) setSkills(data.skills);
            })
            .catch(() => {});
    }, [workspaceId]);

    // Rehydrate model from preferences
    useEffect(() => {
        if (savedModel && !model) setModel(savedModel);
    }, [savedModel]); // eslint-disable-line react-hooks/exhaustive-deps

    // Scroll to bottom when turns update
    useEffect(() => {
        if (turns.length > 0 && conversationRef.current) {
            conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
        }
    }, [turns]);

    // Cleanup SSE on unmount
    useEffect(() => () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
    }, []);

    const handleModelChange = useCallback((value: string) => {
        setModel(value);
        persistModel(value);
    }, [persistModel]);

    // --- turn helpers ---

    const setTurnsAndCache = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        turnsRef.current = resolved;
        setTurns(resolved);
    };

    const markLastTurnAsError = (errorMessage?: string) => {
        setTurnsAndCache(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last.streaming) {
                return [
                    ...prev.slice(0, -1),
                    { ...last, streaming: false, isError: true, content: errorMessage || last.content || '' },
                ];
            }
            return prev;
        });
    };

    const removeStreamingPlaceholder = () => {
        setTurnsAndCache(prev => {
            const last = prev[prev.length - 1];
            return last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
        });
    };

    // --- SSE streaming ---

    const waitForCompletion = useCallback((pid: string) =>
        new Promise<void>(resolve => {
            const es = new EventSource(`${getApiBase()}/processes/${encodeURIComponent(pid)}/stream`);
            eventSourceRef.current = es;
            setIsStreaming(true);
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                es.close();
                eventSourceRef.current = null;
                setIsStreaming(false);
                fetchApi(`/processes/${encodeURIComponent(pid)}`)
                    .then(data => {
                        const freshTurns = getConversationTurns(data);
                        setTurnsAndCache(freshTurns);
                    })
                    .catch(() => {})
                    .finally(() => resolve());
            };
            const timeout = setTimeout(finish, 90_000);
            es.addEventListener('done', () => { clearTimeout(timeout); finish(); });
            es.addEventListener('status', (e: Event) => {
                try {
                    const status = JSON.parse((e as MessageEvent).data)?.status;
                    if (status && !['running', 'queued'].includes(status)) { clearTimeout(timeout); finish(); }
                } catch { /* ignore */ }
            });
            es.onerror = () => { clearTimeout(timeout); finish(); };
            es.addEventListener('suggestions', (event: Event) => {
                try {
                    const data = JSON.parse((event as MessageEvent).data);
                    if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions);
                } catch { /* ignore */ }
            });
        }), []);

    // --- start chat ---

    const handleStartChat = async () => {
        const raw = inputValue.trim();
        if (!raw) return;
        const { skills: parsedSkills, prompt } = slashCommands.parseAndExtract(raw);
        if (!prompt) return;
        setInputValue('');
        slashCommands.dismissMenu();
        setSending(true);
        setError(null);
        try {
            const response = await fetch(`${getApiBase()}/queue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'chat',
                    workspaceId,
                    workingDirectory: workspacePath,
                    prompt,
                    displayName: 'Chat',
                    images: imagePaste.images.length > 0 ? imagePaste.images : undefined,
                    payload: { readonly: readOnly },
                    ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}),
                    ...(model ? { config: { model } } : {}),
                }),
            });
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error ?? `Failed to create task (${response.status})`);
            }
            const body = await response.json();
            const newTaskId: string = body.task?.id ?? body.id;
            const newProcessId: string = body.task?.processId ?? `queue_${newTaskId}`;
            setChatTaskId(newTaskId);
            setProcessId(newProcessId);
            imagePaste.clearImages();
            onChatCreated?.(newTaskId);

            const userTurn: ClientConversationTurn = {
                role: 'user', content: prompt,
                timestamp: new Date().toISOString(), timeline: [],
                images: imagePaste.images.length > 0 ? [...imagePaste.images] : undefined,
            };
            const assistantPlaceholder: ClientConversationTurn = {
                role: 'assistant', content: '',
                timestamp: new Date().toISOString(), streaming: true, timeline: [],
            };
            setTurnsAndCache([userTurn, assistantPlaceholder]);

            // Start streaming
            await waitForCompletion(newProcessId);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to start chat.');
        } finally {
            setSending(false);
        }
    };

    // --- follow-up ---

    const sendFollowUp = async (overrideContent?: string) => {
        const raw = (overrideContent ?? inputValue).trim();
        if (!raw || !processId || sending || sessionExpired) return;
        const { skills: parsedSkills, prompt: cleanedContent } = slashCommands.parseAndExtract(raw);
        const content = cleanedContent || raw;
        setSuggestions([]);
        setInputValue('');
        slashCommands.dismissMenu();
        setSending(true);
        setError(null);

        const timestamp = new Date().toISOString();
        const sentImages = followUpImagePaste.images.length > 0 ? [...followUpImagePaste.images] : undefined;
        setTurnsAndCache(prev => ([
            ...prev,
            { role: 'user', content, timestamp, timeline: [], images: sentImages },
            { role: 'assistant', content: '', timestamp, streaming: true, timeline: [] },
        ]));

        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    images: followUpImagePaste.images.length > 0 ? followUpImagePaste.images : undefined,
                    ...(parsedSkills.length > 0 ? { skillNames: parsedSkills } : {}),
                }),
            });
            if (response.status === 410) {
                setSessionExpired(true);
                setError('Session expired. Start a new chat.');
                removeStreamingPlaceholder();
                return;
            }
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                markLastTurnAsError(body?.error ?? `Failed to send message (${response.status})`);
                return;
            }
            followUpImagePaste.clearImages();
            await waitForCompletion(processId);
        } catch (err: any) {
            markLastTurnAsError(err?.message ?? 'Failed to send follow-up message.');
        } finally {
            setSending(false);
        }
    };

    // --- register with minimized dialogs tray ---

    const pillPreview = useMemo(() => {
        const raw = inputValue.trim() || (turns.length > 0 ? turns[0].content : '');
        return raw.length > 30 ? raw.slice(0, 30) + '…' : raw;
    }, [inputValue, turns]);

    const chatLabel = chatStarted ? 'Chat' : 'New Chat';
    const fullLabel = readOnly ? `${chatLabel} (Read-Only)` : chatLabel;

    const minimizedEntry = useMemo(() => {
        if (!minimized) return null;
        return {
            id: 'new-chat',
            icon: '💬',
            label: fullLabel,
            preview: pillPreview || undefined,
            onRestore,
            extra: isStreaming ? <Spinner size="sm" /> : undefined,
        };
    }, [minimized, fullLabel, pillPreview, onRestore, isStreaming]);
    useMinimizedDialog(minimizedEntry);

    if (minimized) return null;

    // --- start screen ---

    const renderStartScreen = () => (
        <div className="flex flex-col gap-3">
            <div className="relative">
                <textarea
                    className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    rows={3}
                    placeholder="Ask anything… Type / for skills"
                    value={inputValue}
                    onChange={e => {
                        setInputValue(e.target.value);
                        slashCommands.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyDown={e => {
                        if (slashCommands.handleKeyDown(e)) {
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                if (selected) slashCommands.selectSkill(selected.name, inputValue, setInputValue);
                            }
                            return;
                        }
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleStartChat(); }
                    }}
                    onPaste={imagePaste.addFromPaste}
                    disabled={sending}
                    data-testid="new-chat-input"
                />
                <SlashCommandMenu
                    skills={skills}
                    filter={slashCommands.menuFilter}
                    onSelect={name => slashCommands.selectSkill(name, inputValue, setInputValue)}
                    onDismiss={slashCommands.dismissMenu}
                    visible={slashCommands.menuVisible}
                    highlightIndex={slashCommands.highlightIndex}
                />
            </div>
            <ImagePreviews images={imagePaste.images} onRemove={imagePaste.removeImage} />
            {error && <div className="text-xs text-red-500" data-testid="new-chat-error">{error}</div>}
            <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-[#848484] cursor-pointer" data-testid="new-chat-readonly-toggle">
                    <input
                        type="checkbox"
                        checked={readOnly}
                        onChange={e => setReadOnly(e.target.checked)}
                        className="accent-blue-500"
                    />
                    Read-only
                </label>
                <select
                    value={model}
                    onChange={e => handleModelChange(e.target.value)}
                    className="px-2 py-1.5 text-sm rounded border bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                    data-testid="new-chat-model-select"
                >
                    <option value="">Default</option>
                    {models.map(m => (
                        <option key={m} value={m}>{m}</option>
                    ))}
                </select>
            </div>
        </div>
    );

    // --- conversation view ---

    const renderConversation = () => (
        <div className="flex flex-col min-h-0 flex-1">
            {readOnly && (
                <span
                    className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-900 text-yellow-700 dark:text-yellow-300 self-start mb-2"
                    data-testid="new-chat-readonly-badge"
                >
                    Read-only
                </span>
            )}
            <div ref={conversationRef} className="flex-1 min-h-0 overflow-y-auto space-y-3 mb-3" data-testid="new-chat-conversation">
                {turns.map((turn, i) => (
                    <ConversationTurnBubble key={i} turn={turn} />
                ))}
            </div>
            {/* Follow-up input */}
            {!sessionExpired && (
                <div
                    className={cn("space-y-2 border-t border-[#e0e0e0] dark:border-[#3c3c3c] pt-2", isMobile && "pb-14")}
                    data-testid="new-chat-followup-wrapper"
                >
                    {suggestions.length > 0 && !isStreaming && (
                        <SuggestionChips
                            suggestions={suggestions}
                            onSelect={(text) => { setSuggestions([]); void sendFollowUp(text); }}
                            disabled={inputDisabled || sessionExpired}
                        />
                    )}
                    <ImagePreviews images={followUpImagePaste.images} onRemove={followUpImagePaste.removeImage} />
                    <div className="flex items-end gap-2 relative">
                        <div className="flex-1 relative">
                            <textarea
                                rows={1}
                                value={inputValue}
                                disabled={inputDisabled}
                                placeholder="Follow up… Type / for skills"
                                onChange={e => {
                                    setInputValue(e.target.value);
                                    slashCommands.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length);
                                    if (suggestions.length > 0) setSuggestions([]);
                                }}
                                onKeyDown={e => {
                                    if (slashCommands.handleKeyDown(e)) {
                                        if (e.key === 'Enter' || e.key === 'Tab') {
                                            const selected = slashCommands.filteredSkills[slashCommands.highlightIndex];
                                            if (selected) slashCommands.selectSkill(selected.name, inputValue, setInputValue);
                                        }
                                        return;
                                    }
                                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void sendFollowUp(); }
                                }}
                                onPaste={followUpImagePaste.addFromPaste}
                                className="w-full border rounded p-2 text-sm resize-none bg-white dark:bg-[#1e1e1e] text-[#1e1e1e] dark:text-[#cccccc] border-[#e0e0e0] dark:border-[#3c3c3c]"
                                data-testid="new-chat-followup-input"
                            />
                            <SlashCommandMenu
                                skills={skills}
                                filter={slashCommands.menuFilter}
                                onSelect={name => slashCommands.selectSkill(name, inputValue, setInputValue)}
                                onDismiss={slashCommands.dismissMenu}
                                visible={slashCommands.menuVisible}
                                highlightIndex={slashCommands.highlightIndex}
                            />
                        </div>
                        <Button disabled={inputDisabled || !inputValue.trim()} onClick={() => void sendFollowUp()} data-testid="new-chat-send-btn">
                            {sending ? '...' : 'Send'}
                        </Button>
                    </div>
                </div>
            )}
            {sessionExpired && (
                <div className="text-xs text-[#848484] text-center py-2">
                    Session expired.
                </div>
            )}
            {error && <div className="text-xs text-red-500 mt-1" data-testid="new-chat-error">{error}</div>}
        </div>
    );

    // --- dialog content ---

    const dialogContent = chatStarted ? renderConversation() : renderStartScreen();

    const title = chatStarted
        ? `Chat${readOnly ? ' (Read-Only)' : ''}`
        : `New Chat${readOnly ? ' (Read-Only)' : ''}`;

    const footer = !chatStarted ? (
        <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
                disabled={!inputValue.trim() || sending}
                onClick={() => void handleStartChat()}
                loading={sending}
                data-testid="new-chat-start-btn"
            >
                Start Chat <kbd className="ml-1 text-[9px] opacity-60">Ctrl+Enter</kbd>
            </Button>
        </>
    ) : undefined;

    if (!isMobile) {
        return (
            <FloatingDialog
                open
                id="new-chat-dialog"
                onClose={onClose}
                onMinimize={onMinimize}
                title={title}
                className="max-w-[700px] max-h-[80vh]"
                footer={footer}
                resizable
            >
                {dialogContent}
            </FloatingDialog>
        );
    }

    return (
        <Dialog
            open
            id="new-chat-dialog"
            onClose={onClose}
            onMinimize={onMinimize}
            title={title}
            className="max-w-[700px]"
            footer={footer}
        >
            {dialogContent}
        </Dialog>
    );
}
