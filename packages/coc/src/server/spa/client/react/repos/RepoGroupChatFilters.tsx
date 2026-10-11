import type { RepoGroupChatSource, RepoGroupChatStatus } from '@plusplusoneplusplus/coc-client';
import { useBreakpoint } from '../hooks/ui/useBreakpoint';
import type { RepoGroupChatFeedFilters } from './useRepoGroupChatFeed';

export function RepoGroupChatFilters({ filters, sources, onChange }: {
    filters: RepoGroupChatFeedFilters;
    sources: RepoGroupChatSource[];
    onChange: (filters: RepoGroupChatFeedFilters) => void;
}) {
    const { isMobile, isTablet } = useBreakpoint();
    const controls = <div className="flex flex-wrap gap-1 px-2 py-1 text-xs">
        <select aria-label="Repo filter" value={filters.owners?.[0] ?? ''} onChange={e =>
            onChange({ ...filters, owners: e.target.value ? [e.target.value] : undefined })}>
            <option value="">All repos</option>
            {sources.map(source => <option key={source.workspaceId} value={source.workspaceId}>
                {source.role === 'group' ? 'Group' : source.name ?? source.workspaceId}
            </option>)}
        </select>
        <select aria-label="Status filter" value={filters.statuses?.[0] ?? ''} onChange={e =>
            onChange({ ...filters, statuses: e.target.value ? [e.target.value as RepoGroupChatStatus] : undefined })}>
            <option value="">All statuses</option>
            {(['running', 'queued', 'completed', 'failed', 'cancelled'] as const).map(status =>
                <option key={status} value={status}>{status}</option>)}
        </select>
        <select aria-label="Archived filter" value={filters.archived ?? 'exclude'} onChange={e =>
            onChange({ ...filters, archived: e.target.value === 'only' ? 'only' : e.target.value === 'include' ? 'include' : 'exclude' })}>
            <option value="exclude">Unarchived</option><option value="only">Archived</option><option value="include">All chats</option>
        </select>
    </div>;
    return <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
        <input type="search" aria-label="Search group conversations" placeholder="Search conversation text"
            className="w-full px-2 py-1 text-xs bg-transparent"
            value={filters.q ?? ''} onChange={e => onChange({ ...filters, q: e.target.value })} />
        {isMobile || isTablet ? <details><summary className="px-2 text-xs">Filters</summary>{controls}</details> : controls}
    </div>;
}
