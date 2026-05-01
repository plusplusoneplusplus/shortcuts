import { useEffect, useState } from 'react';
import { getApiBase } from '../../utils/config';

let cachedEnabled: boolean | null = null;
let fetchPromise: Promise<boolean> | null = null;

async function fetchHtmlEmbedEnabled(): Promise<boolean> {
    try {
        const res = await fetch(getApiBase() + '/preferences');
        if (!res.ok) return false;
        const data = await res.json();
        return data?.htmlEmbed?.enabled === true;
    } catch {
        return false;
    }
}

function getOrFetch(): Promise<boolean> {
    if (cachedEnabled !== null) return Promise.resolve(cachedEnabled);
    if (!fetchPromise) {
        fetchPromise = fetchHtmlEmbedEnabled().then(enabled => {
            cachedEnabled = enabled;
            fetchPromise = null;
            return enabled;
        });
    }
    return fetchPromise;
}

export function invalidateHtmlEmbedPreference(): void {
    cachedEnabled = null;
    fetchPromise = null;
}

export function useHtmlEmbedPreference(workspaceId?: string): boolean {
    const [enabled, setEnabled] = useState(cachedEnabled ?? false);

    useEffect(() => {
        if (!workspaceId) {
            setEnabled(false);
            return;
        }
        let cancelled = false;
        getOrFetch().then(value => {
            if (!cancelled) setEnabled(value);
        });
        return () => {
            cancelled = true;
        };
    }, [workspaceId]);

    return enabled;
}
