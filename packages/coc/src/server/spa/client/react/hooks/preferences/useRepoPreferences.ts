import { useEffect, useState } from 'react';
import type { CocClient, PerRepoPreferences } from '@plusplusoneplusplus/coc-client';
import { getRepoPreferences, peekRepoPreferences } from '../../api/repoPreferences';
import { useCocClient } from '../../repos/cloneRouting';

/** Shares one owner/workspace read; provider and model choices derive from the same response. */
export function useRepoPreferences(workspaceId?: string, owner?: CocClient): PerRepoPreferences | undefined {
    const routedClient = useCocClient(workspaceId);
    const client = owner ?? routedClient;
    const [snapshot, setSnapshot] = useState(() => ({
        client,
        workspaceId,
        preferences: workspaceId ? peekRepoPreferences(client, workspaceId) : undefined,
    }));

    useEffect(() => {
        let cancelled = false;
        setSnapshot({ client, workspaceId, preferences: workspaceId ? peekRepoPreferences(client, workspaceId) : undefined });
        if (!workspaceId) return;
        getRepoPreferences(client, workspaceId)
            .then(preferences => {
                if (!cancelled) setSnapshot({ client, workspaceId, preferences });
            })
            .catch(() => { /* preferences are optional; failures are not cached */ });
        return () => { cancelled = true; };
    }, [client, workspaceId]);

    return snapshot.client === client && snapshot.workspaceId === workspaceId
        ? snapshot.preferences
        : workspaceId ? peekRepoPreferences(client, workspaceId) : undefined;
}
