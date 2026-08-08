import { useEffect, useState } from 'react';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isChatStyleSelectorEnabled } from '../../utils/config';

/**
 * Cache of resolved remote capability, keyed by API base. A composer that
 * remounts (or a second composer pointing at the same clone) reuses the answer
 * instead of re-fetching `/config/runtime` on every mount.
 */
const remoteFlagCache = new Map<string, boolean>();

/** Test seam: drop the cached remote answers between cases. */
export function __resetChatStyleSelectorFlagCache(): void {
    remoteFlagCache.clear();
}

/**
 * Whether the server that owns the composer's target offers the chat Style
 * selector (`features.chatStyleSelector`).
 *
 * Two paths, one hook:
 *
 * - **Local workspace** (`apiBase` omitted): read the live dashboard config and
 *   subscribe to `DASHBOARD_CONFIG_UPDATED_EVENT`, so an open composer shows or
 *   hides Style the moment an admin flips the setting — no reload.
 * - **Remote clone** (`apiBase` given): fetch `${apiBase}/config/runtime` from
 *   the server that owns the clone, following the `useWorktreeCapability()`
 *   pattern. This keeps one server's flag from leaking into a clone owned by
 *   another. An unreachable or older server (no such flag) reads as unsupported.
 *
 * Returns `false` while a remote answer is still resolving so the selector never
 * flashes in and then disappears.
 */
export function useChatStyleSelectorEnabled(apiBase?: string): boolean {
    const [localEnabled, setLocalEnabled] = useState(isChatStyleSelectorEnabled());
    const [remoteEnabled, setRemoteEnabled] = useState<boolean | undefined>(
        apiBase ? remoteFlagCache.get(apiBase) : undefined,
    );

    useEffect(() => {
        const onConfigUpdated = () => setLocalEnabled(isChatStyleSelectorEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);

    useEffect(() => {
        if (!apiBase) {
            setRemoteEnabled(undefined);
            return;
        }
        const cached = remoteFlagCache.get(apiBase);
        if (cached !== undefined) {
            setRemoteEnabled(cached);
            return;
        }
        let cancelled = false;
        setRemoteEnabled(undefined);
        (async () => {
            let flag = false;
            try {
                const resp = await fetch(`${apiBase}/config/runtime`);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                flag = data?.features?.chatStyleSelectorEnabled === true;
            } catch {
                // Unreachable target / older server → unsupported, so the client
                // hides the control rather than sending a field that server rejects.
                flag = false;
            }
            remoteFlagCache.set(apiBase, flag);
            if (!cancelled) setRemoteEnabled(flag);
        })();
        return () => { cancelled = true; };
    }, [apiBase]);

    return apiBase ? remoteEnabled === true : localEnabled;
}
