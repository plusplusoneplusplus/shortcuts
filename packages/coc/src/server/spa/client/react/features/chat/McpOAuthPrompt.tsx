/**
 * McpOAuthPrompt
 *
 * Renders an inline OAuth authentication prompt within the chat conversation
 * when an MCP server requires authorization. Auto-opens the auth URL and
 * polls for completion, then triggers auto-retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBase } from '../../utils/config';
import type { McpOAuthPromptData } from './hooks/useChatSSE';

export type McpOAuthPromptStatus = 'waiting' | 'authorizing' | 'completed' | 'failed';

export interface McpOAuthPromptProps {
    data: McpOAuthPromptData;
    /** Called when OAuth flow completes successfully. */
    onCompleted?: (requestId: string) => void;
    /** Called when OAuth flow fails or times out. */
    onFailed?: (requestId: string) => void;
}

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 min max wait

export function McpOAuthPrompt({ data, onCompleted, onFailed }: McpOAuthPromptProps) {
    const [status, setStatus] = useState<McpOAuthPromptStatus>('waiting');
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; };
    }, []);

    const stopPolling = useCallback(() => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    }, []);

    const handleAuthorize = useCallback(() => {
        // Open the auth URL in a new tab
        if (data.authorizationUrl) {
            window.open(data.authorizationUrl, '_blank', 'noopener,noreferrer');
        }
        setStatus('authorizing');

        // Start polling for completion
        const poll = setInterval(async () => {
            try {
                const res = await fetch(`${getApiBase()}/mcp-oauth/pending/${encodeURIComponent(data.requestId)}`);
                if (!res.ok) return;
                const entry = await res.json();
                if (!mountedRef.current) { stopPolling(); return; }
                if (entry.status === 'completed') {
                    stopPolling();
                    setStatus('completed');
                    onCompleted?.(data.requestId);
                } else if (entry.status === 'failed') {
                    stopPolling();
                    setStatus('failed');
                    setErrorMessage(entry.error ?? 'Authorization failed');
                    onFailed?.(data.requestId);
                }
            } catch {
                // Network error — keep polling
            }
        }, POLL_INTERVAL_MS);
        pollRef.current = poll;

        // Timeout after max wait
        timeoutRef.current = setTimeout(() => {
            if (!mountedRef.current) return;
            stopPolling();
            setStatus('failed');
            setErrorMessage('Authorization timed out');
            onFailed?.(data.requestId);
        }, POLL_TIMEOUT_MS);
    }, [data, onCompleted, onFailed, stopPolling]);

    const handleCompleteAndRetry = useCallback(async () => {
        try {
            await fetch(`${getApiBase()}/mcp-oauth/pending/${encodeURIComponent(data.requestId)}/complete-and-retry`, {
                method: 'POST',
            });
        } catch {
            // Non-fatal
        }
    }, [data.requestId]);

    // Auto-open auth URL on mount if available
    useEffect(() => {
        if (data.authorizationUrl && status === 'waiting') {
            handleAuthorize();
        }
        return stopPolling;
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-trigger retry on completion
    useEffect(() => {
        if (status === 'completed') {
            void handleCompleteAndRetry();
        }
    }, [status, handleCompleteAndRetry]);

    return (
        <div
            data-testid="mcp-oauth-prompt"
            className="my-3 mx-2 p-4 rounded-lg border border-amber-300/40 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-900/10"
        >
            <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0" aria-hidden="true">🔐</span>
                <div className="flex-1 min-w-0">
                    {status === 'waiting' && (
                        <>
                            <p className="text-sm font-medium text-[#1f2328] dark:text-[#e6edf3]">
                                <strong>{data.serverName}</strong> requires authentication
                            </p>
                            <p className="text-xs text-[#656d76] dark:text-[#8b949e] mt-1">
                                Authorize access to continue using this MCP server.
                            </p>
                            {data.authorizationUrl ? (
                                <button
                                    onClick={handleAuthorize}
                                    className="mt-3 px-3 py-1.5 text-xs font-medium rounded-md bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                                >
                                    Authorize in Browser
                                </button>
                            ) : (
                                <p className="text-xs text-[#656d76] dark:text-[#8b949e] mt-2 italic">
                                    Please authenticate with {data.serverName} at {data.serverUrl} and retry.
                                </p>
                            )}
                        </>
                    )}

                    {status === 'authorizing' && (
                        <>
                            <p className="text-sm font-medium text-[#1f2328] dark:text-[#e6edf3]">
                                Waiting for authorization…
                            </p>
                            <p className="text-xs text-[#656d76] dark:text-[#8b949e] mt-1">
                                Complete the sign-in in your browser. This will auto-detect when done.
                            </p>
                            {data.authorizationUrl && (
                                <a
                                    href={data.authorizationUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#0078d4] hover:underline mt-2 inline-block"
                                >
                                    Open authorization page again ↗
                                </a>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                                <div className="w-3 h-3 border-2 border-[#0078d4] border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs text-[#656d76] dark:text-[#8b949e]">Polling…</span>
                            </div>
                        </>
                    )}

                    {status === 'completed' && (
                        <p className="text-sm font-medium text-green-700 dark:text-green-400">
                            ✓ Authorized — retrying…
                        </p>
                    )}

                    {status === 'failed' && (
                        <>
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">
                                Authorization failed
                            </p>
                            {errorMessage && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{errorMessage}</p>
                            )}
                            {data.authorizationUrl && (
                                <button
                                    onClick={() => { setStatus('waiting'); setErrorMessage(undefined); handleAuthorize(); }}
                                    className="mt-2 px-3 py-1.5 text-xs font-medium rounded-md bg-[#0078d4] text-white hover:bg-[#106ebe] transition-colors"
                                >
                                    Try Again
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
