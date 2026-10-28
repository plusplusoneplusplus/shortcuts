/**
 * sentinelTodoExcursion — opening a chat from a Sentinel To-do link, then
 * coming back.
 *
 * A plain click on a To-do Job/Ref link starts an *excursion*: one in-memory
 * record per window naming the origin Sentinel (panel scope, chat, ledger
 * owner, title, route) and the hosted chats visited since. While the selected
 * chat is on that path, the panel layers the origin's To-do over the stored
 * tabs as a transient, owner-labelled tab, and the chat shows an origin bar
 * with Back to Sentinel. Back, arriving at the origin from anywhere, Unpin, or
 * closing the pinned tab ends it. Nothing here writes ledger or chat state, and
 * a reload forgets it.
 *
 * The To-do view (scroll position, expanded rows) is remembered per ledger
 * owner across remounts, so the origin tab and the pinned tab show the same
 * list and a return restores it. Back also focuses the link that was followed.
 */

import { useSyncExternalStore } from 'react';
import type { SentinelTodoExternalReference, SentinelTodoPriority, SentinelTodoStatus } from '@plusplusoneplusplus/coc-client';
import { buildRepoGroupChatHash, parseRepoGroupChatDeepLink } from '../../../layout/dashboardRoutes';
import { decodeSegment, encodeSegment, repoHashBase, tokenizeHash } from '../../../layout/routePath';
import { buildRemoteCloneKey, parseRemoteCloneKey } from '../../../repos/cloneIdentity';
import { sentinelTodoOwnerKey, sentinelTodoTabInput, type SentinelTodoOwner } from './sentinelTodoPanelModel';
import { openTab, unifiedTabId, type UnifiedPanelState } from './unifiedPanelTabsModel';

/** A hosted chat on the path: its panel scope, chat id, title, and route. */
export interface SentinelTodoExcursionStop {
    scopeWorkspaceId: string;
    chatId: string;
    title: string | null;
    /** The hash route to return to this chat. */
    href: string;
}

export interface SentinelTodoExcursionOrigin extends SentinelTodoExcursionStop {
    owner: SentinelTodoOwner;
    /** The followed link, focused again on Back. */
    linkKey: string;
}

export interface SentinelTodoExcursion {
    origin: SentinelTodoExcursionOrigin;
    /** Chats visited since leaving the origin, oldest first; the last is current. */
    trail: readonly SentinelTodoExcursionStop[];
}

/** The longest path kept; older stops drop off the front. */
export const SENTINEL_TODO_EXCURSION_MAX_TRAIL = 5;

function sameChat(a: Pick<SentinelTodoExcursionStop, 'scopeWorkspaceId' | 'chatId'>, b: Pick<SentinelTodoExcursionStop, 'scopeWorkspaceId' | 'chatId'>): boolean {
    return a.scopeWorkspaceId === b.scopeWorkspaceId && a.chatId === b.chatId;
}

/**
 * Record arriving at a hosted chat. The origin ends the excursion once the
 * user has left it; a chat already on the path trims the path back to it.
 */
export function visitExcursionStop(excursion: SentinelTodoExcursion, stop: SentinelTodoExcursionStop): SentinelTodoExcursion | null {
    if (sameChat(stop, excursion.origin)) return excursion.trail.length > 0 ? null : excursion;
    const at = excursion.trail.findIndex(entry => sameChat(entry, stop));
    if (at >= 0 && at === excursion.trail.length - 1 && excursion.trail[at].title === stop.title) return excursion;
    const trail = at >= 0
        ? [...excursion.trail.slice(0, at), stop]
        : [...excursion.trail, stop].slice(-SENTINEL_TODO_EXCURSION_MAX_TRAIL);
    return { ...excursion, trail };
}

/** Index of a chat on the path, or -1 when it is not on an excursion. */
export function excursionStopIndex(excursion: SentinelTodoExcursion | null, scopeWorkspaceId: string, chatId: string | null): number {
    if (excursion === null || chatId === null) return -1;
    return excursion.trail.findIndex(stop => sameChat(stop, { scopeWorkspaceId, chatId }));
}

/** The pinned To-do's label: always names whose list it is. */
export function pinnedSentinelTodoLabel(origin: SentinelTodoExcursionOrigin): string {
    return `To-do · ${origin.title ?? 'Sentinel'}`;
}

function pinnedInput(excursion: SentinelTodoExcursion, chatId: string) {
    return { ...sentinelTodoTabInput(excursion.origin.owner, chatId), label: pinnedSentinelTodoLabel(excursion.origin) };
}

/** Id of the pinned To-do in a chat on the path, or null elsewhere. */
export function pinnedSentinelTodoTabId(excursion: SentinelTodoExcursion | null, scopeWorkspaceId: string, chatId: string | null): string | null {
    if (excursionStopIndex(excursion, scopeWorkspaceId, chatId) < 0) return null;
    return unifiedTabId(pinnedInput(excursion!, chatId!));
}

/**
 * The read state with the origin's To-do layered into a chat on the path.
 * Stored selections are kept as they are, so the pinned tab is active only
 * when that chat's remembered selection names it; nothing is persisted.
 */
export function withPinnedSentinelTodo(
    state: UnifiedPanelState,
    excursion: SentinelTodoExcursion | null,
    scopeWorkspaceId: string,
    chatId: string | null,
): UnifiedPanelState {
    if (excursionStopIndex(excursion, scopeWorkspaceId, chatId) < 0) return state;
    return { ...openTab(state, pinnedInput(excursion!, chatId!)), activeByScope: state.activeByScope };
}

