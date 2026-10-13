/**
 * RailPinnedJobs — collapsed-rail pinned-jobs control. `RepoChatTab` portals it
 * beside the Sentinel shortcut so it reads the list's own pin/archive state and
 * opens rows through the tab's `selectTask` (clone route included). Hover/focus
 * previews and click-to-expand come from `SplitWorkspacePanel`'s rail controls.
 */

import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useApp } from '../../contexts/AppContext';
import { useOptionalChatPrefs } from '../../contexts/chatPrefsConsumer';
import { workspaceReadSource } from '../../api/workspaceReads';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { queueJobHash } from '../../queue/queueJobRoute';
import { RailControlsContext, RailHoverPreview, RailPreviewRow } from '../repo-detail/RailHoverPreview';
import { RailJobMetadata } from './RailJobMetadata';
import { getChatRowTitle } from './latestSentinelChat';
import { loadedPinKeys, pinnedJobKey, selectRailPinnedJobs, type PinnedSnapshot, type RailPinnedTab } from './rail-pinned-jobs';
import { ToastContext } from '../../contexts/ToastContext';

const REFETCH_DEBOUNCE_MS = 300;

export interface RailPinnedJobsProps {
    workspaceId: string;
    /** Concrete dashboard selection (clone-qualified for remote workspaces/groups). */
    routeId: string;
    client: CocClient;
    running: readonly any[];
    history: readonly any[];
    scopeLabel: string;
    /** Route segment used by the list's own selection (`chats`/`tasks`/`activity`). */
    tab: RailPinnedTab;
    onOpen: (task: any) => void;
    ownerAvailable?: boolean;
    onRefreshReady?: (refresh: (() => Promise<void>) | null) => void;
}

