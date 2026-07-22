/**
 * PopOutChatShell — standalone shell for a chat popped into a separate window.
 *
 * Rendered when `window.location.hash` starts with `#popout/activity/:taskId`.
 * Bootstraps its own minimal provider stack (AppProvider, QueueProvider,
 * ThemeProvider, ToastProvider) so it is fully independent of the parent window.
 *
 * URL format: `/?workspace=<workspaceId>#popout/activity/<taskId>`
 */

import { useEffect, useRef, useCallback } from 'react';
import { AppProvider } from '../contexts/AppContext';
import { QueueProvider } from '../contexts/QueueContext';
import { useQueueBootstrap } from '../contexts/useQueueBootstrap';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../contexts/ToastContext';
import { ChatPreferencesProvider } from '../contexts/ChatPreferencesContext';
import { ToastContainer, useToast } from '../ui';
import { ChatDetail } from '../features/chat/ChatDetail';
import { usePopOutChannel, type PopOutMessage } from '../features/chat/hooks/usePopOutChannel';
import { getHostname } from '../utils/config';
import { registerCloneBaseUrls } from '../repos/cloneRegistry';

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface PopOutRouteParams {
    taskId: string;
    workspaceId?: string;
    cloneBaseUrl?: string;
}

export function parsePopOutActivityRoute(hash: string, search = ''): PopOutRouteParams | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'popout' || parts[1] !== 'activity' || !parts[2]) return null;
    const searchParams = new URLSearchParams(search);
    return {
        taskId: decodeURIComponent(parts[2]),
        workspaceId: searchParams.get('workspace') || undefined,
        cloneBaseUrl: searchParams.get('cloneBaseUrl') || undefined,
    };
}

// ── Inner component (uses toast + channel) ─────────────────────────────────────

function PopOutContent({ taskId, workspaceId }: { taskId: string; workspaceId: string | null }) {
    const { toasts, addToast, removeToast } = useToast();
    const hasNotifiedRef = useRef(false);

    // Populate this window's own (otherwise empty) QueueProvider so ChatDetail can
    // resolve the implement-plan run's live status instead of showing 'Unknown'.
    // The popout is a separate OS window with its own React realm, so it never
    // runs App's connect-time bootstrap; fire the same fetch here once on mount.
    const bootstrapQueue = useQueueBootstrap();
    useEffect(() => {
        void bootstrapQueue();
    }, [bootstrapQueue]);

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
        const hostname = getHostname();
        const brand = hostname ? `CoC @ ${hostname}` : 'CoC';
        document.title = `Chat — ${brand}`;
    }, []);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <ChatPreferencesProvider workspaceId={workspaceId ?? ''}>
                <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="popout-shell">
                    <ChatDetail
                        taskId={taskId}
                        workspaceId={workspaceId ?? undefined}
                        isPopOut={true}
                    />
                </div>
            </ChatPreferencesProvider>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastProvider>
    );
}

// ── Shell entry point ──────────────────────────────────────────────────────────

export function PopOutChatShell() {
    const parsed = parsePopOutActivityRoute(window.location.hash, window.location.search);

    // Seed the clone registry before children render so remote chat detail actions
    // use the selected clone's CoC server inside the standalone pop-out window.
    if (parsed?.workspaceId && parsed.cloneBaseUrl) {
        registerCloneBaseUrls([{ workspaceId: parsed.workspaceId, baseUrl: parsed.cloneBaseUrl }]);
    }

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
                    <PopOutContent taskId={parsed.taskId} workspaceId={parsed.workspaceId ?? null} />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
