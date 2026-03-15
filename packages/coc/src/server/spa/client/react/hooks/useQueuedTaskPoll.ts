import { useEffect } from 'react';
import { fetchApi } from './useApi';
import { getConversationTurns } from '../chat/chatConversationUtils';
import type { ClientConversationTurn } from '../types/dashboard';

type SetTurnsAndRef = (next: ClientConversationTurn[] | ((prev: ClientConversationTurn[]) => ClientConversationTurn[])) => void;

export interface UseQueuedTaskPollOptions {
    taskId: string;
    task: any;
    setTask: (t: any) => void;
    setProcessDetails: (p: any) => void;
    setTurnsAndRef: SetTurnsAndRef;
}

/** Polls every 2 s while task is queued, transitioning to running state when the server starts it. */
export function useQueuedTaskPoll({ taskId, task, setTask, setProcessDetails, setTurnsAndRef }: UseQueuedTaskPollOptions): void {
    useEffect(() => {
        if (!taskId || task?.status !== 'queued') return;
        const interval = setInterval(async () => {
            try {
                const data = await fetchApi(`/queue/${encodeURIComponent(taskId)}`);
                const t = data?.task;
                if (t && t.status !== 'queued') {
                    setTask(t);
                    if (t.processId || t.status === 'running') {
                        const pid = t.processId ?? `queue_${taskId}`;
                        const procData = await fetchApi(`/processes/${encodeURIComponent(pid)}`);
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
                }
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [taskId, task?.status, setTurnsAndRef]); // eslint-disable-line react-hooks/exhaustive-deps
}
