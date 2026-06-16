import { useState, useEffect, useCallback, useRef } from 'react';
import { useCocClient } from '../../../repos/cloneRouting';
import type { AttachmentPayload } from '../../../types/attachments';
import { formatAttachedContext, type AttachedWorkItemContextItem } from '../../chat/hooks/useAttachedContext';

export interface UseWorkItemChatBindingOptions {
    workspaceId: string;
    workItemId: string | undefined;
    title?: string;
    status?: string;
    type?: string;
    workItemNumber?: number;
}

export interface WorkItemChatComposerSendOptions {
    mode?: string;
    context?: Record<string, unknown>;
    attachments?: AttachmentPayload[];
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    config?: { effortTier?: string };
    workingDirectory?: string;
}

export interface UseWorkItemChatBindingReturn {
    taskId: string | null;
    loading: boolean;
    error: string | null;
    createChat: (prompt: string, options?: WorkItemChatComposerSendOptions) => Promise<string | null>;
    startFreshChat: () => Promise<boolean>;
    startingFresh: boolean;
}

function makeWorkItemLabel(workItemId: string, workItemNumber?: number): string {
    return workItemNumber !== undefined ? `Work Item #${workItemNumber}` : `Work Item ${workItemId}`;
}

function buildWorkItemPointerContext(opts: UseWorkItemChatBindingOptions): AttachedWorkItemContextItem | null {
    if (!opts.workItemId) return null;
    const label = makeWorkItemLabel(opts.workItemId, opts.workItemNumber);
    return {
        kind: 'work-item',
        id: `work-item:${opts.workspaceId}:${opts.workItemId}`,
        sourceWorkspaceId: opts.workspaceId,
        workItemId: opts.workItemId,
        workItemNumber: opts.workItemNumber,
        label,
        status: opts.status,
        type: opts.type,
        preview: label,
    };
}

function prependWorkItemPointer(prompt: string, opts: UseWorkItemChatBindingOptions): string {
    const pointer = buildWorkItemPointerContext(opts);
    if (!pointer) return prompt;
    const contextBlock = formatAttachedContext([pointer]);
    return [contextBlock, prompt].filter(part => part.trim().length > 0).join('\n\n');
}

export function useWorkItemChatBinding(opts: UseWorkItemChatBindingOptions): UseWorkItemChatBindingReturn {
    const { workspaceId, workItemId, status, type, workItemNumber } = opts;
    const cloneClient = useCocClient(workspaceId); // AC-07: work-item chat binding on the selected clone's server.
    const [taskId, setTaskId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [startingFresh, setStartingFresh] = useState(false);
    const mountedRef = useRef(false);
    const currentRequestRef = useRef({ workspaceId, workItemId });
    currentRequestRef.current = { workspaceId, workItemId };

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const isCurrentRequest = useCallback((requestedWorkspaceId: string, requestedWorkItemId: string | undefined) => (
        mountedRef.current
        && currentRequestRef.current.workspaceId === requestedWorkspaceId
        && currentRequestRef.current.workItemId === requestedWorkItemId
    ), []);

    useEffect(() => {
        if (!workItemId) { setTaskId(null); setStartingFresh(false); return; }
        let cancelled = false;
        setLoading(true);
        setError(null);
        setTaskId(null);
        setStartingFresh(false);

        cloneClient.workItems.getChatBinding(workspaceId, workItemId)
            .then(data => { if (!cancelled) setTaskId(data.taskId); })
            .catch(err => {
                if (cancelled) return;
                if (err?.status === 404 || err?.message?.includes('404')) setTaskId(null);
                else setError('Failed to load work item chat');
            })
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [workspaceId, workItemId, cloneClient]);

    const createChat = useCallback(async (prompt: string, options: WorkItemChatComposerSendOptions = {}): Promise<string | null> => {
        if (!workItemId) return null;
        const requestedWorkspaceId = workspaceId;
        const requestedWorkItemId = workItemId;
        if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
            setError(null);
        }
        try {
            const promptWithPointer = prependWorkItemPointer(prompt, { workspaceId, workItemId, status, type, workItemNumber });
            const res = await cloneClient.queue.enqueue({
                type: 'chat',
                priority: 'normal',
                payload: {
                    kind: 'chat',
                    mode: options.mode ?? 'ask',
                    prompt: promptWithPointer,
                    ...(options.workingDirectory ? { workingDirectory: options.workingDirectory } : {}),
                    workspaceId,
                    ...(options.attachments && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
                    ...(options.provider ? { provider: options.provider } : {}),
                    ...(options.model ? { model: options.model } : {}),
                    ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
                    context: {
                        ...(options.context ?? {}),
                        workItemChat: { workspaceId, workItemId, status, type, workItemNumber },
                    },
                },
                ...(options.config ? { config: options.config } : {}),
            });
            const newTaskId = res.task?.id ?? (res as { id?: string }).id;
            if (!newTaskId) throw new Error('Failed to create work item chat task');

            await cloneClient.workItems.createChatBinding(workspaceId, workItemId, newTaskId);

            if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
                setError(null);
                setTaskId(newTaskId);
            }
            return newTaskId;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
                setError(err?.message ?? 'Failed to create work item chat');
            }
            return null;
        }
    }, [workspaceId, workItemId, status, type, workItemNumber, isCurrentRequest, cloneClient]);

    const startFreshChat = useCallback(async (): Promise<boolean> => {
        if (!workItemId) return false;
        const requestedWorkspaceId = workspaceId;
        const requestedWorkItemId = workItemId;
        if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
            setStartingFresh(true);
            setError(null);
        }
        try {
            await cloneClient.workItems.startFreshChat(workspaceId, workItemId);
            if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
                setTaskId(null);
                setError(null);
            }
            return true;
        } catch (err: any) {
            if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
                setError(err?.message ?? 'Failed to start fresh work item chat');
            }
            return false;
        } finally {
            if (isCurrentRequest(requestedWorkspaceId, requestedWorkItemId)) {
                setStartingFresh(false);
            }
        }
    }, [workspaceId, workItemId, isCurrentRequest, cloneClient]);

    return { taskId, loading, error, createChat, startFreshChat, startingFresh };
}
