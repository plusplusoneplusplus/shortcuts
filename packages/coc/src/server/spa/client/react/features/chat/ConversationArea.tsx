import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '../../ui';
import { ConversationTurnBubble } from './conversation/ConversationTurnBubble';
import { CompactionBubble } from './CompactionBubble';
import { useMessageNavigation } from './hooks/useMessageNavigation';
import { PendingTaskInfoPanel } from '../../queue/PendingTaskInfoPanel';
import { cn } from '../../ui/cn';
import { QueuedFollowUps } from './QueuedBubble';
import { BackgroundTasksIndicator } from './BackgroundTasksIndicator';
import { AskUserInline } from './AskUserInline';
import { McpOAuthPrompt } from './McpOAuthPrompt';
import type { ClientConversationTurn } from '../../types/dashboard';
import type { QueuedMessage } from '../../utils/chatUtils';
import type { BackgroundTasksState, AskUserBatch, McpOAuthPromptData, RalphGrillPlanningProgress } from './hooks/useChatSSE';
import { MODE_ICONS, MODE_TEXT_COLORS, normalizeChatMode } from '../../repos/modeConfig';
import type { ChatMode } from '../../repos/modeConfig';
import type { ChatProvider } from './ProviderBadge';

export const INTERRUPTED_TURN_CONTINUE_MESSAGE = 'Please continue from where the last response was interrupted.';
export const INTERRUPTED_TURN_RETRY_MESSAGE = 'The previous response was interrupted by a temporary authorization/session error. Please retry the prior request and continue.';

const RETRYABLE_INTERRUPTION_REASON_PATTERN = /\b(auth(?:entication|orization)?|authori[sz](?:ation|ed)?|login|session|provider|network|connection|temporar(?:y|ily)|unavailable|econnreset|econnrefused|eai_again|etimedout)\b/i;

export function buildInterruptedTurnFollowUpMessage(reason?: string | null): string {
    if (reason && RETRYABLE_INTERRUPTION_REASON_PATTERN.test(reason)) {
        return INTERRUPTED_TURN_RETRY_MESSAGE;
    }
    return INTERRUPTED_TURN_CONTINUE_MESSAGE;
}