/** Whether a To-do view is the origin's list shown pinned in another chat. */
export function isPinnedSentinelTodo(excursion: SentinelTodoExcursion | null, owner: SentinelTodoOwner, chatId: string | null): boolean {
    return excursion !== null
        && chatId !== excursion.origin.chatId
        && sentinelTodoOwnerKey(owner) === sentinelTodoOwnerKey(excursion.origin.owner);
}

// ---------------------------------------------------------------------------
// The window's excursion
// ---------------------------------------------------------------------------

let current: SentinelTodoExcursion | null = null;
const listeners = new Set<() => void>();

function setExcursion(next: SentinelTodoExcursion | null): void {
    if (next === current) return;
    current = next;
    listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getSentinelTodoExcursion(): SentinelTodoExcursion | null {
    return current;
}

export function useSentinelTodoExcursion(): SentinelTodoExcursion | null {
    return useSyncExternalStore(subscribe, getSentinelTodoExcursion, getSentinelTodoExcursion);
}

/** The ledger owner is authoritative; the window URL can already name a child. */
function originChatHref(origin: SentinelTodoExcursionOrigin): string {
    const { owner, href } = origin;
    const remote = parseRemoteCloneKey(owner.ownerRoutingRef);
    const selectionId = remote
        ? buildRemoteCloneKey(remote.serverId, owner.ownerWorkspaceId)
        : owner.ownerWorkspaceId;
    const fallback = `${repoHashBase(selectionId)}/chats/${encodeSegment(owner.processId)}`;
    try {
        const member = parseRepoGroupChatDeepLink(href);
        if (member?.ownerSelectionId === selectionId) {
            return member.processId === owner.processId ? href
                : buildRepoGroupChatHash(member.groupSelectionId, owner.ownerWorkspaceId, owner.processId);
        }
        const { segments } = tokenizeHash(href);
        if (segments[0] !== 'repos' || decodeSegment(segments[1] ?? '') !== selectionId
            || !['chats', 'activity', 'tasks'].includes(segments[2])) return fallback;
        // Keep valid route metadata, but never copy a different chat's sub-view.
        if (segments.length === 4 && decodeSegment(segments[3]) === owner.processId) return href;
        return `${repoHashBase(selectionId)}/${segments[2]}/${encodeSegment(owner.processId)}`;
    } catch {
        return fallback;
    }
}

/**
 * Follow a To-do link. A link in the pinned list keeps the running excursion
 * and its path, updating only the link Back returns focus to.
 */
export function startSentinelTodoExcursion(origin: SentinelTodoExcursionOrigin): void {
    if (current !== null && sentinelTodoOwnerKey(current.origin.owner) === sentinelTodoOwnerKey(origin.owner)) {
        if (current.origin.linkKey !== origin.linkKey) setExcursion({ ...current, origin: { ...current.origin, linkKey: origin.linkKey } });
        return;
    }
    setExcursion({ origin: { ...origin, href: originChatHref(origin) }, trail: [] });
}

export function visitSentinelTodoExcursionChat(stop: SentinelTodoExcursionStop): void {
    if (current !== null) setExcursion(visitExcursionStop(current, stop));
}

export function endSentinelTodoExcursion(): void {
    setExcursion(null);
}

/** End the excursion and return the origin route; Back focuses the followed link there. */
export function returnFromSentinelTodoExcursion(): string | null {
    if (current === null) return null;
    const { owner, linkKey, href } = current.origin;
    rememberSentinelTodoView(owner, { focusLinkKey: linkKey });
    setExcursion(null);
    return href;
}

// ---------------------------------------------------------------------------
// Remembered To-do view, per ledger owner
// ---------------------------------------------------------------------------

export interface SentinelTodoView {
    scrollTop?: number;
    expandedIds?: readonly string[];
    selectedId?: string | null;
    detailOpen?: boolean;
    sections?: {
        done: boolean; archived: boolean; manual: boolean; manualDone: boolean; manualArchived: boolean;
    };
    itemDrafts?: Readonly<Record<string, {
        editing: {
            titleOnly?: boolean;
            notesOnly?: boolean;
            title: string; completionCondition: string; notes: string; priority: SentinelTodoPriority; baseRevision: number;
            externalReferences?: SentinelTodoExternalReference[];
            externalReferencesChanged?: boolean;
            initialFields?: { title: string; completionCondition: string; notes: string; priority: SentinelTodoPriority };
        } | null;
        statusDraft: { status: SentinelTodoStatus; reason: string } | null;
        error: string | null;
        notesOpen?: boolean;
    }>>;
    /** A link to focus once, on the next mount after Back. */
    focusLinkKey?: string;
}

const views = new Map<string, SentinelTodoView>();

/** Merge into the owner's remembered view; an `undefined` field clears it. */
export function rememberSentinelTodoView(owner: SentinelTodoOwner, view: SentinelTodoView): void {
    const key = sentinelTodoOwnerKey(owner);
    views.set(key, { ...views.get(key), ...view });
}

export function recallSentinelTodoView(owner: SentinelTodoOwner): SentinelTodoView {
    return views.get(sentinelTodoOwnerKey(owner)) ?? {};
}

/** Test helper: forget the excursion and every remembered view. */
export function clearSentinelTodoExcursion(): void {
    views.clear();
    setExcursion(null);
}
