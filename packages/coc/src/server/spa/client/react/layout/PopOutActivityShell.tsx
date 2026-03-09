/**
 * PopOutActivityShell — standalone shell for a chat popped into a separate window.
 *
 * Rendered when `window.location.hash` starts with `#popout/activity/:taskId`.
 * Bootstraps its own minimal provider stack (AppProvider, QueueProvider,
 * ThemeProvider, ToastProvider) so it is fully independent of the parent window.
 *
 * URL format: `/?workspace=<workspaceId>#popout/activity/<taskId>`
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppProvider } from '../context/AppContext';
import { QueueProvider } from '../context/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../context/ToastContext';
import { ToastContainer, useToast } from '../shared';
import { ActivityChatDetail } from '../repos/ActivityChatDetail';
import { usePopOutChannel, type PopOutMessage } from '../hooks/usePopOutChannel';

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface PopOutRouteParams {
    taskId: string;
}

export function parsePopOutActivityRoute(hash: string): PopOutRouteParams | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'popout' || parts[1] !== 'activity' || !parts[2]) return null;
    return { taskId: decodeURIComponent(parts[2]) };
}

// ── Inner component (uses toast + channel) ─────────────────────────────────────

function PopOutContent({ taskId, workspaceId }: { taskId: string; workspaceId: string | null }) {
    const { toasts, addToast, removeToast } = useToast();
    const hasNotifiedRef = useRef(false);

    const handleMessage = useCallback((msg: PopOutMessage) => {
        if (msg.type === 'popout-restore' && msg.taskId === taskId) {
            window.close();
        }
    }, [taskId]);

    const { postMessage } = usePopOutChannel(handleMessage);

    // Notify parent and register beforeunload on mount
    useEffect(() => {
        if (hasNotifiedRef.current) return;
        hasNotifiedRef.current = true;
        postMessage({ type: 'popout-opened', taskId });

        const handleBeforeUnload = () => {
            postMessage({ type: 'popout-closed', taskId });
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [taskId, postMessage]);

    useEffect(() => {
        document.title = `Chat — CoC`;
    }, []);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="popout-shell">
                <ActivityChatDetail
                    taskId={taskId}
                    workspaceId={workspaceId ?? undefined}
                    isPopOut={true}
                />
            </div>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastProvider>
    );
}

// ── Shell entry point ──────────────────────────────────────────────────────────

export function PopOutActivityShell() {
    const parsed = parsePopOutActivityRoute(window.location.hash);
    const searchParams = new URLSearchParams(window.location.search);
    const workspaceId = searchParams.get('workspace');

    if (!parsed) {
        return (
            <div className="flex items-center justify-center h-screen text-sm text-[#848484]">
                Invalid pop-out URL.
            </div>
        );
    }

    return (
        <AppProvider>
            <QueueProvider>
                <ThemeProvider>
                    <PopOutContent taskId={parsed.taskId} workspaceId={workspaceId} />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
