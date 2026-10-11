/**
 * RepoGroupChatList — the repo group's combined chat list (canvas option B).
 *
 * Rows come from `useRepoGroupChatFeed`: chats owned by the group itself and by
 * every explicit member, in Running, Queued, Pinned and History sections with
 * history in global latest-activity order. A member row carries a plain, muted
 * `repo /` prefix on the title line; group-owned rows show only the title. Full
 * owner and server details sit in the row's tooltip and accessible label, and the
 * owning server is named in the list header.
 *
 * Rows keep the native status dot, mode pill, time and selection styling from
 * `chat-row-style`. The list is navigation only: it never mutates chats or queues.
 */
import { useMemo, useState } from 'react';
import { cn } from '../ui';
import { formatRelativeTime, statusLabel } from '../utils/format';
import { getTaskModeKey, getTaskModeLabel } from '../features/chat/ChatListPane';
import { getChatRowTitle } from '../features/chat/latestSentinelChat';
import { getTaskChatProvider } from '../features/chat/ProviderBadge';
import {
    CHAT_ROW_LAYOUT_CLASSES,
    CHAT_ROW_SELECTED_CLASSES,
    getChatRowDotClasses,
    getChatRowModeBadgeClasses,
} from '../features/chat/chat-row-style';
import type { RepoGroupChatFeedState } from './useRepoGroupChatFeed';
import type { RepoGroupChatFeedFilters } from './useRepoGroupChatFeed';
import { RepoGroupChatFilters } from './RepoGroupChatFilters';
import type { RepoGroupChatRow } from './repoGroupChatFeed';
import {
    buildRepoGroupOwnerLabels,
    isUnseenGroupChat,
    partitionPinnedRows,
    type RepoGroupOwnerLabel,
} from './repoGroupChatRowLabels';

export interface RepoGroupChatListProps {
    feed: Pick<RepoGroupChatFeedState, 'model' | 'status' | 'error' | 'loadingMore' | 'loadMore'>;
    /** Owning server, named in the header and every row's owner details. */
    serverLabel: string;
    selectedKey: string | null;
    onSelect: (row: RepoGroupChatRow) => void;
    filters?: RepoGroupChatFeedFilters;
    onFiltersChange?: (filters: RepoGroupChatFeedFilters) => void;
}

type SectionKey = 'running' | 'queued' | 'pinned' | 'history';

const SECTION_LABELS: Record<SectionKey, string> = {
    running: 'Running',
    queued: 'Queued',
    pinned: 'Pinned',
    history: 'History',
};

function rowTime(row: RepoGroupChatRow): string {
    const item = row.item;
    if (row.section === 'running') return statusLabel('running', item?.type);
    const ts = item?.completedAt ?? item?.endTime ?? item?.startedAt ?? item?.startTime ?? item?.createdAt;
    return ts ? formatRelativeTime(new Date(ts).toISOString()) : '';
}