export interface ConversationAreaProps {
    loading: boolean;
    error: string | null;
    turns: ClientConversationTurn[];
    pendingQueue: QueuedMessage[];
    backgroundTasks?: BackgroundTasksState | null;
    /** Pending ask-user question batch from the AI, if any. */
    pendingAskUserBatch?: AskUserBatch | null;
    /** Transient progress while Ralph multi-agent grill planning is running. */
    ralphGrillPlanningProgress?: RalphGrillPlanningProgress | null;
    /** Called when the user answers or skips the pending question batch. */
    onAskUserAnswered?: () => void;
    /** Owning workspace, so an ask_user reply routes to the chat's clone (AC-07). */
    workspaceId?: string;
    isScrolledUp: boolean;
    scrollRef: React.RefObject<HTMLDivElement>;
    /** Ref attached to the inner turns container (for minimap navigation) */
    turnsContainerRef?: React.RefObject<HTMLDivElement | null>;
    onScrollToBottom: () => void;
    isPending: boolean;
    task: any;
    fullTask: any;
    onCancel: () => void;
    onMoveToTop: () => void;
    variant: 'inline' | 'floating';
    taskId: string;
    wsId?: string;
    /** Whether selection mode is active. */
    isSelecting?: boolean;
    /** Set of selected turn indices (used when isSelecting is true). */
    selectedTurns?: Set<number>;
    /** Click handler for turn selection (Ctrl/Shift+Click). */
    onTurnClick?: (index: number, event: React.MouseEvent) => void;
    /** Called to copy the selected turns as HTML snapshot. */
    onCopySelected?: () => void;
    /** Called to exit selection mode. */
    onCancelSelection?: () => void;
    /** Called when user selects "Attach as context" from a bubble's context menu. */
    onAttachContext?: (turnIndex: number, role: 'user' | 'assistant', snippet: string) => void;
    /** Called when user deletes a turn via context menu. */
    onDeleteTurn?: (turnIndex: number) => void;
    /** Called when user pins/unpins a turn via context menu. */
    onPinTurn?: (turnIndex: number, pinned: boolean) => void;
    /** Called when user archives/unarchives a turn via context menu. */
    onArchiveTurn?: (turnIndex: number, archived: boolean) => void;
    /** Called when user rewinds the conversation to a user turn via context menu. */
    onRewindTurn?: (turnIndex: number) => void;
    /** Undo-delete state: turnIndex of the recently deleted turn (for undo toast). */
    undoDeleteTurnIndex?: number | null;
    /** Called when user clicks "Undo" on the delete toast. */
    onUndoDelete?: () => void;
    /** Note edit snapshots from process.metadata.noteEdits — passed to ConversationTurnBubble for NoteEditCard. */
    noteEdits?: Array<{
        editId: string;
        notePath: string;
        preEditContent: string;
        postEditContent?: string;
        timestamp: string;
        turnIndex: number;
        tooLarge?: boolean;
    }>;
    /** Process ID — needed for NoteEditCard undo API call. */
    processId?: string;
    /**
     * Process type (e.g. `'run-script'`, `'chat'`) — propagated to
     * ConversationTurnBubble so it can render script output as a styled
     * terminal block instead of plain markdown.
     */
    processType?: string;
    /** Called when the user cancels a queued/pending follow-up message. */
    onCancelPendingMessage?: (messageId: string) => void;
    /**
     * Process-level failure reason (from `processDetails.error`). When set and
     * the task status is `failed`, shown as an error banner — either replacing
     * the "No conversation data" placeholder (0 turns) or appended after the
     * last conversation turn.
     */
    processError?: string | null;
    /**
     * Optional handle to the chat follow-up input. When provided,
     * vim-style `i` re-focuses the input from nav mode.
     */
    inputRef?: React.RefObject<{ focus: () => void } | null> | null;
    /** Sends a generated raw follow-up for interrupted assistant turns. Falls back to focusing input when omitted. */
    onSendInterruptedTurnFollowUp?: (message: string) => void;
    /** Active MCP OAuth prompts awaiting user authorization. */
    mcpOAuthPrompts?: McpOAuthPromptData[];
    /** Called when an MCP OAuth flow completes. */
    onMcpOAuthCompleted?: (requestId: string) => void;
    /** Called when an MCP OAuth flow fails. */
    onMcpOAuthFailed?: (requestId: string) => void;
    /**
     * AI provider that owns this conversation. Threaded into
     * {@link ConversationTurnBubble} so each assistant avatar takes on the
     * provider's brand color (Copilot=green, Claude=orange, Codex=indigo).
     */
    provider?: ChatProvider;
    /** Additional cards that should remain reachable via the main conversation scroll area. */
    postConversationContent?: ReactNode;
    /**
     * True while a `/compact` action is running for this conversation (AC-02).
     * Renders a synthetic, user-message-style "Compacting context…" bubble near
     * the bottom and suppresses the normal empty assistant streaming placeholder
     * that a `running` status would otherwise trigger. The bubble is a pure
     * client render — never persisted as a turn, never replayed into model
     * history.
     */
    isCompacting?: boolean;
    /** Custom instructions typed after the `/compact` token, surfaced in the compacting bubble. */
    compactInstructions?: string;
}

