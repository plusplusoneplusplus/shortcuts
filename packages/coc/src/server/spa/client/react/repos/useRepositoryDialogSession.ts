import { useCallback, useEffect, useRef } from 'react';
import type { ServerSelection } from './useServerSelection';

/** A completed request may only update the dialog session that started it. */
export function useRepositoryDialogSession(open: boolean, server: ServerSelection, contextKey?: string) {
    const identity = JSON.stringify([open, server.selected.id, server.selected.baseUrl, contextKey]);
    const session = useRef({ identity, generation: 0, open });
    if (session.current.identity !== identity) {
        session.current = { identity, generation: session.current.generation + 1, open };
    }
    const invalidate = useCallback(() => { session.current.generation++; }, []);
    useEffect(() => invalidate, [invalidate]);
    const capture = useCallback(() => {
        const generation = session.current.generation;
        return () => session.current.open && session.current.generation === generation;
    }, []);
    return { capture, invalidate };
}
