import { useCallback, useState } from 'react';
import type { RepoGroupChatFeedFilters } from './useRepoGroupChatFeed';
import type { RepoGroupChatStatus } from '@plusplusoneplusplus/coc-client';

const statuses: readonly RepoGroupChatStatus[] = ['queued', 'running', 'completed', 'failed', 'cancelled'];

function load(scope: string): RepoGroupChatFeedFilters {
    try {
        const raw = localStorage.getItem(`coc.group-chat-filters:${scope}`);
        if (!raw) return {};
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== 'object') return {};
        const filter = value as Record<string, unknown>;
        return {
            ...(typeof filter.q === 'string' ? { q: filter.q } : {}),
            ...(Array.isArray(filter.owners) && filter.owners.every(owner => typeof owner === 'string') ? { owners: filter.owners } : {}),
            ...(Array.isArray(filter.statuses) ? { statuses: filter.statuses.filter((s): s is RepoGroupChatStatus => statuses.includes(s)) } : {}),
            ...(filter.archived === 'only' || filter.archived === 'include' ? { archived: filter.archived } : {}),
        };
    } catch (error) {
        console.warn('Could not restore group chat filters.', error);
        return {};
    }
}

export function useRepoGroupChatFilters(scope: string): [RepoGroupChatFeedFilters, (filters: RepoGroupChatFeedFilters) => void] {
    const [state, setState] = useState(() => ({ scope, filters: load(scope) }));
    const filters = state.scope === scope ? state.filters : load(scope);
    const setFilters = useCallback((next: RepoGroupChatFeedFilters) => {
        setState({ scope, filters: next });
        try {
            localStorage.setItem(`coc.group-chat-filters:${scope}`, JSON.stringify(next));
        } catch (error) {
            console.warn('Could not save group chat filters.', error);
        }
    }, [scope]);
    return [filters, setFilters];
}
