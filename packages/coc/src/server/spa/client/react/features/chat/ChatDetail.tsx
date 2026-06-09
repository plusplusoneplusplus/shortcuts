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
import { useModelCommand, selectPickableModels } from './hooks/useModelCommand';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { getMetaSkillItems, mergeSkillsWithMeta, type SkillItem } from './SlashCommandMenu';
import { scanTurnsForCreatedFiles } from '../../utils/conversationScan';
import { toQueueProcessId, isQueueProcessId, toTaskId } from '../../utils/queue-process-id';
import type { ClientConversationTurn } from '../../types/dashboard';
import { getDraft, setDraft, pruneExpired } from './hooks/useDraftStore';
import { clearAskUserDraftsForProcess } from './hooks/useAskUserDraftStore';
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
import { buildEffortOptionsForModel } from './EffortPillSelector';
import type { EffortLevel } from './EffortPillSelector';
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
import { resolveLoadedTaskMode } from './chatMode';
import { normalizeChatMode } from '../../repos/modeConfig';
import { isRalphEnabled, isLoopsEnabled, getDefaultProvider, isEffortLevelsEnabled, isSessionContextAttachmentsEnabled } from '../../utils/config';
import type { ChatMode } from '../../repos/modeConfig';
import { useProviderReasoningEfforts } from '../../hooks/useProviderReasoningEfforts';
import { useProviderEffortTiers } from '../../hooks/useProviderEffortTiers';
import type { EffortTierKey } from '../../hooks/useProviderEffortTiers';
import { resolveEffortTier, resolveEffectiveTier } from '../../utils/resolveEffortTier';
import { deriveEffort } from '../../utils/effortUtils';
import { RalphStartPanel } from './RalphStartPanel';
import { ImplementPlanCard } from './ImplementPlanCard';
import type { ImplementationRecord, ExistingRun, RunLiveStatus } from './ImplementPlanCard';
import { ForEachPlanReviewCard, type ForEachGenerationMetadata } from './ForEachPlanReviewCard';
import { MapReducePlanReviewCard, type MapReduceGenerationMetadata } from './MapReducePlanReviewCard';
import { getRalphContext } from '../../../../../tasks/task-types';
import { useLoops } from './hooks/useLoops';
import { LoopManagementPanel } from './LoopManagementPanel';
import { RenameDialog } from '../../ui/RenameDialog';
import { useConversationRetrievalCapability } from './sessionContextDrop';

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
    /** Hide the ask/autopilot mode selector */
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
    /** Opens the reviewed For Each parent-run pane after approval. */
    onOpenForEachRun?: (runId: string) => void;
    /** Opens the reviewed Map Reduce parent-run pane after approval. */
    onOpenMapReduceRun?: (runId: string) => void;
}

