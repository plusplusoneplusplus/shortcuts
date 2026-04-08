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
import { useFileAttachments } from '../hooks/useFileAttachments';
import { useSlashCommands } from './useSlashCommands';
import { useBreakpoint } from '../hooks/useBreakpoint';
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
import type { ModelInfo } from '../hooks/useModels';
import { ChatHeader } from './ChatHeader';
import { ConversationArea } from './ConversationArea';
import { FollowUpInputArea } from './FollowUpInputArea';
import { CreateWorkItemDialog } from './CreateWorkItemDialog';
import type { RichTextInputHandle } from '../shared/RichTextInput';
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
    /** When true, suppresses QueueContext dispatches (SELECT_QUEUE_TASK). For embedded use. */
    standalone?: boolean;
    /** When true, hides the follow-up input area (read-only execution viewer). */
    readOnly?: boolean;
    /** Override the "Chat" title in ChatHeader */
    title?: string;
    /** Hide the ask/plan/autopilot mode selector */
    hideModeSelector?: boolean;
}

export function ActivityChatDetail({ taskId, onBack, workspaceId, isPopOut = false, variant = 'inline', standalone = false, readOnly = false, title, hideModeSelector = false }: ActivityChatDetailProps) {
    const [task, setTask] = useState<any>(null);
    const [fullTask, setFullTask] = useState<any>(null);

    // Derive attached plan file path (user-selected at task creation)
    function isAbsolutePath(v: unknown): v is string {
        if (typeof v !== 'string') return false;
        return v.startsWith('/') || /^[A-Za-z]:[/\\]/.test(v);
    }
    const rawContextFile = task?.payload?.context?.files?.[0];
    const planPath: string =
        (isAbsolutePath(rawContextFile) ? rawContextFile : undefined) ??
        task?.payload?.planFilePath ??
        task?.metadata?.planFilePath ??
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
    const [backgroundTasks, setBackgroundTasks] = useState<import('../hooks/useChatSSE').BackgroundTasksState | null>(null);
    const [showCreateWorkItem, setShowCreateWorkItem] = useState(false);
    const lastFailedMessageRef = useRef<string>('');
    // Ref to capture latest followUpInput value for stale-closure-safe draft saves
    const followUpInputRef = useRef<string>('');
    const richTextRef = useRef<RichTextInputHandle>(null);
    const selectedModeRef = useRef<'ask' | 'plan' | 'autopilot'>('autopilot');

    const loadCounterRef = useRef(0);
    const conversationContainerRef = useRef<HTMLDivElement>(null);
    const turnsContainerRef = useRef<HTMLDivElement>(null);
    const lastRefreshVersionRef = useRef(0);
    const isInitialLoadRef = useRef(true);

    const { attachments, images, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();
    const { isMobile } = useBreakpoint();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    const { state: appState, dispatch: appDispatch } = useApp();
    const slashCommands = useSlashCommands(skills);

    // Keep refs in sync with state for stale-closure-safe draft saves
    followUpInputRef.current = followUpInput;
    selectedModeRef.current = selectedMode;

    const processId = task?.processId ?? (taskId ? `queue_${taskId}` : null);
    const isPending = task?.status === 'queued';
    const isTerminal = task?.status === 'completed' || task?.status === 'failed' || task?.status === 'cancelled';
    const inputDisabled = loading || isPending || task?.status === 'cancelled' || task?.status === 'cancelling' || sessionExpired;
    const resumeSessionId = getSessionIdFromProcess(processDetails || task);
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const metadataProcess = useMemo(() => buildMetadataProcess(task, processDetails, processId), [task, processId, processDetails]);
    const sessionModel = metadataProcess?.metadata?.model as string | undefined;
    const createdFiles = useMemo(() => scanTurnsForCreatedFiles(turns), [turns]);

    // Detect .plan.md created mid-conversation and elevate to planPath slot
    const detectedPlanFile = useMemo(
        () => createdFiles.find(f => f.filePath.endsWith('.plan.md'))?.filePath ?? '',
        [createdFiles],
    );
    const effectivePlanPath = planPath || detectedPlanFile;

    // Deduplicate: remove the detected plan file from the regular files list
    const displayFiles = useMemo(
        () => effectivePlanPath ? createdFiles.filter(f => f.filePath !== effectivePlanPath) : createdFiles,
        [createdFiles, effectivePlanPath],
    );

    // Persist detected plan path to process metadata (fire at most once per load)
    const planPatchedRef = useRef(false);
    useEffect(() => {
        if (planPatchedRef.current) return;
        if (!detectedPlanFile || planPath || task?.metadata?.planFilePath || !processId) return;
        planPatchedRef.current = true;
        const merged = { ...(task?.metadata ?? {}), planFilePath: detectedPlanFile };
        fetchApi(`/processes/${encodeURIComponent(processId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ metadata: merged }),
        })
            .then((data: any) => {
                if (data?.process) setTask((prev: any) => prev ? { ...prev, metadata: data.process.metadata } : prev);
            })
            .catch(() => { /* best-effort persist */ });
    }, [detectedPlanFile, planPath, task?.metadata?.planFilePath, processId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Reset patch guard when switching tasks
    useEffect(() => { planPatchedRef.current = false; }, [taskId]);

    // Seed tokenLimit from /api/models as soon as sessionModel is known.
    // Only runs when sessionTokenLimit is still undefined to avoid clobbering
    // a value already received via SSE (conversation-snapshot / token-usage).
    useEffect(() => {
        if (!sessionModel || sessionTokenLimit !== undefined) return;
        fetchApi('/models')
            .then((data: ModelInfo[]) => {
                if (!Array.isArray(data)) return;
                const info = data.find(m => m.id === sessionModel);
                if (info?.tokenLimit && info.tokenLimit > 0) {
                    setSessionTokenLimit(info.tokenLimit);
                }
            })
            .catch(() => { /* ignore — bar stays hidden until SSE arrives */ });
    }, [sessionModel, sessionTokenLimit]); // eslint-disable-line react-hooks/exhaustive-deps
    const pinnedFile = createdFiles.at(-1);

    const setTurnsAndRef = useCallback((next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => {
        const resolved = typeof next === 'function' ? next(turnsRef.current) : next;
        // No-op: updater returned same reference — skip re-render and cache dispatch
        if (resolved === turnsRef.current) return;
        turnsRef.current = resolved;
        setTurns(resolved);
        if (taskId) {
            const dirty = resolved.some(t => t.streaming);
            appDispatch({ type: 'CACHE_CONVERSATION', processId: taskId, turns: resolved, dirty });
        }
    }, [taskId, appDispatch]);

    const removeStreamingPlaceholder = useCallback(() => {
        setTurnsAndRef(prev => {
            const last = prev[prev.length - 1];
            return last?.role === 'assistant' && last.streaming ? prev.slice(0, -1) : prev;
        });
    }, [setTurnsAndRef]);

    // Monotonic counter to deduplicate concurrent refreshConversation calls.
    // Only the latest in-flight fetch applies its result; earlier ones are discarded.
    const refreshVersionRef = useRef(0);

    const refreshConversation = useCallback(async (pid: string) => {
        const version = ++refreshVersionRef.current;
        try {
            const data = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
            // Discard stale response — a newer refresh was issued while we were in flight
            if (version !== refreshVersionRef.current) return;
            setProcessDetails(data?.process || null);
            const refreshedTurns = getConversationTurns(data);
            // Guard against stale data: skip if fetched data is less rich than current.
            // Check turn count first (cheap), then total content length for same-count case
            // where the server returned partial/unflushed content.
            if (refreshedTurns.length < turnsRef.current.length) return;
            if (refreshedTurns.length === turnsRef.current.length) {
                const fetchedLen = refreshedTurns.reduce((s, t) => s + (t.content?.length || 0), 0);
                const currentLen = turnsRef.current.reduce((s, t) => s + (t.content?.length || 0), 0);
                if (fetchedLen < currentLen) return;
            }
            setTurnsAndRef(refreshedTurns);
        } catch { /* keep current turns */ }
    }, [setTurnsAndRef]);

    const { sendFollowUp, closeFollowUpStream, onSendComplete } = useSendMessage({
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
        clearImages: clearAttachments,
        toPayload,
        lastFailedMessageRef,
        setTask,
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
        setBackgroundTasks,
        setTurnsAndRef,
        refreshConversation,
        onSendComplete,
        queueDispatch,
        workspaceId,
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
        clearAttachments();
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
                const cacheUsable = cached && (cached.dirty || Date.now() - cached.cachedAt < CACHE_TTL_MS);
                if (cacheUsable) {
                    setTurnsAndRef(cached.turns);
                    // Background-refresh both metadata AND turns
                    // (critical when cache is dirty from interrupted streaming)
                    fetchApi(`/processes/${encodeURIComponent(pid)}`)
                        .then((data: any) => {
                            if (loadCounterRef.current !== loadId) return;
                            setProcessDetails(data?.process || null);
                            const processMode = data?.process?.metadata?.mode;
                            if (processMode && ['ask', 'plan', 'autopilot'].includes(processMode)) {
                                setSelectedMode(processMode);
                            }
                            // Refresh turns to catch any missed during streaming
                            const refreshedTurns = getConversationTurns(data);
                            if (refreshedTurns.length > 0) {
                                setTurnsAndRef(prev => {
                                    if (refreshedTurns.length < prev.length) return prev;
                                    if (refreshedTurns.length === prev.length) {
                                        const fetchedLen = refreshedTurns.reduce((s: number, t: ClientConversationTurn) => s + (t.content?.length || 0), 0);
                                        const currentLen = prev.reduce((s, t) => s + (t.content?.length || 0), 0);
                                        if (fetchedLen < currentLen) return prev;
                                    }
                                    return refreshedTurns;
                                });
                            }
                        })
                        .catch(() => { /* background refresh is best-effort */ });
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
                            const nextIdx = Math.max(0, ...loadedTurns.map((t: ClientConversationTurn) => t.turnIndex ?? -1)) + 1;
                            setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [], turnIndex: nextIdx }]);
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
            } else if (!isScrolledUp) {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [turns, loading, isScrolledUp]);

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
        if (!standalone) queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
        onBack?.();
    };

    const handleStop = async () => {
        if (!processId) return;
        setSending(false);
        try {
            await fetchApi(`/processes/${encodeURIComponent(processId)}/cancel`, { method: 'POST' });
        } catch { /* best-effort */ }
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
        <div className="flex-1 flex flex-col min-h-0" data-testid="activity-chat-detail" {...(workspaceId ? { 'data-ws-id': workspaceId } : {})}>
            <ChatHeader
                task={task}
                metadataProcess={metadataProcess}
                planPath={effectivePlanPath}
                createdFiles={displayFiles}
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
                title={title}
                wsId={workspaceId}
                onCreateWorkItem={workspaceId ? () => setShowCreateWorkItem(true) : undefined}
            />
            <div className="relative flex-1 min-h-0 flex overflow-x-hidden min-w-0">
                <ConversationArea
                    loading={loading}
                    error={error}
                    turns={turns}
                    pendingQueue={pendingQueue}
                    backgroundTasks={backgroundTasks}
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
                {variant !== 'floating' && !isMobile && (
                    <ConversationMiniMap
                        turns={turns}
                        scrollContainerRef={conversationContainerRef}
                        turnsContainerRef={turnsContainerRef}
                        isStreaming={task?.status === 'running'}
                    />
                )}
            </div>
            {!readOnly && !isPending && noSessionForFollowUp && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                    <div className="text-[#848484] text-sm text-center">
                        Follow-up chat is not available for this process type.
                    </div>
                </div>
            )}
            {!readOnly && !isPending && !noSessionForFollowUp && (
                <FollowUpInputArea
                    richTextRef={richTextRef}
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
                    onStop={handleStop}
                    skills={skills}
                    attachments={attachments}
                    onAttachmentPaste={addFromPaste}
                    onAttachmentRemove={removeAttachment}
                    onAttachmentFiles={addFromFileInput}
                    attachmentError={attachmentError}
                    task={task}
                    slashCommands={slashCommands}
                    hideModeSelector={hideModeSelector}
                />
            )}
            {workspaceId && (
                <CreateWorkItemDialog
                    open={showCreateWorkItem}
                    onClose={() => setShowCreateWorkItem(false)}
                    workspaceId={workspaceId}
                    fromChatId={processId ?? undefined}
                />
            )}
        </div>
    );
}
