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
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800"
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
            className="inline-flex items-center rounded-full border border-[#d0d7de] bg-[#f6f8fa] px-2 py-0.5 text-[11px] font-medium text-[#57606a]"
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

    // Reset selection and paging when the workspace changes.
    useEffect(() => {
        setSelectedSessionId(null);
        setDetail(null);
        setOffset(0);
        setFilterDraft(EMPTY_FILTERS);
        setFilters(EMPTY_FILTERS);
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
        <div className="flex min-h-0 flex-1 flex-col lg:max-w-[46%] lg:border-r lg:border-[#d0d7de]">
            <div className="border-b border-[#d0d7de] bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-semibold">Copilot Sessions</h2>
                    <ExternalLabel />
                    <ReadOnlyBadge />
                    <span className="ml-auto text-xs text-[#57606a]">{total} session{total === 1 ? '' : 's'}</span>
                </div>
                <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={applyFilters} data-testid="native-sessions-filters">
                    <input
                        type="text"
                        value={filterDraft.q}
                        onChange={e => setFilterDraft(prev => ({ ...prev, q: e.target.value }))}
                        placeholder="Search indexed content…"
                        className="h-8 min-w-[160px] flex-1 rounded border border-[#d0d7de] px-2 text-sm"
                        data-testid="native-sessions-search-input"
                    />
                    <input
                        type="text"
                        value={filterDraft.sessionId}
                        onChange={e => setFilterDraft(prev => ({ ...prev, sessionId: e.target.value }))}
                        placeholder="Session ID"
                        className="h-8 w-32 rounded border border-[#d0d7de] px-2 text-sm"
                        data-testid="native-sessions-session-id-input"
                    />
                    <input
                        type="text"
                        value={filterDraft.branch}
                        onChange={e => setFilterDraft(prev => ({ ...prev, branch: e.target.value }))}
                        placeholder="Branch"
                        className="h-8 w-28 rounded border border-[#d0d7de] px-2 text-sm"
                        data-testid="native-sessions-branch-input"
                    />
                    <label className="flex items-center gap-1 text-xs text-[#57606a]">
                        From
                        <input
                            type="date"
                            value={filterDraft.from}
                            onChange={e => setFilterDraft(prev => ({ ...prev, from: e.target.value }))}
                            className="h-8 rounded border border-[#d0d7de] px-2 text-sm"
                        />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-[#57606a]">
                        To
                        <input
                            type="date"
                            value={filterDraft.to}
                            onChange={e => setFilterDraft(prev => ({ ...prev, to: e.target.value }))}
                            className="h-8 rounded border border-[#d0d7de] px-2 text-sm"
                        />
                    </label>
                    <Button type="submit" size="sm" data-testid="native-sessions-apply-filters">Apply</Button>
                </form>
                {listResponse?.available === true && listResponse.searchIndexAvailable === false && filters.q && (
                    <p className="mt-1 text-xs text-amber-700" data-testid="native-sessions-search-unavailable">
                        Text search is unavailable: the native store has no search index. Metadata filters still apply.
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
                        <thead>
                            <tr className="border-b border-[#d0d7de] text-left text-xs text-[#57606a]">
                                <th className="px-3 py-2 font-medium">Session</th>
                                <th className="px-3 py-2 font-medium">Branch</th>
                                <th className="hidden px-3 py-2 font-medium md:table-cell">Updated</th>
                                <th className="px-3 py-2 text-right font-medium">Turns</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(item => (
                                <SessionRow
                                    key={item.id}
                                    item={item}
                                    selected={item.id === selectedSessionId}
                                    onSelect={() => setSelectedSessionId(item.id)}
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
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-[#57606a]">
                    Select a native session to view its summary and turns.
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
                <SessionDetailView detail={detail} onBack={() => setSelectedSessionId(null)} />
            )}
        </div>
    );

    // Wide screens render the searchable table beside the detail; narrow screens
    // stack panes and show one at a time based on selection.
    return (
        <div className="flex h-full min-h-0 flex-col bg-white" data-testid="native-copilot-sessions-panel">
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className={cn('flex min-h-0 flex-1 flex-col lg:flex', selectedSessionId ? 'hidden lg:flex' : 'flex')}>
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
    return (
        <tr
            data-testid="native-session-row"
            onClick={onSelect}
            className={cn(
                'cursor-pointer border-b border-[#eaeef2] align-top hover:bg-[#f6f8fa]',
                selected && 'bg-[#ddf4ff] hover:bg-[#ddf4ff]',
            )}
        >
            <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#57606a]">{item.id.slice(0, 8)}</span>
                    <ExternalLabel />
                </div>
                <div className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[13px]">{item.summaryPreview || <span className="text-[#8c959f]">No summary stored</span>}</div>
                {item.matchSnippets.length > 0 && (
                    <div className="mt-1 space-y-0.5" data-testid="native-session-match-snippets">
                        {item.matchSnippets.map((snippet, index) => (
                            <div key={index} className="truncate rounded bg-[#fff8c5] px-1 py-0.5 text-xs text-[#57606a]">{snippet}</div>
                        ))}
                    </div>
                )}
                <div className="mt-0.5 truncate text-xs text-[#8c959f]">{item.repository || item.cwd || ''}</div>
            </td>
            <td className="px-3 py-2 text-xs">{item.branch || 'Unknown branch'}</td>
            <td className="hidden px-3 py-2 text-xs md:table-cell" title={`Created ${formatTimestamp(item.createdAt)}`}>{formatTimestamp(item.updatedAt)}</td>
            <td className="px-3 py-2 text-right text-xs">{item.turnCount}</td>
        </tr>
    );
}

function SessionDetailView({ detail, onBack }: { detail: NativeCopilotSessionDetail; onBack: () => void }) {
    return (
        <div className="flex flex-col gap-3 p-4" data-testid="native-session-detail">
            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={onBack}
                        className="rounded border border-[#d0d7de] px-2 py-0.5 text-xs lg:hidden"
                        data-testid="native-session-detail-back"
                    >
                        ← Back
                    </button>
                    <ExternalLabel />
                    <ReadOnlyBadge />
                </div>
                <h2 className="mt-2 break-all font-mono text-sm font-semibold">{detail.id}</h2>
                <p className="mt-1 text-xs text-[#57606a]" data-testid="native-session-readonly-helper">
                    {READ_ONLY_TOOLTIP}
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Repository</dt><dd className="break-all">{detail.repository || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Branch</dt><dd>{detail.branch || 'Unknown branch'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Working dir</dt><dd className="break-all">{detail.cwd || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Host</dt><dd>{detail.hostType || '—'}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Created</dt><dd>{formatTimestamp(detail.createdAt)}</dd></div>
                    <div className="flex gap-2"><dt className="font-medium text-[#57606a]">Updated</dt><dd>{formatTimestamp(detail.updatedAt)}</dd></div>
                </dl>
                {detail.summary && (
                    <div className="mt-3">
                        <h3 className="text-xs font-semibold text-[#57606a]">Stored summary</h3>
                        <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-2 font-sans text-[13px]" data-testid="native-session-summary">{detail.summary}</pre>
                    </div>
                )}
            </div>

            <div className="rounded-lg border border-[#d0d7de] bg-white p-4">
                <h3 className="text-sm font-semibold">Turns ({detail.turns.length})</h3>
                {detail.turns.length === 0 && (
                    <p className="mt-2 text-sm text-[#57606a]" data-testid="native-session-no-turns">This native session has no stored turns.</p>
                )}
                <ol className="mt-2 space-y-3">
                    {detail.turns.map(turn => (
                        <li key={turn.id} className="rounded border border-[#eaeef2] p-3" data-testid="native-session-turn">
                            <div className="flex flex-wrap items-center gap-2 text-xs text-[#57606a]">
                                <span className="font-medium">Turn {turn.turnIndex}</span>
                                <span>{formatTimestamp(turn.timestamp)}</span>
                                <span>{turn.userChars} user chars · {turn.assistantChars} assistant chars</span>
                                <span data-testid="native-session-turn-index-diagnostics">
                                    {turn.searchIndexSourceId
                                        ? `Indexed (${turn.searchIndexChars ?? 0} chars)`
                                        : 'Not indexed'}
                                </span>
                            </div>
                            <div className="mt-2">
                                <h4 className="text-xs font-semibold text-[#57606a]">User</h4>
                                <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-2 font-sans text-[13px]" data-testid="native-session-turn-user">{turn.userMessage || '—'}</pre>
                            </div>
                            <div className="mt-2">
                                <h4 className="text-xs font-semibold text-[#57606a]">Assistant</h4>
                                {turn.assistantResponse
                                    ? <pre className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded bg-[#f6f8fa] p-2 font-sans text-[13px]" data-testid="native-session-turn-assistant">{turn.assistantResponse}</pre>
                                    : <p className="mt-1 text-[13px] italic text-[#8c959f]" data-testid="native-session-turn-no-assistant">No assistant response stored</p>}
                            </div>
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