function GroupChatRow({ row, owner, serverLabel, selected, onSelect, snippet, unavailable }: {
    row: RepoGroupChatRow;
    owner: RepoGroupOwnerLabel | undefined;
    serverLabel: string;
    selected: boolean;
    onSelect: (row: RepoGroupChatRow) => void;
    snippet?: string;
    unavailable?: boolean;
}) {
    const task = row.item;
    const isRunning = row.section === 'running';
    const isQueued = row.section === 'queued';
    const isFailed = !isRunning && task?.status === 'failed';
    const isUnseen = isUnseenGroupChat(row);
    const isPinned = !!task?.pinnedAt && !isQueued;
    const title = getChatRowTitle(task);
    const ownerName = owner?.full ?? row.ownerName ?? row.ownerWorkspaceId;
    const ownerDetails = `${ownerName} · ${serverLabel}`;
    const modeKey = getTaskModeKey(task);
    return (
        <div
            role="option"
            tabIndex={0}
            aria-selected={selected}
            aria-label={`${title} — ${ownerDetails}${unavailable ? ' — unavailable' : ''}`}
            title={`${title}\n${ownerDetails}`}
            className={cn(
                CHAT_ROW_LAYOUT_CLASSES,
                'outline-none focus-visible:ring-2 focus-visible:ring-[#0078d4]/60',
                task?.archived && 'opacity-70',
                isPinned && 'border-l-2 border-l-amber-400 dark:border-l-amber-500',
                selected && CHAT_ROW_SELECTED_CLASSES,
            )}
            onClick={() => onSelect(row)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(row);
                }
            }}
            data-testid="repo-group-chat-row"
            data-chat-key={row.key}
            data-owner={row.ownerWorkspaceId}
            data-owner-role={row.ownerRole}
            data-section={row.section}
            data-unseen={isUnseen || undefined}
            data-unavailable={unavailable || undefined}
        >
            <span
                className={getChatRowDotClasses({ isRunning, isQueued, isFailed, provider: getTaskChatProvider(task) })}
                aria-hidden="true"
            />
            <span className={getChatRowModeBadgeClasses(modeKey)} aria-hidden="true">{getTaskModeLabel(task)}</span>
            <span className="min-w-0 flex items-center gap-1 overflow-hidden">
                {isUnseen && (
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[#0078d4] dark:bg-[#3794ff]" data-testid="unseen-dot" />
                )}
                {isPinned && (
                    <span className="shrink-0 text-[10px] text-amber-500 dark:text-amber-400" aria-hidden="true">📌</span>
                )}
                {owner?.prefix && (
                    <span
                        className="shrink-0 whitespace-nowrap text-[#848484] dark:text-[#8f8f8f]"
                        data-testid="repo-group-chat-owner-prefix"
                    >
                        {owner.prefix} /
                    </span>
                )}
                <span
                    className={cn(
                        'chat-title truncate text-[#1e1e1e] dark:text-[#cccccc]',
                        isUnseen && 'font-semibold',
                        isFailed && 'text-red-700 dark:text-red-400',
                    )}
                >
                    {title}
                    {unavailable && <span className="ml-1 text-amber-700 text-[10px]">unavailable</span>}
                    {snippet && <span className="ml-2 font-normal text-[#848484]" data-testid="repo-group-search-snippet">{snippet}</span>}
                </span>
            </span>
            <span className="chat-row-when text-[10.5px] font-mono tabular-nums whitespace-nowrap text-[#848484] dark:text-[#999]">
                {rowTime(row)}
            </span>
        </div>
    );
}

