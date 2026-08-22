import { useEffect, useState } from 'react';
import { normalizeApiBasePath } from '@plusplusoneplusplus/coc-client';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isChatStyleSelectorEnabled } from '../../utils/config';

/**
 * Cache of resolved remote capability, keyed by the clone's server-root
 * `baseUrl`. A composer that remounts (or a second composer pointing at the
 * same clone) reuses the answer instead of re-fetching `/config/runtime` on
 * every mount.
 */
const remoteFlagCache = new Map<string, boolean>();

/**
 * Probe URL for a remote server's runtime config, built from its server root.
 * Mirrors `cloneApiBase`: remote CoC servers are never in container mode, so
 * the plain configured `apiBasePath` (not `getApiBase()`) is appended.
 */
function remoteRuntimeConfigUrl(baseUrl: string): string {
    const apiBasePath = (globalThis as { window?: { __DASHBOARD_CONFIG__?: { apiBasePath?: string } } })
        .window?.__DASHBOARD_CONFIG__?.apiBasePath;
    return `${baseUrl.replace(/\/+$/, '')}${normalizeApiBasePath(apiBasePath)}/config/runtime`;
}

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
 * - **Local workspace** (`baseUrl` omitted): read the live dashboard config and
 *   subscribe to `DASHBOARD_CONFIG_UPDATED_EVENT`, so an open composer shows or
 *   hides Style the moment an admin flips the setting — no reload.
 * - **Remote clone** (`baseUrl` given): `baseUrl` is the clone's **server root**
 *   as returned by `useResolveCloneBaseUrl()` / `sourceRemoteInfo` (e.g.
 *   `http://127.0.0.1:4000`, no `/api` suffix) — the same shape sibling hooks
 *   like `useAgentProviders` take. The hook appends the api base path itself
 *   and fetches `/config/runtime` from the server that owns the clone. This
 *   keeps one server's flag from leaking into a clone owned by another. An
 *   unreachable or older server (no such flag) reads as unsupported.
 *
 * Returns `false` while a remote answer is still resolving so the selector never
 * flashes in and then disappears.
 */
export function useChatStyleSelectorEnabled(baseUrl?: string): boolean {
    const [localEnabled, setLocalEnabled] = useState(isChatStyleSelectorEnabled());
    const [remoteEnabled, setRemoteEnabled] = useState<boolean | undefined>(
        baseUrl ? remoteFlagCache.get(baseUrl) : undefined,
    );

    useEffect(() => {
        const onConfigUpdated = () => setLocalEnabled(isChatStyleSelectorEnabled());
        window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
        return () => window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    }, []);

    useEffect(() => {
        if (!baseUrl) {
            setRemoteEnabled(undefined);
            return;
        }
        const cached = remoteFlagCache.get(baseUrl);
        if (cached !== undefined) {
            setRemoteEnabled(cached);
            return;
        }
        let cancelled = false;
        setRemoteEnabled(undefined);
        (async () => {
            let flag = false;
            try {
                const resp = await fetch(remoteRuntimeConfigUrl(baseUrl));
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const data = await resp.json();
                flag = data?.features?.chatStyleSelectorEnabled === true;
            } catch {
                // Unreachable target / older server → unsupported, so the client
                // hides the control rather than sending a field that server rejects.
                flag = false;
            }
            remoteFlagCache.set(baseUrl, flag);
            if (!cancelled) setRemoteEnabled(flag);
        })();
        return () => { cancelled = true; };
    }, [baseUrl]);

    return baseUrl ? remoteEnabled === true : localEnabled;
}
