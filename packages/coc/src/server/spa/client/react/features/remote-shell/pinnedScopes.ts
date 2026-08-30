/**
 * pinnedScopes — pure model for the scopes a user has pinned as their own
 * segments in the `ScopeSlideSwitcher`, between the virtual scopes
 * (My Work / My Life) and the trailing workspace chip.
 *
 * Two different things in this codebase are both called a "repo group", and a
 * pin list of bare strings would silently merge them:
 *   • a `RepoGroup` — the git-remote clustering from `repoGrouping.ts`, keyed by
 *     `groupKey(group)` (a normalizedUrl like `github.com/acme/app`, or the
 *     `workspace:<id>` fallback for an un-remoted clone). This is what the
 *     picker's "Recent remotes" rows are.
 *   • a repo-*group virtual workspace* — a `group-*` workspace id, what the
 *     picker's "Repo groups" rows are.
 * A pin is therefore a discriminated `{ kind, key }` pair, serialized with a
 * `repo:` / `group:` prefix so the two key spaces can never collide in storage.
 * `repo:` holds a `groupKey`; `group:` holds a workspace id.
 *
 * Everything here is pure so it unit-tests without React, the dashboard
 * contexts, or the preferences client.
 */
import { getRepoSelectionId } from '../../repos/cloneIdentity';
import { groupKey, type RepoGroup } from '../../repos/repoGrouping';
import { summarizeRemote, type CloneStatus } from './shellModel';

/** Which key space a pin's `key` lives in. See the header comment. */
export type PinnedScopeKind = 'repo' | 'group';

export interface PinnedScopeRef {
    kind: PinnedScopeKind;
    key: string;
}

/**
 * Same cap as `recentRemotes` (see `useRecentRemotes` / the preferences schema):
 * the switcher shares one header row with the tab clusters, so an unbounded pin
 * list would push identity off-screen long before it hit any storage limit.
 */
export const MAX_PINNED_SCOPES = 8;

/** `repo:<groupKey>` / `group:<workspaceId>`. */
export function serializePinnedScope(ref: PinnedScopeRef): string {
    return `${ref.kind}:${ref.key}`;
}

/**
 * Inverse of `serializePinnedScope`, rejecting anything without a known prefix.
 *
 * Splits on the FIRST colon only: a `groupKey` may itself be `workspace:<id>`,
 * so `repo:workspace:abc` has to parse back to the key `workspace:abc` rather
 * than being truncated.
 */
export function parsePinnedScope(raw: unknown): PinnedScopeRef | null {
    if (typeof raw !== 'string') return null;
    const sep = raw.indexOf(':');
    if (sep <= 0) return null;
    const kind = raw.slice(0, sep);
    const key = raw.slice(sep + 1);
    if (kind !== 'repo' && kind !== 'group') return null;
    if (!key) return null;
    return { kind, key };
}

/** Parse a stored list: drop invalid entries, dedupe, cap. */
export function parsePinnedScopes(raw: unknown, max = MAX_PINNED_SCOPES): PinnedScopeRef[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const out: PinnedScopeRef[] = [];
    for (const entry of raw) {
        const ref = parsePinnedScope(entry);
        if (!ref) continue;
        const id = serializePinnedScope(ref);
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(ref);
        if (out.length >= max) break;
    }
    return out;
}

export function isPinnedScope(pins: readonly PinnedScopeRef[], ref: PinnedScopeRef): boolean {
    const id = serializePinnedScope(ref);
    return pins.some(p => serializePinnedScope(p) === id);
}

/**
 * Pin (append) or unpin (remove). Appending past `max` is a no-op rather than an
 * eviction: pins are deliberate, so silently dropping the user's oldest one is
 * worse than refusing the new one.
 */
export function togglePinnedScope(
    pins: readonly PinnedScopeRef[],
    ref: PinnedScopeRef,
    max = MAX_PINNED_SCOPES,
): PinnedScopeRef[] {
    const id = serializePinnedScope(ref);
    if (pins.some(p => serializePinnedScope(p) === id)) {
        return pins.filter(p => serializePinnedScope(p) !== id);
    }
    if (pins.length >= max) return [...pins];
    return [...pins, ref];
}

/** Move a pin one slot left (`-1`) or right (`1`); out-of-range moves are no-ops. */
export function movePinnedScope(
    pins: readonly PinnedScopeRef[],
    ref: PinnedScopeRef,
    delta: -1 | 1,
): PinnedScopeRef[] {
    const id = serializePinnedScope(ref);
    const from = pins.findIndex(p => serializePinnedScope(p) === id);
    if (from < 0) return [...pins];
    const to = from + delta;
    if (to < 0 || to >= pins.length) return [...pins];
    const next = [...pins];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

/** Anything with an id/name pair; both local and remote group workspaces qualify. */
type NamedWorkspace = { id?: unknown; name?: unknown };

export interface PinnedScopeResolveContext {
    /** Git-remote clusters, for `repo:` pins. */
    groups: readonly RepoGroup[];
    /** Repo-group virtual workspaces (local + remote), for `group:` pins. */
    groupWorkspaces: readonly NamedWorkspace[];
    cloneStatus: Record<string, CloneStatus | string>;
    unseenCounts: Record<string, number>;
}

export interface ResolvedPinnedScope {
    ref: PinnedScopeRef;
    /** Stable per-pin segment key for refs / `data-*` (the serialized ref). */
    id: string;
    /** Workspace id the pop-out and the right-click menu act on. */
    workspaceId: string;
    /** What `selectClone` is called with when the segment is clicked. */
    targetId: string;
    label: string;
    /** Status dot color; group pins have no member health of their own. */
    color: string;
    unseen: number;
}

/**
 * Resolve stored pins against what actually exists right now.
 *
 * Pins whose repo or group has gone away are dropped from the *rendered* set
 * only — exactly like `getPresentRecentRemoteKeys` — never from the stored list,
 * so a pin survives a remote server being briefly offline or a repo list still
 * loading.
 */
export function resolvePinnedScopes(
    pins: readonly PinnedScopeRef[],
    ctx: PinnedScopeResolveContext,
): ResolvedPinnedScope[] {
    const groupsByKey = new Map(ctx.groups.map(g => [groupKey(g), g]));
    const workspacesById = new Map(
        ctx.groupWorkspaces.map(ws => [String(ws?.id ?? ''), ws] as const),
    );
    const out: ResolvedPinnedScope[] = [];
    for (const ref of pins) {
        const id = serializePinnedScope(ref);
        if (ref.kind === 'repo') {
            const group = groupsByKey.get(ref.key);
            const first = group?.repos[0];
            if (!group || !first) continue;
            const summary = summarizeRemote(group, ctx.cloneStatus, ctx.unseenCounts);
            // A cluster has no single workspace, so the pin acts on its first
            // clone — the same clone the picker falls back to when no clone of
            // that remote has been visited yet (`chooseGroup`).
            const targetId = getRepoSelectionId(first);
            out.push({
                ref,
                id,
                workspaceId: targetId,
                targetId,
                label: summary.name,
                color: summary.color,
                unseen: summary.unseen,
            });
            continue;
        }
        const ws = workspacesById.get(ref.key);
        if (!ws) continue;
        const name = typeof ws.name === 'string' && ws.name.length > 0 ? ws.name : ref.key;
        out.push({
            ref,
            id,
            workspaceId: ref.key,
            targetId: ref.key,
            label: name,
            // Neutral: a group aggregates clones with independent health, so
            // borrowing any member's color would misreport the others.
            color: '#848484',
            unseen: ctx.unseenCounts[ref.key] ?? 0,
        });
    }
    return out;
}
