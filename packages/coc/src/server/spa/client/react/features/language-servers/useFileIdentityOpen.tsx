import { useCallback, useEffect, useRef, useState } from 'react';
import { FileOpenQueue, resolveOwnedFile, type FileOwner } from './fileIdentity';

export function useFileIdentityOpen(context: string) {
    const current = useRef(context);
    current.current = context;
    const queues = useRef(new Map<string, FileOpenQueue>());
    const [failure, setFailure] = useState<{ message: string; retry(): void } | null>(null);
    useEffect(() => {
        setFailure(null);
        const ownedQueues = queues.current;
        return () => {
            for (const queue of ownedQueues.values()) queue.dispose();
            ownedQueues.clear();
        };
    }, [context]);
    const open = useCallback((owner: FileOwner, path: string, existing: () => readonly string[], commit: (path: string, signal: AbortSignal) => void) => {
        const key = JSON.stringify([context, owner.workspaceId, owner.routingRef]);
        let queue = queues.current.get(key);
        if (!queue) queues.current.set(key, queue = new FileOpenQueue());
        const attempt = () => {
            if (current.current !== context) return;
            void queue!.open(path, existing, (value, signal) => resolveOwnedFile(owner, value, signal), (value, signal) => {
                if (current.current !== context) return;
                commit(value, signal);
                setFailure(null);
            }).catch(error => {
                if (current.current === context && error?.name !== 'AbortError') {
                    setFailure({ message: error instanceof Error ? error.message : 'Cannot confirm file identity.', retry: attempt });
                }
            });
        };
        attempt();
    }, [context]);
    return {
        open,
        error: failure && <div role="alert" className="p-2 text-sm text-[#d32f2f]">
            {failure.message} <button type="button" onClick={failure.retry}>Retry</button>
        </div>,
    };
}
