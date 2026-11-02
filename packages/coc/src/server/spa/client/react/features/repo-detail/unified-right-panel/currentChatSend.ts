import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useUnifiedPanelHost, type UnifiedPanelHost } from './unifiedPanelHost';
import { lookupCloneBaseUrl, subscribeCloneBaseUrl } from '../../../repos/cloneRegistry';

interface CurrentChatSender {
    disabledReason?: string;
    send: (message: string) => Promise<void>;
}

const entries = new Map<string, CurrentChatSender>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const keyFor = (host: UnifiedPanelHost | null, baseUrl?: string) => host?.chatId
    ? JSON.stringify([host.workspaceId, host.routingRef ?? null, baseUrl ?? null, host.chatId]) : null;

function useHostBaseUrl(host: UnifiedPanelHost | null) {
    const ref = host?.routingRef ?? undefined;
    return useSyncExternalStore(
        useCallback(listener => subscribeCloneBaseUrl(ref, listener), [ref]),
        useCallback(() => ref ? lookupCloneBaseUrl(ref) : undefined, [ref]),
        () => undefined,
    );
}

/** Only the selected, mounted conversation publishes under its exact panel owner. */
export function usePublishCurrentChatSend(host: UnifiedPanelHost | null, sender: CurrentChatSender, ownerBaseUrl?: string): void {
    const baseUrl = useHostBaseUrl(host);
    const key = keyFor(host, baseUrl);
    const activeKey = useRef(key);
    activeKey.current = key;
    const lock = useMemo(() => ({ pending: false }), [key]);
    const disabledReason = (host?.routingRef && !baseUrl) || (baseUrl ?? '') !== (ownerBaseUrl ?? '')
        ? 'The open chat server is unavailable or does not match this panel.' : sender.disabledReason;
    const latest = useRef(sender);
    latest.current = { ...sender, disabledReason };
    const entry = useMemo(() => {
        const value: CurrentChatSender = {
            disabledReason,
            send: async message => {
                if (!key || activeKey.current !== key || entries.get(key) !== value) throw new Error('The open chat changed. Send again from the current review.');
                if (disabledReason) throw new Error(disabledReason);
                if (latest.current.disabledReason) throw new Error(latest.current.disabledReason);
                if (lock.pending) throw new Error('Comments are already being sent.');
                lock.pending = true;
                try {
                    await latest.current.send(message);
                } finally {
                    lock.pending = false;
                }
            },
        };
        return value;
    }, [key, disabledReason, lock]);
    useEffect(() => {
        if (!key) return;
        entries.set(key, entry);
        notify();
        return () => {
            if (entries.get(key) === entry) {
                entries.delete(key);
                notify();
            }
        };
    }, [key, entry]);
}

export function useCurrentChatSend(): CurrentChatSender {
    const host = useUnifiedPanelHost();
    const baseUrl = useHostBaseUrl(host);
    const key = keyFor(host, baseUrl);
    const entry = useSyncExternalStore(
        useCallback(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []),
        useCallback(() => key ? entries.get(key) : undefined, [key]),
        () => undefined,
    );
    return entry ?? {
        disabledReason: host?.chatId ? 'Sending is unavailable in the open chat.' : 'Open a chat to send comments.',
        send: async () => { throw new Error('Open a suitable chat to send comments.'); },
    };
}
