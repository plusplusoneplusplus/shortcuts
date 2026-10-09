/**
 * sentinelTodoChats — which hosted chat is a Sentinel, and the live seams the
 * To-do tab shares with the panel shell.
 *
 * The panel knows only the selected chat id; the chat knows its mode and its
 * ledger owner. A mounted, hosted Sentinel `ChatDetail` publishes its owner
 * here keyed by `(panel scope, chat id)`, the same shape `unifiedChatChanges`
 * uses, and withdraws it on chat switch or unmount, so the scope key keeps
 * repos, repo groups, and remote clones apart.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isFeatureEnabled } from '../../../utils/config';
import { isSentinelTodoChangeFor, type SentinelTodoChangeEvent, type SentinelTodoOwner } from './sentinelTodoPanelModel';

/** What a hosted Sentinel chat publishes: its ledger owner, without a route. */
export type SentinelTodoChat = Omit<SentinelTodoOwner, 'ownerRoutingRef'>;

const entries = new Map<string, SentinelTodoChat>();
const listeners = new Map<string, Set<() => void>>();

function entryKey(scopeWorkspaceId: string, chatId: string): string {
    return `${scopeWorkspaceId}\n${chatId}`;
}

function notify(key: string): void {
    listeners.get(key)?.forEach(listener => listener());
}

export function publishSentinelTodoChat(scopeWorkspaceId: string, chatId: string, chat: SentinelTodoChat): void {
    const key = entryKey(scopeWorkspaceId, chatId);
    const current = entries.get(key);
    if (current && current.ownerWorkspaceId === chat.ownerWorkspaceId && current.processId === chat.processId) return;
    entries.set(key, { ownerWorkspaceId: chat.ownerWorkspaceId, processId: chat.processId });
    notify(key);
}

export function withdrawSentinelTodoChat(scopeWorkspaceId: string, chatId: string): void {
    const key = entryKey(scopeWorkspaceId, chatId);
    if (entries.delete(key)) notify(key);
}

export function getSentinelTodoChat(scopeWorkspaceId: string, chatId: string | null): SentinelTodoChat | null {
    return chatId === null ? null : entries.get(entryKey(scopeWorkspaceId, chatId)) ?? null;
}

/** Test helper: forget every published chat. */
export function clearSentinelTodoChats(): void {
    const keys = [...entries.keys()];
    entries.clear();
    keys.forEach(notify);
}

export function useSentinelTodoChat(scopeWorkspaceId: string, chatId: string | null): SentinelTodoChat | null {
    const key = chatId === null ? null : entryKey(scopeWorkspaceId, chatId);
    const subscribe = useCallback((listener: () => void) => {
        if (key === null) return () => {};
        let set = listeners.get(key);
        if (!set) listeners.set(key, set = new Set());
        set.add(listener);
        return () => {
            set!.delete(listener);
            if (set!.size === 0) listeners.delete(key);
        };
    }, [key]);
    const getSnapshot = () => getSentinelTodoChat(scopeWorkspaceId, chatId);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The live `features.sentinelTodoLedger` flag (runtime `sentinelTodoLedgerEnabled`). */
export function useSentinelTodoLedgerEnabled(): boolean {
    return useSyncExternalStore(subscribeDashboardConfig, readSentinelTodoFlag, readSentinelTodoFlag);
}

function subscribeDashboardConfig(listener: () => void): () => void {
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, listener);
}

function readSentinelTodoFlag(): boolean {
    return isFeatureEnabled('sentinelTodoLedgerEnabled');
}

/**
 * Ledger change events from the OWNING server's WebSocket, subscribed to the
 * owner workspace, so a remote-owned Sentinel refreshes from its own host.
 * `owner === null` subscribes to nothing.
 */
export function useSentinelTodoEvents(
    owner: SentinelTodoOwner | null,
    onChange: (event: SentinelTodoChangeEvent) => void,
): void {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const workspaceId = owner?.ownerWorkspaceId ?? null;
    const processId = owner?.processId ?? null;
    const routingRef = owner?.ownerRoutingRef;
    useEffect(() => {
        if (workspaceId === null || processId === null) return;
        // Resolved only for a Sentinel owner, so other chats touch no clone routing.
        const client = getCocClientForWorkspace(routingRef === null ? undefined : routingRef ?? workspaceId);
        const target = { ownerWorkspaceId: workspaceId, processId };
        const connection = client.events.connect({
            workspaceId,
            onMessage: message => {
                if (isSentinelTodoChangeFor(message, target)) onChangeRef.current(message);
            },
        });
        return () => connection.close();
    }, [workspaceId, processId, routingRef]);
}
