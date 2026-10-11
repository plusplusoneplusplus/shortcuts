/**
 * repoGroupChatRowLabels — presentation helpers for a repo group's aggregated chat
 * list (canvas option B): the plain repo prefix shown before member chat titles,
 * the Pinned section, and the per-row unread rule.
 */
import type { RepoGroupChatSource } from '@plusplusoneplusplus/coc-client';
import type { RepoGroupChatRow } from './repoGroupChatFeed';

/** Prefixes longer than this are shortened when the short form stays unique. */
export const OWNER_PREFIX_MAX_LENGTH = 18;

export interface RepoGroupOwnerLabel {
    /** Prefix shown before the title; absent for the viewed group's own chats. */
    prefix?: string;
    /** Full owner name for hover/focus and accessible labels. */
    full: string;
}

function shorten(name: string): string {
    return name.length > OWNER_PREFIX_MAX_LENGTH ? name.slice(0, OWNER_PREFIX_MAX_LENGTH - 1) + '…' : name;
}

/**
 * Owner labels keyed by workspace id. Group-owned chats get no prefix. Member
 * prefixes use the registered name, shortened only when no two members would
 * then read the same; members sharing a registered name are told apart by their
 * workspace id.
 */
export function buildRepoGroupOwnerLabels(
    sources: readonly RepoGroupChatSource[],
): Map<string, RepoGroupOwnerLabel> {
    const labels = new Map<string, RepoGroupOwnerLabel>();
    const members = sources.filter(source => source.role === 'member');
    const nameCount = new Map<string, number>();
    for (const member of members) {
        const name = member.name || member.workspaceId;
        nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
    }
    const full = new Map(members.map(member => {
        const name = member.name || member.workspaceId;
        return [member.workspaceId, (nameCount.get(name) ?? 0) > 1 ? `${name} (${member.workspaceId})` : name];
    }));
    const shortCount = new Map<string, number>();
    for (const name of full.values()) shortCount.set(shorten(name), (shortCount.get(shorten(name)) ?? 0) + 1);
    for (const source of sources) {
        if (source.role === 'group') {
            labels.set(source.workspaceId, { full: source.name || source.workspaceId });
            continue;
        }
        const name = full.get(source.workspaceId)!;
        const short = shorten(name);
        labels.set(source.workspaceId, { prefix: (shortCount.get(short) ?? 0) > 1 ? name : short, full: name });
    }
    return labels;
}

function pinTime(row: RepoGroupChatRow): number {
    const t = Date.parse(row.item?.pinnedAt ?? '');
    return Number.isFinite(t) ? t : 0;
}

/**
 * Split loaded history into the Pinned section (newest pin first, like the repo
 * list; ties break on row identity) and the rest, which keeps the feed's global
 * latest-activity order.
 */
export function partitionPinnedRows(history: readonly RepoGroupChatRow[]): {
    pinned: RepoGroupChatRow[];
    rest: RepoGroupChatRow[];
} {
    const pinned: RepoGroupChatRow[] = [];
    const rest: RepoGroupChatRow[] = [];
    for (const row of history) (row.item?.pinnedAt && !row.item?.archived ? pinned : rest).push(row);
    pinned.sort((a, b) => pinTime(b) - pinTime(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return { pinned, rest };
}

/** Same rule as the owner's unread badge: finished, and not seen since it ended. */
export function isUnseenGroupChat(row: RepoGroupChatRow): boolean {
    const item = row.item;
    if (row.section !== 'history' || !item) return false;
    if (item.status !== 'completed' && item.status !== 'failed') return false;
    if (!item.endTime) return false;
    return item.seenAt !== item.endTime;
}
