/**
 * SecurityBanner — high-visibility warning shown when the CoC server is
 * bound to an address that exposes it on all network interfaces (e.g.,
 * '0.0.0.0' or '::'). In that mode any device that can reach the host
 * over the network can access conversations, files, terminals, and AI
 * sessions, so we surface the risk loudly above the TopBar instead of
 * silently rewriting the URL to 'localhost'.
 *
 * Visibility rules:
 *   - Hidden when the binding is safe (e.g., '127.0.0.1').
 *   - Hidden once the user clicks "I understand the risk" for the current
 *     browser session (state stored in sessionStorage).
 *   - Reappears on full page reload (sessionStorage cleared by the user
 *     closing the tab/browser).
 */

import { useCallback, useEffect, useState } from 'react';
import { getBindAddress, isExposedBinding } from '../utils/config';

const ACK_STORAGE_KEY = 'coc:security-ack';
const SAFE_RESTART_COMMAND = 'coc serve --host 127.0.0.1';

function readAck(): boolean {
    try {
        return typeof window !== 'undefined' && window.sessionStorage?.getItem(ACK_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

function writeAck(): void {
    try {
        window.sessionStorage?.setItem(ACK_STORAGE_KEY, '1');
    } catch {
        /* ignore — private mode or storage disabled */
    }
}

function getDisplayPort(): string {
    if (typeof window === 'undefined') return '';
    const port = window.location?.port;
    if (port) return port;
    return window.location?.protocol === 'https:' ? '443' : '80';
}

export function SecurityBanner(): JSX.Element | null {
    const exposed = isExposedBinding();
    const [acknowledged, setAcknowledged] = useState<boolean>(() => readAck());
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!copied) return;
        const t = window.setTimeout(() => setCopied(false), 1500);
        return () => window.clearTimeout(t);
    }, [copied]);

    const handleAcknowledge = useCallback(() => {
        writeAck();
        setAcknowledged(true);
    }, []);

    const handleCopy = useCallback(async () => {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(SAFE_RESTART_COMMAND);
            } else {
                const ta = document.createElement('textarea');
                ta.value = SAFE_RESTART_COMMAND;
                ta.setAttribute('readonly', '');
                ta.style.position = 'absolute';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
        } catch {
            /* ignore — clipboard unavailable */
        }
    }, []);

    if (!exposed || acknowledged) return null;

    const bindAddress = getBindAddress() ?? '';
    const port = getDisplayPort();
    const target = port ? `${bindAddress}:${port}` : bindAddress;

    return (
        <div
            role="alert"
            aria-live="assertive"
            data-testid="security-banner"
            className="w-full border-b-2 border-red-500 bg-red-50 px-4 py-2 text-red-900 dark:border-red-400 dark:bg-red-900/30 dark:text-red-100"
        >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2">
                    <span aria-hidden="true" className="text-lg leading-tight">🔓</span>
                    <div className="text-sm leading-snug">
                        <div className="font-semibold">
                            Security Warning: Server exposed on all network interfaces
                        </div>
                        <div>
                            Bound to <code className="font-mono">{target}</code> — anyone on your network can access conversations, files, and terminals.
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                    <button
                        type="button"
                        onClick={handleCopy}
                        data-testid="security-banner-copy"
                        className="rounded border border-red-400 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-300 dark:bg-red-950 dark:text-red-100 dark:hover:bg-red-900"
                    >
                        {copied ? '✓ Copied' : 'Copy safe restart command'}
                    </button>
                    <button
                        type="button"
                        onClick={handleAcknowledge}
                        data-testid="security-banner-ack"
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-400"
                    >
                        I understand the risk
                    </button>
                </div>
            </div>
        </div>
    );
}
