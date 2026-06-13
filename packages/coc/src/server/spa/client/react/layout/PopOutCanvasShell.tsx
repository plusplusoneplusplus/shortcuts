/**
 * PopOutCanvasShell — standalone shell for a canvas in a separate browser window.
 *
 * Rendered when `window.location.hash` starts with `#popout/canvas`.
 * URL format: `/?workspace=<wsId>&canvasId=<canvasId>#popout/canvas`
 *
 * The window renders the shared CanvasPanel full-screen. Live updates arrive
 * two ways: the global WebSocket `canvas-updated` event (user saves and
 * extension capability calls from any window) is mapped into the panel's
 * `liveEvent`, and refocusing the window bumps `reloadNonce` so AI tool edits
 * (which stream over the chat SSE channel, not WS) are picked up on focus.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppProvider } from '../contexts/AppContext';
import { QueueProvider } from '../contexts/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer, useToast } from '../ui';
import { CanvasPanel } from '../features/canvas/CanvasPanel';
import type { CanvasUpdatedEvent } from '../features/chat/hooks/useChatSSE';
import { useWebSocket } from '../hooks/useWebSocket';
import { getHostname } from '../utils/config';

export interface PopOutCanvasParams {
    wsId: string;
    canvasId: string;
}

export function parsePopOutCanvasRoute(hash: string, search: string): PopOutCanvasParams | null {
    if (!hash.replace(/^#/, '').startsWith('popout/canvas')) return null;
    const searchParams = new URLSearchParams(search);
    const wsId = searchParams.get('workspace');
    const canvasId = searchParams.get('canvasId');
    if (!wsId || !canvasId) return null;
    return { wsId, canvasId };
}

function PopOutCanvasContent({ params }: { params: PopOutCanvasParams }) {
    const { toasts, addToast, removeToast } = useToast();
    const [liveEvent, setLiveEvent] = useState<CanvasUpdatedEvent | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);

    const handleMessage = useCallback((msg: { type?: string; canvasId?: string; title?: string; revision?: number; editor?: string }) => {
        if (msg?.type === 'canvas-updated' && msg.canvasId === params.canvasId && typeof msg.revision === 'number') {
            setLiveEvent({
                canvasId: msg.canvasId,
                title: typeof msg.title === 'string' ? msg.title : '',
                revision: msg.revision,
                editor: msg.editor === 'user' ? 'user' : 'ai',
            });
        }
    }, [params.canvasId]);

    const { connect, disconnect } = useWebSocket({ onMessage: handleMessage });
    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    // AI tool edits stream over the chat SSE channel (absent here); pick them up
    // when the user returns to this window.
    const seenRef = useRef(false);
    useEffect(() => {
        const onFocus = () => {
            if (!seenRef.current) { seenRef.current = true; return; }
            setReloadNonce(n => n + 1);
        };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, []);

    useEffect(() => {
        const hostname = getHostname();
        const brand = hostname ? `CoC @ ${hostname}` : 'CoC';
        document.title = `Canvas — ${brand}`;
    }, []);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <div className="h-screen bg-[#fafafa] dark:bg-[#1e1e1e]" data-testid="popout-canvas-shell">
                <CanvasPanel
                    workspaceId={params.wsId}
                    canvasId={params.canvasId}
                    liveEvent={liveEvent}
                    reloadNonce={reloadNonce}
                />
            </div>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastProvider>
    );
}

export function PopOutCanvasShell() {
    const params = parsePopOutCanvasRoute(window.location.hash, window.location.search);

    if (!params) {
        return (
            <div className="flex items-center justify-center h-screen text-sm text-[#848484]">
                Invalid canvas pop-out URL.
            </div>
        );
    }

    return (
        <AppProvider>
            <QueueProvider>
                <ThemeProvider>
                    <PopOutCanvasContent params={params} />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
