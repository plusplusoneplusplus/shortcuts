/**
 * shellModel — pure helpers for the remote-first shell.
 *
 * Maps the existing per-clone repo data model onto the redesign's remote-first
 * concepts:
 *   • a "remote" is a RepoGroup (clones sharing a normalized origin URL)
 *   • a "clone" is a RepoData (a local checkout / workspace)
 *
 * Everything here is pure and dependency-light so it can be unit-tested without
 * React or the dashboard contexts.
 */

import type { RepoData, RepoGroup } from '../../repos/repoGrouping';
import type { RemoteConnectionStatus, RemoteQueueStatus } from '../../repos/remoteWorkspaceAggregation';
import type { RepoSubTab } from '../../types/dashboard';
import type { SubTabDef } from '../repo-detail/repoSubTabs';

// ── Tab scoping ──────────────────────────────────────────────────────────────

/** Sub-tabs that belong to the REMOTE (shared across all clones of an origin). */
export const REMOTE_SCOPE_KEYS: ReadonlyArray<RepoSubTab> = ['work-items', 'pull-requests'];

// Fixed display order for the remote scope (only present tabs are emitted).
const REMOTE_ORDER: RepoSubTab[] = ['work-items', 'pull-requests'];

export interface PartitionedShellTabs {
    /** Remote-scoped tabs (Work Items, Pull Requests) — left of the divider, always shown. */
    remote: SubTabDef[];
    /** Clone-scoped tabs in display order. Shown inline until they run out of
     *  horizontal room, after which the tail collapses into the ⋯ overflow. */
    clone: SubTabDef[];
}

/**
 * Split the visible sub-tabs into the two scopes. Remote-scoped tabs come first
 * in a stable order; every other tab is clone-scoped and kept in source order.
 */
export function partitionShellTabs(tabs: SubTabDef[]): PartitionedShellTabs {
    const byKey = new Map<RepoSubTab, SubTabDef>(tabs.map(t => [t.key, t]));
    const remote = REMOTE_ORDER.map(k => byKey.get(k)).filter((t): t is SubTabDef => !!t);
    const taken = new Set<RepoSubTab>(remote.map(t => t.key));
    const clone = tabs.filter(t => !taken.has(t.key));
    return { remote, clone };
}

/**
 * Given each clone tab's natural pixel width (in display order) and the
 * available container width, return the set of tab keys that fit. The active tab
 * is always kept visible (swapped in for the last fitting tab if needed).
 *
 * Returns `null` to mean "show everything" — either there is no layout
 * information yet (containerWidth <= 0, e.g. jsdom) or every tab fits.
 */
export function computeVisibleTabKeys(
    measured: { key: string; width: number }[],
    containerWidth: number,
    activeKey: string | null,
    gap = 2,
): Set<string> | null {
    if (containerWidth <= 0) return null;
    const visible = new Set<string>();
    let used = 0;
    let lastVisible: string | null = null;
    for (const m of measured) {
        const w = m.width + gap;
        if (used + w <= containerWidth) {
            visible.add(m.key);
            used += w;
            lastVisible = m.key;
        } else {
            break;
        }
    }
    if (visible.size >= measured.length) return null;
    if (activeKey && !visible.has(activeKey)) {
        if (lastVisible && visible.size > 0) visible.delete(lastVisible);
        visible.add(activeKey);
    }
    return visible;
}

// ── Clone status ─────────────────────────────────────────────────────────────

/**
 * Per-clone status driving the dropdown's status dot.
 *   • Local clones: queue-derived (idle/running/queued/paused), unchanged.
 *   • Remote clones (AC-05): connection-first — `offline` / `connecting` win over
 *     the queue; when the server is online the remote queue status is used.
 */
export type CloneStatus = 'idle' | 'running' | 'queued' | 'paused' | 'offline' | 'connecting';

/** Minimal remote marker shape this module reads off a workspace (set by AC-01/05). */
interface RemoteStatusMarker {
    connection?: RemoteConnectionStatus;
    queue?: RemoteQueueStatus;
}

/**
 * Read a workspace's remote marker when present. Inlined (not imported from the
 * network-aware aggregation module) to keep shellModel pure and dependency-light;
 * local workspaces return `undefined`.
 */