export function ChatDetail({ taskId, onBack, workspaceId, isPopOut = false, variant = 'inline', standalone = false, title, hideModeSelector = false, allowedModes, compactModeSelector = false, readOnly = false, disableScratchpad = false, pendingPrefix, onClearPendingPrefix, onOpenForEachRun, onOpenMapReduceRun }: ChatDetailProps) {
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
    const [retryingTask, setRetryingTask] = useState(false);
    const [resumeFeedback, setResumeFeedback] = useState<{ type: 'success' | 'error'; message: string; command?: string } | null>(null);
    const [processDetails, setProcessDetails] = useState<any>(null);
    const [copied, setCopied] = useState(false);
    const [selectedMode, setSelectedMode] = useState<ChatMode>('ask');
    const [effortOverride, setEffortOverride] = useState<EffortLevel | null>(null);
    const [selectedFollowUpEffortTier, setSelectedFollowUpEffortTier] = useState<EffortTierKey>('medium');
    const [skills, setSkills] = useState<SkillItem[]>([]);
    const [sessionTokenLimit, setSessionTokenLimit] = useState<number | undefined>(undefined);
    const [sessionCurrentTokens, setSessionCurrentTokens] = useState<number | undefined>(undefined);
    const [sessionSystemTokens, setSessionSystemTokens] = useState<number | undefined>(undefined);
    const [sessionToolTokens, setSessionToolTokens] = useState<number | undefined>(undefined);
    const [sessionConversationTokens, setSessionConversationTokens] = useState<number | undefined>(undefined);
    const [pendingQueue, setPendingQueue] = useState<QueuedMessage[]>([]);
    const [invalidScratchpadPaths, setInvalidScratchpadPaths] = useState<Set<string>>(() => new Set());
    const [backgroundTasks, setBackgroundTasks] = useState<import('./hooks/useChatSSE').BackgroundTasksState | null>(null);
    const [pendingAskUserBatch, setPendingAskUserBatch] = useState<import('./hooks/useChatSSE').AskUserBatch | null>(null);
    const [mcpOAuthPrompts, setMcpOAuthPrompts] = useState<import('./hooks/useChatSSE').McpOAuthPromptData[]>([]);
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
    /** Set to true the first time we initialise effortOverride from processDetails.config.
     *  Reset to false on taskId change so every new conversation gets a fresh init. */
    const effortInitializedRef = useRef(false);
    /** Tracks first mount of the model-override effect so we don't re-derive on initial render. */
    const modelOverrideMountedRef = useRef(false);
    const previousSessionProviderRef = useRef<string | null>(null);

    const { attachments, images, addFromPaste, addFromFileInput, removeAttachment, clearAttachments, error: attachmentError, toPayload } = useFileAttachments();
    const textPaste = useTextPaste();
    const attachedContext = useAttachedContext();
    const { isMobile } = useBreakpoint();
    const selection = useConversationSelection();
    const { state: queueState, dispatch: queueDispatch } = useQueue();
    // Init from current refreshVersion so a fresh mount treats it as "already seen"
    const lastRefreshVersionRef = useRef(queueState.refreshVersion);
    const { state: appState, dispatch: appDispatch } = useApp();

    // Loop management
    const processId = task?.processId ?? (taskId
        ? (isQueueProcessId(taskId) ? taskId : toQueueProcessId(taskId))
        : null);
    const metadataProcess = useMemo(() => buildMetadataProcess(task, processDetails, processId), [task, processId, processDetails]);
    const forEachGeneration = metadataProcess?.metadata?.forEach?.kind === 'generation'
        ? metadataProcess.metadata.forEach as ForEachGenerationMetadata
        : null;
    const mapReduceGeneration = metadataProcess?.metadata?.mapReduce?.kind === 'generation'
        ? metadataProcess.metadata.mapReduce as MapReduceGenerationMetadata
        : null;
    const sessionModel = metadataProcess?.metadata?.model as string | undefined;
    const rawReasoningEffort = metadataProcess?.metadata?.reasoningEffort;
    const sessionReasoningEffort = rawReasoningEffort === 'low'
        || rawReasoningEffort === 'medium'
        || rawReasoningEffort === 'high'
        || rawReasoningEffort === 'xhigh'
        ? rawReasoningEffort
        : undefined;
    const workingDirectory: string | undefined = metadataProcess?.workingDirectory
        || metadataProcess?.payload?.workingDirectory
        || metadataProcess?.metadata?.workingDirectory
        || undefined;
    const rawSessionProvider = metadataProcess?.metadata?.provider;
    const sessionProvider = rawSessionProvider === 'codex' || rawSessionProvider === 'claude' || rawSessionProvider === 'copilot'
        ? rawSessionProvider
        : getDefaultProvider();
    const { models: availableModels } = useModels(sessionProvider);
    // Per-provider, per-model reasoning-effort preferences for mid-conversation model-swap re-derive.
    const reasoningEfforts = useProviderReasoningEfforts(sessionProvider);
    const { tiers: followUpEffortTierMap, loading: followUpEffortTiersLoading } = useProviderEffortTiers(sessionProvider);
    const followUpHasTiers = !followUpEffortTiersLoading && (['low', 'medium', 'high'] as EffortTierKey[]).some(k => !!followUpEffortTierMap[k]?.model);
    const useFollowUpEffortTierMode = isEffortLevelsEnabled() && followUpHasTiers;
    const pickableModels = selectPickableModels(availableModels);
    const modelCommand = useModelCommand(pickableModels);
    const augmentedSkills = useMemo(() => mergeSkillsWithMeta(skills, getMetaSkillItems(isLoopsEnabled())), [skills]);
    const slashCommands = useSlashCommands(augmentedSkills);

    useEffect(() => {
        if (previousSessionProviderRef.current === null) {
            previousSessionProviderRef.current = sessionProvider;
            return;
        }
        if (previousSessionProviderRef.current !== sessionProvider) {
            previousSessionProviderRef.current = sessionProvider;
            modelCommand.setModelOverride(null);
        }
    }, [sessionProvider, modelCommand.setModelOverride]);

    const loopsHook = useLoops(workspaceId, processId);
    const [loopPanelOpen, setLoopPanelOpen] = useState(false);
    const [renameOpen, setRenameOpen] = useState(false);

    const scratchpadEnabled = useScratchpadEnabled() && !disableScratchpad;
    const { scratchpadLayout } = useDisplaySettings();
    const bareTaskId = isQueueProcessId(taskId) ? toTaskId(taskId) : taskId;
    const scratchpad = useScratchpadState(scratchpadContainerRef, scratchpadLayout, bareTaskId);
    const workspaceRootPath = useMemo(() => {
        const workspace = appState.workspaces.find((ws: any) => ws.id === workspaceId);
        return typeof workspace?.rootPath === 'string' ? workspace.rootPath : '';
    }, [appState.workspaces, workspaceId]);
    const sessionContextAttachmentsEnabled = isSessionContextAttachmentsEnabled();
    const canRetrieveConversations = useConversationRetrievalCapability(workspaceId, sessionContextAttachmentsEnabled);

    // Keep refs in sync with state for stale-closure-safe draft saves
    followUpInputRef.current = followUpInput;
    selectedModeRef.current = selectedMode;

    // `processDetails` is typically authoritative because it can flip to
    // terminal slightly ahead of `task` during SSE teardown. However, when a
    // task transitions out of `queued` (running/completed/failed/cancelled),
    // `processDetails` may still hold the initial synthesised `queued` snapshot
    // from the queue route fallback if a refresh hasn't completed yet — in
    // that window we prefer `task.status` so the pending panel can hide.
    const TASK_PRIORITY_STATUSES = new Set(['running', 'cancelling', 'completed', 'failed', 'cancelled']);
    const effectiveStatus = (() => {
        const ps = processDetails?.status;
        const ts = task?.status;
        if (ps === 'queued' && ts && TASK_PRIORITY_STATUSES.has(ts)) return ts;
        return ps ?? ts;
    })();
    const isActiveGeneration = effectiveStatus === 'running' || effectiveStatus === 'cancelling' || isStreaming;
    const isCancelling = effectiveStatus === 'cancelling';
    const isPending = effectiveStatus === 'queued';
    const isTerminal = effectiveStatus === 'completed' || effectiveStatus === 'failed' || effectiveStatus === 'cancelled';
    const planChatBusy = sending || isActiveGeneration || (pendingQueue?.length ?? 0) > 0;
    const inputDisabled = loading || isPending || effectiveStatus === 'cancelled' || isCancelling || sessionExpired;
    const resumeSessionId = getSessionIdFromProcess(processDetails || task);
    const noSessionForFollowUp = isTerminal && processDetails !== null && !resumeSessionId;

    const createdFiles = useMemo(() => scanTurnsForCreatedFiles(turns), [turns]);

    // Compute the follow-up mode pill set, optionally appending Ralph when
    // the chat is eligible for in-place promotion. Eligibility:
    //   - completed (no in-flight turn or queued follow-ups)
    //   - payload mode === 'ask' (autopilot/ralph already-Ralph excluded)
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
        return ['ask', 'autopilot', 'ralph'];
    }, [allowedModes, task, effectiveStatus, readOnly, pendingQueue]);

    // Coerce stored modes back to an option that is currently rendered.
    useEffect(() => {
        const allowed = effectiveAllowedModes ?? ['ask', 'autopilot'];
        if (!allowed.includes(selectedMode)) {
            setSelectedMode('ask');
        }
    }, [selectedMode, effectiveAllowedModes]);

    // Detect .plan.md created mid-conversation and elevate to planPath slot
    const detectedPlanFile = useMemo(
        () => createdFiles.find(f => f.filePath.endsWith('.plan.md'))?.filePath ?? '',
        [createdFiles],
    );
    const effectivePlanPath = planPath || detectedPlanFile;

    // Detect goal.md or *.goal.md created mid-conversation for direct Ralph launch
    const detectedGoalFile = useMemo(
        () => createdFiles.find(f => {
            const lower = f.filePath.toLowerCase();
            if (lower.endsWith('.goal.md')) return true;
            const sep = lower.lastIndexOf('/') >= 0 ? '/' : '\\';
            const base = lower.slice(lower.lastIndexOf(sep) + 1);
            return base === 'goal.md';
        })?.filePath ?? '',
        [createdFiles],
    );

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

    // Persist detected goal file path to process metadata (fire at most once per load)
    const goalPatchedRef = useRef(false);
    useEffect(() => {
        if (goalPatchedRef.current) return;
        if (!detectedGoalFile || task?.metadata?.goalFilePath || !processId) return;
        goalPatchedRef.current = true;
        const merged = { ...(task?.metadata ?? {}), goalFilePath: detectedGoalFile };
        getSpaCocClient().processes.update(processId, { metadata: merged })
            .then((data: any) => {
                if (data?.process) setTask((prev: any) => prev ? { ...prev, metadata: data.process.metadata } : prev);
            })
            .catch(() => { /* best-effort persist */ });
    }, [detectedGoalFile, task?.metadata?.goalFilePath, processId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        goalPatchedRef.current = false;
        effortInitializedRef.current = false;
        modelOverrideMountedRef.current = false;
        setEffortOverride(null);
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

    // Reactively sync title, customTitle, lastMessagePreview, and status from
    // process-updated WS events (via AppContext).
    useEffect(() => {
        if (!processId) return;
        const proc = appState.processes.find((p: any) => p.id === processId);
        if (!proc) return;
        setTask((prev: any) => {
            if (!prev) return prev;
            const titleChanged = proc.title !== undefined && prev.title !== proc.title;
            const customTitleChanged = proc.customTitle !== undefined && prev.customTitle !== proc.customTitle;
            const previewChanged = proc.lastMessagePreview !== undefined && prev.lastMessagePreview !== proc.lastMessagePreview;
            const statusChanged = proc.status && prev.status !== proc.status;
            if (!titleChanged && !customTitleChanged && !previewChanged && !statusChanged) return prev;
            const next: any = { ...prev };
            if (titleChanged) { next.title = proc.title; next.displayName = proc.customTitle || proc.title; }
            if (customTitleChanged) { next.customTitle = proc.customTitle; next.displayName = proc.customTitle || prev.title || prev.displayName; }
            if (previewChanged) next.lastMessagePreview = proc.lastMessagePreview;
            if (statusChanged) next.status = proc.status;
            return next;
        });
    }, [processId, appState.processes]);

    // Tracks the previous `task.status` so a one-shot conversation refresh
    // can fire when the task transitions out of `queued`. Declared here; the
    // effect that uses it is defined below `refreshConversation`.
    const prevStatusRef = useRef<string | undefined>(undefined);

    // Seed tokenLimit from the session provider's model catalog as soon as
    // sessionModel is known.
    // Only runs when sessionTokenLimit is still undefined to avoid clobbering
    // a value already received via SSE (conversation-snapshot / token-usage).
    useEffect(() => {
        if (!sessionModel || sessionTokenLimit !== undefined) return;
        const info = availableModels.find((m: ModelInfo) => m.id === sessionModel);
        if (info?.tokenLimit && info.tokenLimit > 0) {
            setSessionTokenLimit(info.tokenLimit);
        }
    }, [availableModels, sessionModel, sessionTokenLimit]);

    // Seed session token state from a freshly-fetched process record so the
    // ContextWindowIndicator shows real usage immediately on cold load —
    // including completed / non-running chats that never open the SSE stream
    // (the only other source of this data; `useChatSSE` gates on
    // `task.status === 'running'`). Each setter is guarded by a numeric type
    // check, mirroring the `conversation-snapshot` SSE handler, so absent
    // fields never clobber existing/SSE values with `undefined`. The persisted
    // AIProcess fields map to the `session*` aliases the indicator consumes.
    const seedSessionTokensFromProcess = useCallback((loadedProcess: any) => {
        if (!loadedProcess) return;
        if (typeof loadedProcess.tokenLimit === 'number') setSessionTokenLimit(loadedProcess.tokenLimit);
        if (typeof loadedProcess.currentTokens === 'number') setSessionCurrentTokens(loadedProcess.currentTokens);
        if (typeof loadedProcess.systemTokens === 'number') setSessionSystemTokens(loadedProcess.systemTokens);
        if (typeof loadedProcess.toolDefinitionsTokens === 'number') setSessionToolTokens(loadedProcess.toolDefinitionsTokens);
        if (typeof loadedProcess.conversationTokens === 'number') setSessionConversationTokens(loadedProcess.conversationTokens);
    }, []);

    // Derive effort picker options from the effective model (override or session model).
    // `chatEffectiveModelInfo` drives both option-set and disabled state so that
    // switching model mid-conversation updates the pill immediately.
    const chatEffectiveModelId = modelCommand.modelOverride ?? sessionModel;
    const chatEffectiveModelInfo = availableModels.find((m: ModelInfo) => m.id === chatEffectiveModelId);
    const sessionModelInfo = availableModels.find((m: ModelInfo) => m.id === sessionModel);
    const effortOptions = buildEffortOptionsForModel(chatEffectiveModelInfo?.supportedReasoningEfforts);
    // Disable the effort picker when the model's capabilities explicitly report no reasoning support.
    const effortPickerDisabled = Boolean(chatEffectiveModelInfo && chatEffectiveModelInfo.capabilities?.supports.reasoningEffort === false);

    // ── Effort initialisation from processDetails.config.reasoningEffort (§5.1) ──
    // Fires once per task load when processDetails becomes available.
    // `sessionModelInfo` is included so that if models load after processDetails,
    // the validation against supportedReasoningEfforts still runs.
    useEffect(() => {
        if (!processDetails || effortInitializedRef.current) return;
        effortInitializedRef.current = true;
        const configEffort = (processDetails as any)?.config?.reasoningEffort as string | undefined;
        const supported = sessionModelInfo?.supportedReasoningEfforts;
        const capSupports = !sessionModelInfo || sessionModelInfo.capabilities?.supports.reasoningEffort !== false;
        const derived = deriveEffort(configEffort, supported, capSupports);
        setEffortOverride(derived);
        if (derived !== null) {
            console.debug('[coc-effort-auto-derive]', {
                trigger: 'existing-chat-init',
                modelId: sessionModel,
                derivedEffort: derived,
            });
        }
    }, [processDetails, sessionModelInfo]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Mid-conversation model-override swap re-derive (§5.4) ──
    // Fires when the user picks a different model override.
    // Skipped on initial mount so it doesn't clobber the init effect above.
    useEffect(() => {
        if (!modelOverrideMountedRef.current) {
            modelOverrideMountedRef.current = true;
            return;
        }
        const preferred = reasoningEfforts[chatEffectiveModelId ?? ''];
        const supported = chatEffectiveModelInfo?.supportedReasoningEfforts;
        const capSupports = !chatEffectiveModelInfo || chatEffectiveModelInfo.capabilities?.supports.reasoningEffort !== false;
        const derived = deriveEffort(preferred, supported, capSupports);
        setEffortOverride(derived);
        if (derived !== null) {
            console.debug('[coc-effort-auto-derive]', {
                trigger: 'model-swap',
                modelId: chatEffectiveModelId,
                derivedEffort: derived,
            });
        }
    }, [modelCommand.modelOverride]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Validation guard: clear effort when model loads and stored effort is unsupported (§5.1 edge) ──
    // Handles the case where processDetails loaded before models, so the init ran
    // with an unknown model. Once models load, re-validate.
    useEffect(() => {
        if (!effortOverride || !chatEffectiveModelInfo) return;
        const supported = chatEffectiveModelInfo.supportedReasoningEfforts;
        if (supported && supported.length > 0 && !supported.includes(effortOverride)) {
            setEffortOverride(null);
        }
    }, [chatEffectiveModelInfo, effortOverride]);

    /** Records that the user has explicitly picked — prevents mid-conversation
     *  re-derives from accidentally overwriting an in-flight pick. */
    const handleEffortChange = useCallback((effort: EffortLevel | null) => {
        setEffortOverride(effort);
    }, []);

    // Restore last-picked effort tier from localStorage on workspace switch.
    useEffect(() => {
        const key = `coc:effort-tier:${workspaceId ?? 'default'}`;
        const stored = localStorage.getItem(key);
        if (stored === 'low' || stored === 'medium' || stored === 'high') {
            setSelectedFollowUpEffortTier(stored);
        } else {
            setSelectedFollowUpEffortTier('medium');
        }
    }, [workspaceId]);

    // When the selected tier becomes unconfigured, fall back to the first configured tier.
    useEffect(() => {
        if (!useFollowUpEffortTierMode) return;
        const effective = resolveEffectiveTier(selectedFollowUpEffortTier, followUpEffortTierMap);
        if (effective !== selectedFollowUpEffortTier) {
            setSelectedFollowUpEffortTier(effective);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [useFollowUpEffortTierMode, followUpEffortTierMap]);

    function handleFollowUpEffortTierChange(tier: EffortTierKey) {
        setSelectedFollowUpEffortTier(tier);
        localStorage.setItem(`coc:effort-tier:${workspaceId ?? 'default'}`, tier);
    }

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

    // When a task transitions out of `queued` (via WebSocket or polling), force
    // a one-shot conversation refresh. Without this hook, a fast `queued →
    // completed` (or `queued → running → completed`) jump can leave the UI
    // stuck on the synthesised queued snapshot — SSE only opens while
    // `task.status === 'running'` and `useQueuedTaskPoll`'s 2 s interval may
    // not fire before the status flips, so neither the SSE finish() path nor
    // the polling refresh ever runs. Refreshing here closes the gap.
    useEffect(() => {
        const prev = prevStatusRef.current;
        const curr = task?.status as string | undefined;
        prevStatusRef.current = curr;
        if (!processId || !curr || curr === 'queued') return;
        if (prev === curr || prev === undefined) return;
        // Refresh on any out-of-queued transition. Running → terminal is also
        // covered (in case SSE never opened or was torn down before the
        // conversation snapshot arrived). refreshConversation is idempotent,
        // so an extra call alongside SSE finish() is harmless.
        void refreshConversation(processId);
    }, [task?.status, processId, refreshConversation]);

    // Resolve effective model + effort for follow-up sends: tier mode takes priority over legacy controls.
    const followUpTierPayload = useFollowUpEffortTierMode
        ? resolveEffortTier(selectedFollowUpEffortTier, followUpEffortTierMap)
        : null;
    const effectiveFollowUpModelOverride = followUpTierPayload?.model ?? modelCommand.modelOverride ?? null;
    const effectiveFollowUpEffort = (followUpTierPayload !== null
        ? followUpTierPayload.reasoningEffort as EffortLevel | null
        : effortOverride);

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
        modelOverride: effectiveFollowUpModelOverride,
        effortOverride: effectiveFollowUpEffort,
        workspaceId,
        sessionContextAttachmentsEnabled,
        conversationRetrievalAvailable: canRetrieveConversations,
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
        setSessionSystemTokens,
        setSessionToolTokens,
        setSessionConversationTokens,
        setBackgroundTasks,
        setTurnsAndRef,
        refreshConversation,
        onSendComplete,
        onAskUserBatch: setPendingAskUserBatch,
        onMcpOAuthRequired: (data) => {
            setMcpOAuthPrompts(prev => {
                if (prev.some(p => p.requestId === data.requestId)) return prev;
                return [...prev, data];
            });
        },
        onMcpOAuthCompleted: (data) => {
            setMcpOAuthPrompts(prev => prev.filter(p => p.requestId !== data.requestId));
        },
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

    useEffect(() => {
        if (processId && effectiveStatus === 'cancelled') {
            clearAskUserDraftsForProcess(processId);
        }
    }, [effectiveStatus, processId]);

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
        setSessionSystemTokens(undefined);
        setSessionToolTokens(undefined);
        setSessionConversationTokens(undefined);
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
            const draftMode = normalizeChatMode(draft.mode);
            if (draftMode) {
                setSelectedMode(draftMode);
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

                    // Cache check: if we have a recent snapshot for this session,
                    // paint immediately from the cache and revalidate in the
                    // background so re-visits feel instant. Most clicks land on
                    // a session the user has already viewed in this tab.
                    const cached = appState.conversationCache[taskId];
                    const cacheHit = cached && (Date.now() - cached.cachedAt < CACHE_TTL_MS);
                    if (cacheHit) {
                        setTurnsAndRef(cached.turns);
                        setLoading(false);
                        // Fire-and-forget background revalidation. Bail out if
                        // the user has navigated away or to another session.
                        getSpaCocClient().processes.get(pid).then((processData: any) => {
                            if (loadCounterRef.current !== loadId) return;
                            const loadedProcess = processData?.process ?? null;
                            if (!loadedProcess) return;
                            setTask({
                                id: taskId,
                                processId: pid,
                                status: loadedProcess.status,
                                type: loadedProcess.type ?? 'chat',
                                payload: loadedProcess.payload ?? {},
                                metadata: loadedProcess.metadata ?? {},
                                title: loadedProcess.title,
                                customTitle: loadedProcess.customTitle,
                                lastMessagePreview: loadedProcess.lastMessagePreview,
                                displayName: loadedProcess.customTitle || loadedProcess.title,
                            });
                            const turns = getConversationTurns(processData);
                            setTurnsAndRef(turns);
                            setProcessDetails(loadedProcess);
                            seedSessionTokensFromProcess(loadedProcess);
                        }).catch(() => { /* best-effort revalidation */ });
                        return;
                    }

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
                            title: loadedProcess.title,
                            customTitle: loadedProcess.customTitle,
                            lastMessagePreview: loadedProcess.lastMessagePreview,
                            displayName: loadedProcess.customTitle || loadedProcess.title,
                        });
                        const turns = getConversationTurns(processData);
                        setTurnsAndRef(turns);
                        setProcessDetails(loadedProcess);
                        seedSessionTokensFromProcess(loadedProcess);
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
                            seedSessionTokensFromProcess(data?.process);
                            // Merge customTitle/title/lastMessagePreview into task so
                            // the chat header reflects the persisted custom name even
                            // on cached loads where loadedTask lacked these fields.
                            const proc = data?.process;
                            if (proc) {
                                setTask((prev: any) => prev ? {
                                    ...prev,
                                    title: proc.title ?? prev.title,
                                    customTitle: proc.customTitle ?? prev.customTitle,
                                    lastMessagePreview: proc.lastMessagePreview ?? prev.lastMessagePreview,
                                } : prev);
                            }
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

                    // Reconcile: process status is authoritative over queue status.
                    // Also propagate customTitle/lastMessagePreview/title from the
                    // process row — queue.getTask does not include them.
                    const proc = procData?.process;
                    const procStatus = proc?.status;
                    const effectiveTask = (procStatus && procStatus !== loadedTask?.status) || proc
                        ? {
                            ...loadedTask,
                            ...(procStatus ? { status: procStatus } : {}),
                            ...(proc ? {
                                title: proc.title ?? loadedTask?.title,
                                customTitle: proc.customTitle ?? loadedTask?.customTitle,
                                lastMessagePreview: proc.lastMessagePreview ?? loadedTask?.lastMessagePreview,
                            } : {}),
                        }
                        : loadedTask;

                    setTask(effectiveTask);
                    setProcessDetails(procData?.process || null);
                    seedSessionTokensFromProcess(procData?.process);
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
        if (normalizeChatMode(draft?.mode)) {
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
                            title: procData.process.title,
                            customTitle: procData.process.customTitle,
                            lastMessagePreview: procData.process.lastMessagePreview,
                            displayName: procData.process.customTitle || procData.process.title,
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

                // Reconcile: process status is authoritative over queue status.
                // Also propagate customTitle/lastMessagePreview/title from the
                // process row — queue.getTask does not include them.
                const proc = procData?.process;
                const procStatus = proc?.status;
                const effectiveTask = (procStatus && procStatus !== refreshedTask?.status) || proc
                    ? {
                        ...refreshedTask,
                        ...(procStatus ? { status: procStatus } : {}),
                        ...(proc ? {
                            title: proc.title ?? refreshedTask?.title,
                            customTitle: proc.customTitle ?? refreshedTask?.customTitle,
                            lastMessagePreview: proc.lastMessagePreview ?? refreshedTask?.lastMessagePreview,
                        } : {}),
                    }
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
                if (!isScrolledUp || dist < 100) el.scrollTop = el.scrollHeight;
            }
        }
    }, [turns, loading, isScrolledUp]);

    // Register all .md files from created files into the scratchpad tab list,
    // including the plan file so it appears as a scratchpad tab (AC-01, AC-03).
    useEffect(() => {
        if (!scratchpadEnabled) return;
        const mdPaths = createdFiles
            .map(f => f.filePath)
            .filter(p => p.endsWith('.md'));
        if (mdPaths.length > 0) {
            scratchpad.registerFiles(mdPaths);
        }
    }, [createdFiles, scratchpadEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Re-run a task whose first message failed before any resumable session
    // existed. Enqueues a fresh copy server-side and navigates to it.
    const handleRetryTask = useCallback(async () => {
        if (retryingTask) return;
        setRetryingTask(true);
        try {
            const res = await getSpaCocClient().queue.retry(bareTaskId);
            const newId = res?.task?.id;
            if (newId) {
                const newProcessId = toQueueProcessId(String(newId));
                if (!standalone) {
                    queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newProcessId, repoId: workspaceId });
                }
                if (workspaceId) {
                    location.hash = '#repos/' + encodeURIComponent(workspaceId) + '/activity/' + encodeURIComponent(newProcessId);
                }
            }
        } catch (err) {
            setError(getSpaCocClientErrorMessage(err, 'Failed to retry task.'));
        } finally {
            setRetryingTask(false);
        }
    }, [retryingTask, bareTaskId, standalone, workspaceId, queueDispatch]);

    const scrollToBottom = () => {
        if (conversationContainerRef.current) {
            conversationContainerRef.current.scrollTop = conversationContainerRef.current.scrollHeight;
        }
    };

    const isVerticalScratchpad = scratchpadEnabled && scratchpad.isOpen && scratchpadLayout === 'vertical';
    /** On mobile, when the scratchpad is open, switch to full-screen tab mode. */
    const isMobileScratchpad = isMobile && scratchpadEnabled && scratchpad.isOpen;
    const scratchpadSelectedMode = selectedMode === 'autopilot' ? 'autopilot' : 'ask';
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

    // Notice shown when a terminal task has no resumable session. For *failed*
    // tasks (e.g. the first message failed before a session existed), offer a
    // one-click retry that re-runs the task from its original payload.
    const noSessionNotice = (
        <div className="border-t border-[#e0e0e0] dark:border-[#3c3c3c] p-3">
            <div className="text-[#848484] text-sm text-center">
                {effectiveStatus === 'failed'
                    ? 'This task failed before a chat session was created.'
                    : 'Follow-up chat is not available for this process type.'}
            </div>
            {effectiveStatus === 'failed' && (
                <div className="mt-2 flex justify-center">
                    <button
                        type="button"
                        data-testid="retry-task-button"
                        onClick={handleRetryTask}
                        disabled={retryingTask}
                        className="px-3 py-1.5 text-sm rounded bg-[#0e639c] hover:bg-[#1177bb] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {retryingTask ? 'Retrying…' : 'Retry task'}
                    </button>
                </div>
            )}
        </div>
    );

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
                sessionSystemTokens={sessionSystemTokens}
                sessionToolTokens={sessionToolTokens}
                sessionConversationTokens={sessionConversationTokens}
                sessionModel={sessionModel}
                copied={copied}
                setCopied={setCopied}
                taskId={taskId}
                onLaunchInteractiveResume={() => { void launchInteractiveResume(); }}
                onPopOut={handlePopOut}
                onFloat={handleFloat}
                title={(task?.customTitle as string | undefined) || title || task?.title || task?.displayName}
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
                onRenameTitle={processId ? () => setRenameOpen(true) : undefined}
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
                        mcpOAuthPrompts={mcpOAuthPrompts}
                        onMcpOAuthCompleted={(requestId) => setMcpOAuthPrompts(prev => prev.filter(p => p.requestId !== requestId))}
                        onMcpOAuthFailed={(requestId) => setMcpOAuthPrompts(prev => prev.filter(p => p.requestId !== requestId))}
                        processError={processDetails?.error ?? null}
                        provider={sessionProvider}
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
                        const goalPath = detectedGoalFile || (task?.metadata?.goalFilePath as string | undefined) || '';
                        // Path 1: traditional grilling-phase → start
                        // Prefer the goal file (authoritative spec) over
                        // extracting from the last assistant turn, which is
                        // often a short synthesis that drops detail.
                        if (ralphCtx && ralphCtx.phase === 'grilling' && task?.status === 'completed') {
                            return (
                                <RalphStartPanel
                                    processId={processId ?? taskId}
                                    workspaceId={workspaceId}
                                    turns={turns}
                                    goalFilePath={goalPath || undefined}
                                    onStarted={(newProcessId) => {
                                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newProcessId, repoId: workspaceId });
                                    }}
                                />
                            );
                        }
                        // Path 2: goal.md detected → direct launch (skip grilling)
                        if (
                            goalPath
                            && isRalphEnabled()
                            && !ralphCtx
                            && task?.status === 'completed'
                        ) {
                            return (
                                <RalphStartPanel
                                    processId={processId ?? taskId}
                                    workspaceId={workspaceId}
                                    turns={turns}
                                    goalFilePath={goalPath}
                                    useLaunchEndpoint
                                    onStarted={(newProcessId) => {
                                        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: newProcessId, repoId: workspaceId });
                                    }}
                                />
                            );
                        }
                        return null;
                    })()}
                    {forEachGeneration && (
                        <ForEachPlanReviewCard
                            workspaceId={workspaceId ?? forEachGeneration.workspaceId}
                            processId={processId}
                            metadataProcess={metadataProcess}
                            forEach={forEachGeneration}
                            turns={turns}
                            provider={sessionProvider}
                            model={sessionModel}
                            reasoningEffort={sessionReasoningEffort}
                            onApprovedRun={onOpenForEachRun}
                        />
                    )}
                    {mapReduceGeneration && (
                        <MapReducePlanReviewCard
                            workspaceId={workspaceId ?? mapReduceGeneration.workspaceId}
                            processId={processId}
                            metadataProcess={metadataProcess}
                            mapReduce={mapReduceGeneration}
                            turns={turns}
                            provider={sessionProvider}
                            model={sessionModel}
                            reasoningEffort={sessionReasoningEffort}
                            onApprovedRun={onOpenMapReduceRun}
                        />
                    )}
                    {/* Plan file complete — offer one-click handoff to autopilot */}
                    {isTerminal && !planChatBusy && resolveLoadedTaskMode(task) === 'ask' && effectivePlanPath && (
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
                        noSessionNotice
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
                            onAttachSessionContext={attachedContext.addSessionContext}
                            workspaceId={workspaceId}
                            currentProcessId={processId ?? taskId}
                            sessionContextAttachmentsEnabled={sessionContextAttachmentsEnabled}
                            canRetrieveConversations={canRetrieveConversations}
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
                            sessionSystemTokens={sessionSystemTokens}
                            sessionToolTokens={sessionToolTokens}
                            sessionConversationTokens={sessionConversationTokens}
                            activeProvider={sessionProvider}
                            effortOverride={effortOverride}
                            effortOptions={effortOptions}
                            effortDisabled={effortPickerDisabled}
                             onEffortChange={handleEffortChange}
                            useEffortTierMode={useFollowUpEffortTierMode}
                            effortTierMap={followUpEffortTierMap}
                            selectedEffortTier={selectedFollowUpEffortTier}
                            onEffortTierChange={handleFollowUpEffortTierChange}
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
                            selectedMode={scratchpadSelectedMode}
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
                noSessionNotice
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
                    onAttachSessionContext={attachedContext.addSessionContext}
                    workspaceId={workspaceId}
                    currentProcessId={processId ?? taskId}
                    sessionContextAttachmentsEnabled={sessionContextAttachmentsEnabled}
                    canRetrieveConversations={canRetrieveConversations}
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
                    sessionSystemTokens={sessionSystemTokens}
                    sessionToolTokens={sessionToolTokens}
                    sessionConversationTokens={sessionConversationTokens}
                    activeProvider={sessionProvider}
                    effortOverride={effortOverride}
                    effortOptions={effortOptions}
                    effortDisabled={effortPickerDisabled}
                    onEffortChange={handleEffortChange}
                    useEffortTierMode={useFollowUpEffortTierMode}
                    effortTierMap={followUpEffortTierMap}
                    selectedEffortTier={selectedFollowUpEffortTier}
                    onEffortTierChange={handleFollowUpEffortTierChange}
                />
            )}
            {isMobileScratchpad && (
                <MobileScratchpadTabBar
                    activeTab={scratchpad.activeMobileTab}
                    onTabChange={scratchpad.setActiveMobileTab}
                    onClose={scratchpad.close}
                />
            )}
            <RenameDialog
                open={renameOpen}
                currentTitle={(task?.customTitle as string | undefined) || ''}
                onCancel={() => setRenameOpen(false)}
                onConfirm={async (newTitle) => {
                    setRenameOpen(false);
                    if (!processId) return;
                    try {
                        await getSpaCocClient().processes.update(processId, { customTitle: newTitle });
                    } catch { /* WS will sync eventually */ }
                }}
            />
        </div>
    );
}
