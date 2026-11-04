import { useState, useEffect, useCallback } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import { resolveCanonicalOriginId } from '../../../repos/originScope';
import { useRequestScope } from '../../../hooks/useRequestScope';
import { enqueueReviewChat, type ReviewChatComposerSendOptions } from '../../../shared/reviewChatRequest';
export type { ReviewChatComposerSendOptions } from '../../../shared/reviewChatRequest';

export interface UsePullRequestChatBindingOptions {
    /** Workspace ID for the concrete clone used by queue/fresh-chat actions. */
    workspaceId: string;
    /** Remote URL used to resolve the shared origin-scoped binding key. */
    remoteUrl?: string | null;
    /** PR identifier (stringified). When falsy the hook resets to empty state. */
    prId: string | undefined;
    /** Human-readable PR number — surfaced to the AI prompt. */
    prNumber?: number;
    /** PR title — surfaced to the AI prompt. */
    prTitle?: string;
    /** Repo identifier the PR belongs to (used when different from workspaceId). */
    repoId?: string;
}

export interface UsePullRequestChatBindingReturn {
    /** The queue task ID bound to this PR, or null if no chat exists. */
    taskId: string | null;
    loading: boolean;
    /** Error message if binding fetch failed. */
    error: string | null;
    /** Create a new chat for this PR. Returns the new taskId. */
    createChat: (prompt: string, options?: ReviewChatComposerSendOptions) => Promise<string | null>;
    /** Archive the currently bound chat and return this PR to an empty chat state. */
    startFreshChat: () => Promise<boolean>;
    /** True while the fresh-chat binding reset is in progress. */
    startingFresh: boolean;
}

export function usePullRequestChatBinding(opts: UsePullRequestChatBindingOptions): UsePullRequestChatBindingReturn {
    const { workspaceId, remoteUrl, prId, prNumber, prTitle, repoId } = opts;
    const originId = resolveCanonicalOriginId({ workspaceId, remoteUrl });
    const cloneClient = useCocClient(workspaceId); // AC-07: PR chat binding on the selected clone's server.
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [startingFresh, setStartingFresh] = useState(false);
    const isCurrentRequest = useRequestScope(cloneClient, JSON.stringify([workspaceId, originId, prId]));

    useEffect(() => {
        if (!prId) { setTaskId(null); setStartingFresh(false); setLoading(false); setError(null); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);
        setStartingFresh(false);

        cloneClient.pullRequests.getChatBindingForOrigin(originId, prId)
            .then(data => { if (!cancelled && isCurrentRequest()) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled || !isCurrentRequest()) return;
                if (err?.status === 404 || err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load pull request chat');
            })
            .finally(() => { if (!cancelled && isCurrentRequest()) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, originId, prId, cloneClient, isCurrentRequest]);

    const createChat = useCallback(async (prompt: string, options: ReviewChatComposerSendOptions = {}): Promise<string | null> => {
        if (!prId) return null;
        if (isCurrentRequest()) {
            setError(null);
        }
        try {
            const newTaskId = await enqueueReviewChat(cloneClient, workspaceId, prompt, { prId, prNumber, prTitle, repoId, originId }, options);
            if (!newTaskId) throw new Error('Failed to create pull request chat task');

            await cloneClient.pullRequests.createChatBindingForOrigin(originId, prId, newTaskId);

            if (isCurrentRequest()) {
                setError(null);
                setTaskId(newTaskId);
            }
            return newTaskId;
        } catch (err) {
            if (isCurrentRequest()) {
                setError(err instanceof Error ? err.message : 'Failed to create pull request chat');
            }
            return null;
        }
    }, [workspaceId, originId, prId, prNumber, prTitle, repoId, isCurrentRequest, cloneClient]);

    const startFreshChat = useCallback(async (): Promise<boolean> => {
        if (!prId) return false;
        if (isCurrentRequest()) {
            setStartingFresh(true);
            setError(null);
        }
        try {
            await cloneClient.pullRequests.startFreshChatForOrigin(originId, prId, workspaceId);
            if (isCurrentRequest()) {
                setTaskId(null);
                setError(null);
            }
            return true;
        } catch (err) {
            if (isCurrentRequest()) {
                setError(err instanceof Error ? err.message : 'Failed to start fresh pull request chat');
            }
            return false;
        } finally {
            if (isCurrentRequest()) {
                setStartingFresh(false);
            }
        }
    }, [workspaceId, originId, prId, isCurrentRequest, cloneClient]);

    return { taskId, loading, error, createChat, startFreshChat, startingFresh };
}