export function ConversationArea({
    loading,
    error,
    turns,
    pendingQueue,
    backgroundTasks,
    pendingAskUserBatch,
    ralphGrillPlanningProgress,
    onAskUserAnswered,
    workspaceId,
    isScrolledUp,
    scrollRef,
    turnsContainerRef,
    onScrollToBottom,
    isPending,
    task,
    fullTask,
    onCancel,
    onMoveToTop,
    variant,
    taskId,
    wsId,
    isSelecting,
    selectedTurns,
    onTurnClick,
    onCopySelected,
    onCancelSelection,
    onAttachContext,
    onDeleteTurn,
    onPinTurn,
    onArchiveTurn,
    onRewindTurn,
    undoDeleteTurnIndex,
    onUndoDelete,
    noteEdits,
    processId,
    processType,
    onCancelPendingMessage,
    inputRef,
    onSendInterruptedTurnFollowUp,
    mcpOAuthPrompts,
    onMcpOAuthCompleted,
    onMcpOAuthFailed,
    processError,
    provider,
    postConversationContent,
    isCompacting,
    compactInstructions,
}: ConversationAreaProps) {
    const [showArchived, setShowArchived] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const { currentTurnIndex, navHintVisible } = useMessageNavigation({
        scrollRef,
        containerRef,
        inputRef,
    });
    // Escape key exits selection mode
    useEffect(() => {
        if (!isSelecting) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancelSelection?.();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [isSelecting, onCancelSelection]);

    const selectedCount = selectedTurns?.size ?? 0;
    const continueInterruptedTurn = (reason?: string) => {
        if (onSendInterruptedTurnFollowUp) {
            onSendInterruptedTurnFollowUp(buildInterruptedTurnFollowUpMessage(reason));
            return;
        }
        inputRef?.current?.focus();
    };
    const showRalphGrillPlanningProgress = !!ralphGrillPlanningProgress && !pendingAskUserBatch;

    return (
        <div
            ref={containerRef}
            className="relative flex-1 min-h-0 overflow-x-hidden min-w-0 focus:outline-none"
            tabIndex={-1}
            role="region"
            aria-label="Chat conversation"
            data-current-turn={currentTurnIndex ?? undefined}
        >
            <div
                ref={scrollRef}
                data-testid="activity-chat-conversation"
                className={cn('flex-1 min-h-0 overflow-y-auto h-full space-y-3 min-w-0', variant === 'floating' ? 'p-2' : 'p-4')}
            >
                {isPending ? (
                    <PendingTaskInfoPanel task={fullTask || task} onCancel={onCancel} onMoveToTop={onMoveToTop} />
                ) : loading ? (
                    <div className="flex items-center gap-2 text-[#848484] text-sm">
                        <Spinner size="sm" /> Loading conversation...
                    </div>
                ) : turns.length === 0 && showRalphGrillPlanningProgress ? (
                    <RalphGrillPlanningProgressCard progress={ralphGrillPlanningProgress} />
                ) : turns.length === 0 ? (
                    processError ? (
                        <div
                            className="flex items-start gap-3 p-3 rounded-lg bg-[#fdf3f3] dark:bg-[#3a1a1a] border border-[#f1707050] dark:border-[#f1707040]"
                            data-testid="process-error-banner"
                            role="alert"
                        >
                            <span className="text-[#d32f2f] dark:text-[#f48771] flex-shrink-0 text-base leading-5">⚠</span>
                            <div className="min-w-0">
                                <div className="text-sm font-semibold text-[#d32f2f] dark:text-[#f48771] mb-1">Task failed</div>
                                <pre className="text-xs text-[#1f2328] dark:text-[#cccccc] whitespace-pre-wrap break-words font-mono">{processError}</pre>
                            </div>
                        </div>
                    ) : (
                        <div className="text-[#848484] text-sm">No conversation data available.</div>
                    )
                ) : (
                    <div className="space-y-3" ref={turnsContainerRef}>
                        {/* Pinned messages section */}
                        {onPinTurn && (() => {
                            const pinnedTurns = turns.filter(t => t.pinnedAt && !t.deletedAt);
                            if (pinnedTurns.length === 0) return null;
                            return (
                                <details data-pinned-section className="border border-amber-300/30 dark:border-amber-500/20 rounded-lg p-2 mb-2">
                                    <summary className="cursor-pointer text-xs font-semibold text-[#848484] dark:text-[#999] select-none">
                                        📌 Pinned Messages ({pinnedTurns.length})
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        {pinnedTurns.sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? '')).map((turn, i) => (
                                            <ConversationTurnBubble
                                                key={`pinned-${turn.turnIndex ?? i}`}
                                                turn={turn}
                                                taskId={taskId}
                                                wsId={wsId}
                                                turnIndex={turn.turnIndex}
                                                onPinTurn={onPinTurn}
                                                onArchiveTurn={onArchiveTurn}
                                                onDeleteTurn={onDeleteTurn}
                                                onRewindTurn={onRewindTurn}
                                                onContinueInterrupted={() => continueInterruptedTurn(turn.interruptionReason)}
                                                noteEdits={noteEdits}
                                                processId={processId}
                                                processType={processType}
                                                provider={provider}
                                            />
                                        ))}
                                    </div>
                                </details>
                            );
                        })()}
                        {/* Archived toggle */}
                        {onArchiveTurn && turns.some(t => t.archived && !t.deletedAt) && (
                            <button
                                onClick={() => setShowArchived(v => !v)}
                                className="text-xs text-[#848484] hover:text-[#666] dark:hover:text-[#bbb] transition-colors"
                            >
                                {showArchived ? '🗄️ Hide archived messages' : `🗄️ Show archived messages (${turns.filter(t => t.archived && !t.deletedAt).length})`}
                            </button>
                        )}
                        {(() => {
                            const hasStreaming = turns.some(t => t.streaming);
                            const nextTurnIndex = Math.max(0, ...turns.map(t => t.turnIndex ?? -1)) + 1;
                            // While compacting, the process is marked `running` (AC-01) but
                            // there is no live assistant generation — suppress the empty
                            // streaming placeholder so the synthetic compaction bubble is the
                            // only in-progress indicator.
                            const renderTurns =
                                task?.status === 'running' && !hasStreaming && turns.length > 0 && !isCompacting
                                    ? [...turns, { role: 'assistant' as const, content: '', streaming: true, timeline: [], turnIndex: nextTurnIndex }]
                                    : turns;
                            const sortedTurns = [...renderTurns]
                                .filter(t => !t.deletedAt && (!t.archived || showArchived || !onArchiveTurn))
                                .sort((a, b) => {
                                const ai = a.turnIndex;
                                const bi = b.turnIndex;
                                if (ai == null && bi == null) return 0;
                                if (ai == null) return 1;
                                if (bi == null) return -1;
                                return ai - bi;
                            });
                            return sortedTurns.map((turn, i) => {
                                const idx = turn.turnIndex ?? i;
                                const isSelected = isSelecting && selectedTurns?.has(idx);

                                // Detect model change: show divider when a user turn
                                // introduces a different model than the previous model-bearing turn,
                                // or when switching from the default (no model field) for the first time
                                let modelDivider: React.ReactNode = null;
                                if (turn.role === 'user' && turn.model) {
                                    let prevModel: string | undefined;
                                    let hasPriorTurns = false;
                                    for (let j = i - 1; j >= 0; j--) {
                                        hasPriorTurns = true;
                                        if (sortedTurns[j].model) { prevModel = sortedTurns[j].model; break; }
                                    }
                                    if (hasPriorTurns && prevModel !== turn.model) {
                                        modelDivider = (
                                            <div
                                                className="model-divider flex items-center gap-3 mt-3.5 mb-2 ml-9"
                                                data-testid="model-change-divider"
                                            >
                                                <span className="model-divider-label font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#6b7280] dark:text-[#9aa0a6] whitespace-nowrap">
                                                    switched to{' '}
                                                    <strong className="font-semibold text-[#1f2328] dark:text-[#cccccc]">
                                                        {turn.model}
                                                    </strong>
                                                </span>
                                                <div className="model-divider-rule flex-1 h-px bg-[#e5e7eb] dark:bg-[#3c3c3c]" />
                                            </div>
                                        );
                                    }
                                }

                                // Detect mode change: same pattern as the model divider above.
                                let modeDivider: React.ReactNode = null;
                                if (turn.role === 'user' && turn.mode) {
                                    let prevMode: string | undefined;
                                    let hasPriorTurns = false;
                                    for (let j = i - 1; j >= 0; j--) {
                                        hasPriorTurns = true;
                                        if (sortedTurns[j].mode) { prevMode = sortedTurns[j].mode; break; }
                                    }
                                    const mode = normalizeChatMode(turn.mode);
                                    const prev = normalizeChatMode(prevMode);
                                    if (mode && hasPriorTurns && prev !== mode) {
                                        const modeKey = mode as ChatMode;
                                        const icon = MODE_ICONS[modeKey] ?? '';
                                        const accent = MODE_TEXT_COLORS[modeKey] ?? 'text-[#1f2328] dark:text-[#cccccc]';
                                        modeDivider = (
                                            <div
                                                className="mode-divider flex items-center gap-3 mt-3.5 mb-2 ml-9"
                                                data-testid="mode-change-divider"
                                            >
                                                <span className="mode-divider-label font-mono text-[10.5px] uppercase tracking-[0.1em] text-[#6b7280] dark:text-[#9aa0a6] whitespace-nowrap">
                                                    switched to{' '}
                                                    <strong className={cn('font-semibold', accent)}>
                                                        {icon ? `${icon} ` : ''}{mode}
                                                    </strong>
                                                </span>
                                                <div className="mode-divider-rule flex-1 h-px bg-[#e5e7eb] dark:bg-[#3c3c3c]" />
                                            </div>
                                        );
                                    }
                                }

                                return (
                                    <div key={idx}>
                                        {modelDivider}
                                        {modeDivider}
                                        <div
                                            className={cn(
                                                'flex items-start gap-2',
                                                isSelecting && 'cursor-pointer',
                                                isSelected && 'ring-2 ring-[#0078d4] ring-offset-1 rounded-lg',
                                            )}
                                            onClick={isSelecting ? (e: React.MouseEvent) => onTurnClick?.(idx, e) : undefined}
                                        >
                                            {isSelecting && (
                                                <div className="flex-shrink-0 pt-3 pl-1">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected ?? false}
                                                        readOnly
                                                        className="w-4 h-4 accent-[#0078d4] pointer-events-none"
                                                        aria-label={`Select turn ${idx}`}
                                                    />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <ConversationTurnBubble
                                                    turn={turn}
                                                    taskId={taskId}
                                                    wsId={wsId}
                                                    turnIndex={idx}
                                                    onAttachContext={onAttachContext}
                                                    onDeleteTurn={onDeleteTurn}
                                                    onPinTurn={onPinTurn}
                                                    onArchiveTurn={onArchiveTurn}
                                                    onRewindTurn={onRewindTurn}
                                                    onContinueInterrupted={() => continueInterruptedTurn(turn.interruptionReason)}
                                                    noteEdits={noteEdits}
                                                    processId={processId}
                                                    processType={processType}
                                                    provider={provider}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                        {isCompacting && (
                            <CompactionBubble instructions={compactInstructions} />
                        )}
                        {pendingAskUserBatch && (
                            <AskUserInline
                                key={pendingAskUserBatch.batchId}
                                batch={pendingAskUserBatch}
                                processId={processId ?? taskId}
                                onAnswered={onAskUserAnswered ?? (() => {})}
                                workspaceId={workspaceId}
                            />
                        )}
                        {showRalphGrillPlanningProgress && (
                            <RalphGrillPlanningProgressCard progress={ralphGrillPlanningProgress} />
                        )}
                        {mcpOAuthPrompts && mcpOAuthPrompts.length > 0 && mcpOAuthPrompts.map(prompt => (
                            <McpOAuthPrompt
                                key={prompt.requestId}
                                data={prompt}
                                onCompleted={onMcpOAuthCompleted}
                                onFailed={onMcpOAuthFailed}
                            />
                        ))}
                        {pendingQueue.length > 0 && (
                            <QueuedFollowUps queue={pendingQueue} onCancel={onCancelPendingMessage} />
                        )}
                        {backgroundTasks && backgroundTasks.backgroundTotalActive > 0 && (
                            <BackgroundTasksIndicator backgroundTasks={backgroundTasks} />
                        )}
                        {processError && task?.status === 'failed' && (
                            <div
                                className="flex items-start gap-3 p-3 rounded-lg bg-[#fdf3f3] dark:bg-[#3a1a1a] border border-[#f1707050] dark:border-[#f1707040]"
                                data-testid="process-error-banner"
                                role="alert"
                            >
                                <span className="text-[#d32f2f] dark:text-[#f48771] flex-shrink-0 text-base leading-5">⚠</span>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-[#d32f2f] dark:text-[#f48771] mb-1">Task failed</div>
                                    <pre className="text-xs text-[#1f2328] dark:text-[#cccccc] whitespace-pre-wrap break-words font-mono">{processError}</pre>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                {postConversationContent}
            </div>
            {/* Undo delete toast */}
            {undoDeleteTurnIndex != null && onUndoDelete && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#333] dark:bg-[#555] text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in">
                    <span>Message deleted</span>
                    <button
                        onClick={onUndoDelete}
                        className="font-semibold text-amber-300 hover:text-amber-200 transition-colors"
                    >
                        Undo
                    </button>
                </div>
            )}
            {/* Nav-mode hint pill (vim-style j/k navigation). */}
            {navHintVisible && (
                <div
                    data-testid="nav-mode-hint"
                    className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 px-3 py-1.5 rounded-full bg-black/75 text-white text-[11px] shadow-lg pointer-events-none select-none"
                    role="status"
                    aria-live="polite"
                >
                    Nav mode — j/k move · i to type · gg/G jump · Esc to exit
                </div>
            )}
            <button
                data-testid="scroll-to-bottom-btn"
                className={cn(
                    'absolute bottom-4 right-4 z-10 flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-full bg-[#0078d4] text-white shadow-md hover:bg-[#106ebe] text-sm pointer-events-none opacity-0 transition-opacity',
                    isScrolledUp && 'visible pointer-events-auto opacity-100',
                )}
                onClick={onScrollToBottom}
                title="Scroll to bottom"
            >
                ↓
            </button>
            {/* Floating action bar for selection mode */}
            {isSelecting && selectedCount > 0 && (
                <div
                    data-testid="selection-action-bar"
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-[#0078d4] text-white shadow-lg text-sm"
                >
                    <span className="font-medium">{selectedCount} turn{selectedCount !== 1 ? 's' : ''} selected</span>
                    <button
                        data-testid="copy-selected-html-btn"
                        onClick={onCopySelected}
                        className="px-3 py-1 rounded-full bg-white text-[#0078d4] font-medium hover:bg-[#e8f3ff] transition-colors"
                    >
                        Copy HTML
                    </button>
                    <button
                        data-testid="cancel-selection-btn"
                        onClick={onCancelSelection}
                        className="px-2 py-1 rounded-full hover:bg-[#106ebe] transition-colors"
                    >
                        ✕
                    </button>
                </div>
            )}
        </div>
    );
}

function formatDepth(depth: string): string {
    return depth ? depth.charAt(0).toUpperCase() + depth.slice(1) : 'Standard';
}

function RalphGrillPlanningProgressCard({ progress }: { progress: RalphGrillPlanningProgress }) {
    const runningCount = progress.agents.filter(agent => agent.status === 'running').length;
    const failedCount = progress.agents.filter(agent => agent.status === 'failed').length;
    const emptyCount = progress.agents.filter(agent => agent.status === 'empty').length;
    const completedCount = progress.agents.filter(agent => agent.status === 'completed').length;
    const statusCopy = progress.status === 'running'
        ? `Running ${runningCount} of ${progress.agentCount} grill agents`
        : `Preparing consolidated form from ${completedCount} completed${failedCount ? `, ${failedCount} failed` : ''}${emptyCount ? `, ${emptyCount} empty` : ''}`;

    return (
        <div
            className="my-2 rounded-md border border-purple-200 bg-purple-50/80 p-3 text-xs text-purple-900 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-100"
            data-testid="ralph-grill-planning-progress-card"
            role="status"
            aria-live="polite"
        >
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <div className="font-semibold">Question planning</div>
                    <div className="mt-0.5 text-purple-800/80 dark:text-purple-100/75">
                        Round {progress.round} of up to {progress.maxRounds} · {formatDepth(progress.depth)} depth · {statusCopy}
                    </div>
                </div>
                <div className={cn(
                    'rounded-full px-2 py-0.5 font-medium',
                    progress.status === 'running'
                        ? 'bg-white/80 text-purple-700 dark:bg-purple-500/15 dark:text-purple-200'
                        : 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-100',
                )}>
                    {progress.status === 'running' ? 'Running' : 'Planned'}
                </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
                {progress.agents.map(agent => (
                    <span
                        key={`${agent.role}-${agent.provenanceLabel}`}
                        className="rounded-full border border-purple-200 bg-white/80 px-2 py-0.5 text-[11px] text-purple-800 dark:border-purple-500/30 dark:bg-[#1f1f1f]/70 dark:text-purple-100"
                        data-testid="ralph-grill-planning-progress-chip"
                    >
                        {agent.provenanceLabel} · {agent.status}{agent.status !== 'running' ? ` · ${agent.candidateCount}` : ''}
                    </span>
                ))}
            </div>
            <div className="mt-2 text-[11px] text-purple-800/85 dark:text-purple-100/75">
                {progress.message}
            </div>
            {progress.warnings.length > 0 && (
                <div className="mt-2 rounded border border-amber-300/60 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="ralph-grill-planning-progress-warnings">
                    {progress.warnings.length === 1 ? progress.warnings[0] : `${progress.warnings.length} planning warnings; goal creation can continue.`}
                </div>
            )}
        </div>
    );
}
