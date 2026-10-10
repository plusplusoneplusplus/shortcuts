import { useCallback, useEffect, useState } from 'react';
import type { RepoGroupAccessResponse } from '@plusplusoneplusplus/coc-client';
import { getRepoGroupAccess } from './repoGroupAccess';

export function useRepoGroupAccess(groupId: string | undefined, baseUrl: string | undefined, enabled = true) {
    const [access, setAccess] = useState<RepoGroupAccessResponse>();
    const [error, setError] = useState<string>();
    const [revision, setRevision] = useState(0);
    const refresh = useCallback(() => setRevision(value => value + 1), []);
    useEffect(() => {
        setAccess(undefined);
        setError(undefined);
        if (!enabled) return;
        let cancelled = false;
        Promise.resolve().then(() => getRepoGroupAccess(groupId, baseUrl)).then(value => {
            if (!cancelled) setAccess(value);
        }).catch((err: unknown) => {
            if (cancelled) return;
            // Older owning servers keep their existing policy and UI.
            if ((err as { status?: number })?.status === 404) setAccess({ enabled: false, members: [] });
            else setError('Sharing status unavailable. The owning server will validate write access when you save.');
        });
        return () => { cancelled = true; };
    }, [groupId, baseUrl, enabled, revision]);
    return { access, error, refresh };
}
