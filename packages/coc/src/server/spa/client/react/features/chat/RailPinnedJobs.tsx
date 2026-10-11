/**
 * RailPinnedJobs — collapsed-rail pinned-jobs control. `RepoChatTab` portals it
 * beside the Sentinel shortcut so it reads the list's own pin/archive state and
 * opens rows through the tab's `selectTask` (clone route included). Hover/focus
 * previews and click-to-expand come from `SplitWorkspacePanel`'s rail controls.
 */

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { CocClient } from '@plusplusoneplusplus/coc-client';
import { useApp } from '../../contexts/AppContext';
import { useOptionalChatPrefs } from '../../contexts/chatPrefsConsumer';
import { workspaceReadSource } from '../../api/workspaceReads';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { queueJobHash } from '../../queue/queueJobRoute';
import { RailControlsContext, RailHoverPreview, RailPreviewRow } from '../repo-detail/RailHoverPreview';
import { RailJobMetadata } from './RailJobMetadata';
import { getChatRowTitle } from './latestSentinelChat';
import { loadedPinKeys, selectRailPinnedJobs, type PinnedSnapshot, type RailPinnedTab } from './rail-pinned-jobs';

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
}

export function RailPinnedJobs({ workspaceId, routeId, client, running, history, scopeLabel, tab, onOpen }: RailPinnedJobsProps) {
    const rail = useContext(RailControlsContext);
    const prefs = useOptionalChatPrefs();
    const { state: appState } = useApp();
    const excludedTypes = useMemo(() => new Set(appState.myWorkExcludedTypes ?? []), [appState.myWorkExcludedTypes]);
    // Untagged clients for a remote selection would read the page origin's pins.
    const unresolvedRemote = !!parseRemoteCloneKey(routeId) && !client.options?.baseUrl;
    const scope = `${routeId}:${workspaceReadSource(client)}:${workspaceId}`;
    const pinnedIds = useMemo(() => (prefs?.loaded ? [...prefs.pinnedChatIds] : null), [prefs?.loaded, prefs?.pinnedChatIds]);
    const archivedIds = prefs?.archivedChatIds;
    const loadedKeys = loadedPinKeys(running, history);
    // Pin, unpin, archive, delete and status moves all change this; refetch the full set.
    const signature = [pinnedIds?.join(',') ?? '', [...(archivedIds ?? [])].join(','), loadedKeys.join(',')].join('|');

    const [snapshot, setSnapshot] = useState<(PinnedSnapshot & { scope: string }) | null>(null);
    const fetched = useRef<string | null>(null);
    useEffect(() => {
        if (unresolvedRemote || typeof client.workspaces?.pinned !== 'function') return;
        let cancelled = false;
        const delay = fetched.current === scope ? REFETCH_DEBOUNCE_MS : 0;
        const timer = setTimeout(() => {
            client.workspaces.pinned(workspaceId).then(response => {
                if (cancelled) return;
                fetched.current = scope;
                setSnapshot({ scope, entries: Array.isArray(response?.entries) ? response.entries : [] });
            }).catch(error => {
                console.error('Failed to load pinned jobs for the collapsed workspace rail:', error);
            });
        }, delay);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [client, workspaceId, scope, signature, unresolvedRemote]);

    const rows = useMemo(() => selectRailPinnedJobs({
        snapshot: snapshot?.scope === scope ? snapshot : null,
        running,
        history,
        pinnedIds,
        archivedIds: archivedIds ?? new Set(),
        excludedTypes,
        tab,
    }), [snapshot, scope, running, history, pinnedIds, archivedIds, excludedTypes, tab]);

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
                renderRows: dismiss => rows.map(row => {
                    const title = getChatRowTitle(row);
                    return (
                        <RailPreviewRow
                            key={String(row.id)}
                            title={title}
                            href={queueJobHash(routeId, row, tab)}
                            onOpen={event => {
                                event.preventDefault();
                                dismiss();
                                onOpen(row);
                            }}
                            meta={<RailJobMetadata job={row} />}
                        />
                    );
                }),
            }]}
        />
    );
}
