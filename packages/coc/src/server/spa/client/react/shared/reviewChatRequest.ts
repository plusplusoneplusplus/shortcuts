import type { CocClient, EnqueueTaskRequest } from '@plusplusoneplusplus/coc-client';
import type { AttachmentPayload } from '../types/attachments';

export interface ReviewChatComposerSendOptions {
    mode?: string;
    context?: Record<string, unknown>;
    attachments?: AttachmentPayload[];
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    chatStyle?: string;
    config?: Pick<NonNullable<EnqueueTaskRequest['config']>, 'effortTier'>;
    workingDirectory?: string;
}

interface PullRequestChatContext {
    prId: string;
    repoId?: string;
    prTitle?: string;
    prNumber?: number;
    originId?: string;
}

/** Binding storage and ownership remain the caller's responsibility. */
export async function enqueueReviewChat(
    client: CocClient,
    workspaceId: string,
    prompt: string,
    pullRequestChat: PullRequestChatContext,
    options: ReviewChatComposerSendOptions,
): Promise<string | null> {
    const res = await client.queue.enqueue({
        type: 'chat',
        priority: 'normal',
        payload: {
            kind: 'chat',
            mode: options.mode ?? 'ask',
            prompt,
            ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
            workspaceId,
            ...(options.attachments?.length ? { attachments: options.attachments } : {}),
            ...(options.provider ? { provider: options.provider } : {}),
            ...(options.model ? { model: options.model } : {}),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(options.chatStyle ? { chatStyle: options.chatStyle } : {}),
            context: { ...(options.context ?? {}), pullRequestChat },
        },
        ...(options.config ? { config: options.config } : {}),
    });
    return res.task?.id ?? ('id' in res && typeof res.id === 'string' ? res.id : null);
}
