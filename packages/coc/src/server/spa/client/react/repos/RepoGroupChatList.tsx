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
import { cn, Dialog } from '../ui';
import { applyRepoGroupChatAction, applyRepoGroupQueueControl, groupChatActionAllowed, type RepoGroupChatAction, type RepoGroupChatActionResult } from './repoGroupChatActions';
import { groupRepoGroupChatRows } from './repoGroupChatHierarchy';
import { buildRepoGroupChatHash } from '../layout/dashboardRoutes';
import { repoHashBase } from '../layout/routePath';
import { buildRemoteCloneKey, parseRemoteCloneKey } from './cloneIdentity';
import { useChatFoldersEnabled } from '../hooks/feature-flags/useChatFoldersEnabled';
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
    baseUrl?: string;
    refresh?: () => Promise<void>;
    groupSelectionId?: string;
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

function GroupChatRow({ row, owner, serverLabel, selected, onSelect, snippet, unavailable, groupSelectionId }: {
    row: RepoGroupChatRow;
    owner: RepoGroupOwnerLabel | undefined;
    serverLabel: string;
    selected: boolean;
    onSelect: (row: RepoGroupChatRow) => void;
    snippet?: string;
    unavailable?: boolean;
    groupSelectionId?: string;
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
                {groupSelectionId && task.parentProcessId && task.parentOwnerWorkspaceId
                    && task.parentOwnerWorkspaceId !== row.ownerWorkspaceId && <a
                        className="text-[10px] text-[#848484] shrink-0"
                        onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                        href={task.parentOwnerWorkspaceId === task.groupWorkspaceId
                            ? repoHashBase(groupSelectionId) + '/chats/' + encodeURIComponent(task.parentProcessId)
                            : buildRepoGroupChatHash(groupSelectionId, task.parentOwnerWorkspaceId, task.parentProcessId)}>
                        Delegated from
                    </a>}
            </span>
            <span className="chat-row-when text-[10.5px] font-mono tabular-nums whitespace-nowrap text-[#848484] dark:text-[#999]">
                {rowTime(row)}
            </span>
        </div>
    );
}