export function RepoGroupChatList({ feed, serverLabel, selectedKey, onSelect, filters, onFiltersChange }: RepoGroupChatListProps) {
    const { model, status, error, loadingMore, loadMore } = feed;
    const [collapsed, setCollapsed] = useState<Set<SectionKey>>(() => new Set());
    const owners = useMemo(() => buildRepoGroupOwnerLabels(model?.sources ?? []), [model?.sources]);
    const sections = useMemo(() => {
        if (!model) return [] as Array<{ key: SectionKey; rows: RepoGroupChatRow[] }>;
        const { pinned, rest } = partitionPinnedRows(model.history);
        return ([
            { key: 'running', rows: model.running },
            { key: 'queued', rows: model.queued },
            { key: 'pinned', rows: pinned },
            { key: 'history', rows: rest },
        ] as Array<{ key: SectionKey; rows: RepoGroupChatRow[] }>).filter(section => section.rows.length > 0);
    }, [model]);
    const unavailable = (model?.sources ?? []).filter(source => !source.available);

    const toggle = (key: SectionKey) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    return (
        <div className="flex flex-col h-full min-h-0" data-testid="repo-group-chat-list">
            {filters && onFiltersChange && <RepoGroupChatFilters filters={filters} sources={model?.sources ?? []} onChange={onFiltersChange} />}
            <div
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-[#848484] dark:text-[#a0a0a0] border-b border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80"
                data-testid="repo-group-chat-list-header"
            >
                <span className="truncate" title={`Group owned by ${serverLabel}`} data-testid="repo-group-chat-server">
                    {serverLabel}
                </span>
                {model && (
                    <span className="ml-auto font-mono tabular-nums" data-testid="repo-group-chat-total">
                        {model.counts.total}{model.counts.partial || unavailable.length > 0 ? '+' : ''}
                    </span>
                )}
                {model?.counts.unread !== undefined && <span aria-label={`${model.counts.unread} unread chats${model.counts.partial ? ', partial' : ''}`}
                    data-testid="repo-group-chat-unread">{model.counts.unread} unread{model.counts.partial ? '+' : ''}</span>}
            </div>
            {unavailable.length > 0 && (
                <div className="px-3 py-1 text-[10px] text-amber-700 dark:text-amber-400" role="status" data-testid="repo-group-chat-partial">
                    Partial: {unavailable.map(source => owners.get(source.workspaceId)?.full ?? source.workspaceId).join(', ')} unavailable
                </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto" role="listbox" aria-label="Group chats">
                {status === 'loading' && !model && (
                    <div className="p-4 text-sm text-[#848484]" data-testid="repo-group-chat-loading">Loading chats…</div>
                )}
                {status === 'error' && !model && (
                    <div className="p-4 text-sm text-red-600 dark:text-red-400" role="alert" data-testid="repo-group-chat-error">
                        Could not load group chats{error ? `: ${error}` : ''}
                    </div>
                )}
                {model && sections.length === 0 && (
                    <div className="p-4 text-sm text-[#848484]" data-testid="repo-group-chat-empty">
                        {unavailable.length > 0 ? 'No chats from the available repos.' : 'No chats yet.'}
                    </div>
                )}
                {sections.map(section => {
                    const open = !collapsed.has(section.key);
                    return (
                        <div key={section.key} data-section={section.key} role="group" aria-label={SECTION_LABELS[section.key]}>
                            <div className="sticky top-0 z-[2] flex items-center gap-1.5 px-3 py-1 border-b backdrop-blur-md bg-white/[0.94] dark:bg-[#1e1e1e]/[0.94] border-[#e0e0e0]/80 dark:border-[#3c3c3c]/80">
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 text-[10px] leading-none font-mono font-semibold uppercase tracking-[0.1em] text-[#848484] dark:text-[#a0a0a0] hover:text-[#0078d4] dark:hover:text-[#3794ff]"
                                    onClick={() => toggle(section.key)}
                                    aria-expanded={open}
                                    data-testid={`repo-group-${section.key}-section-toggle`}
                                >
                                    <span className="text-[10px]">{open ? '▼' : '▶'}</span>
                                    {SECTION_LABELS[section.key]}
                                </button>
                                <span className="ml-auto text-[10px] leading-none font-mono tabular-nums text-[#848484] dark:text-[#a0a0a0]">
                                    {section.rows.length}
                                </span>
                            </div>
                            {open && section.rows.map(row => (
                                <GroupChatRow
                                    key={row.key}
                                    row={row}
                                    snippet={model?.snippets?.[row.ownerWorkspaceId]?.[row.canonicalId]}
                                    unavailable={model?.sources.find(source => source.workspaceId === row.ownerWorkspaceId)?.available === false}
                                    owner={owners.get(row.ownerWorkspaceId)}
                                    serverLabel={serverLabel}
                                    selected={row.key === selectedKey}
                                    onSelect={onSelect}
                                />
                            ))}
                        </div>
                    );
                })}
                {model?.hasMore && (
                    <div className="px-4 py-2">
                        <button
                            type="button"
                            onClick={() => void loadMore()}
                            disabled={loadingMore}
                            className="w-full text-xs text-[#848484] dark:text-[#858585] hover:text-[#3c3c3c] dark:hover:text-[#cccccc] disabled:opacity-50 disabled:cursor-not-allowed py-1"
                            data-testid="repo-group-chat-load-more"
                        >
                            {loadingMore ? 'Loading…' : 'Load more'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
