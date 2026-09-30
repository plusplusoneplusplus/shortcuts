/**
 * ImportCopilotChatDialog — picker for importing a native GitHub Copilot CLI
 * session into a workspace's chat list.
 *
 * Lists every native Copilot session (`scope=all`, not just ones whose cwd
 * matches), with the native `q` search and simple paging. Importing is
 * idempotent per workspace: a session already imported shows an "Imported"
 * badge and its button opens the existing chat instead.
 *
 * In a repo-group view the target is a member repo, chosen from a dropdown
 * that defaults to the first live member.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NativeCopilotSessionListItem } from '@plusplusoneplusplus/coc-client';
import { Button, Dialog, cn } from '../../ui';
import { formatRelativeTime } from '../../utils/format';
import { useApp } from '../../contexts/AppContext';
import { useCocClient } from '../../repos/cloneRouting';
import { isRepoGroupWorkspaceId } from '../../repos/virtualWorkspaceIds';
import { useRepoGroupMembers } from '../../repos/useRepoGroupMembers';

export const IMPORT_COPILOT_CHAT_PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 250;

export interface ImportCopilotChatDialogProps {
    open: boolean;
    onClose: () => void;
    /** Repo workspace id, or a `group-*` id (then a member repo is picked). */
    workspaceId: string;
    /** Called with the target workspace and the new or existing chat's process id. */
    onImported: (targetWorkspaceId: string, processId: string) => void;
}

/** Compare two filesystem paths across OSes (slashes, trailing slash, Windows case). */
export function isSameFolderPath(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    const norm = (p: string) => {
        let out = p.replace(/\\/g, '/').replace(/\/+$/, '');
        if (/^[a-zA-Z]:/.test(out)) out = out.toLowerCase();
        return out;
    };
    return norm(a) === norm(b);
}

