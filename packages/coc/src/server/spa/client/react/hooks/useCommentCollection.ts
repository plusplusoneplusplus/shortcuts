import { useCallback, useEffect, useRef, useState } from 'react';

/** Transport and comment shapes stay in the domain hook. */
export function useCommentCollection<T>(
    load: () => Promise<T[]>,
    isCurrent: () => boolean,
    errorMessage: (error: unknown) => string,
) {
    const [comments, setComments] = useState<T[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const requestId = useRef(0);

    const refresh = useCallback(async () => {
        const request = ++requestId.current;
        if (!isCurrent()) return;
        setLoading(true);
        setError(null);
        try {
            const data = await load();
            if (isCurrent() && request === requestId.current) setComments(data);
        } catch (err) {
            if (isCurrent() && request === requestId.current) {
                setError(errorMessage(err));
                setComments([]);
            }
        } finally {
            if (isCurrent() && request === requestId.current) setLoading(false);
        }
    }, [load, isCurrent, errorMessage]);

    useEffect(() => {
        setComments([]);
        void refresh();
        return () => { ++requestId.current; };
    }, [refresh]);

    return { comments, setComments, loading, error, refresh };
}
