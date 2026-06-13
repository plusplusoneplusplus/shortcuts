/**
 * NativeCopilotSessionsPanel — read-only dashboard view for native GitHub
 * Copilot CLI sessions scoped to the active workspace.
 *
 * Native sessions are external data read from the server user's
 * `~/.copilot/session-store.db`. This surface intentionally renders no CoC
 * chat actions (no follow-up, archive, pin, delete, resume, retry, or turn
 * actions) and labels every session as an external read-only record. All
 * stored text renders as plain pre-wrapped text so stored HTML/scripts never
 * execute.
 */

import { useCallback, useEffect, useState } from 'react';
import type {
    ListNativeCopilotSessionsResponse,
    NativeCopilotSessionDetail,
    NativeCopilotSessionListItem,
    NativeCopilotSessionsUnavailableReason,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';
import { Button, Spinner, cn } from '../../ui';
import { useNativeCopilotSessionsEnabled } from '../../hooks/feature-flags/useNativeCopilotSessionsEnabled';
import { buildNativeCopilotSessionHash, parseNativeCopilotSessionDeepLink } from '../../layout/Router';

const READ_ONLY_TOOLTIP = 'This data is read from the local native Copilot CLI session store (~/.copilot/session-store.db) and cannot be modified from CoC.';

interface NativeCopilotSessionsPanelProps {
    workspaceId: string;
}

interface ListFilters {
    q: string;
    sessionId: string;
    branch: string;
    from: string;
    to: string;
}

const EMPTY_FILTERS: ListFilters = { q: '', sessionId: '', branch: '', from: '', to: '' };

function formatTimestamp(value: string | null): string {
    if (!value) return '—';
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return value;
    return new Date(parsed).toLocaleString();
}

function unavailableCopy(reason: NativeCopilotSessionsUnavailableReason | undefined): { title: string; body: string } {
    if (reason === 'db-missing') {
        return {
            title: 'Native session store not found',
            body: 'No native Copilot CLI session store exists at ~/.copilot/session-store.db on the CoC server. Run the GitHub Copilot CLI at least once to create it.',
        };
    }
    return {
        title: 'Native session store unavailable',
        body: 'The native Copilot CLI session store could not be read. It may be corrupt or use an unsupported schema.',
    };
}

function ReadOnlyBadge() {
    return (
        <span
            data-testid="native-session-readonly-badge"
            title={READ_ONLY_TOOLTIP}
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-800"
        >
            Read-only
        </span>
    );
}

function ExternalLabel() {
    return (
        <span
            data-testid="native-session-external-label"
            title={READ_ONLY_TOOLTIP}
            className="inline-flex items-center rounded-full border border-[#d0d7de] bg-[#f6f8fa] px-1.5 py-px text-[10px] font-medium text-[#57606a]"
        >
            Native Copilot CLI session
        </span>
    );
}

export function NativeCopilotSessionsPanel({ workspaceId }: NativeCopilotSessionsPanelProps) {
    const enabled = useNativeCopilotSessionsEnabled();

    const [filterDraft, setFilterDraft] = useState<ListFilters>(EMPTY_FILTERS);
    const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS);
    const [offset, setOffset] = useState(0);
    const [listLoading, setListLoading] = useState(false);
    const [listError, setListError] = useState<string | null>(null);
    const [listResponse, setListResponse] = useState<ListNativeCopilotSessionsResponse | null>(null);

    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [detail, setDetail] = useState<NativeCopilotSessionDetail | null>(null);

    const loadList = useCallback(async () => {
        if (!enabled) return;
        setListLoading(true);
        setListError(null);
        try {
            const response = await getSpaCocClient().nativeCopilotSessions.list(workspaceId, {
                q: filters.q || undefined,
                sessionId: filters.sessionId || undefined,
                branch: filters.branch || undefined,
                from: filters.from ? `${filters.from}T00:00:00.000Z` : undefined,
                to: filters.to ? `${filters.to}T23:59:59.999Z` : undefined,
                offset,
            });
            setListResponse(response);
        } catch (error) {
            setListError(error instanceof Error ? error.message : String(error));
            setListResponse(null);
        } finally {
            setListLoading(false);
        }
    }, [enabled, workspaceId, filters, offset]);

    useEffect(() => { void loadList(); }, [loadList]);

    // Reset paging/filters when the workspace changes. Selection is driven by
    // the URL hash (see the deep-link sync effect below).
    useEffect(() => {
        setDetail(null);
        setOffset(0);
        setFilterDraft(EMPTY_FILTERS);
        setFilters(EMPTY_FILTERS);
    }, [workspaceId]);

    // Deep-link: keep the selected session in sync with the URL hash
    // (`#repos/{wsId}/copilot-sessions/{sessionId}`) so selections survive
    // refresh/back/forward and can be shared as links.
    useEffect(() => {
        const apply = () => {
            const parsed = parseNativeCopilotSessionDeepLink(window.location.hash);
            const next = parsed && parsed.workspaceId === workspaceId ? parsed.sessionId : null;
            setSelectedSessionId(prev => (prev === next ? prev : next));
        };
        apply();
        window.addEventListener('hashchange', apply);
        return () => window.removeEventListener('hashchange', apply);
    }, [workspaceId]);

    // Selecting (or clearing) a session writes the deep-link hash; the
    // hashchange listener above then reconciles `selectedSessionId`.
    const selectSession = useCallback((sessionId: string | null) => {
        setSelectedSessionId(sessionId);
        const next = buildNativeCopilotSessionHash(workspaceId, sessionId);
        if (window.location.hash !== next) {
            window.location.hash = next;
        }
    }, [workspaceId]);

    useEffect(() => {
        if (!enabled || !selectedSessionId) {
            setDetail(null);
            return;
        }
        let cancelled = false;
        setDetailLoading(true);
        setDetailError(null);
        getSpaCocClient().nativeCopilotSessions.get(workspaceId, selectedSessionId)
            .then(response => {
                if (cancelled) return;
                if (!response.enabled || response.available === false || !response.session) {
                    setDetail(null);
                    setDetailError('This native session is unavailable.');
                    return;
                }
                setDetail(response.session);
            })
            .catch(error => {
                if (cancelled) return;
                setDetail(null);
                const message = error instanceof Error ? error.message : String(error);
                setDetailError(/not found/i.test(message)
                    ? 'Session not found in this workspace.'
                    : message);
            })
            .finally(() => { if (!cancelled) setDetailLoading(false); });
        return () => { cancelled = true; };
    }, [enabled, workspaceId, selectedSessionId]);

    if (!enabled) {
        return (
            <div className="flex h-full items-center justify-center p-6" data-testid="native-sessions-disabled-by-flag">
                <div className="max-w-md rounded-lg border border-[#d0d7de] bg-white p-5 text-center">
                    <h2 className="text-base font-semibold">Copilot Sessions is disabled</h2>
                    <p className="mt-2 text-sm text-[#57606a]">
                        Enable the <code>features.nativeCopilotSessions</code> flag in Admin to browse native
                        GitHub Copilot CLI sessions for this workspace in read-only mode.
                    </p>
                </div>
            </div>
        );
    }

    const unavailable = listResponse && (listResponse.enabled === false || listResponse.available === false);
    const items = listResponse?.items ?? [];
    const total = listResponse?.total ?? 0;
    const limit = listResponse?.limit ?? 50;
    const hasFilters = Boolean(filters.q || filters.sessionId || filters.branch || filters.from || filters.to);

    const applyFilters = (e: React.FormEvent) => {
        e.preventDefault();
        setOffset(0);
        setFilters(filterDraft);
    };

    const listPane = (
        <div className="flex min-h-0 flex-1 flex-col lg:border-r lg:border-[#d0d7de]">
            <div className="border-b border-[#d0d7de] bg-white px-2.5 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    <h2 className="text-[13px] font-semibold text-[#1f2328]">Copilot Sessions</h2>
                    <ExternalLabel />
                    <ReadOnlyBadge />
                    <span className="ml-auto inline-flex items-center rounded-full bg-[#f6f8fa] px-1.5 py-0.5 text-[11px] font-medium text-[#57606a]" data-testid="native-sessions-count">
                        {total.toLocaleString()} session{total === 1 ? '' : 's'}
                    </span>
                </div>
                <form className="mt-2 flex flex-wrap items-end gap-1.5" onSubmit={applyFilters} data-testid="native-sessions-filters">
                    <div className="relative min-w-[140px] flex-1 basis-full">
                        <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8c959f]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M10.68 11.74a6 6 0 0 1-7.922-8.982 6 6 0 0 1 8.982 7.922l3.04 3.04a.749.749 0 1 1-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z" />
                        </svg>
                        <input
                            type="text"
                            value={filterDraft.q}
                            onChange={e => setFilterDraft(prev => ({ ...prev, q: e.target.value }))}
                            placeholder="Search indexed content…"
                            className="h-7 w-full rounded-md border border-[#d0d7de] pl-7 pr-2 text-[13px] focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                            data-testid="native-sessions-search-input"
                        />
                    </div>
                    <input
                        type="text"
                        value={filterDraft.sessionId}
                        onChange={e => setFilterDraft(prev => ({ ...prev, sessionId: e.target.value }))}
                        placeholder="Session ID"
                        className="h-7 w-28 rounded-md border border-[#d0d7de] px-2 text-[13px] focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                        data-testid="native-sessions-session-id-input"
                    />
                    <input
                        type="text"
                        value={filterDraft.branch}
                        onChange={e => setFilterDraft(prev => ({ ...prev, branch: e.target.value }))}
                        placeholder="Branch"
                        className="h-7 w-24 rounded-md border border-[#d0d7de] px-2 text-[13px] focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                        data-testid="native-sessions-branch-input"
                    />
                    <label className="flex items-center gap-1 text-[11px] text-[#57606a]">
                        From
                        <input
                            type="date"
                            value={filterDraft.from}
                            onChange={e => setFilterDraft(prev => ({ ...prev, from: e.target.value }))}
                            className="h-7 rounded-md border border-[#d0d7de] px-1.5 text-[13px] focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                        />
                    </label>
                    <label className="flex items-center gap-1 text-[11px] text-[#57606a]">
                        To
                        <input
                            type="date"
                            value={filterDraft.to}
                            onChange={e => setFilterDraft(prev => ({ ...prev, to: e.target.value }))}
                            className="h-7 rounded-md border border-[#d0d7de] px-1.5 text-[13px] focus:border-[#0969da] focus:outline-none focus:ring-1 focus:ring-[#0969da]"
                        />
                    </label>
                    <Button type="submit" size="sm" data-testid="native-sessions-apply-filters">Apply</Button>
                </form>
                {listResponse?.available === true && listResponse.searchIndexAvailable === false && filters.q && (
                    <p className="mt-1 text-xs text-amber-700" data-testid="native-sessions-search-unavailable">
                        Text search is unavailable: the native store has no search index. Metadata filters still apply.
                    </p>
                )}
                {listResponse?.available === true && (listResponse.deduplicatedCount ?? 0) > 0 && (
                    <p className="mt-1 text-[11px] text-[#57606a]" data-testid="native-sessions-deduplicated">
                        {listResponse.deduplicatedCount} session{listResponse.deduplicatedCount === 1 ? '' : 's'} hidden — already tracked in CoC Activity.
                    </p>
                )}
                {listResponse?.available === true && (listResponse.backgroundJobCount ?? 0) > 0 && (
                    <p className="mt-1 text-[11px] text-[#57606a]" data-testid="native-sessions-background-hidden">
                        {listResponse.backgroundJobCount} background job{listResponse.backgroundJobCount === 1 ? '' : 's'} hidden (e.g. title generation).
                    </p>
                )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {listLoading && (
                    <div className="flex items-center justify-center p-8" data-testid="native-sessions-loading"><Spinner /></div>
                )}
                {!listLoading && listError && (
                    <div className="m-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="native-sessions-error">
                        Failed to load native sessions: {listError}
                        <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => void loadList()}>Retry</Button></div>
                    </div>
                )}
                {!listLoading && !listError && unavailable && (
                    <div className="m-3 rounded border border-[#d0d7de] bg-[#f6f8fa] p-4 text-sm" data-testid="native-sessions-unavailable">
                        <h3 className="font-semibold">{unavailableCopy(listResponse?.reason).title}</h3>
                        <p className="mt-1 text-[#57606a]">{unavailableCopy(listResponse?.reason).body}</p>
                    </div>
                )}
                {!listLoading && !listError && !unavailable && items.length === 0 && (
                    <div className="m-3 rounded border border-[#d0d7de] bg-white p-4 text-center text-sm text-[#57606a]" data-testid="native-sessions-empty">
                        {hasFilters
                            ? 'No native Copilot CLI sessions match the current filters.'
                            : 'No native Copilot CLI sessions were found for this workspace.'}
                    </div>
                )}
                {!listLoading && !listError && !unavailable && items.length > 0 && (
                    <table className="w-full border-collapse text-sm" data-testid="native-sessions-table">
                        <tbody>
                            {items.map(item => (
                                <SessionRow
                                    key={item.id}
                                    item={item}
                                    selected={item.id === selectedSessionId}
                                    onSelect={() => selectSession(item.id)}
                                />
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
            {!unavailable && total > limit && (
                <div className="flex items-center justify-between border-t border-[#d0d7de] bg-white px-3 py-2 text-xs" data-testid="native-sessions-pagination">
                    <Button size="sm" variant="secondary" disabled={offset === 0 || listLoading} onClick={() => setOffset(Math.max(0, offset - limit))}>Previous</Button>
                    <span className="text-[#57606a]">{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
                    <Button size="sm" variant="secondary" disabled={offset + limit >= total || listLoading} onClick={() => setOffset(offset + limit)}>Next</Button>
                </div>
            )}
        </div>
    );

    const detailPane = (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#f6f8fa]" data-testid="native-session-detail-pane">
            {!selectedSessionId && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[#57606a]" data-testid="native-session-detail-empty">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eaeef2]">
                        <svg className="h-6 w-6 text-[#8c959f]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                            <path d="M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z" />
                        </svg>
                    </div>
                    <p className="max-w-xs">Select a native session to view its summary and turns.</p>
                </div>
            )}
            {selectedSessionId && detailLoading && (
                <div className="flex flex-1 items-center justify-center p-8" data-testid="native-session-detail-loading"><Spinner /></div>
            )}
            {selectedSessionId && !detailLoading && detailError && (
                <div className="m-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800" data-testid="native-session-detail-error">
                    {detailError}
                </div>
            )}
            {selectedSessionId && !detailLoading && !detailError && detail && (
                <SessionDetailView detail={detail} onBack={() => selectSession(null)} />
            )}
        </div>
    );

    // Wide screens render the searchable table beside the detail; narrow screens
    // stack panes and show one at a time based on selection.
    return (
        <div className="flex h-full min-h-0 flex-col bg-white" data-testid="native-copilot-sessions-panel">
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className={cn(
                    'min-h-0 flex-col lg:w-[42%] lg:min-w-[380px] lg:max-w-[600px] lg:shrink-0',
                    selectedSessionId ? 'hidden lg:flex' : 'flex flex-1',
                )}>
                    {listPane}
                </div>
                <div className={cn('min-h-0 flex-1 flex-col lg:flex', selectedSessionId ? 'flex' : 'hidden lg:flex')}>
                    {detailPane}
                </div>
            </div>
        </div>
    );
}

function SessionRow({ item, selected, onSelect }: {
    item: NativeCopilotSessionListItem;
    selected: boolean;
    onSelect: () => void;
}) {
    const location = item.repository || item.cwd || '';
    return (
        <tr
            data-testid="native-session-row"
            onClick={onSelect}
            className={cn(
                'group cursor-pointer border-b border-[#eaeef2] align-top transition-colors hover:bg-[#f6f8fa]',
                selected && 'bg-[#ddf4ff] hover:bg-[#ddf4ff]',
            )}
        >
            <td className={cn('px-2.5 py-1.5', selected ? 'border-l-2 border-[#0969da]' : 'border-l-2 border-transparent')}>
                <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                            <span className="rounded border border-[#d0d7de] bg-[#f6f8fa] px-1 py-px font-mono text-[10px] text-[#57606a]">{item.id.slice(0, 8)}</span>
                            <span className="text-[10px] text-[#8c959f]" title={`Created ${formatTimestamp(item.createdAt)}`}>{formatTimestamp(item.updatedAt)}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[12px] leading-snug text-[#1f2328]">{item.summaryPreview || <span className="text-[#8c959f]">No summary stored</span>}</div>
                        {item.matchSnippets.length > 0 && (
                            <div className="mt-0.5 space-y-0.5" data-testid="native-session-match-snippets">
                                {item.matchSnippets.map((snippet, index) => (
                                    <div key={index} className="truncate rounded bg-[#fff8c5] px-1 py-px text-[11px] text-[#57606a]">{snippet}</div>
                                ))}
                            </div>
                        )}
                        {location && (
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[#8c959f]">
                                <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                    <path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 10 4.25V1.5Z" />
                                </svg>
                                <span className="truncate">{location}</span>
                            </div>
                        )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="inline-flex items-center rounded-full bg-[#f6f8fa] px-1.5 py-px text-[10px] font-medium text-[#57606a]" title={`${item.turnCount} turn${item.turnCount === 1 ? '' : 's'}`}>
                            {item.turnCount} turn{item.turnCount === 1 ? '' : 's'}
                        </span>
                        <span className="inline-flex max-w-[120px] items-center gap-1 truncate text-[10px] text-[#57606a]" title={item.branch || 'Unknown branch'}>
                            <svg className="h-2.5 w-2.5 shrink-0 text-[#8c959f]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                                <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
                            </svg>
                            <span className="truncate">{item.branch || 'Unknown branch'}</span>
                        </span>
                    </div>
                </div>
            </td>
        </tr>
    );
}

function SessionDetailView({ detail, onBack }: { detail: NativeCopilotSessionDetail; onBack: () => void }) {
    return (
        <div className="flex flex-col gap-2 p-2.5" data-testid="native-session-detail">
            <div className="rounded-lg border border-[#d0d7de] bg-white p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded border border-[#d0d7de] px-2 py-0.5 text-[11px] lg:hidden"
                        data-testid="native-session-detail-back"
                    >
                        ← Back
                    </button>
                    <ExternalLabel />
                    <ReadOnlyBadge />
                </div>
                <h2 className="mt-1.5 break-all font-mono text-[13px] font-semibold">{detail.id}</h2>
                <p className="mt-0.5 text-[11px] text-[#57606a]" data-testid="native-session-readonly-helper">
                    {READ_ONLY_TOOLTIP}
                </p>
                <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-2">
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Repository</dt><dd className="break-all">{detail.repository || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Branch</dt><dd>{detail.branch || 'Unknown branch'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Working dir</dt><dd className="break-all">{detail.cwd || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Host</dt><dd>{detail.hostType || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Created</dt><dd>{formatTimestamp(detail.createdAt)}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Updated</dt><dd>{formatTimestamp(detail.updatedAt)}</dd></div>
                </dl>
                {detail.summary && (
                    <div className="mt-2">
                        <h3 className="text-[11px] font-semibold text-[#57606a]">Stored summary</h3>
                        <pre className="mt-0.5 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-1.5 font-sans text-[12px]" data-testid="native-session-summary">{detail.summary}</pre>
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-[#d0d7de] bg-white p-3">
                <h3 className="text-[13px] font-semibold">Turns ({detail.turns.length})</h3>
                {detail.turns.length === 0 && (
                    <p className="mt-1.5 text-[12px] text-[#57606a]" data-testid="native-session-no-turns">This native session has no stored turns.</p>
                )}
                <ol className="mt-1.5 space-y-2">
                    {detail.turns.map(turn => (
                        <li key={turn.id} className="rounded border border-[#eaeef2] p-2" data-testid="native-session-turn">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#57606a]">
                                <span className="font-medium">Turn {turn.turnIndex}</span>
                                <span>{formatTimestamp(turn.timestamp)}</span>
                                <span>{turn.userChars} user chars · {turn.assistantChars} assistant chars</span>
                                <span data-testid="native-session-turn-index-diagnostics">
                                    {turn.searchIndexSourceId
                                        ? `Indexed (${turn.searchIndexChars ?? 0} chars)`
                                        : 'Not indexed'}
                                </span>
                            </div>
                            <div className="mt-1.5">
                                <h4 className="text-[11px] font-semibold text-[#57606a]">User</h4>
                                <pre className="mt-0.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-1.5 font-sans text-[12px]" data-testid="native-session-turn-user">{turn.userMessage || '—'}</pre>
                            </div>
                            <div className="mt-1.5">
                                <h4 className="text-[11px] font-semibold text-[#57606a]">Assistant</h4>
                                {turn.assistantResponse
                                    ? <pre className="mt-0.5 max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-1.5 font-sans text-[12px]" data-testid="native-session-turn-assistant">{turn.assistantResponse}</pre>
                                    : <p className="mt-0.5 text-[12px] italic text-[#8c959f]" data-testid="native-session-turn-no-assistant">No assistant response stored</p>}
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
