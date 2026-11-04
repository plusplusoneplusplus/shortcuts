import { useCallback, useEffect, useMemo, useRef } from 'react';

/** Capture this predicate before awaiting; leaving and returning to a scope is a new request lifetime. */
export function useRequestScope(owner: object, key: string) {
    const token = useMemo(() => ({}), [owner, key]);
    const current = useRef(token);
    current.current = token;
    const mounted = useRef(false);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    return useCallback(() => mounted.current && current.current === token, [token]);
}
