/**
 * ActivityChatDetail — unified detail surface for the Activity tab.
 *
 * Orchestrates data loading, SSE streaming, follow-up messaging, scroll
 * management, and draft persistence. Delegates rendering to ChatHeader,
 * ConversationArea, and FollowUpInputArea, and behaviour to useChatSSE,
 * useSendMessage, useQueuedTaskPoll, and useChatWindowActions.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { fetchApi } from '../hooks/useApi';
import { getApiBase } from '../utils/config';
import { getConversationTurns } from '../chat/chatConversationUtils';
import { getSessionIdFromProcess } from '../processes/ConversationMetadataPopover';
import { useQueue } from '../context/QueueContext';
import { useApp } from '../context/AppContext';
import { useImagePaste } from '../hooks/useImagePaste';
import { useSlashCommands } from './useSlashCommands';
import type { SkillItem } from './SlashCommandMenu';
import { scanTurnsForCreatedFiles } from '../utils/conversationScan';
import type { ClientConversationTurn } from '../types/dashboard';
import { getDraft, setDraft, pruneExpired } from '../hooks/useDraftStore';
import { buildMetadataProcess } from '../utils/chatUtils';
import type { QueuedMessage } from '../utils/chatUtils';
import { useChatSSE } from '../hooks/useChatSSE';
import { useSendMessage } from '../hooks/useSendMessage';
import { useQueuedTaskPoll } from '../hooks/useQueuedTaskPoll';
import { useChatWindowActions } from '../hooks/useChatWindowActions';
import { ChatHeader } from './ChatHeader';
import { ConversationArea } from './ConversationArea';
import { FollowUpInputArea } from './FollowUpInputArea';
import { ConversationMiniMap } from '../processes/ConversationMiniMap';

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface ActivityChatDetailProps {
    taskId: string;
    onBack?: () => void;
    workspaceId?: string;
    /** When true (i.e., rendered inside a pop-out window), hides the pop-out button. */
    isPopOut?: boolean;
    /**
     * Controls the rendering variant:
     * - `'inline'` (default) — full header with back button, standard padding.
     * - `'floating'` — compact header (no back button, smaller padding, no border-b),
     *   as used inside a FloatingDialog overlay.
     */
    variant?: 'inline' | 'floating';
}

