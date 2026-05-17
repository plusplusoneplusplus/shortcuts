/**
 * ChatDetail — unified detail surface for the Activity tab.
 *
 * Orchestrates data loading, SSE streaming, follow-up messaging, scroll
 * management, and draft persistence. Delegates rendering to ChatHeader,
 * ConversationArea, and FollowUpInputArea, and behaviour to useChatSSE,
 * useSendMessage, useQueuedTaskPoll, and useChatWindowActions.
 */

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';
import { getConversationTurns } from './conversation/chatConversationUtils';
import { getSessionIdFromProcess } from './conversation/ConversationMetadataPopover';
import { useQueue } from '../../contexts/QueueContext';
import { useApp } from '../../contexts/AppContext';
import { useFileAttachments } from './hooks/useFileAttachments';
import { useTextPaste } from './hooks/useTextPaste';
import { useAttachedContext } from './hooks/useAttachedContext';
import { useSlashCommands } from './hooks/useSlashCommands';
import { useModelCommand } from './hooks/useModelCommand';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { getMetaSkillItems, mergeSkillsWithMeta, type SkillItem } from './SlashCommandMenu';
import { scanTurnsForCreatedFiles } from '../../utils/conversationScan';
import { toQueueProcessId, isQueueProcessId, toTaskId } from '../../utils/queue-process-id';
import type { ClientConversationTurn } from '../../types/dashboard';
import { getDraft, setDraft, pruneExpired } from './hooks/useDraftStore';
import { buildMetadataProcess } from '../../utils/chatUtils';
import type { QueuedMessage } from '../../utils/chatUtils';
import { useChatSSE } from './hooks/useChatSSE';
import { hydrateAskUserBatch } from './hooks/hydrateAskUserBatch';
import { useSendMessage } from './hooks/useSendMessage';
import { useQueuedTaskPoll } from '../../queue/hooks/useQueuedTaskPoll';
import { useChatWindowActions } from './hooks/useChatWindowActions';
import { useModels } from '../../hooks/useModels';
import type { ModelInfo } from '../../hooks/useModels';
import { ChatHeader } from './ChatHeader';
import { ConversationArea } from './ConversationArea';
import { FollowUpInputArea } from './FollowUpInputArea';
import type { RichTextInputHandle } from '../../shared/RichTextInput';
import { ConversationMiniMap } from './conversation/ConversationMiniMap';
import { useConversationSelection } from './hooks/useConversationSelection';
import { snapshotConversation } from '../../utils/snapshot-copy-utils';
import { copyHtmlToClipboard } from '../../utils/format';
import { useScratchpadEnabled } from '../../hooks/feature-flags/useScratchpadEnabled';
import { useDisplaySettings } from '../../hooks/preferences/useDisplaySettings';
import { useScratchpadState } from './scratchpad/useScratchpadState';
import { ScratchpadDivider } from './scratchpad/ScratchpadDivider';
import { ScratchpadPanel } from './scratchpad/ScratchpadPanel';
import { MobileScratchpadTabBar } from './scratchpad/MobileScratchpadTabBar';
import { buildScratchpadCandidates } from './scratchpad/scratchpadCandidates';
import { isChatMode, resolveLoadedTaskMode } from './chatMode';
import { isRalphEnabled, isLoopsEnabled } from '../../utils/config';
import type { ChatMode } from '../../repos/modeConfig';
import { RalphStartPanel } from './RalphStartPanel';
import { ImplementPlanCard } from './ImplementPlanCard';
import type { ImplementationRecord, ExistingRun, RunLiveStatus } from './ImplementPlanCard';
import { getRalphContext } from '../../../../../tasks/task-types';
import { useLoops } from './hooks/useLoops';
import { LoopManagementPanel } from './LoopManagementPanel';

const CACHE_TTL_MS = 60 * 60 * 1000;

export interface ChatDetailProps {
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
    /** Override the "Chat" title in ChatHeader */
    title?: string;
    /** Hide the ask/plan/autopilot mode selector */
    hideModeSelector?: boolean;
    /** When set, restricts mode selector to only these modes */
    allowedModes?: ChatMode[];
    /**
     * When true, the mode selector renders as the icon-only cycling button at
     * all viewport sizes. Use in narrow side-by-side contexts (e.g.
     * NoteChatPanel) to avoid the wide `<select>` dropdown.
     */
    compactModeSelector?: boolean;
    /** When true, hides the follow-up input area (read-only view). */
    readOnly?: boolean;
    /**
     * When true, forces the scratchpad off regardless of the global display setting.
     * Use in embedded chat contexts (e.g. NoteChatPanel) where the scratchpad is
     * redundant or would conflict with the host UI.
     */
    disableScratchpad?: boolean;
    /**
     * Text prefix to prepend to the next follow-up message (e.g. note reference text).
     * Automatically prepended when the user sends and then cleared via onClearPendingPrefix.
     */
    pendingPrefix?: string;
    /** Called after pendingPrefix has been consumed (prepended and sent). */
    onClearPendingPrefix?: () => void;
}

