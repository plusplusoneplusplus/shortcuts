/**
 * railGitModel — pure model for the collapsed workspace rail's Git tiles.
 *
 * Inputs are the owner's own reads: `git-info` (branch, upstream ahead/behind,
 * detached HEAD) and the working-tree read (de-duplicated changed paths and
 * merge/rebase conflicts). Group scope uses one `git-info` per member and never
 * names a group branch. Unknown data never renders as clean or 0/0.
 */
import type { GitInfoResponse, GitWorkingTreeChangesResponse } from '@plusplusoneplusplus/coc-client';

export type RailGitTone = 'clean' | 'changed' | 'conflict' | 'muted';

/** One rail tile: compact text, its tone, and the full accessible description. */
export interface RailGitTile {
    text: string;
    tone: RailGitTone;
    label: string;
}

export interface RailWorkingTreeSummary {
    /** Distinct changed paths; a path both staged and modified counts once. */
    paths: number;
    staged: number;
    modified: number;
    untracked: number;
    conflicts: string[];
    /** `merge`, `rebase`, `cherry-pick`, … or `none`. */
    operation: string;
}

/** Last successful read plus the outcome of the latest attempt. */
export interface RailGitRead<T> {
    data?: T;
    readAt?: number;
    loading: boolean;
    /** The latest attempt failed; `data` (if any) is last known. */
    failed: boolean;
}

export interface RepoRailGitInput {
    info: RailGitRead<GitInfoResponse>;
    tree: RailGitRead<RailWorkingTreeSummary>;
}

export interface GroupRailGitMember {
    id: string;
    name: string;
    /** Registry reports the member missing/unreadable. */
    stale: boolean;
    /** Undefined: no read yet; null: the owner had no data for this member. */
    info: GitInfoResponse | null | undefined;
}

export interface GroupRailGitInput {
    members: readonly GroupRailGitMember[] | undefined;
    read: RailGitRead<unknown>;
}

export function summarizeWorkingTree(response: GitWorkingTreeChangesResponse): RailWorkingTreeSummary {
    const staged = new Set<string>();
    const modified = new Set<string>();
    const untracked = new Set<string>();
    for (const change of response.changes ?? []) {
        const set = change.stage === 'staged' ? staged : change.stage === 'untracked' ? untracked : modified;
        set.add(change.filePath);
    }
    const all = new Set([...staged, ...modified, ...untracked]);
    // A capped untracked list reports its true total separately.
    const hiddenUntracked = response.untrackedTruncated && typeof response.untrackedTotal === 'number'
        ? Math.max(0, response.untrackedTotal - untracked.size)
        : 0;
    return {
        paths: all.size + hiddenUntracked,
        staged: staged.size,
        modified: modified.size,
        untracked: untracked.size + hiddenUntracked,
        conflicts: [...new Set(response.repoState?.conflictFiles ?? [])],
        operation: response.repoState?.operation ?? 'none',
    };
}

const capped = (n: number) => (n > 99 ? '99+' : String(n));
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function repoChangesTile({ tree }: RepoRailGitInput): RailGitTile {
    const data = tree.data;
    if (!data) {
        return tree.loading
            ? { text: '…', tone: 'muted', label: 'Working changes: reading Git status' }
            : { text: '?', tone: 'muted', label: 'Working changes: Git status unavailable' };
    }
    const lastKnown = tree.failed ? 'Last known: ' : '';
    if (data.conflicts.length > 0) {
        return {
            text: '!' + capped(data.conflicts.length),
            tone: 'conflict',
            label: `Working changes: ${lastKnown}${plural(data.conflicts.length, 'conflicted file')}${data.operation !== 'none' ? `, ${data.operation} in progress` : ''}`,
        };
    }
    if (data.paths > 0) {
        return { text: '~' + capped(data.paths), tone: 'changed', label: `Working changes: ${lastKnown}${plural(data.paths, 'changed path')}` };
    }
    return { text: '✓', tone: 'clean', label: `Working changes: ${lastKnown}working tree clean` };
}

/** Upstream comparison for one repo's git-info; undefined fields stay unknown. */
export function syncState(info: GitInfoResponse | null | undefined):
    | { kind: 'unknown' }
    | { kind: 'detached' }
    | { kind: 'no-upstream' }
    | { kind: 'compared'; upstream: string; ahead: number; behind: number } {
    if (!info || !info.isGitRepo) return { kind: 'unknown' };
    if (info.detached) return { kind: 'detached' };
    // Servers that do not report the upstream cannot vouch for their counts.
    if (info.upstream === undefined) return { kind: 'unknown' };
    if (info.upstream === null) return { kind: 'no-upstream' };
    return { kind: 'compared', upstream: info.upstream, ahead: info.ahead ?? 0, behind: info.behind ?? 0 };
}

export function repoSyncTile({ info }: RepoRailGitInput): RailGitTile {
    if (!info.data) {
        return info.loading
            ? { text: '↕…', tone: 'muted', label: 'Sync status: reading Git status' }
            : { text: '↕?', tone: 'muted', label: 'Sync status: unavailable' };
    }
    const lastKnown = info.failed ? 'Last known: ' : '';
    const sync = syncState(info.data);
    switch (sync.kind) {
        case 'unknown':
            return { text: '↕?', tone: 'muted', label: 'Sync status: upstream comparison unavailable' };
        case 'detached':
            return { text: '↕—', tone: 'muted', label: 'Sync status: detached HEAD, no upstream comparison' };
        case 'no-upstream':
            return { text: '↕—', tone: 'muted', label: 'Sync status: no upstream configured' };
        case 'compared':
            return {
                text: `↑${capped(sync.ahead)}↓${capped(sync.behind)}`,
                tone: sync.ahead || sync.behind ? 'changed' : 'clean',
                label: `Sync status: ${lastKnown}${sync.ahead} ahead, ${sync.behind} behind ${sync.upstream}`,
            };
    }
}

