import { useEffect } from 'react';
import { fetchApi } from '../../hooks/useApi';
import { getSpaCocClient } from '../../api/cocClient';
import { getConversationTurns } from '../../features/chat/conversation/chatConversationUtils';
import { toQueueProcessId, isQueueProcessId, toTaskId } from '../../utils/queue-process-id';
import type { ClientConversationTurn } from '../../types/dashboard';
import { useCocClient } from '../../repos/cloneRouting';
import { useWorkspaceOwner } from '../../repos/workspaceOwnerContext';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface UseQueuedTaskPollOptions {
    taskId: string;
    task: any;
    setTask: (t: any) => void;
    setProcessDetails: (p: any) => void;
    setTurnsAndRef: SetTurnsAndRef;
    workspaceId?: string;
}

/** Polls every 2 s while task is queued, transitioning to running state when the server starts it. */
export function useQueuedTaskPoll({ taskId, task, setTask, setProcessDetails, setTurnsAndRef, workspaceId }: UseQueuedTaskPollOptions): void {
    const client = useCocClient(workspaceId);
    const owner = useWorkspaceOwner(workspaceId);
    useEffect(() => {
        if (!taskId || task?.status !== 'queued') return;
        // The queue endpoint expects a bare task id. The taskId received here
        // may be a processId-form `queue_<id>` (when this hook is mounted by
        // ChatDetail through `/activity/queue_<id>`); strip the prefix so the
        // server can locate the in-memory queued task.
        const bareTaskId = isQueueProcessId(taskId) ? toTaskId(taskId) : taskId;
        let cancelled = false;
        const interval = setInterval(async () => {
            try {
                const data = await (workspaceId ? client : getSpaCocClient()).queue.getTask(bareTaskId);
                if (cancelled) return;
                const t = data?.task;
                if (t && t.status !== 'queued') {
                    setTask(t);
                    // Always refresh processDetails when the task transitions out of
                    // `queued`. The previous gate (`t.processId || t.status === 'running'`)
                    // missed `queued → completed` short hops, leaving the stale
                    // synthesised `queued` processDetails in place and keeping the
                    // PendingTaskInfoPanel visible after task completion.
                    const pid = t.processId ?? (isQueueProcessId(taskId) ? taskId : toQueueProcessId(bareTaskId));
                    const procData = workspaceId
                        ? await client.processes.get(pid, owner ? { workspace: owner.workspaceId } : undefined)
                        : await fetchApi(`/processes/${encodeURIComponent(pid)}`);
                    if (cancelled) return;
                    setProcessDetails(procData?.process || null);
                    const loadedTurns = getConversationTurns(procData, t);
                    if (t.status === 'running') {
                        const lastTurn = loadedTurns[loadedTurns.length - 1];
                        if (lastTurn?.role === 'assistant') {
                            setTurnsAndRef(loadedTurns.map((turn: ClientConversationTurn, i: number) =>
                                i === loadedTurns.length - 1 ? { ...turn, streaming: true } : turn
                            ));
                        } else {
                            setTurnsAndRef([...loadedTurns, { role: 'assistant', content: '', streaming: true, timeline: [] }]);
                        }
                    } else {
                        setTurnsAndRef(loadedTurns);
                    }
                }
            } catch { /* ignore */ }
        }, 2000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [taskId, task?.status, setTurnsAndRef, workspaceId, client, owner]); // eslint-disable-line react-hooks/exhaustive-deps
}
