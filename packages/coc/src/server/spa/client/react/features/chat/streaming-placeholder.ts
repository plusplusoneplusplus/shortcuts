/**
 * Decide whether the transcript should inject the synthetic empty-assistant
 * "streaming" placeholder turn — the live "thinking…" affordance shown while a
 * turn is running but the stream has produced nothing yet.
 *
 * Suppressed while a `/compact` is in flight: AC-01 marks the process `running`
 * during compaction even though nothing is generating, so without the
 * `!isCompacting` guard the placeholder would render alongside the synthetic
 * CompactionBubble (AC-02).
 */
export function shouldInjectStreamingPlaceholder(params: {
    status: string | null | undefined;
    hasStreaming: boolean;
    turnCount: number;
    isCompacting: boolean;
}): boolean {
    const { status, hasStreaming, turnCount, isCompacting } = params;
    return status === 'running' && !hasStreaming && turnCount > 0 && !isCompacting;
}
