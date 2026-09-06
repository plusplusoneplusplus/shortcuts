/**
 * useWhatsNew — asks the server once per dashboard load whether the running app
 * version has release notes the user has not seen yet (AC-05).
 *
 * The seen marker lives server-side (`whats-new.json` under the CoC data dir),
 * never in localStorage, so it survives a reinstall or a profile change.
 *
 * Every failure path is silent: a slow, unreachable, or erroring API renders
 * nothing at all — the dashboard is never blocked and never shows an error.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApi } from '../hooks/useApi';

export interface WhatsNewContent {
    version: string;
    tag: string;
    title: string;
    notes: string;
    htmlUrl?: string;
    isPrerelease: boolean;
}

export interface UseWhatsNewResult {
    /** Content to show, or null while in flight / when there is nothing unseen. */
    content: WhatsNewContent | null;
    /** Closes the modal for good and records the version as seen. */
    dismiss: () => void;
}

function toContent(data: unknown): WhatsNewContent | null {
    if (!data || typeof data !== 'object') return null;
    const raw = data as Record<string, unknown>;
    if (raw.show !== true) return null;
    if (typeof raw.version !== 'string' || typeof raw.notes !== 'string' || !raw.notes) return null;

    return {
        version: raw.version,
        tag: typeof raw.tag === 'string' ? raw.tag : `v${raw.version}`,
        title: typeof raw.title === 'string' && raw.title ? raw.title : `CoC v${raw.version}`,
        notes: raw.notes,
        htmlUrl: typeof raw.htmlUrl === 'string' ? raw.htmlUrl : undefined,
        isPrerelease: raw.isPrerelease === true,
    };
}

export function useWhatsNew(): UseWhatsNewResult {
    const [content, setContent] = useState<WhatsNewContent | null>(null);
    // One request per mounted dashboard, even under React StrictMode double-invoke.
    const requestedRef = useRef(false);
    // Mirrors `content` so `dismiss` stays a stable, side-effect-free callback.
    const contentRef = useRef<WhatsNewContent | null>(null);

    useEffect(() => {
        if (requestedRef.current) return;
        requestedRef.current = true;

        let cancelled = false;
        void (async () => {
            try {
                const data = await fetchApi('/whats-new');
                if (cancelled) return;
                const next = toContent(data);
                if (next) {
                    contentRef.current = next;
                    setContent(next);
                }
            } catch {
                // Offline, rate-limited, or the endpoint is missing — show nothing.
            }
        })();

        return () => { cancelled = true; };
    }, []);

    const dismiss = useCallback(() => {
        const current = contentRef.current;
        if (!current) return;
        contentRef.current = null;
        setContent(null);

        // Closing first means an ack failure never traps the user. Worst case the
        // modal reappears on the next launch, which is acceptable.
        void fetchApi('/whats-new/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: current.version }),
        }).catch(() => { /* ignored on purpose */ });
    }, []);

    return { content, dismiss };
}
