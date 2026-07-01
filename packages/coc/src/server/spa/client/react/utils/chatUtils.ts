/** A server-confirmed queued follow-up waiting for execution. */
export interface QueuedMessage {
    id: string;           // server-assigned UUID — used as React key and identifier
    content: string;
    status: 'queued' | 'steering';
    /** Base64 image data-URLs attached when the follow-up was queued (rendered as thumbnails). */
    images?: string[];
}

export function buildMetadataProcess(task: any, processDetails: any, processId: string | null): any {
    if (!task) return null;
    const provider = task.provider ?? task.payload?.provider;
    const model = task.model ?? task.config?.model ?? task.payload?.model;
    const reasoningEffort = task.reasoningEffort ?? task.config?.reasoningEffort ?? task.payload?.reasoningEffort;
    const timeoutMs = task.timeoutMs ?? task.config?.timeoutMs ?? task.payload?.timeoutMs;
    return {
        ...task,
        ...(processDetails || {}),
        id: processId ?? task.id,
        metadata: {
            queueTaskId: task.id,
            model,
            reasoningEffort,
            mode: (task as any)?.payload?.mode,
            provider,
            dream: task.payload?.kind === 'dream-run'
                ? {
                    workspaceId: task.payload?.workspaceId,
                    trigger: task.payload?.trigger,
                    timeoutMs,
                }
                : undefined,
            ...task.metadata,
            ...(processDetails?.metadata || {}),
        },
    };
}
