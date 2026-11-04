import { useState, useEffect, useCallback } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { useRequestScope } from '../../../hooks/useRequestScope';
import { enqueueReviewChat, type ReviewChatComposerSendOptions } from '../../../shared/reviewChatRequest';
export type { ReviewChatComposerSendOptions } from '../../../shared/reviewChatRequest';
import { getReviewChatTargetStorageId } from '../commits/commitChatPlacement';

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

export interface UsePrChatBindingReturn {
    taskId: string | null;
    loading: boolean;
    error: string | null;
    createChat: (prompt: string, options?: ReviewChatComposerSendOptions) => Promise<string | null>;
}

const BINDING_STORAGE_PREFIX = 'coc.prChat.binding.';

function getPrChatBindingStorageKey(opts: Pick<UsePrChatBindingOptions, 'workspaceId' | 'repoId' | 'prId'>): string {
    return `${BINDING_STORAGE_PREFIX}${getReviewChatTargetStorageId({
        type: 'pr',
        workspaceId: opts.workspaceId,
        repoId: opts.repoId,
        prId: opts.prId,
    })}`;
}

function getStoredBinding(opts: Pick<UsePrChatBindingOptions, 'workspaceId' | 'repoId' | 'prId'>): string | null {
    try {
        return localStorage.getItem(getPrChatBindingStorageKey(opts)) ?? null;
    } catch { return null; }
}

function storeBinding(opts: Pick<UsePrChatBindingOptions, 'workspaceId' | 'repoId' | 'prId'>, taskId: string): void {
    try {
        localStorage.setItem(getPrChatBindingStorageKey(opts), taskId);
    } catch { /* ignore */ }
}

/**
 * Hook for PR-level AI chat. Creates chat tasks with pullRequestChat context so
 * the backend prompt-builder emits the PR framing sentence. The AI determines
 * what to read; no diff content is injected.
 */
export function usePrChatBinding(opts: UsePrChatBindingOptions): UsePrChatBindingReturn {
    const { workspaceId, prId, repoId, prTitle } = opts;
    const client = useCocClient(workspaceId);
    const isCurrent = useRequestScope(client, JSON.stringify([workspaceId, repoId, prId]));
    const [taskId, setTaskId] = useState<string | null>(() => getStoredBinding({ workspaceId, repoId, prId }));
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Restore binding from localStorage when the review target identity changes.
    useEffect(() => {
        const stored = getStoredBinding({ workspaceId, repoId, prId });
        setTaskId(stored);
        setLoading(false);
        setError(null);
    }, [workspaceId, repoId, prId, client]);

    const createChat = useCallback(async (prompt: string, options: ReviewChatComposerSendOptions = {}): Promise<string | null> => {
        if (!isCurrent()) return null;
        setLoading(true);
        setError(null);
        try {
            const newTaskId = await enqueueReviewChat(client, workspaceId, prompt, { prId, repoId, prTitle }, options);
            if (!newTaskId) throw new Error('Failed to create PR chat task');

            storeBinding({ workspaceId, repoId, prId }, newTaskId);
            if (isCurrent()) setTaskId(newTaskId);
            return newTaskId;
        } catch (err) {
            if (isCurrent()) setError(err instanceof Error ? err.message : 'Failed to create PR chat');
            return null;
        } finally {
            if (isCurrent()) setLoading(false);
        }
    }, [workspaceId, prId, repoId, prTitle, client, isCurrent]);

    return { taskId, loading, error, createChat };
}
