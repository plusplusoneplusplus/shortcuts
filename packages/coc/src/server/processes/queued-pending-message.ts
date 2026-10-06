import type { AIProcess, PendingMessage, CreateTaskInput } from '@plusplusoneplusplus/forge';

/** Keep buffered turns durable until their queue task starts; stable IDs prevent double draining. */
export function pendingMessageTask(proc: AIProcess, message: PendingMessage): CreateTaskInput {
    return {
        id: `pending-${proc.id}-${message.id}`,
        processId: proc.id,
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat', processId: proc.id, prompt: message.content,
            workingDirectory: proc.workingDirectory, workspaceId: proc.metadata?.workspaceId,
            deferredMessage: message,
            ...(message.resumeSessionId ? { resumeSessionId: message.resumeSessionId } : {}),
            ...(message.relayRequestId ? { relayRequestId: message.relayRequestId } : {}),
            ...(message.provider ? { provider: message.provider } : {}),
            ...(message.model ? { model: message.model } : {}),
            ...(message.mode ? { mode: message.mode } : {}),
            ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}),
            attachments: message.attachments, images: message.images,
            imageTempDir: message.imageTempDir, fileAttachmentMeta: message.fileAttachmentMeta,
            context: { ...message.context, ...(message.skillNames?.length ? { skills: message.skillNames } : {}) },
        },
        config: { ...(message.reasoningEffort ? { reasoningEffort: message.reasoningEffort } : {}) },
        displayName: message.content.trim().slice(0, 60),
    };
}