export function ImportCopilotChatDialog({ open, onClose, workspaceId, onImported }: ImportCopilotChatDialogProps) {
    const isGroup = isRepoGroupWorkspaceId(workspaceId);
    const members = useRepoGroupMembers(workspaceId, undefined, open && isGroup);
    const liveMembers = useMemo(() => (members ?? []).filter(m => !m.stale), [members]);
    const [memberWorkspaceId, setMemberWorkspaceId] = useState<string>('');
    useEffect(() => {
        if (!isGroup) return;
        if (!liveMembers.some(m => m.workspaceId === memberWorkspaceId)) {
            setMemberWorkspaceId(liveMembers[0]?.workspaceId ?? '');
        }
    }, [isGroup, liveMembers, memberWorkspaceId]);
    const targetWorkspaceId = isGroup ? memberWorkspaceId : workspaceId;

    const client = useCocClient(targetWorkspaceId || workspaceId);
    const { state: appState } = useApp();
    const targetRoot = useMemo(() => {
        if (isGroup) return liveMembers.find(m => m.workspaceId === targetWorkspaceId)?.rootPath;
        return (appState.workspaces ?? []).find((w: any) => w.id === workspaceId)?.rootPath;
    }, [isGroup, liveMembers, targetWorkspaceId, appState.workspaces, workspaceId]);

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [offset, setOffset] = useState(0);
    const [items, setItems] = useState<NativeCopilotSessionListItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [importingId, setImportingId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) {
            setQuery('');
            setDebouncedQuery('');
            setOffset(0);
            setError(null);
        }
    }, [open]);

    useEffect(() => {
        const handle = setTimeout(() => {
            setDebouncedQuery(query.trim());
            setOffset(0);
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [query]);

    useEffect(() => {
        if (!open || !targetWorkspaceId) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        client.nativeCopilotSessions
            .list(targetWorkspaceId, {
                scope: 'all',
                q: debouncedQuery || undefined,
                limit: IMPORT_COPILOT_CHAT_PAGE_SIZE,
                offset,
            })
            .then(res => {
                if (cancelled) return;
                if (res.available === false) {
                    setError(res.reason === 'db-invalid'
                        ? 'The Copilot session store could not be read.'
                        : 'No Copilot session store found (~/.copilot/session-store.db).');
                    setItems([]);
                    setTotal(0);
                    return;
                }
                setItems(res.items ?? []);
                setTotal(res.total ?? 0);
            })
            .catch(err => {
                if (!cancelled) setError(err instanceof Error ? err.message : String(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [open, client, targetWorkspaceId, debouncedQuery, offset]);

    const handleImport = useCallback(async (item: NativeCopilotSessionListItem) => {
        if (!targetWorkspaceId) return;
        if (item.importedProcessId) {
            onImported(targetWorkspaceId, item.importedProcessId);
            return;
        }
        setImportingId(item.id);
        setError(null);
        try {
            const res = await client.nativeCopilotSessions.import(targetWorkspaceId, item.id);
            onImported(targetWorkspaceId, res.processId);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setImportingId(null);
        }
    }, [client, targetWorkspaceId, onImported]);

    const pageEnd = Math.min(offset + items.length, total);

    return (
        <Dialog id="import-copilot-chat-dialog" open={open} onClose={onClose} title="Import Copilot chat">
            <div className="flex flex-col gap-2 min-w-0" data-testid="import-copilot-chat-dialog">
                {isGroup && (
                    <label className="flex items-center gap-2 text-xs text-[#616161] dark:text-[#9d9d9d]">
                        <span className="flex-shrink-0">Import into</span>
                        <select
                            value={memberWorkspaceId}
                            onChange={e => { setMemberWorkspaceId(e.target.value); setOffset(0); }}
                            data-testid="import-copilot-chat-member-select"
                            className="flex-1 min-w-0 h-7 px-1.5 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e]"
                        >
                            {liveMembers.map(m => (
                                <option key={m.workspaceId} value={m.workspaceId}>{m.name ?? m.workspaceId}</option>
                            ))}
                        </select>
                    </label>
                )}
                <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search Copilot sessions…"
                    data-testid="import-copilot-chat-search"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full h-7 px-2 text-xs rounded border border-[#e0e0e0] dark:border-[#3c3c3c] bg-white dark:bg-[#1e1e1e] outline-none focus:border-[#0078d4]"
                />
                {error && <p className="text-xs text-[#f14c4c]" data-testid="import-copilot-chat-error">{error}</p>}
                <ul className="flex flex-col divide-y divide-[#eaeaea] dark:divide-[#333] max-h-[50vh] overflow-y-auto" data-testid="import-copilot-chat-list">
                    {!loading && items.length === 0 && !error && (
                        <li className="py-3 text-xs text-[#848484]" data-testid="import-copilot-chat-empty">No Copilot sessions found.</li>
                    )}
                    {items.map(item => {
                        const location = item.repository || item.cwd || '';
                        const otherFolder = !!item.cwd && !!targetRoot && !isSameFolderPath(item.cwd, targetRoot);
                        return (
                            <li key={item.id} className="flex items-start gap-2 py-1.5" data-testid="import-copilot-chat-row" data-session-id={item.id}>
                                <div className="min-w-0 flex-1">
                                    <div className="line-clamp-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]">
                                        {item.summaryPreview || <span className="text-[#848484]">No summary stored</span>}
                                    </div>
                                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[#848484]">
                                        {location && <span className="truncate max-w-[16rem]" title={location}>{location}</span>}
                                        {item.branch && <span>⎇ {item.branch}</span>}
                                        {item.updatedAt && <span>{formatRelativeTime(item.updatedAt)}</span>}
                                        <span>{item.turnCount} turn{item.turnCount === 1 ? '' : 's'}</span>
                                        {item.importedProcessId && (
                                            <span className="rounded px-1 bg-[#e6f4ea] text-[#1a7f37] dark:bg-[#1a3a24] dark:text-[#7ee2a8]" data-testid="import-copilot-chat-imported-badge">Imported</span>
                                        )}
                                    </div>
                                    {otherFolder && (
                                        <div className="mt-0.5 text-[10px] text-[#9a6700] dark:text-[#d7ba7d]" data-testid="import-copilot-chat-cwd-note">
                                            Started in a different folder; follow-ups run in this repo.
                                        </div>
                                    )}
                                </div>
                                <Button
                                    variant={item.importedProcessId ? 'ghost' : 'secondary'}
                                    size="sm"
                                    disabled={importingId !== null}
                                    loading={importingId === item.id}
                                    onClick={() => { void handleImport(item); }}
                                    data-testid="import-copilot-chat-import-btn"
                                >
                                    {item.importedProcessId ? 'Open' : 'Import'}
                                </Button>
                            </li>
                        );
                    })}
                </ul>
                {total > 0 && (
                    <div className={cn('flex items-center justify-between text-[11px] text-[#848484]')}>
                        <span data-testid="import-copilot-chat-range">{offset + 1}–{pageEnd} of {total}</span>
                        <span className="flex gap-1">
                            <Button variant="ghost" size="sm" disabled={loading || offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - IMPORT_COPILOT_CHAT_PAGE_SIZE))}
                                data-testid="import-copilot-chat-prev">Prev</Button>
                            <Button variant="ghost" size="sm" disabled={loading || pageEnd >= total}
                                onClick={() => setOffset(offset + IMPORT_COPILOT_CHAT_PAGE_SIZE)}
                                data-testid="import-copilot-chat-next">Next</Button>
                        </span>
                    </div>
                )}
            </div>
        </Dialog>
    );
}
