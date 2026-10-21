import { useEffect, useMemo, useRef } from 'react';

/** Marking the active file uses the host's normal selection path, in rail order. */
export function useReviewFileNavigation({ identity, selectedPath, paths, reviewedFiles, toggleReviewed, navigate }: {
    identity: string;
    selectedPath: string | null | undefined;
    paths: readonly string[];
    reviewedFiles: ReadonlySet<string>;
    toggleReviewed: (path: string) => void | Promise<void>;
    navigate: (path: string, target: 'first') => void;
}) {
    const scope = useMemo(() => ({}), [identity, selectedPath]);
    const latest = useRef({ scope, paths, reviewedFiles, toggleReviewed, navigate });
    latest.current = { scope, paths, reviewedFiles, toggleReviewed, navigate };
    const action = useRef(0);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    return (path: string) => {
        if (!mounted.current || latest.current.scope !== scope) return;
        const { paths, reviewedFiles, toggleReviewed, navigate } = latest.current;
        const ticket = ++action.current;
        const index = paths.indexOf(path);
        const next = path === selectedPath && !reviewedFiles.has(path) && index >= 0 ? paths[index + 1] : undefined;
        const advance = () => {
            if (next && mounted.current && latest.current.scope === scope && ticket === action.current && latest.current.paths.includes(next)) {
                latest.current = { ...latest.current, scope: {} };
                navigate(next, 'first');
            }
        };
        try {
            const result = toggleReviewed(path);
            // Progress hooks update locally and persist separately. Async hosts only
            // navigate on success; failures and superseded actions stay in place.
            if (result) void result.then(advance, () => {});
            else advance();
        } catch { /* Failed review mutations must not change the selected file. */ }
    };
}