export function ActivityChatDetail({ taskId, onBack, workspaceId, isPopOut = false, variant = 'inline' }: ActivityChatDetailProps) {
    const [task, setTask] = useState<any>(null);
    const [fullTask, setFullTask] = useState<any>(null);

    // Derive attached plan file path (user-selected at task creation)
    const planPath: string =
        task?.payload?.context?.files?.[0] ??
        task?.payload?.planFilePath ??
        '';
    const [turns, setTurns] = useState<ClientConversationTurn[]>([]);
    const turnsRef = useRef<ClientConversationTurn[]>([]);
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionExpired, setSessionExpired] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isScrolledUp, setIsScrolledUp] = useState(false);
    const [followUpInput, setFollowUpInput] = useState('');
    const [resumeLaunching, setResumeLaunching] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'ask' | 'plan' | 'autopilot'>('autopilot');
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [sessionTokenLimit, setSessionTokenLimit] = useState<number | undefined>(undefined);
    const [sessionCurrentTokens, setSessionCurrentTokens] = useState<number | undefined>(undefined);
    const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);
    const lastFailedMessageRef = useRef<string>('');
    // Ref to capture latest followUpInput value for stale-closure-safe draft saves
    const followUpInputRef = useRef<string>('');
    const selectedModeRef = useRef<'ask' | 'plan' | 'autopilot'>('autopilot');

    const loadCounterRef = useRef(0);
    const conversationContainerRef = useRef<HTMLDivElement>(null);
    const turnsContainerRef = useRef<HTMLDivElement>(null);
    const lastRefreshVersionRef = useRef(0);
    const isInitialLoadRef = useRef(true);

    const { images, addFromPaste, removeImage, clearImages } = useImagePaste();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();
    const slashCommands = useSlashCommands(skills);

    // Keep refs in sync with state for stale-closure-safe draft saves
    followUpInputRef.current = followUpInput;
    selectedModeRef.current = selectedMode;

    const processId = task?.processId ?? (taskId ? `queue_${taskId}` : null);
    const isPending = task?.status === 'queued';
    const isTerminal = task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled';
    const inputDisabled = isPending || task?.status === 'cancelled' || sessionExpired;
    const resumeSessionId = getSessionIdFromProcess(processDetails || task);
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const metadataProcess = useMemo(() => buildMetadataProcess(task, processDetails, processId), [task, processId, processDetails]);
    const sessionModel = metadataProcess?.metadata?.model as string | undefined;
    const createdFiles = useMemo(() => scanTurnsForCreatedFiles(turns), [turns]);
    const pinnedFile = createdFiles.at(-1);

    const setTurnsAndRef = useCallback((next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        turnsRef.current = resolved;
        setTurns(resolved);
        if (taskId && !resolved.some(t => t.streaming)) {
            appDispatch({ type: 'CACHE_CONVERSATION', processId: taskId, turns: resolved });
        }
    }, [taskId, appDispatch]);

    const removeStreamingPlaceholder = useCallback(() => {
        setTurnsAndRef(prev => {
            const last = prev[prev.length - 1];
            return last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
        });
    }, [setTurnsAndRef]);

    const refreshConversation = useCallback(async (pid: string) => {
        try {
            const data = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
            setProcessDetails(data?.process || null);
            const refreshedTurns = getConversationTurns(data);
            setTurnsAndRef(refreshedTurns);
        } catch { /* keep current turns */ }
    }, [setTurnsAndRef]);

    const { sendFollowUp, flushQueueRef, closeFollowUpStream } = useSendMessage({
        processId,
        taskId,
        inputDisabled,
        sending,
        setSending,
        setError,
        setSessionExpired,
        setSuggestions,
        pendingQueue,
        setPendingQueue,
        setTurnsAndRef,
        removeStreamingPlaceholder,
        refreshConversation,
        queueDispatch,
        slashCommands,
        followUpInputRef,
        setFollowUpInput,
        selectedMode,
        selectedModeRef,
        images,
        clearImages,
        lastFailedMessageRef,
    });

    const { stopStreaming } = useChatSSE({
        taskId,
        task,
        processId,
        setIsStreaming,
        setTask,
        setPendingQueue,
        setSuggestions,
        setSessionTokenLimit,
        setSessionCurrentTokens,
        setTurnsAndRef,
        refreshConversation,
        flushQueueRef,
    });

    useQueuedTaskPoll({ taskId, task, setTask, setProcessDetails, setTurnsAndRef });

    const { handlePopOut, handleFloat } = useChatWindowActions({ task, taskId, workspaceId });

    // Fetch skills when workspaceId changes
    useEffect(() => {
        setSkills([]);
        if (!workspaceId) return;
        fetchApi('/workspaces/' + encodeURIComponent(workspaceId) + '/skills/all')
            .then((data: any) => {
                if (data?.merged && Array.isArray(data.merged)) {
                    setSkills(data.merged);
                } else if (data?.skills && Array.isArray(data.skills)) {
                    setSkills(data.skills);
                }
            })
            .catch(() => { /* ignore */ });
    }, [workspaceId]);

    // Fetch full task data for pending tasks (metadata + payload)
    useEffect(() => {
        if (!taskId || !isPending) { setFullTask(null); return; }
        fetchApi(`/queue/${encodeURIComponent(taskId)}`)
            .then((data: any) => setFullTask(data?.task || null))
            .catch(() => setFullTask(null));
    }, [taskId, isPending, queueState.refreshVersion]);

    // Prune stale drafts once on mount
    useEffect(() => { pruneExpired(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Load task + conversation on mount / taskId change
    useEffect(() => {
        isInitialLoadRef.current = true;
        const loadId = ++loadCounterRef.current;
        const currentTaskId = taskId;
        setLoading(true);
        setError(null);
        setSessionExpired(false);
        setTask(null);
        setFullTask(null);
        setTurnsAndRef([]);
        setProcessDetails(null);
        setSuggestions([]);
        setResumeFeedback(null);
        setSessionTokenLimit(undefined);
        setSessionCurrentTokens(undefined);
        clearImages();
        stopStreaming();
        closeFollowUpStream();
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        setPendingQueue([]);
        setSending(false);
        setIsStreaming(false);

        // Restore draft for the new taskId
        const draft = getDraft(currentTaskId);
        if (draft) {
            setFollowUpInput(draft.text);
            if (draft.mode && ['ask', 'plan', 'autopilot'].includes(draft.mode)) {
                setSelectedMode(draft.mode as 'ask' | 'plan' | 'autopilot');
            }
        } else {
            setFollowUpInput('');
        }

        (async () => {
            try {
                const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                if (loadCounterRef.current !== loadId) return;
                const loadedTask = queueData?.task ?? null;
                setTask(loadedTask);
                if (loadedTask?.payload?.mode && ['ask', 'plan', 'autopilot'].includes(loadedTask.payload.mode)) {
                    setSelectedMode(loadedTask.payload.mode);
                }

                if (!loadedTask?.processId && loadedTask?.status === 'queued') {
                    const prompt = loadedTask?.payload?.prompt ?? '';
                    if (prompt) {
                        setTurnsAndRef([{ role: 'user', content: prompt, timeline: [] }]);
                    }
                    return;
                }

                const pid = loadedTask?.processId ?? `queue_${taskId}`;

                // Check shared conversation cache
                const cached = appState.conversationCache[taskId];
                if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
                    setTurnsAndRef(cached.turns);
                    // Background-refresh metadata
                    fetchApi(`/processes/${encodeURIComponent(pid)}`)
                        .then((data: any) => {
                            setProcessDetails(data?.process || null);
                            const processMode = data?.process?.metadata?.mode;
                            if (processMode && ['ask', 'plan', 'autopilot'].includes(processMode)) {
                                setSelectedMode(processMode);
                            }
                        })
                        .catch(() => { /* metadata refresh is best-effort */ });
                } else {
                    const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                    if (loadCounterRef.current !== loadId) return;
                    setProcessDetails(procData?.process || null);
                    const processMode = procData?.process?.metadata?.mode;
                    if (processMode && ['ask', 'plan', 'autopilot'].includes(processMode)) {
                        setSelectedMode(processMode);
                    }
                    const loadedTurns = getConversationTurns(procData, loadedTask);
                    if (loadedTask?.status === 'running') {
                        const lastTurn = loadedTurns[loadedTurns.length - 1];
                        if (lastTurn?.role === 'assistant') {
                            setTurnsAndRef(loadedTurns.map((t: ClientConversationTurn, i: number) =>
                                i === loadedTurns.length - 1 ? { ...t, streaming: true } : t
                            ));
                        } else {
                            setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
                        }
                    } else {
                        setTurnsAndRef(loadedTurns);
                    }
                }
            } catch (err: any) {
                if (loadCounterRef.current !== loadId) return;
                setError(err?.message ?? 'Failed to load chat');
            } finally {
                if (loadCounterRef.current === loadId) setLoading(false);
            }
        })();

        return () => {
            stopStreaming();
            closeFollowUpStream();
            // Save draft on navigate-away; clear if input is empty
            setDraft(currentTaskId, followUpInputRef.current, selectedModeRef.current);
        };
    }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch conversation when user re-clicks the already-selected task
    useEffect(() => {
        const isRefresh = queueState.refreshVersion > 0 &&
            lastRefreshVersionRef.current !== queueState.refreshVersion;
        lastRefreshVersionRef.current = queueState.refreshVersion;
        if (!isRefresh || !taskId) return;

        (async () => {
            try {
                const queueData = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                const refreshedTask = queueData?.task ?? null;
                setTask(refreshedTask);

                const pid = refreshedTask?.processId ?? `queue_${taskId}`;
                if (!refreshedTask?.processId && refreshedTask?.status === 'queued') return;

                const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                setProcessDetails(procData?.process || null);
                const refreshedTurns = getConversationTurns(procData, refreshedTask);
                setTurnsAndRef(refreshedTurns);
            } catch { /* keep current state */ }
        })();
    }, [taskId, queueState.refreshVersion, setTurnsAndRef]);

    // Scroll to bottom on new turns
    useEffect(() => {
        if (!loading && turns.length > 0 && conversationContainerRef.current) {
            const el = conversationContainerRef.current;
            if (isInitialLoadRef.current) {
                // Force scroll to bottom when a task is first selected
                isInitialLoadRef.current = false;
                requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
            } else {
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                if (dist < 100) el.scrollTop = el.scrollHeight;
            }
        }
    }, [turns, loading]);

    // Track scroll position
    useEffect(() => {
        const el = conversationContainerRef.current;
        if (!el) return;
        const onScroll = () => {
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            setIsScrolledUp(dist > 100);
        };
        el.addEventListener('scroll', onScroll);
        return () => el.removeEventListener('scroll', onScroll);
    }, [taskId]);

    // Cleanup on unmount
    useEffect(() => () => { stopStreaming(); closeFollowUpStream(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCancel = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId), { method: 'DELETE' });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
        onBack?.();
    };

    const handleMoveToTop = async () => {
        await fetch(getApiBase() + '/queue/' + encodeURIComponent(taskId) + '/move-to-top', { method: 'POST' });
        queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
    };

    const retryLastMessage = () => {
        if (!lastFailedMessageRef.current) return;
        void sendFollowUp(lastFailedMessageRef.current);
    };

    const launchInteractiveResume = async () => {
        if (!processId || !resumeSessionId) return;
        setResumeLaunching(true);
        setResumeFeedback(null);
        try {
            const response = await fetch(`${getApiBase()}/processes/${encodeURIComponent(processId)}/resume-cli`, { method: 'POST' });
            const body = await response.json().catch(() => null);
            if (!response.ok) throw new Error(body?.error || `Failed to launch resume command (${response.status})`);
            const launched = body?.launched !== false;
            setResumeFeedback({
                type: 'success',
                message: launched ? 'Opened Terminal with Copilot resume command.' : 'Auto-launch unavailable. Run this command manually.',
                command: !launched && typeof body?.command === 'string' ? body.command : undefined,
            });
        } catch (err: any) {
            setResumeFeedback({ type: 'error', message: err?.message || 'Failed to launch Copilot resume command.' });
        } finally {
            setResumeLaunching(false);
        }
    };

    const scrollToBottom = () => {
        if (conversationContainerRef.current) {
            conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0" data-testid="activity-chat-detail">
            <ChatHeader
                task={task}
                metadataProcess={metadataProcess}
                planPath={planPath}
                createdFiles={createdFiles}
                pinnedFile={pinnedFile}
                onBack={onBack}
                variant={variant}
                isPopOut={isPopOut}
                loading={loading}
                turns={turns}
                resumeLaunching={resumeLaunching}
                resumeSessionId={resumeSessionId}
                isPending={isPending}
                sessionTokenLimit={sessionTokenLimit}
                sessionCurrentTokens={sessionCurrentTokens}
                sessionModel={sessionModel}
                copied={copied}
                setCopied={setCopied}
                taskId={taskId}
                onLaunchInteractiveResume={() => { void launchInteractiveResume(); }}
                onPopOut={handlePopOut}
                onFloat={handleFloat}
            />
            <div className="relative flex-1 min-h-0 flex">
                <ConversationArea
                    loading={loading}
                    error={error}
                    turns={turns}
                    pendingQueue={pendingQueue}
                    isScrolledUp={isScrolledUp}
                    scrollRef={conversationContainerRef}
                    turnsContainerRef={turnsContainerRef}
                    onScrollToBottom={scrollToBottom}
                    isPending={isPending}
                    task={task}
                    fullTask={fullTask}
                    onCancel={handleCancel}
                    onMoveToTop={handleMoveToTop}
                    variant={variant}
                    taskId={taskId}
                    wsId={workspaceId}
                />
                {variant !== 'floating' && (
                    <ConversationMiniMap
                        turns={turns}
                        scrollContainerRef={conversationContainerRef}
                        turnsContainerRef={turnsContainerRef}
                        isStreaming={task?.status === 'running'}
                    />
                )}
            </div>
            {!isPending && noSessionForFollowUp && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                    <div className="text-[#848484] text-sm text-center">
                        Follow-up chat is not available for this process type.
                    </div>
                </div>
            )}
            {!isPending && !noSessionForFollowUp && (
                <FollowUpInputArea
                    inputDisabled={inputDisabled}
                    sending={sending}
                    error={error}
                    resumeFeedback={resumeFeedback}
                    suggestions={suggestions}
                    followUpInput={followUpInput}
                    setFollowUpInput={setFollowUpInput}
                    selectedMode={selectedMode}
                    setSelectedMode={setSelectedMode}
                    onSend={sendFollowUp}
                    onRetry={retryLastMessage}
                    skills={skills}
                    images={images}
                    onImagePaste={addFromPaste}
                    onImageRemove={removeImage}
                    task={task}
                    slashCommands={slashCommands}
                />
            )}
        </div>
    );
}
