import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useUnifiedPanelHost, type UnifiedPanelHost } from './unifiedPanelHost';
import { lookupCloneBaseUrl, subscribeCloneBaseUrl } from '../../../repos/cloneRegistry';

interface CurrentChatSender {
    disabledReason?: string;
    requiresAutopilotConfirmation?: boolean;
    /** Revokes pending confirmation when the hydrated conversation or provider changes. */
    targetKey?: string;
    send: (message: string, switchToAutopilot?: boolean) => Promise<void>;
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
            requiresAutopilotConfirmation: sender.requiresAutopilotConfirmation,
            send: async (message, switchToAutopilot = false) => {
                const currentBaseUrl = host?.routingRef ? lookupCloneBaseUrl(host.routingRef) : undefined;
                if (!key || activeKey.current !== key || entries.get(key) !== value
                    || currentBaseUrl !== baseUrl || latest.current.targetKey !== sender.targetKey) {
                    throw new Error('The open chat changed. Send again from the current review.');
                }
                if (disabledReason) throw new Error(disabledReason);
                if (latest.current.disabledReason) throw new Error(latest.current.disabledReason);
                if (!!latest.current.requiresAutopilotConfirmation !== switchToAutopilot) {
                    throw new Error('Confirm switching this Ask chat to Autopilot before sending review comments.');
                }
                if (lock.pending) throw new Error('Comments are already being sent.');
                lock.pending = true;
                try {
                    await latest.current.send(message, switchToAutopilot);
                } finally {
                    lock.pending = false;
                }
            },
        };
        return value;
    }, [key, disabledReason, lock, sender.requiresAutopilotConfirmation, sender.targetKey]);
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
