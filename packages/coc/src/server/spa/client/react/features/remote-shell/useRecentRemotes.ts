import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSpaCocClient } from '../../api/cocClient';
import { groupKey, type RepoGroup } from '../../repos/repoGrouping';

export const RECENT_REMOTE_LIMIT = 4;
export const MAX_RECENT_REMOTES = 8;

export function mergeRecentRemoteUse(keys: readonly string[], key: string, max = MAX_RECENT_REMOTES): string[] {
    const trimmed = key.trim();
    if (!trimmed) return keys.slice(0, max);
    return [trimmed, ...keys.filter(k => k !== trimmed)].slice(0, max);
}

export function getPresentRecentRemoteKeys(keys: readonly string[], groups: readonly RepoGroup[]): string[] {
    const present = new Set(groups.map(groupKey));
    const seen = new Set<string>();
    const result: string[] = [];
    for (const key of keys) {
        if (!present.has(key) || seen.has(key)) continue;
        seen.add(key);
        result.push(key);
    }
    return result;
}

export function resolveRecentRemoteGroups(
    groups: readonly RepoGroup[],
    keys: readonly string[],
    recentLimit = RECENT_REMOTE_LIMIT,
): { recentGroups: RepoGroup[]; remainingGroups: RepoGroup[]; recentKeys: string[] } {
    const recentKeys = getPresentRecentRemoteKeys(keys, groups);
    const groupsByKey = new Map(groups.map(group => [groupKey(group), group]));
    const hasSavedRecents = recentKeys.length > 0;
    const recentGroups = hasSavedRecents
        ? recentKeys.slice(0, recentLimit).map(key => groupsByKey.get(key)).filter((group): group is RepoGroup => !!group)
        : groups.slice(0, recentLimit);
    const recentSet = new Set(recentGroups.map(groupKey));
    return {
        recentGroups,
        remainingGroups: groups.filter(group => !recentSet.has(groupKey(group))),
        recentKeys,
    };
}

export function useRecentRemotes(groups: readonly RepoGroup[]): {
    recentGroups: RepoGroup[];
    remainingGroups: RepoGroup[];
    recentKeys: string[];
    recordUse: (key: string) => void;
    loaded: boolean;
} {
    const [storedKeys, setStoredKeys] = useState<string[]>([]);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        let cancelled = false;
        getSpaCocClient().preferences.getGlobal()
            .then(prefs => {
                if (cancelled) return;
                setStoredKeys(Array.isArray(prefs.recentRemotes)
                    ? prefs.recentRemotes.filter((key): key is string => typeof key === 'string' && key.length > 0)
                    : []);
            })
            .catch(() => {
                if (!cancelled) setStoredKeys([]);
            })
            .finally(() => {
                if (!cancelled) setLoaded(true);
            });
        return () => { cancelled = true; };
    }, []);

    const resolved = useMemo(
        () => resolveRecentRemoteGroups(groups, storedKeys),
        [groups, storedKeys],
    );

    const recordUse = useCallback((key: string) => {
        setStoredKeys(prev => {
            const next = mergeRecentRemoteUse(prev, key);
            getSpaCocClient().preferences.patchGlobal({ recentRemotes: next }).catch(() => {});
            return next;
        });
    }, []);

    return { ...resolved, recordUse, loaded };
}