export function ChatDetail({ taskId, onBack, workspaceId, isPopOut = false, variant = 'inline', standalone = false, title, hideModeSelector = false, allowedModes, compactModeSelector = false, readOnly = false, disableScratchpad = false, pendingPrefix, onClearPendingPrefix }: ChatDetailProps) {
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
    const [forking, setForking] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [selectedMode, setSelectedMode] = useState<ChatMode>('ask');
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [sessionTokenLimit, setSessionTokenLimit] = useState<number | undefined>(undefined);
    const [sessionCurrentTokens, setSessionCurrentTokens] = useState<number | undefined>(undefined);
    const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);
    const [invalidScratchpadPaths, setInvalidScratchpadPaths] = useState<Set<string>>(() => new Set());
    const [backgroundTasks, setBackgroundTasks] = useState<import('./hooks/useChatSSE').BackgroundTasksState | null>(null);
    const [pendingAskUserBatch, setPendingAskUserBatch] = useState<import('./hooks/useChatSSE').AskUserBatch | null>(null);
    const [noteEdits, setNoteEdits] = useState<Array<{
        editId: string; notePath: string; preEditContent: string;
        postEditContent?: string; timestamp: string; turnIndex: number; tooLarge?: boolean;
    }>>([]);
    const lastFailedMessageRef = useRef<string>('');
    // Ref to capture latest followUpInput value for stale-closure-safe draft saves
    const followUpInputRef = useRef<string>('');
    const richTextRef = useRef<RichTextInputHandle>(null);
    const selectedModeRef = useRef<ChatMode>('ask');

    const loadCounterRef = useRef(0);
    const conversationContainerRef = useRef<HTMLDivElement>(null);
    const turnsContainerRef = useRef<HTMLDivElement>(null);
    const scratchpadContainerRef = useRef<HTMLDivElement>(null);
    const isInitialLoadRef = useRef(true);

    const { attachments, images, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();
    const textPaste = useTextPaste();
    const attachedContext = useAttachedContext();
    const { isMobile } = useBreakpoint();
    const selection = useConversationSelection();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    // Init from current refreshVersion so a fresh mount treats it as "already seen"
    const lastRefreshVersionRef = useRef(queueState.refreshVersion);
    const { state: appState, dispatch: appDispatch } = useApp();
    const { models: availableModels } = useModels();
    const enabledModels = availableModels.filter(m => m.enabled);
    const modelCommand = useModelCommand(enabledModels);
    const augmentedSkills = useMemo(() => mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled())), [skills]);
    const slashCommands = useSlashCommands(augmentedSkills);

    // Loop management
    const processId = task?.processId ?? (taskId
        ? (isQueueProcessId(taskId) ? taskId : toQueueProcessId(taskId))
        : null);
    const loopsHook = useLoops(workspaceId, processId);
    const [loopPanelOpen, setLoopPanelOpen] = useState(false);

    const scratchpadEnabled = useScratchpadEnabled() && !disableScratchpad;
    const { scratchpadLayout } = useDisplaySettings();
    const bareTaskId = isQueueProcessId(taskId) ? toTaskId(taskId) : taskId;
    const scratchpad = useScratchpadState(scratchpadContainerRef, scratchpadLayout, bareTaskId);
    const workspaceRootPath = useMemo(() => {
        const workspace = appState.workspaces.find((ws: any) => ws.id === workspaceId);
        return typeof workspace?.rootPath === 'string' ? workspace.rootPath : '';
    }, [appState.workspaces, workspaceId]);

    // Keep refs in sync with state for stale-closure-safe draft saves
    followUpInputRef.current = followUpInput;
    selectedModeRef.current = selectedMode;

    const effectiveStatus = processDetails?.status ?? task?.status;
    const isActiveGeneration = effectiveStatus === 'running' || effectiveStatus === 'cancelling' || isStreaming;
    const isCancelling = effectiveStatus === 'cancelling';
    const isPending = effectiveStatus === 'queued';
    const isTerminal = effectiveStatus === 'completed' || effectiveStatus === 'failed' || effectiveStatus === 'cancelled';
    const planChatBusy = sending || isActiveGeneration || (pendingQueue?.length ?? 0) > 0;
    const inputDisabled = loading || isPending || effectiveStatus === 'cancelled' || isCancelling || sessionExpired;
    const resumeSessionId = getSessionIdFromProcess(processDetails || task);
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const metadataProcess = useMemo(() => buildMetadataProcess(task, processDetails, processId), [task, processId, processDetails]);
    const sessionModel = metadataProcess?.metadata?.model as string | undefined;
    const workingDirectory: string | undefined = metadataProcess?.workingDirectory
        || metadataProcess?.payload?.workingDirectory
        || metadataProcess?.metadata?.workingDirectory
        || undefined;
    const createdFiles = useMemo(() => scanTurnsForCreatedFiles(turns), [turns]);

    // Compute the follow-up mode pill set, optionally appending Ralph when
    // the chat is eligible for in-place promotion. Eligibility:
    //   - completed (no in-flight turn or queued follow-ups)
    //   - payload mode === 'ask' (plan/autopilot/ralph already-Ralph excluded)
    //   - no existing Ralph context (already-Ralph chats hide the pill)
    //   - not read-only
    // The Ralph pill is also omitted when the consumer pinned `allowedModes`.
    const effectiveAllowedModes = useMemo<ChatMode[] | undefined>(() => {
        if (allowedModes) return allowedModes;
        const ralphCtx = getRalphContext(task);
        const payloadMode = resolveLoadedTaskMode(task);
        const noPending = (pendingQueue?.length ?? 0) === 0;
        const ralphEligible = isRalphEnabled()
            && !readOnly
            && !ralphCtx
            && payloadMode === 'ask'
            && effectiveStatus === 'completed'
            && noPending;
        if (!ralphEligible) return undefined;
        return ['ask', 'plan', 'autopilot', 'ralph'];
    }, [allowedModes, task, effectiveStatus, readOnly, pendingQueue]);

    // Coerce a stored draft mode of 'ralph' back to 'ask' when the Ralph pill
    // is no longer in the allowed set (already-promoted, running, etc.). Without
    // this the pill row would render with no element matching `selectedMode`,
    // leaving the UI in a "selected pill that no longer exists" state.
    useEffect(() => {
        if (selectedMode !== 'ralph') return;
        const allowed = effectiveAllowedModes;
        if (!allowed || !allowed.includes('ralph')) {
            setSelectedMode('ask');
        }
    }, [selectedMode, effectiveAllowedModes]);

    // Detect .plan.md created mid-conversation and elevate to planPath slot
    const detectedPlanFile = useMemo(
        () => createdFiles.find(f => f.filePath.endsWith('.plan.md'))?.filePath ?? '',
        [createdFiles],
    );
    const effectivePlanPath = planPath || detectedPlanFile;

    const handleCopySelected = useCallback(async () => {
        if (!turnsContainerRef.current || selection.selectedTurns.size === 0) return;
        try {
            const html = snapshotConversation(turnsContainerRef.current, {
                selectedIndices: selection.selectedTurns,
            });
            await copyHtmlToClipboard(html);
            selection.stopSelecting();
        } catch (e) {
            console.error('Copy selected HTML failed:', e);
        }
    }, [selection]);

    // Deduplicate: remove the detected plan file from the regular files list;
    // also remove .md files already tracked in the scratchpad tabs so they
    // don't appear in both the References dropdown AND the scratchpad divider.
    const displayFiles = useMemo(() => {
        let files = effectivePlanPath
            ? createdFiles.filter(f => f.filePath !== effectivePlanPath)
            : createdFiles;
        if (scratchpadEnabled && scratchpad.knownFiles.length > 0) {
            const tabPaths = new Set(scratchpad.knownFiles.map(p => p.toLowerCase()));
            files = files.filter(f => !tabPaths.has(f.filePath.toLowerCase()));
        }
        return files;
    }, [createdFiles, effectivePlanPath, scratchpadEnabled, scratchpad.knownFiles]);

    // Persist detected plan path to process metadata (fire at most once per load)
    const planPatchedRef = useRef(false);
    useEffect(() => {
        if (planPatchedRef.current) return;
        if (!detectedPlanFile || planPath || task?.metadata?.planFilePath || !processId) return;
        planPatchedRef.current = true;
        const merged = { ...(task?.metadata ?? {}), planFilePath: detectedPlanFile };
        getSpaCocClient().processes.update(processId, { metadata: merged })
            .then((data: any) => {
                if (data?.process) setTask((prev: any) => prev ? { ...prev, metadata: data.process.metadata } : prev);
            })
            .catch(() => { /* best-effort persist */ });
    }, [detectedPlanFile, planPath, task?.metadata?.planFilePath, processId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch note edit snapshots for note-chat processes (needed for NoteEditCard)
    useEffect(() => {
        if (!processId || !isTerminal) return;
        // Only fetch for note-chat processes
        if (task?.metadata?.notePath === undefined) return;
        getSpaCocClient().notes.listNoteEdits(processId)
            .then((edits: any) => {
                if (Array.isArray(edits) && edits.length > 0) setNoteEdits(edits);
            })
            .catch(() => { /* best-effort */ });
    }, [processId, isTerminal, task?.metadata?.notePath]);

    // Reset patch guard when switching tasks
    useEffect(() => {
        planPatchedRef.current = false;
        setInvalidScratchpadPaths(new Set());
    }, [taskId]);

    // ── Resolve existing implementation runs from task metadata ─────────
    const rawImplementations: ImplementationRecord[] = useMemo(() => {
        const impls = task?.metadata?.implementations;
        return Array.isArray(impls) ? impls : [];
    }, [task?.metadata?.implementations]);

    // Resolve live status for each recorded implementation from the queue context
    const existingRuns: ExistingRun[] = useMemo(() => {
        if (rawImplementations.length === 0) return [];
        const allTasks = [...queueState.queued, ...queueState.running, ...queueState.history];
        return rawImplementations.map((rec) => {
            const bareId = rec.processId.startsWith('queue_') ? rec.processId.slice(6) : rec.processId;
            const found = allTasks.find((t: any) => t.id === bareId || t.id === rec.processId);
            let liveStatus: RunLiveStatus = 'unknown';
            if (found) {
                const s = found.status as string;
                if (s === 'queued' || s === 'running' || s === 'completed' || s === 'failed' || s === 'cancelled') {
                    liveStatus = s;
                }
            }
            return { ...rec, liveStatus };
        });
    }, [rawImplementations, queueState.queued, queueState.running, queueState.history]);

    // One-time fetch for implementation runs not found in queue state
    const implFetchedRef = useRef(false);
    useEffect(() => {
        if (implFetchedRef.current || rawImplementations.length === 0) return;
        const unknown = existingRuns.filter(r => r.liveStatus === 'unknown');
        if (unknown.length === 0) return;
        implFetchedRef.current = true;
        Promise.all(
            unknown.map(async (run) => {
                try {
                    const data = await getSpaCocClient().processes.get(run.processId);
                    return { processId: run.processId, status: data?.process?.status as RunLiveStatus ?? 'unknown' };
                } catch {
                    return { processId: run.processId, status: 'unknown' as RunLiveStatus };
                }
            }),
        ).then((results) => {
            const statusMap = Object.fromEntries(results.map(r => [r.processId, r.status]));
            setTask((prev: any) => {
                if (!prev) return prev;
                const impls = Array.isArray(prev.metadata?.implementations) ? prev.metadata.implementations : [];
                const updatedImpls = impls.map((rec: ImplementationRecord) => ({
                    ...rec,
                    _resolvedStatus: statusMap[rec.processId] ?? undefined,
                }));
                return { ...prev, metadata: { ...prev.metadata, implementations: updatedImpls, _implStatusMap: statusMap } };
            });
        });
    }, [rawImplementations, existingRuns]); // eslint-disable-line react-hooks/exhaustive-deps

    // Merge fetched statuses into existingRuns
    const resolvedRuns: ExistingRun[] = useMemo(() => {
        const statusMap = task?.metadata?._implStatusMap as Record<string, RunLiveStatus> | undefined;
        if (!statusMap) return existingRuns;
        return existingRuns.map(run => ({
            ...run,
            liveStatus: run.liveStatus === 'unknown' ? (statusMap[run.processId] ?? 'unknown') : run.liveStatus,
        }));
    }, [existingRuns, task?.metadata?._implStatusMap]);

    // Reset impl-fetch guard when switching tasks
    useEffect(() => { implFetchedRef.current = false; }, [taskId]);

    // Reactively sync title and status from process-updated WS events (via AppContext)
    useEffect(() => {
        if (!processId) return;
        const proc = appState.processes.find((p: any) => p.id === processId);
        if (!proc) return;
        setTask((prev: any) => {
            if (!prev) return prev;
            const titleChanged = proc.title && prev.displayName !== proc.title;
            const statusChanged = proc.status && prev.status !== proc.status;
            if (!titleChanged && !statusChanged) return prev;
            return {
                ...prev,
                ...(titleChanged ? { displayName: proc.title } : {}),
                ...(statusChanged ? { status: proc.status } : {}),
            };
        });
    }, [processId, appState.processes]);

    // Seed tokenLimit from /api/models as soon as sessionModel is known.
    // Only runs when sessionTokenLimit is still undefined to avoid clobbering
    // a value already received via SSE (conversation-snapshot / token-usage).
    useEffect(() => {
        if (!sessionModel || sessionTokenLimit !== undefined) return;
        getSpaCocClient().models.list()
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
            const data = await getSpaCocClient().processes.get(pid);
            setProcessDetails(data?.process || null);
            const refreshedTurns = getConversationTurns(data);
            // Preserve client-only costTimeMs across server refresh
            setTurnsAndRef(prev => {
                const costTimeMap = new Map<number, number>();
                for (const t of prev) {
                    if (t.costTimeMs != null && t.turnIndex != null) {
                        costTimeMap.set(t.turnIndex, t.costTimeMs);
                    }
                }
                if (costTimeMap.size === 0) return refreshedTurns;
                return refreshedTurns.map(t => {
                    const ct = t.turnIndex != null ? costTimeMap.get(t.turnIndex) : undefined;
                    return ct != null ? { ...t, costTimeMs: ct } : t;
                });
            });
            // Sync queued follow-ups from server state
            const serverPending: any[] = data?.process?.pendingMessages ?? [];
            setPendingQueue(serverPending.map((m: any) => ({
                id: m.id,
                content: m.content,
                status: 'queued' as const,
            })));
        } catch { /* keep current turns */ }
    }, [setTurnsAndRef]);

    const { sendFollowUp, closeFollowUpStream, onSendComplete } = useSendMessage({
        processId,
        taskId,
        inputDisabled,
        sending,
        isActiveGeneration,
        setSending,
        setError,
        setSessionExpired,
        setSuggestions,
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
        clearPaste: textPaste.clearPaste,
        getPastedContent: () => textPaste.pastedContent,
        lastFailedMessageRef,
        setTask,
        getAttachedContext: attachedContext.getItems,
        clearAttachedContext: attachedContext.clear,
        modelOverride: modelCommand.modelOverride,
        workspaceId,
        // After a successful Ralph promotion the follow-up area's `allowedModes`
        // recomputes (the chat now has a ralph context) and the Ralph pill
        // disappears; reset the selector to a value that still exists so we
        // don't show a "selected pill that no longer exists" UI glitch.
        onPromotedToRalph: () => setSelectedMode('ask'),
    });

    const sendFollowUpWithPrefix = useCallback(async (overrideContent?: string, deliveryMode?: any) => {
        if (pendingPrefix) {
            const base = overrideContent ?? followUpInputRef.current;
            const prefixed = pendingPrefix + (base ? base : '');
            onClearPendingPrefix?.();
            return sendFollowUp(prefixed, deliveryMode);
        }
        return sendFollowUp(overrideContent, deliveryMode);
    }, [pendingPrefix, onClearPendingPrefix, sendFollowUp, followUpInputRef]);

    const { stopStreaming } = useChatSSE({
        taskId,
        task,
        processId,
        setIsStreaming,
        setTask,
        setProcessDetails,
        setPendingQueue,
        setSuggestions,
        setSessionTokenLimit,
        setSessionCurrentTokens,
        setBackgroundTasks,
        setTurnsAndRef,
        refreshConversation,
        onSendComplete,
        onAskUserBatch: setPendingAskUserBatch,
    });

    useQueuedTaskPoll({ taskId, task, setTask, setProcessDetails, setTurnsAndRef });

    const { handlePopOut, handleFloat } = useChatWindowActions({ task, taskId, workspaceId });

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

    // Fetch full task data for pending tasks (metadata + payload)
    useEffect(() => {
        if (!taskId || !isPending) { setFullTask(null); return; }
        getSpaCocClient().queue.getTask(bareTaskId)
            .then((data: any) => setFullTask(data?.task || null))
            .catch(() => setFullTask(null));
    }, [taskId, isPending, queueState.refreshVersion]);

    // Prune stale drafts once on mount
    useEffect(() => { pruneExpired(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Hydrate pendingAskUserBatch from processDetails.pendingAskUser so that
    // the ask-user widget appears on cold load (or page refresh) without
    // depending on an in-flight SSE `ask-user` event. The executor is the
    // single source of truth: it persists pendingAskUser when the AI asks
    // and clears it on answer/skip/cancel, so we mirror that state directly.
    useEffect(() => {
        setPendingAskUserBatch(prev => hydrateAskUserBatch(processDetails?.pendingAskUser, prev));
    }, [processDetails]);

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
        textPaste.clearPaste();
        stopStreaming();
        closeFollowUpStream();
        queueDispatch({ type: 'SET_FOLLOW_UP_STREAMING', value: false, turnIndex: null });
        setPendingQueue([]);
        setPendingAskUserBatch(null);
        setSending(false);
        setIsStreaming(false);

        // Restore draft for the new taskId
        const draft = getDraft(currentTaskId);
        if (draft) {
            setFollowUpInput(draft.text);
            if (isChatMode(draft.mode)) {
                setSelectedMode(draft.mode);
            }
        } else {
            setFollowUpInput('');
        }

        (async () => {
            try {
                // If taskId is already a processId (history item or processId-keyed selection),
                // try loading from /processes/ first.
                if (isQueueProcessId(taskId)) {
                    const pid = taskId;
                    const processData = await getSpaCocClient().processes.get(pid);
                    if (loadCounterRef.current !== loadId) return;
                    const loadedProcess = processData?.process ?? null;

                    if (loadedProcess) {
                        setTask({
                            id: taskId,
                            processId: pid,
                            status: loadedProcess.status,
                            type: loadedProcess.type ?? 'chat',
                            payload: loadedProcess.payload ?? {},
                            metadata: loadedProcess.metadata ?? {},
                            displayName: loadedProcess.title,
                        });
                        const turns = getConversationTurns(processData);
                        setTurnsAndRef(turns);
                        setProcessDetails(loadedProcess);
                        setLoading(false);
                        return;
                    }
                    // Process not found — may be a pending queue task whose process
                    // hasn't been created yet. Fall through to queue fetch using
                    // the derived bare taskId.
                }

                // Queue fetch path — taskId may be bare or a processId that fell through
                const queueData = await getSpaCocClient().queue.getTask(bareTaskId);
                if (loadCounterRef.current !== loadId) return;
                const loadedTask = queueData?.task ?? null;

                if (!loadedTask?.processId && loadedTask?.status === 'queued') {
                    setTask(loadedTask);
                    const prompt = loadedTask?.payload?.prompt ?? '';
                    if (prompt) {
                        setTurnsAndRef([{ role: 'user', content: prompt, turnIndex: 0, timeline: [] }]);
                    }
                    return;
                }

                const pid = loadedTask?.processId ?? (isQueueProcessId(taskId) ? taskId : toQueueProcessId(taskId));

                // Check shared conversation cache
                const cached = appState.conversationCache[taskId];
                if (cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS)) {
                    setTask(loadedTask);
                    setTurnsAndRef(cached.turns);
                    // Background-refresh metadata
                    getSpaCocClient().processes.get(pid)
                        .then((data: any) => {
                            setProcessDetails(data?.process || null);
                            // Sync queued follow-ups from server
                            const serverPending: any[] = data?.process?.pendingMessages ?? [];
                            setPendingQueue(serverPending.map((m: any) => ({
                                id: m.id,
                                content: m.content,
                                status: 'queued' as const,
                            })));
                        })
                        .catch(() => { /* metadata refresh is best-effort */ });
                } else {
                    const procData = await getSpaCocClient().processes.get(pid);
                    if (loadCounterRef.current !== loadId) return;

                    // Reconcile: process status is authoritative over queue status
                    const procStatus = procData?.process?.status;
                    const effectiveTask = procStatus && procStatus !== loadedTask?.status
                        ? { ...loadedTask, status: procStatus }
                        : loadedTask;

                    setTask(effectiveTask);
                    setProcessDetails(procData?.process || null);
                    const loadedTurns = getConversationTurns(procData, effectiveTask);
                    if (effectiveTask?.status === 'running') {
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

                    // Sync queued follow-ups from server
                    const serverPending: any[] = procData?.process?.pendingMessages ?? [];
                    setPendingQueue(serverPending.map((m: any) => ({
                        id: m.id,
                        content: m.content,
                        status: 'queued' as const,
                    })));
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

    // Sync mode selector with the loaded task's mode
    useEffect(() => {
        if (!task) {
            return;
        }
        const draft = getDraft(taskId);
        if (isChatMode(draft?.mode)) {
            return;
        }
        const taskMode = resolveLoadedTaskMode(task);
        if (taskMode) {
            setSelectedMode(taskMode);
        }
    }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Re-fetch conversation when user re-clicks the already-selected task
    // (REFRESH_SELECTED_QUEUE_TASK bumps refreshVersion).
    // NOTE: taskId is constant within a mount (parent uses key={taskId}).
    useEffect(() => {
        const isRefresh = queueState.refreshVersion > 0 &&
            lastRefreshVersionRef.current !== queueState.refreshVersion;
        lastRefreshVersionRef.current = queueState.refreshVersion;
        if (!isRefresh || !taskId) return;

        (async () => {
            try {
                // For processId-keyed taskIds, try loading process directly first
                if (isQueueProcessId(taskId)) {
                    const procData = await getSpaCocClient().processes.get(taskId);
                    if (procData?.process) {
                        setTask({
                            id: taskId,
                            processId: taskId,
                            status: procData.process.status,
                            type: procData.process.type ?? 'chat',
                            payload: procData.process.payload ?? {},
                            metadata: procData.process.metadata ?? {},
                            displayName: procData.process.title,
                        });
                        setProcessDetails(procData.process);
                        const refreshedTurns = getConversationTurns(procData);
                        setTurnsAndRef(refreshedTurns);
                        return;
                    }
                    // Fall through to queue fetch with bare taskId
                }

                const queueData = await getSpaCocClient().queue.getTask(bareTaskId);
                const refreshedTask = queueData?.task ?? null;

                const pid = refreshedTask?.processId ?? (isQueueProcessId(taskId) ? taskId : toQueueProcessId(taskId));
                if (!refreshedTask?.processId && refreshedTask?.status === 'queued') {
                    setTask(refreshedTask);
                    return;
                }

                const procData = await getSpaCocClient().processes.get(pid);

                // Reconcile: process status is authoritative over queue status
                const procStatus = procData?.process?.status;
                const effectiveTask = procStatus && procStatus !== refreshedTask?.status
                    ? { ...refreshedTask, status: procStatus }
                    : refreshedTask;

                setTask(effectiveTask);
                setProcessDetails(procData?.process || null);
                const refreshedTurns = getConversationTurns(procData, effectiveTask);
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

    // Register all .md files from created files into the scratchpad tab list.
    // The plan file is excluded — it has its own dedicated display in the header.
    useEffect(() => {
        if (!scratchpadEnabled) return;
        const mdPaths = createdFiles
            .map(f => f.filePath)
            .filter(p => p.endsWith('.md') && p !== effectivePlanPath);
        if (mdPaths.length > 0) {
            scratchpad.registerFiles(mdPaths);
        }
    }, [createdFiles, effectivePlanPath, scratchpadEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

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
        await getSpaCocClient().queue.cancel(bareTaskId);
        if (!standalone) queueDispatch({ type: 'SELECT_QUEUE_TASK', id: null, repoId: workspaceId });
        onBack?.();
    };

    const handleMoveToTop = async () => {
        await getSpaCocClient().queue.moveToTop(bareTaskId);
        queueDispatch({ type: 'REFRESH_SELECTED_QUEUE_TASK' });
    };

    const retryLastMessage = () => {
        if (!lastFailedMessageRef.current) return;
        void sendFollowUp(lastFailedMessageRef.current);
    };

    const handleStop = useCallback(async () => {
        if (!processId) return;
        try {
            await getSpaCocClient().processes.cancel(processId);
        } catch { /* best-effort: SSE will reflect the actual state */ }
    }, [processId]);

    // ── Per-turn actions: delete, pin, archive ──
    const [undoDelete, setUndoDelete] = useState<{ turnIndex: number; timer: ReturnType<typeof setTimeout> } | null>(null);

    const handleDeleteTurn = useCallback((turnIndex: number) => {
        if (!processId) return;
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: new Date().toISOString() } : t));
        getSpaCocClient().processes.deleteTurn(processId, turnIndex).catch(() => {
            setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        });
        if (undoDelete) clearTimeout(undoDelete.timer);
        const timer = setTimeout(() => setUndoDelete(null), 5000);
        setUndoDelete({ turnIndex, timer });
    }, [processId, undoDelete]);

    const handleUndoDelete = useCallback(() => {
        if (!undoDelete || !processId) return;
        clearTimeout(undoDelete.timer);
        const { turnIndex } = undoDelete;
        setUndoDelete(null);
        setTurns(prev => prev.map(t => t.turnIndex === turnIndex ? { ...t, deletedAt: undefined } : t));
        getSpaCocClient().processes.restoreTurn(processId, turnIndex).catch(() => {});
    }, [undoDelete, processId]);

    const handlePinTurn = useCallback((turnIndex: number, pinned: boolean) => {
        if (!processId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex
                ? { ...t, pinnedAt: pinned ? new Date().toISOString() : undefined, archived: pinned ? false : t.archived }
                : t
        ));
        getSpaCocClient().processes.pinTurn(processId, turnIndex, pinned).catch(() => {
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex
                    ? { ...t, pinnedAt: pinned ? undefined : new Date().toISOString() }
                    : t
            ));
        });
    }, [processId]);

    const handleArchiveTurn = useCallback((turnIndex: number, archived: boolean) => {
        if (!processId) return;
        setTurns(prev => prev.map(t =>
            t.turnIndex === turnIndex ? { ...t, archived } : t
        ));
        getSpaCocClient().processes.archiveTurn(processId, turnIndex, archived).catch(() => {
            setTurns(prev => prev.map(t =>
                t.turnIndex === turnIndex ? { ...t, archived: !archived } : t
            ));
        });
    }, [processId]);

    const handleCancelPendingMessage = useCallback((messageId: string) => {
        if (!processId) return;
        let removed: QueuedMessage | undefined;
        setPendingQueue(prev => {
            removed = prev.find(m => m.id === messageId);
            return prev.filter(m => m.id !== messageId);
        });
        getSpaCocClient().processes.deletePendingMessage(processId, messageId).catch(() => {
            if (removed) {
                setPendingQueue(prev => (prev.some(m => m.id === messageId) ? prev : [...prev, removed!]));
            }
        });
    }, [processId]);

    const launchInteractiveResume = async () => {
        if (!processId || !resumeSessionId) return;
        setResumeLaunching(true);
        setResumeFeedback(null);
        try {
            const body = await getSpaCocClient().processes.resumeCli(processId);
            const launched = body.launched !== false;
            setResumeFeedback({
                type: 'success',
                message: launched ? 'Opened Terminal with Copilot resume command.' : 'Auto-launch unavailable. Run this command manually.',
                command: !launched && typeof body?.command === 'string' ? body.command : undefined,
            });
        } catch (err) {
            setResumeFeedback({ type: 'error', message: getSpaCocClientErrorMessage(err, 'Failed to launch Copilot resume command.') });
        } finally {
            setResumeLaunching(false);
        }
    };

    const handleFork = useCallback(async () => {
        if (!processId || forking) return;
        setForking(true);
        try {
            const data = await getSpaCocClient().processes.fork(processId);
            if (data?.process?.id && workspaceId) {
                location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/activity/' + encodeURIComponent(data.process.id);
            }
        } catch (err: any) {
            console.error('Fork failed:', err);
        } finally {
            setForking(false);
        }
    }, [processId, forking, workspaceId]);

    const scrollToBottom = () => {
        if (conversationContainerRef.current) {
            conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
        }
    };

    const isVerticalScratchpad = scratchpadEnabled && scratchpad.isOpen && scratchpadLayout === 'vertical';
    /** On mobile, when the scratchpad is open, switch to full-screen tab mode. */
    const isMobileScratchpad = isMobile && scratchpadEnabled && scratchpad.isOpen;
    const scratchpadCandidates = useMemo(() => buildScratchpadCandidates({
        linkedNotePath: scratchpad.linkedNotePath,
        knownFiles: scratchpad.knownFiles,
        createdFiles,
        effectivePlanPath,
        invalidPaths: invalidScratchpadPaths,
    }), [scratchpad.linkedNotePath, scratchpad.knownFiles, createdFiles, effectivePlanPath, invalidScratchpadPaths]);

    const showScratchpadButton = scratchpadEnabled
        && !scratchpad.isOpen
        && scratchpadCandidates.length > 0;

    const handleOpenScratchpad = useCallback(() => {
        scratchpad.open(scratchpadCandidates[0]);
    }, [scratchpad, scratchpadCandidates]);

    const handleScratchpadNotFound = useCallback(() => {
        const missingPath = scratchpad.linkedNotePath;
        if (!missingPath) {
            scratchpad.close();
            return;
        }

        const missingKey = missingPath.toLowerCase();
        const nextPath = scratchpadCandidates.find(path => path.toLowerCase() !== missingKey);
        setInvalidScratchpadPaths(prev => {
            const next = new Set(prev);
            next.add(missingKey);
            return next;
        });
        scratchpad.unregisterFile(missingPath);
        if (nextPath) {
            scratchpad.open(nextPath);
        } else {
            scratchpad.close();
        }
    }, [scratchpad, scratchpadCandidates]);

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
                title={title || task?.displayName}
                wsId={workspaceId}
                turnsContainerRef={turnsContainerRef}
                isSelecting={selection.isSelecting}
                onToggleSelecting={selection.toggleSelecting}
                showScratchpadButton={showScratchpadButton}
                onOpenScratchpad={handleOpenScratchpad}
                onFork={metadataProcess?.sdkSessionId && task?.status === 'completed' ? handleFork : undefined}
                forking={forking}
                loopCount={loopsHook.manageableCount}
                hasActiveLoops={loopsHook.hasActiveLoops}
                onToggleLoopPanel={() => setLoopPanelOpen(v => !v)}
            />
            {loopPanelOpen && isLoopsEnabled() && (
                <div className="relative">
                    <LoopManagementPanel
                        loops={loopsHook.loops}
                        isOpen={loopPanelOpen}
                        onClose={() => setLoopPanelOpen(false)}
                        onPause={loopsHook.pause}
                        onResume={loopsHook.resume}
                        onCancel={loopsHook.cancel}
                    />
                </div>
            )}
            <div ref={scratchpadContainerRef}className={`relative flex-1 min-h-0 flex ${isVerticalScratchpad ? 'flex-row' : 'flex-col'} overflow-x-hidden min-w-0`}>
                {/* Chat column: in vertical split, also contains the follow-up input */}
                <div
                    className={`relative flex flex-col min-w-0 overflow-hidden ${isVerticalScratchpad ? 'min-h-0' : ''}${isMobileScratchpad && scratchpad.activeMobileTab !== 'chat' ? ' hidden' : ''}`}
                    style={scratchpadEnabled && scratchpad.isOpen && !isMobileScratchpad
                        ? { flex: `0 0 ${scratchpad.topHeightPct}%`, ...(isVerticalScratchpad ? { minWidth: 0 } : { minHeight: 0 }) }
                        : { flex: '1 1 auto', minHeight: 0 }
                    }
                >
                    {/* Inner row: ConversationArea + MiniMap side by side */}
                    <div className="relative flex flex-1 min-h-0 overflow-hidden min-w-0">
                    <ConversationArea
                        loading={loading}
                        error={error}
                        turns={turns}
                        pendingQueue={pendingQueue}
                        backgroundTasks={backgroundTasks}
                        pendingAskUserBatch={pendingAskUserBatch}
                        onAskUserAnswered={() => setPendingAskUserBatch(null)}
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
                        isSelecting={selection.isSelecting}
                        selectedTurns={selection.selectedTurns}
                        onTurnClick={selection.handleTurnClick}
                        onCopySelected={handleCopySelected}
                        onCancelSelection={selection.stopSelecting}
                        onAttachContext={attachedContext.add}
                        onDeleteTurn={handleDeleteTurn}
                        onPinTurn={handlePinTurn}
                        onArchiveTurn={handleArchiveTurn}
                        undoDeleteTurnIndex={undoDelete?.turnIndex ?? null}
                        onUndoDelete={handleUndoDelete}
                        noteEdits={noteEdits}
                        processId={processId ?? bareTaskId}
                        processType={fullTask?.type ?? task?.type}
                        onCancelPendingMessage={handleCancelPendingMessage}
                        inputRef={richTextRef}
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
                    {/* Ralph grilling complete — show Start Ralph panel */}
                    {(() => {
                        const ralphCtx = getRalphContext(task);
                        if (!ralphCtx) return null;
                        if (ralphCtx.phase !== 'grilling') return null;
                        if (task?.status !== 'completed') return null;
                        return (
                            <RalphStartPanel
                                processId={processId ?? taskId}
                                workspaceId={workspaceId}
                                turns={turns}
                                onStarted={(newProcessId) => {
                                    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newProcessId, repoId: workspaceId });
                                }}
                            />
                        );
                    })()}
                    {/* Plan-mode complete — offer one-click handoff to autopilot */}
                    {isTerminal && !planChatBusy && resolveLoadedTaskMode(task) === 'plan' && effectivePlanPath && (
                        <ImplementPlanCard
                            planFilePath={effectivePlanPath}
                            workspaceId={workspaceId}
                            workingDirectory={workingDirectory}
                            existingRuns={resolvedRuns}
                            sourceProcessId={processId ?? undefined}
                            sourceMetadata={task?.metadata}
                            onViewRun={(runProcessId) => {
                                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: runProcessId, repoId: workspaceId });
                            }}
                            onRecordPersisted={(record) => {
                                setTask((prev: any) => {
                                    if (!prev) return prev;
                                    const prevImpls = Array.isArray(prev.metadata?.implementations)
                                        ? prev.metadata.implementations
                                        : [];
                                    return {
                                        ...prev,
                                        metadata: {
                                            ...prev.metadata,
                                            implementations: [...prevImpls, record],
                                        },
                                    };
                                });
                            }}
                            onImplemented={(newProcessId) => {
                                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newProcessId, repoId: workspaceId });
                            }}
                        />
                    )}
                    {isVerticalScratchpad && !isPending && noSessionForFollowUp && !readOnly && (
                        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                            <div className="text-[#848484] text-sm text-center">
                                Follow-up chat is not available for this process type.
                            </div>
                        </div>
                    )}
                    {isVerticalScratchpad && !isPending && !noSessionForFollowUp && !readOnly && (
                        <FollowUpInputArea
                            richTextRef={richTextRef}
                            inputDisabled={inputDisabled}
                            sending={sending}
                            isActiveGeneration={isActiveGeneration}
                            isCancelling={isCancelling}
                            error={error}
                            resumeFeedback={resumeFeedback}
                            suggestions={suggestions}
                            followUpInput={followUpInput}
                            setFollowUpInput={setFollowUpInput}
                            selectedMode={selectedMode}
                            setSelectedMode={setSelectedMode}
                            onSend={sendFollowUpWithPrefix}
                            onRetry={retryLastMessage}
                            onStop={handleStop}
                            skills={skills}
                            attachments={attachments}
                            onAttachmentPaste={addFromPaste}
                            onAttachmentRemove={removeAttachment}
                            onAttachmentFiles={addFromFileInput}
                            attachmentError={attachmentError}
                            pastePreview={{
                                charCount: textPaste.charCount,
                                previewLines: textPaste.previewLines,
                                onTextPaste: textPaste.addFromPaste,
                                clearPaste: textPaste.clearPaste,
                            }}
                            attachedContext={attachedContext.items}
                            onRemoveAttachedContext={attachedContext.remove}
                            task={task}
                            slashCommands={slashCommands}
                            modelCommand={modelCommand}
                            sessionModel={sessionModel}
                            hideModeSelector={hideModeSelector}
                            allowedModes={effectiveAllowedModes}
                            compactModeSelector={compactModeSelector}
                            workingDirectory={workingDirectory}
                            sessionTokenLimit={sessionTokenLimit}
                            sessionCurrentTokens={sessionCurrentTokens}
                        />
                    )}
                </div>
                {scratchpadEnabled && scratchpad.isOpen && (
                    <>
                        {/* Desktop only: resize divider / header bar */}
                        {!isMobileScratchpad && (
                        <ScratchpadDivider
                            linkedNotePath={scratchpad.linkedNotePath}
                            expandMode={scratchpad.expandMode}
                            isDragging={scratchpad.isDragging}
                            onMouseDown={scratchpad.handleDividerMouseDown}
                            onOpenFilePicker={() => { /* no-op: files are discovered from conversation */ }}
                            onExpandTop={() => scratchpad.setExpandMode('top')}
                            onExpandBottom={() => scratchpad.setExpandMode('bottom')}
                            onSplitReset={() => scratchpad.setExpandMode('split')}
                            onClose={scratchpad.close}
                            files={scratchpad.knownFiles}
                            onSelectFile={scratchpad.setLinkedNotePath}
                            workspaceRootPath={workspaceRootPath}
                            layout={scratchpadLayout}
                            renderMode={isVerticalScratchpad ? 'drag-handle' : 'header-bar'}
                        />
                        )}
                        <div className={isMobileScratchpad && scratchpad.activeMobileTab !== 'scratchpad' ? 'hidden' : 'contents'}>
                        <ScratchpadPanel
                            notePath={scratchpad.linkedNotePath}
                            workspaceId={workspaceId ?? ''}
                            onClose={scratchpad.close}
                            onNotFound={handleScratchpadNotFound}
                            height="auto"
                            parentProcessId={processId ?? undefined}
                            selectedMode={selectedMode}
                            headerBar={isVerticalScratchpad ? {
                                expandMode: scratchpad.expandMode,
                                isDragging: scratchpad.isDragging,
                                onExpandTop: () => scratchpad.setExpandMode('top'),
                                onExpandBottom: () => scratchpad.setExpandMode('bottom'),
                                onSplitReset: () => scratchpad.setExpandMode('split'),
                                files: scratchpad.knownFiles,
                                onSelectFile: scratchpad.setLinkedNotePath,
                                workspaceRootPath,
                            } : isMobileScratchpad ? {
                                expandMode: scratchpad.expandMode,
                                isDragging: scratchpad.isDragging,
                                onExpandTop: () => scratchpad.setExpandMode('top'),
                                onExpandBottom: () => scratchpad.setExpandMode('bottom'),
                                onSplitReset: () => scratchpad.setExpandMode('split'),
                                files: scratchpad.knownFiles,
                                onSelectFile: scratchpad.setLinkedNotePath,
                                workspaceRootPath,
                                hideModeControls: true,
                            } : undefined}
                        />
                        </div>
                    </>
                )}
            </div>
            {/* Mobile tab bar — shown when isMobileScratchpad, positioned below follow-up input */}
            {!isVerticalScratchpad && !isPending && noSessionForFollowUp && !readOnly && (!isMobileScratchpad || scratchpad.activeMobileTab === 'chat') && (
                <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
                    <div className="text-[#848484] text-sm text-center">
                        Follow-up chat is not available for this process type.
                    </div>
                </div>
            )}
            {!isVerticalScratchpad && !isPending && !noSessionForFollowUp && !readOnly && (!isMobileScratchpad || scratchpad.activeMobileTab === 'chat') && (
                <FollowUpInputArea
                    richTextRef={richTextRef}
                    inputDisabled={inputDisabled}
                    sending={sending}
                    isActiveGeneration={isActiveGeneration}
                    isCancelling={isCancelling}
                    error={error}
                    resumeFeedback={resumeFeedback}
                    suggestions={suggestions}
                    followUpInput={followUpInput}
                    setFollowUpInput={setFollowUpInput}
                    selectedMode={selectedMode}
                    setSelectedMode={setSelectedMode}
                    onSend={sendFollowUpWithPrefix}
                    onRetry={retryLastMessage}
                    onStop={handleStop}
                    skills={skills}
                    attachments={attachments}
                    onAttachmentPaste={addFromPaste}
                    onAttachmentRemove={removeAttachment}
                    onAttachmentFiles={addFromFileInput}
                    attachmentError={attachmentError}
                    pastePreview={{
                        charCount: textPaste.charCount,
                        previewLines: textPaste.previewLines,
                        onTextPaste: textPaste.addFromPaste,
                        clearPaste: textPaste.clearPaste,
                    }}
                    attachedContext={attachedContext.items}
                    onRemoveAttachedContext={attachedContext.remove}
                    task={task}
                    slashCommands={slashCommands}
                    modelCommand={modelCommand}
                    sessionModel={sessionModel}
                    hideModeSelector={hideModeSelector}
                    allowedModes={effectiveAllowedModes}
                    compactModeSelector={compactModeSelector}
                    workingDirectory={workingDirectory}
                    sessionTokenLimit={sessionTokenLimit}
                    sessionCurrentTokens={sessionCurrentTokens}
                />
            )}
            {isMobileScratchpad && (
                <MobileScratchpadTabBar
                    activeTab={scratchpad.activeMobileTab}
                    onTabChange={scratchpad.setActiveMobileTab}
                    onClose={scratchpad.close}
                />
            )}
        </div>
    );
}
