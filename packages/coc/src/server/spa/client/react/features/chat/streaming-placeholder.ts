/**
 * Decide whether the transcript should inject the synthetic empty-assistant
 * "streaming" placeholder turn at the bottom of the conversation.
 *
 * The placeholder gives the user a live "thinking…" affordance while a turn is
 * running but the stream has not produced any content yet. It must be
 * suppressed while a `/compact` is in flight: AC-01 marks the process `running`
 * during compaction even though there is no assistant generation, so without
 * the `!isCompacting` guard the placeholder would render alongside the
 * synthetic CompactionBubble (AC-02). It is also skipped when a live streaming
 * turn already exists or there are no turns yet.
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
