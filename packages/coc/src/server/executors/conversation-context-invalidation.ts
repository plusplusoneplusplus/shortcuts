import type { ConversationTurn, ProcessCompactionState } from '@plusplusoneplusplus/forge';

/** Compaction signals settle independently: inspect both the transcript and metadata. */
export function hasCompactionSince(
    turns: ConversationTurn[],
    turnIndex: number,
    timestamp: unknown,
    compaction: ProcessCompactionState | undefined,
): boolean {
    if (turns.slice(turnIndex + 1).some(turn => turn.role === 'assistant' && turn.displayOnly === true)) {
        return true;
    }
    if (compaction?.state !== 'completed' || !compaction.completedAt) return false;
    const completedMs = Date.parse(compaction.completedAt);
    const injectedMs = timestamp instanceof Date ? timestamp.getTime() : Date.parse(String(timestamp));
    return Number.isFinite(completedMs) && (!Number.isFinite(injectedMs) || completedMs > injectedMs);
}