function remoteMarker(workspace: unknown): RemoteStatusMarker | undefined {
    const ws = workspace as { remote?: unknown } | undefined;
    if (ws && typeof ws.remote === 'object' && ws.remote !== null) {
        return ws.remote as RemoteStatusMarker;
    }
    return undefined;
}

/**
 * Blend a remote clone's connection + queue into a single status (AC-05).
 * Connection comes first: a server that is not online shows offline/connecting
 * regardless of its last-known queue; once online, the remote queue status is
 * used (mirroring local semantics).
 */
export function blendRemoteCloneStatus(marker: RemoteStatusMarker): CloneStatus {
    const connection = marker.connection ?? 'offline';
    if (connection === 'offline' || connection === 'failed') return 'offline';
    if (connection !== 'online') return 'connecting'; // 'connecting' | 'idle' (not yet online)
    return marker.queue ?? 'idle';
}

/**
 * Derive per-clone status from the QueueContext repoQueueMap, mirroring
 * RepoTabStrip's logic for LOCAL clones. For REMOTE clones (carrying an AC-01
 * marker), the status is blended from the marker's connection + remote queue
 * (AC-05) instead of the local queue map. `isHiddenTask` is injected to keep
 * this module pure.
 */
export function computeCloneStatusMap(
    repos: RepoData[],
    repoQueueMap: Record<string, any> | undefined,
    isHiddenTask: (t: any) => boolean,
): Record<string, CloneStatus> {
    const map: Record<string, CloneStatus> = {};
    for (const repo of repos) {
        const id = String(repo.workspace.id);
        const marker = remoteMarker(repo.workspace);
        if (marker) { map[id] = blendRemoteCloneStatus(marker); continue; }
        const entry = repoQueueMap?.[id];
        if (!entry) { map[id] = 'idle'; continue; }
        if (entry.stats?.isPaused) { map[id] = 'paused'; continue; }
        const running = (entry.running ?? []).filter((t: any) => !isHiddenTask(t)).length;
        if (running > 0) { map[id] = 'running'; continue; }
        const queued = (entry.queued ?? []).filter((t: any) => !isHiddenTask(t)).length;
        map[id] = queued > 0 ? 'queued' : 'idle';
    }
    return map;
}

/**
 * Resolve the dot color for a clone given its status, falling back to the remote
 * color for idle/unknown. Remote-only states get distinct hues: `offline` is a
 * dim grey ("inactive"), `connecting` a blue in-progress hue (NOT queued orange).
 */
export function cloneStatusColor(status: CloneStatus | undefined, fallback: string): string {
    if (status === 'running') return '#16a34a';
    if (status === 'queued') return '#c98410';
    if (status === 'paused') return '#f14c4c';
    if (status === 'connecting') return '#3b82f6';
    if (status === 'offline') return '#8c959f';
    return fallback;
}

// ── Remote summary ───────────────────────────────────────────────────────────

export type RemoteStatus = 'idle' | 'running' | 'queued';

export interface RemoteSummary {
    /** Aggregate queue status across all clones (running wins over queued). */
    status: RemoteStatus;
    /** Sum of unseen counts across clones. */
    unseen: number;
    /** Number of clones (local checkouts) for this remote. */
    cloneCount: number;
    /** Representative color (first clone's color). */
    color: string;
    /** Short remote name (last path segment of the group label). */
    name: string;
}

/** Aggregate a remote group's clones into the per-tab display summary. */
export function summarizeRemote(
    group: RepoGroup,
    cloneStatus: Record<string, CloneStatus | string>,
    unseenCounts: Record<string, number>,
): RemoteSummary {
    let running = false;
    let queued = false;
    let unseen = 0;
    for (const repo of group.repos) {
        const id = String(repo.workspace.id);
        const st = cloneStatus[id] ?? 'idle';
        if (st === 'running') running = true;
        else if (st === 'queued') queued = true;
        unseen += unseenCounts[id] ?? 0;
    }
    const status: RemoteStatus = running ? 'running' : queued ? 'queued' : 'idle';
    const first = group.repos[0]?.workspace;
    const color = (first?.color as string) || '#848484';
    const label = group.label || (first?.name as string) || 'repo';
    const name = label.includes('/') ? label.split('/').slice(-1)[0] : label;
    return { status, unseen, cloneCount: group.repos.length, color, name };
}
