/**
 * compacting-conversations — bucket mid-`/compact` conversations into the
 * chat-list `running` list (and out of `history`).
 *
 * When a user runs `/compact` on an already-completed conversation, the compact
 * route flips the process-store status to `running` and sets
 * `metadata.compaction.state = 'running'` for the duration, restoring the prior
 * terminal status on settle (success or failure). That conversation finished
 * long ago, so it is NOT in the in-memory task queue that feeds the chat-list
 * `running` bucket — it stays in `history` and renders under COMPLETED TASKS the
 * whole time. This helper closes that gap on the SPA side: it promotes such
 * conversations into `running` so `ChatListPane` shows them under RUNNING TASKS,
 * then lets them fall back to their prior terminal section once compaction
 * settles.
 *
 * Provider-agnostic: keys only on process-store status + compaction metadata,
 * never on the provider name. Pure utility: no React, no side effects.
 */

/** Minimal shape of a client-side process index entry this module reads. The
 *  runtime value comes from `appState.processes` (seeded from
 *  `/api/processes/summaries`, kept fresh by `process-updated` WS events). */
export interface CompactionProcessLike {
    id: string;
    status?: string;
    type?: string;
    metadata?: { compaction?: { state?: string } | null } | null;
    // Fallback display fields used when the conversation is absent from local
    // history (e.g. a reload lands mid-compaction — the terminal-only history
    // endpoint excludes a `running` process).
    title?: string;
    customTitle?: string;
    displayName?: string;
    promptPreview?: string;
    lastMessagePreview?: string;
    workspaceId?: string;
    startTime?: string | number;
    workItemId?: string;
}

/**
 * True when a process is mid-`/compact`: process-store status `running` AND
 * `metadata.compaction.state === 'running'`. Both conditions are required so a
 * settled compaction (status restored to a terminal `priorStatus`,
 * `compaction.state` `completed`/`failed`) is NOT treated as running.
 */
export function isCompactingProcess(proc: CompactionProcessLike | null | undefined): boolean {
    return !!proc
        && proc.status === 'running'
        && proc.metadata?.compaction?.state === 'running';
}

export interface MergeCompactingInput {
    /** Chat-list `running` bucket (queue tasks) as fed to `ChatListPane`. */
    running: any[];
    /** Chat-list `history` bucket (terminal `ProcessHistoryItem`s). */
    history: any[];
    /** Global process index (`appState.processes`). */
    processes: CompactionProcessLike[];
}

export interface MergeCompactingResult {
    running: any[];
    history: any[];
}

/** Build a chat-row-shaped `running` entry from a process index entry, used
 *  when the compacting conversation is not present in local history. */
function synthesizeRunningRow(proc: CompactionProcessLike): any {
    return {
        id: proc.id,
        processId: proc.id,
        type: proc.type ?? 'chat',
        status: 'running',
        title: proc.title,
        customTitle: proc.customTitle,
        displayName: proc.displayName ?? proc.customTitle ?? proc.title,
        promptPreview: proc.promptPreview,
        lastMessagePreview: proc.lastMessagePreview,
        workspaceId: proc.workspaceId,
        workItemId: proc.workItemId,
        startTime: proc.startTime,
        startedAt: proc.startTime,
    };
}

/**
 * Merge mid-compaction conversations into the chat-list `running` list and out
 * of `history`. Returns the same array references unchanged when nothing is
 * compacting, so callers can rely on referential stability for memoization.
 */
export function mergeCompactingConversations(input: MergeCompactingInput): MergeCompactingResult {
    const { running, history, processes } = input;

    const compactingIds = new Set<string>();
    for (const proc of processes ?? []) {
        if (isCompactingProcess(proc)) compactingIds.add(proc.id);
    }
    if (compactingIds.size === 0) return { running, history };

    // processIds already represented in the running bucket. Queue tasks carry
    // both a bare `id` and a `processId`; either may match a process index id.
    const runningIds = new Set<string>();
    for (const t of running ?? []) {
        if (t?.id) runningIds.add(t.id);
        if (t?.processId) runningIds.add(t.processId);
    }

    const promoted: any[] = [];
    const handledIds = new Set<string>();
    const nextHistory: any[] = [];
    let historyChanged = false;

    for (const item of history ?? []) {
        if (item && compactingIds.has(item.id)) {
            // A compacting conversation must never render under COMPLETED. Drop
            // it from history; promote it into running unless the queue already
            // surfaces it there (avoid a duplicate row).
            if (!runningIds.has(item.id)) {
                // Promote the exact (already chat-shaped) history row into
                // running. Force `status: 'running'` so any status-derived
                // rendering treats it as in-progress; the running section also
                // forces taskStatus.
                promoted.push({ ...item, status: 'running' });
            }
            handledIds.add(item.id);
            historyChanged = true;
            continue;
        }
        if (item) nextHistory.push(item);
    }

    // Reload fallback: a compacting conversation is excluded from the
    // terminal-only history endpoint, so it may be absent from `history`.
    // Synthesize a running row from the process index entry so it still shows
    // under RUNNING TASKS across a reload.
    for (const proc of processes ?? []) {
        if (!isCompactingProcess(proc)) continue;
        if (runningIds.has(proc.id) || handledIds.has(proc.id)) continue;
        promoted.push(synthesizeRunningRow(proc));
        handledIds.add(proc.id);
    }

    if (promoted.length === 0 && !historyChanged) return { running, history };
    return {
        running: promoted.length ? [...(running ?? []), ...promoted] : running,
        history: historyChanged ? nextHistory : history,
    };
}
