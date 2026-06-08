import { useState, useEffect, useCallback } from 'react';
import { getSpaCocClient } from '../../../api/cocClient';
import type { AttachmentPayload } from '../../../types/attachments';

export interface UsePrChatBindingOptions {
    workspaceId: string;
    prId: string;
    /** Currently selected file — included in chat context for the AI. */
    filePath?: string;
    /** Repo identifier the PR belongs to (may differ from workspaceId). */
    repoId?: string;
    /** PR title — surfaced to the AI framing sentence. */
    prTitle?: string;
}

export interface ReviewChatComposerSendOptions {
    mode?: string;
    context?: Record<string, unknown>;
    attachments?: AttachmentPayload[];
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    config?: { effortTier?: string };
    workingDirectory?: string;
}

export interface UsePrChatBindingReturn {
    taskId: string | null;
    loading: boolean;
    error: string | null;
    createChat: (prompt: string, options?: ReviewChatComposerSendOptions) => Promise<string | null>;
}

const BINDING_STORAGE_PREFIX = 'coc.prChat.binding.';

function getStoredBinding(prId: string): string | null {
    try {
        return localStorage.getItem(`${BINDING_STORAGE_PREFIX}${prId}`) ?? null;
    } catch { return null; }
}

function storeBinding(prId: string, taskId: string): void {
    try {
        localStorage.setItem(`${BINDING_STORAGE_PREFIX}${prId}`, taskId);
    } catch { /* ignore */ }
}

/**
 * Hook for PR-level AI chat. Creates chat tasks with pullRequestChat context so
 * the backend prompt-builder emits the PR framing sentence. The AI determines
 * what to read; no diff content is injected.
 */
export function usePrChatBinding(opts: UsePrChatBindingOptions): UsePrChatBindingReturn {
    const { workspaceId, prId, filePath, repoId, prTitle } = opts;
    const [taskId, setTaskId] = useState<string | null>(() => getStoredBinding(prId));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Restore binding from localStorage on prId change
    useEffect(() => {
        const stored = getStoredBinding(prId);
        setTaskId(stored);
    }, [prId]);

    const createChat = useCallback(async (prompt: string, options: ReviewChatComposerSendOptions = {}): Promise<string | null> => {
        setLoading(true);
        setError(null);
        try {
            const res = await getSpaCocClient().queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: options.mode ?? 'ask',
                    prompt,
                    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
                    workspaceId,
                    ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
                    ...(options.provider ? { provider: options.provider } : {}),
                    ...(options.model ? { model: options.model } : {}),
                    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
                    context: {
                        ...(options.context ?? {}),
                        pullRequestChat: { prId, repoId, prTitle },
                    },
                },
                ...(options.config ? { config: options.config } : {}),
            });
            const newTaskId = res.task?.id ?? (res as { id?: string }).id;
            if (!newTaskId) throw new Error('Failed to create PR chat task');

            storeBinding(prId, newTaskId);
            setTaskId(newTaskId);
            return newTaskId;
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create PR chat');
            return null;
        } finally {
            setLoading(false);
        }
    }, [workspaceId, prId, repoId, prTitle]);

    return { taskId, loading, error, createChat };
}