export function RailPinnedJobs({ workspaceId, routeId, client, running, history, scopeLabel, tab, onOpen, onRefreshReady, ownerAvailable = true }: RailPinnedJobsProps) {
    const rail = useContext(RailControlsContext);
    const prefs = useOptionalChatPrefs();
    const toast = useContext(ToastContext);
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const { state: appState } = useApp();
    const excludedTypes = useMemo(() => new Set(appState.myWorkExcludedTypes ?? []), [appState.myWorkExcludedTypes]);
    // Untagged clients for a remote selection would read the page origin's pins.
    const unresolvedRemote = !ownerAvailable || !!parseRemoteCloneKey(routeId) && !client.options?.baseUrl;
    const scope = `${routeId}:${workspaceReadSource(client)}:${workspaceId}:${unresolvedRemote}`;
    const pinnedIds = useMemo(() => (prefs?.loaded ? [...prefs.pinnedChatIds] : null), [prefs?.loaded, prefs?.pinnedChatIds]);
    const archivedIds = prefs?.archivedChatIds;
    const loadedKeys = loadedPinKeys(running, history);
    // Pin, unpin, archive, delete and status moves all change this; refetch the full set.
    const signature = [pinnedIds?.join(',') ?? '', [...(archivedIds ?? [])].join(','), loadedKeys.join(',')].join('|');

    const [snapshot, setSnapshot] = useState<(PinnedSnapshot & { scope: string }) | null>(null);
    const fetched = useRef<string | null>(null);
    const revision = useRef(0);
    const requests = useRef(new Map<string, object>());
    const [pending, setPending] = useState<{ scope: string; rows: any[] }>({ scope, rows: [] });
    const owner = useRef(scope);
    if (owner.current !== scope) {
        owner.current = scope;
        revision.current++;
        requests.current.clear();
        setPending({ scope, rows: [] });
    }
    useEffect(() => () => { requests.current.clear(); }, []);
    const liveSignature = useRef(signature);
    if (liveSignature.current !== signature) { liveSignature.current = signature; revision.current++; }
    const refresh = useCallback(async () => {
        const request = ++revision.current;
        if (unresolvedRemote) { throw new Error('The owning server is unavailable.'); }
        if (typeof client.workspaces?.pinned !== 'function') { throw new Error('Pinned jobs are unavailable.'); }
        let response;
        try {
            response = await client.workspaces.pinned(workspaceId);
        } catch (error) {
            if (request !== revision.current || owner.current !== scope) { return; }
            throw error;
        }
        if (request !== revision.current || owner.current !== scope) { return; }
        if (!Array.isArray(response?.entries)) { throw new Error('Invalid pinned jobs response.'); }
        fetched.current = scope;
        setSnapshot({ scope, entries: response.entries });
    }, [client, workspaceId, scope, unresolvedRemote]);
    useEffect(() => {
        onRefreshReady?.(refresh);
        return () => { onRefreshReady?.(null); revision.current++; };
    }, [onRefreshReady, refresh]);
    useEffect(() => {
        if (unresolvedRemote || typeof client.workspaces?.pinned !== 'function') return;
        const delay = fetched.current === scope ? REFETCH_DEBOUNCE_MS : 0;
        const timer = setTimeout(() => {
            const currentScope = scope;
            refresh().catch(error => {
                if (owner.current === currentScope) toastRef.current?.addToast(`Could not refresh pinned jobs: ${error.message}`, 'error');
            });
        }, delay);
        return () => { revision.current++; clearTimeout(timer); };
    }, [client, workspaceId, scope, signature, unresolvedRemote, refresh]);

    const rows = useMemo(() => selectRailPinnedJobs({
        snapshot: {
            entries: [
                ...(snapshot?.scope === scope ? snapshot.entries : []),
                ...(pending.scope === scope ? pending.rows.map(row => ({ ...row, id: pinnedJobKey(row) })) : []),
            ],
        },
        running,
        history,
        pinnedIds: pinnedIds && pending.scope === scope ? [...pinnedIds, ...pending.rows.map(pinnedJobKey)] : pinnedIds,
        archivedIds: archivedIds ?? new Set(),
        excludedTypes,
        tab,
    }), [snapshot, scope, running, history, pinnedIds, pending, archivedIds, excludedTypes, tab]);

    const unpin = async (row: any, action: HTMLButtonElement, focusAfterRemoval: (action: HTMLElement) => void) => {
        const id = pinnedJobKey(row);
        if (!prefs || requests.current.has(id)) return;
        const request = {};
        requests.current.set(id, request);
        setPending(current => ({ scope, rows: [...(current.scope === scope ? current.rows : []), row] }));
        try {
            await prefs.setChatPinned(id, false);
            if (owner.current !== scope || requests.current.get(id) !== request) return;
            focusAfterRemoval(action);
            revision.current++;
            setSnapshot(current => current?.scope === scope
                ? { ...current, entries: current.entries.filter(entry => pinnedJobKey(entry) !== id) }
                : current);
        } catch (error) {
            if (owner.current === scope && requests.current.get(id) === request) {
                toastRef.current?.addToast(`Could not unpin job: ${error instanceof Error ? error.message : String(error)}`, 'error');
            }
        } finally {
            if (requests.current.get(id) === request) {
                requests.current.delete(id);
                setPending(current => ({ ...current, rows: current.rows.filter(row => pinnedJobKey(row) !== id) }));
            }
        }
    };

    if (!rail || unresolvedRemote) return null;
    const count = rows.length;
    return (
        <RailHoverPreview
            key={`${scope}:${tab}`}
            {...rail}
            scopeLabel={scopeLabel}
            controls={[{
                key: 'pinned',
                count,
                label: `${count} pinned ${count === 1 ? 'job' : 'jobs'}`,
                heading: 'Pinned jobs',
                className: 'border-[#d0d7de] bg-white text-[#656d76] hover:bg-[#f3f3f3] hover:text-[#1e1e1e] dark:border-[#3c3c3c] dark:bg-[#252526] dark:text-[#aaa] dark:hover:bg-[#2d2d2d] dark:hover:text-[#ddd]',
                badgeClassName: 'bg-[#656d76] dark:bg-[#6e7681]',
                icon: (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                        <path d="M4.456.734a1.75 1.75 0 0 1 2.826.504l.613 1.327a3.08 3.08 0 0 0 2.084 1.707l2.454.584c1.332.317 1.8 1.972.832 2.94L11.06 10l3.72 3.72a.75.75 0 1 1-1.061 1.06L10 11.06l-2.204 2.205c-.968.968-2.623.5-2.94-.832l-.584-2.454a3.08 3.08 0 0 0-1.707-2.084l-1.327-.613a1.75 1.75 0 0 1-.504-2.826L4.456.734ZM5.92 1.866a.25.25 0 0 0-.404-.072L1.794 5.516a.25.25 0 0 0 .072.404l1.328.613A4.58 4.58 0 0 1 5.73 9.63l.584 2.454a.25.25 0 0 0 .42.12l5.47-5.47a.25.25 0 0 0-.12-.42L9.63 5.73a4.58 4.58 0 0 1-3.098-2.537L5.92 1.866Z" />
                    </svg>
                ),
                renderRows: (dismiss, focusAfterRemoval) => rows.map(row => {
                    const title = getChatRowTitle(row);
                    const busy = pending.scope === scope && pending.rows.some(task => pinnedJobKey(task) === pinnedJobKey(row));
                    return (
                        <RailPreviewRow
                            key={pinnedJobKey(row)}
                            title={title}
                            href={queueJobHash(routeId, row, tab)}
                            onOpen={event => {
                                event.preventDefault();
                                dismiss();
                                onOpen(row);
                            }}
                            meta={<RailJobMetadata job={row} />}
                            action={prefs && <button
                                type="button"
                                aria-label={`Unpin job: ${title}`}
                                title="Unpin job"
                                aria-disabled={busy}
                                aria-busy={busy}
                                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-[#656d76] hover:bg-[#f3f3f3] focus-visible:outline focus-visible:outline-[#007acc] aria-disabled:opacity-50 dark:text-[#aaa] dark:hover:bg-[#333]"
                                onClick={event => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    void unpin(row, event.currentTarget, focusAfterRemoval);
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                    <path d="m6 2 7 7-3 1-2 3-5-5 3-2V2ZM2 14l4-4M1 1l14 14" />
                                </svg>
                            </button>}
                        />
                    );
                }),
            }]}
        />
    );
}