export function repoBranchTile({ info }: RepoRailGitInput): RailGitTile {
    const data = info.data;
    if (!data) {
        return info.loading
            ? { text: 'Git…', tone: 'muted', label: 'Branch: reading Git status' }
            : { text: 'Git ?', tone: 'muted', label: 'Branch: unavailable' };
    }
    if (!data.isGitRepo) return { text: 'Git ?', tone: 'muted', label: 'Branch: Git status unavailable' };
    if (data.detached) return { text: 'Detached HEAD', tone: 'muted', label: 'Branch: detached HEAD' };
    if (!data.branch) return { text: 'Git ?', tone: 'muted', label: 'Branch: unknown' };
    return { text: data.branch, tone: 'muted', label: `Branch: ${info.failed ? 'last known ' : ''}${data.branch}` };
}

function liveMembers(members: readonly GroupRailGitMember[] | undefined): GroupRailGitMember[] {
    return (members ?? []).filter(member => !member.stale);
}

/** Members whose git-info is usable; the rest are listed as unknown. */
function knownMembers(input: GroupRailGitInput): GroupRailGitMember[] {
    return liveMembers(input.members).filter(member => member.info?.isGitRepo === true);
}

function groupPending(input: GroupRailGitInput): RailGitTile | null {
    if (input.members === undefined || (!input.read.data && input.read.loading)) {
        return { text: '…', tone: 'muted', label: 'reading member repositories' };
    }
    if (!input.read.data) return { text: '?', tone: 'muted', label: 'member Git status unavailable' };
    if (liveMembers(input.members).length === 0) return { text: '—', tone: 'muted', label: 'no live member repositories' };
    return null;
}

function unknownSuffix(input: GroupRailGitInput, known: number): string {
    const unknown = liveMembers(input.members).length - known;
    return unknown > 0 ? `, ${unknown} unknown` : '';
}

export function groupChangesTile(input: GroupRailGitInput): RailGitTile {
    const pending = groupPending(input);
    if (pending) return { ...pending, label: `Repository changes: ${pending.label}` };
    const known = knownMembers(input);
    if (known.length === 0) return { text: '?', tone: 'muted', label: 'Repository changes: member Git status unavailable' };
    const dirty = known.filter(member => member.info!.dirty).length;
    const lastKnown = input.read.failed ? 'Last known: ' : '';
    const label = `Repository changes: ${lastKnown}${dirty} of ${plural(liveMembers(input.members).length, 'repository', 'repositories')} changed${unknownSuffix(input, known.length)}`;
    if (dirty > 0) return { text: 'R' + capped(dirty), tone: 'changed', label };
    return known.length === liveMembers(input.members).length
        ? { text: '✓', tone: 'clean', label }
        : { text: 'R0', tone: 'muted', label };
}

export function groupSyncTile(input: GroupRailGitInput): RailGitTile {
    const pending = groupPending(input);
    if (pending) return { text: '↕' + pending.text, tone: 'muted', label: `Repository sync: ${pending.label}` };
    const compared = liveMembers(input.members).map(member => syncState(member.info)).filter(sync => sync.kind === 'compared');
    const diverged = compared.filter(sync => sync.kind === 'compared' && (sync.ahead > 0 || sync.behind > 0)).length;
    const uncompared = liveMembers(input.members).length - compared.length;
    const label = `Repository sync: ${input.read.failed ? 'Last known: ' : ''}${diverged} of ${plural(compared.length, 'compared repository', 'compared repositories')} ahead or behind upstream${uncompared > 0 ? `, ${uncompared} without an upstream comparison` : ''}`;
    if (compared.length === 0) return { text: '↕?', tone: 'muted', label };
    return { text: '↕' + capped(diverged), tone: diverged > 0 ? 'changed' : uncompared > 0 ? 'muted' : 'clean', label };
}

export function groupBranchTile(input: GroupRailGitInput): RailGitTile {
    if (input.members === undefined) return { text: 'Repos…', tone: 'muted', label: 'Member repositories: loading' };
    const count = liveMembers(input.members).length;
    return {
        text: plural(count, 'repo'),
        tone: 'muted',
        label: `${plural(count, 'member repository', 'member repositories')}; each has its own branch`,
    };
}

/** Preview line for one group member — always that member's own branch/state. */
export function describeGroupMember(member: GroupRailGitMember): { branch: string; changes: string; sync: string } {
    if (member.stale) return { branch: 'Unavailable', changes: 'Member repository is missing or unreadable', sync: '' };
    const info = member.info;
    if (info === undefined) return { branch: 'Reading…', changes: '', sync: '' };
    if (!info || !info.isGitRepo) return { branch: 'Unavailable', changes: 'Git status unavailable', sync: '' };
    const sync = syncState(info);
    return {
        branch: info.detached ? 'Detached HEAD' : info.branch || 'Unknown branch',
        changes: info.dirty ? 'Uncommitted changes' : 'Working tree clean',
        sync: sync.kind === 'compared'
            ? `↑${sync.ahead} ↓${sync.behind} vs ${sync.upstream}`
            : sync.kind === 'no-upstream' ? 'No upstream' : sync.kind === 'detached' ? 'No upstream comparison' : 'Sync unknown',
    };
}