export function RepoGroupChatList({ feed, serverLabel, selectedKey, onSelect, filters, onFiltersChange, baseUrl, refresh, groupSelectionId }: RepoGroupChatListProps) {
    const { model, status, error, loadingMore, loadMore } = feed;
    const foldersEnabled = useChatFoldersEnabled();
    const [collapsed, setCollapsed] = useState<Set<SectionKey>>(() => new Set());
    const [containersCollapsed, setContainersCollapsed] = useState<Set<string>>(() => new Set());
    const [selecting, setSelecting] = useState(false);
    const [selection, setSelection] = useState<Set<string>>(() => new Set());
    const [pendingAction, setPendingAction] = useState<RepoGroupChatAction | null>(null);
    const [busy, setBusy] = useState(false);
    const [actionResult, setActionResult] = useState<RepoGroupChatActionResult | null>(null);
    const allRows = model ? [...model.running, ...model.queued, ...model.history] : [];
    const selectedRows = allRows.filter(row => selection.has(row.key));
    const perform = async (action: RepoGroupChatAction) => {
        if (busy) return;
        setBusy(true);
        try {
            const result = await applyRepoGroupChatAction(selectedRows, action, model?.sources ?? [], baseUrl);
            setActionResult(result);
            setSelection(new Set(result.failed.map(failure => failure.key)));
            try { await refresh?.(); } catch (error) {
                setActionResult({ ...result, failed: [...result.failed, {
                    key: '', ownerWorkspaceId: '', error: error instanceof Error ? error.message : 'Could not refresh group chats.',
                }] });
            }
        } finally { setBusy(false); setPendingAction(null); }
    };
    const select = (row: RepoGroupChatRow) => {
        if (!selecting) { onSelect(row); return; }
        setSelection(prev => {
            const next = new Set(prev);
            if (next.has(row.key)) next.delete(row.key); else next.add(row.key);
            return next;
        });
    };
    const owners = useMemo(() => buildRepoGroupOwnerLabels(model?.sources ?? []), [model?.sources]);
    const sections = useMemo(() => {
        const sections = (['running', 'queued', 'pinned', 'history'] as const).map(key => ({
            key, rows: [] as RepoGroupChatRow[], containers: [] as ReturnType<typeof groupRepoGroupChatRows>,
        }));
        if (!model) return sections;
        const { pinned, rest } = partitionPinnedRows(model.history);
        const containers = groupRepoGroupChatRows([...model.running, ...model.queued, ...pinned, ...rest], !!filters?.q, foldersEnabled);
        for (const container of containers) {
            const key: SectionKey = container.rows.some(row => row.section === 'running') ? 'running'
                : container.rows.some(row => row.section === 'queued') ? 'queued'
                : container.rows.some(row => row.item.pinnedAt && !row.item.archived) ? 'pinned' : 'history';
            const section = sections.find(section => section.key === key)!;
            section.containers.push(container);
            section.rows.push(...container.rows);
        }
        return sections.filter(section => section.rows.length);
    }, [model, filters?.q, foldersEnabled]);
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
                <button type="button" onClick={() => { setSelecting(!selecting); setSelection(new Set()); }}
                    aria-pressed={selecting}>Select chats</button>
            </div>
            {selecting && <div className="flex flex-wrap gap-2 px-2 py-1 text-xs" aria-label="Selected chat actions">
                <span>{selectedRows.length} selected</span>
                {(['pin', 'unpin', 'archive', 'unarchive', 'delete', 'cancel'] as const).map(action =>
                    <button key={action} disabled={busy || !selectedRows.length || !selectedRows.every(row =>
                        groupChatActionAllowed(row, action, model?.sources ?? []))}
                        onClick={() => action === 'delete' || action === 'cancel' ? setPendingAction(action) : void perform(action)}>
                        {action}
                    </button>)}
            </div>}
            {actionResult && <div role="status" className="px-2 text-xs">
                {actionResult.succeeded.length} succeeded. {actionResult.failed.map(failure =>
                    `${owners.get(failure.ownerWorkspaceId)?.full ?? failure.ownerWorkspaceId}: ${failure.error}`).join('; ')}
            </div>}
            {groupSelectionId && <details className="px-2 text-xs">
                <summary>Owner queues</summary>
                <div>Queue controls affect one owner only. Reorder in that repo.</div>
                {model?.sources.map(source => <div key={source.workspaceId} className="flex flex-wrap gap-2">
                    <span>{source.role === 'group' ? 'Group' : source.name ?? source.workspaceId}</span>
                    {(['pause', 'resume', 'delay'] as const).map(action => <button key={action}
                        disabled={busy || !source.available || source.stale}
                        onClick={() => {
                            setBusy(true);
                            void applyRepoGroupQueueControl(source, action, model.serverKey, baseUrl, action === 'delay' ? 1 : 0)
                                .then(() => refresh?.())
                                .catch(error => setActionResult({ succeeded: [], failed: [{
                                    key: '', ownerWorkspaceId: source.workspaceId, error: error instanceof Error ? error.message : 'Queue action failed.',
                                }] }))
                                .finally(() => setBusy(false));
                        }}>{action === 'delay' ? 'Delay 1 minute' : action}</button>)}
                    <a href={repoHashBase(parseRemoteCloneKey(groupSelectionId)
                        ? buildRemoteCloneKey(parseRemoteCloneKey(groupSelectionId)!.serverId, source.workspaceId)
                        : source.workspaceId) + '/chats'}>Open queue in repo</a>
                </div>)}
            </details>}
            <Dialog open={!!pendingAction} title={`${pendingAction === 'delete' ? 'Delete' : 'Cancel'} ${selectedRows.length} chats?`}
                onClose={() => { if (!busy) setPendingAction(null); }} disableClose={busy}
                footer={<button disabled={busy} onClick={() => pendingAction && void perform(pendingAction)}>Confirm</button>}>
                Requests go to each selected chat's owner. {pendingAction === 'delete' ? 'Deletion cannot be undone.' : 'Running work will stop.'}
            </Dialog>
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
                            {open && section.containers.map(container => (
                                <div key={container.key}>
                                {container.label && <button type="button" className="px-3 text-xs text-[#848484]"
                                    aria-expanded={!containersCollapsed.has(container.key)}
                                    onClick={() => setContainersCollapsed(prev => {
                                        const next = new Set(prev);
                                        if (next.has(container.key)) next.delete(container.key); else next.add(container.key);
                                        return next;
                                    })}>{container.label} ({container.rows.length})</button>}
                                {(!container.label || !containersCollapsed.has(container.key)) && container.rows.map(row => (
                                <GroupChatRow
                                    key={row.key}
                                    row={row}
                                    snippet={model?.snippets?.[row.ownerWorkspaceId]?.[row.canonicalId]}
                                    unavailable={model?.sources.find(source => source.workspaceId === row.ownerWorkspaceId)?.available === false}
                                    groupSelectionId={groupSelectionId}
                                    owner={owners.get(row.ownerWorkspaceId)}
                                    serverLabel={serverLabel}
                                    selected={selecting ? selection.has(row.key) : row.key === selectedKey}
                                    onSelect={select}
                                />
                                ))}
                                </div>
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
