import type { AIProcess, ConversationTurn } from './ai/process-types';
import { PAGE_TURNS, type ConversationTurnsPage, type ProcessHistoryOptions } from './process-store';

export function validateProcessHistoryOptions(options: ProcessHistoryOptions = {}): { limit: number; beforeTurnIndex?: number } {
    const limit = options.limit ?? PAGE_TURNS;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new RangeError('History limit must be an integer between 1 and 200');
    }
    if (options.beforeTurnIndex !== undefined && (!Number.isSafeInteger(options.beforeTurnIndex) || options.beforeTurnIndex < 0)) {
        throw new RangeError('History cursor must be a non-negative safe integer');
    }
    return { limit, beforeTurnIndex: options.beforeTurnIndex };
}

/** File and in-memory stores already hold the full history; SQLite selects its page in SQL. */
export function pageConversationTurns(turns: ConversationTurn[], historyRevision: number, options?: ProcessHistoryOptions): ConversationTurnsPage {
    const { limit, beforeTurnIndex } = validateProcessHistoryOptions(options);
    const eligible = turns.filter(turn => beforeTurnIndex === undefined || turn.turnIndex < beforeTurnIndex)
        .sort((a, b) => a.turnIndex - b.turnIndex);
    let start = Math.max(0, eligible.length - limit);
    if (start > 0 && eligible[start]?.role === 'assistant' && eligible[start - 1].role === 'user') start--;
    const page = eligible.slice(start);
    return {
        turns: page,
        oldestTurnIndex: page[0]?.turnIndex ?? null,
        hasMore: page.length > 0 && start > 0,
        totalTurns: turns.length,
        historyRevision,
    };
}

/** Appends and changes to a streaming placeholder do not invalidate older pages. */
export function historyChanged(previous: AIProcess | undefined, next: AIProcess, filterStreaming = false, explicitEdit = false): boolean {
    if (!previous) return false;
    const nextTurns = new Map((next.conversationTurns ?? []).map(turn => [turn.turnIndex, turn]));
    for (const turn of previous.conversationTurns ?? []) {
        if (filterStreaming && turn.streaming) continue;
        const replacement = nextTurns.get(turn.turnIndex);
        if (!replacement) return true;
        if ((!turn.streaming || explicitEdit) && JSON.stringify(turn) !== JSON.stringify(replacement)) return true;
    }
    const oldMax = Math.max(-1, ...(previous.conversationTurns ?? []).map(turn => turn.turnIndex));
    const oldIndices = new Set((previous.conversationTurns ?? []).map(turn => turn.turnIndex));
    if ((next.conversationTurns ?? []).some(turn => turn.turnIndex < oldMax && !oldIndices.has(turn.turnIndex))) return true;
    const compaction = next.metadata?.compaction;
    return compaction?.state === 'completed' && JSON.stringify(compaction) !== JSON.stringify(previous.metadata?.compaction);
}

/** Private revisions for non-persistent stores, separate from their process payloads. */
export class HistoryAwareProcessMap extends Map<string, AIProcess> {
    private readonly revisions = new Map<string, number>();

    override set(id: string, process: AIProcess, filterStreaming = false, explicitEdit = false): this {
        this.revisions.set(id, (this.revisions.get(id) ?? 0) + Number(historyChanged(this.get(id), process, filterStreaming, explicitEdit)));
        return super.set(id, process);
    }

    getProcessHistory(id: string, workspaceId?: string, options?: ProcessHistoryOptions): { process: AIProcess; page: ConversationTurnsPage } | undefined {
        validateProcessHistoryOptions(options);
        const process = this.get(id);
        if (!process || (workspaceId !== undefined && (process.metadata?.workspaceId ?? '') !== workspaceId)) return undefined;
        const page = pageConversationTurns(process.conversationTurns ?? [], this.revisions.get(id) ?? 0, options);
        return { process: { ...process, conversationTurns: page.turns }, page };
    }
}
