import { useCallback, useEffect, useRef, useState } from 'react';

/** Duplicate actions finish immediately without fabricating a comment result. */
export function useCommentMutations<T>(
    updateStatus: (id: string, status: 'open' | 'resolved') => Promise<T>,
    remove: (id: string) => Promise<void>,
    isCurrent: () => boolean,
) {
    const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
    const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
    const pendingStatus = useRef(new Set<string>());
    const pendingDelete = useRef(new Set<string>());

    useEffect(() => {
        pendingStatus.current = new Set();
        pendingDelete.current = new Set();
        setResolvingIds(new Set());
        setDeletingIds(new Set());
    }, [isCurrent]);

    const changeStatus = useCallback(async (id: string, status: 'open' | 'resolved'): Promise<T | undefined> => {
        const pending = pendingStatus.current;
        if (pending.has(id)) return;
        pending.add(id);
        if (isCurrent()) setResolvingIds(previous => new Set(previous).add(id));
        try {
            return await updateStatus(id, status);
        } finally {
            pending.delete(id);
            if (isCurrent()) setResolvingIds(previous => {
                const next = new Set(previous);
                next.delete(id);
                return next;
            });
        }
    }, [updateStatus, isCurrent]);

    const deleteComment = useCallback(async (id: string): Promise<void> => {
        const pending = pendingDelete.current;
        if (pending.has(id)) return;
        pending.add(id);
        if (isCurrent()) setDeletingIds(previous => new Set(previous).add(id));
        try {
            await remove(id);
        } finally {
            pending.delete(id);
            if (isCurrent()) setDeletingIds(previous => {
                const next = new Set(previous);
                next.delete(id);
                return next;
            });
        }
    }, [remove, isCurrent]);

    const resolveComment = useCallback((id: string) => changeStatus(id, 'resolved'), [changeStatus]);
    const unresolveComment = useCallback((id: string) => changeStatus(id, 'open'), [changeStatus]);
    return { resolvingIds, deletingIds, deleteComment, resolveComment, unresolveComment };
}
