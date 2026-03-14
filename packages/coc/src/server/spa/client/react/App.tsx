/**
 * App — root React component.
 * Wraps providers around the layout shell.
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { QueueProvider, useQueue } from './context/QueueContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';
import { ToastProvider } from './context/ToastContext';
import { MinimizedDialogsProvider, useMinimizedDialog, MinimizedDialogsTray } from './context/MinimizedDialogsContext';
import { PopOutProvider } from './context/PopOutContext';
import { FloatingChatsProvider } from './context/FloatingChatsContext';
import { ThemeProvider } from './layout/ThemeProvider';
import { TopBar } from './layout/TopBar';
import { BottomNav } from './layout/BottomNav';
import { Router } from './layout/Router';
import { FloatingChatManager } from './layout/FloatingChatManager';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchApi } from './hooks/useApi';
import { ToastContainer, useToast } from './shared';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
import { MarkdownReviewDialog } from './processes/MarkdownReviewDialog';
import { EnqueueDialog } from './queue/EnqueueDialog';
import { isAbsolutePath, resolveRelativePath } from './utils/path-resolution';
import { buildNotificationEntry } from './utils/build-notification-entry';

interface MarkdownReviewDialogState {
    open: boolean;
    minimized: boolean;
    scrollTop: number;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
}

/* @internal – exported for testing only */
export interface WorkspaceLike {
    id: string;
    rootPath?: string;
}


function normalizePath(pathValue: string): string {
    return toForwardSlashes(pathValue);
}

function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
}


/* @internal – exported for testing only */
export function resolveWorkspaceForPath(filePath: string, workspaces: WorkspaceLike[]): WorkspaceLike | null {
    const normalizedPath = normalizePath(filePath).toLowerCase();
    let best: WorkspaceLike | null = null;

    for (const ws of workspaces) {
        if (!ws?.rootPath) continue;
        const normalizedRoot = normalizePath(ws.rootPath).replace(/\/+$/, '').toLowerCase();
        if (!normalizedRoot) continue;

        if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
            if (!best || normalizedRoot.length > normalizePath(best.rootPath || '').toLowerCase().length) {
                best = ws;
            }
        }
    }

    return best;
}

function toTaskRelativePath(fullPath: string, workspaceRoot: string): string | null {
    if (!workspaceRoot) return null;
    const normalizedPath = normalizePath(fullPath);
    const normalizedRoot = normalizePath(workspaceRoot).replace(/\/+$/, '');
    const tasksRoot = `${normalizedRoot}/.vscode/tasks`;

    if (normalizedPath === tasksRoot) return '';
    if (!normalizedPath.startsWith(tasksRoot + '/')) return null;

    return normalizedPath.slice(tasksRoot.length + 1);
}


function AppInner() {
    const { state: appState, dispatch: appDispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { addNotification } = useNotifications();
    const { toasts, addToast, removeToast } = useToast();
    const prevWsStatusRef = useRef(appState.wsStatus);
    const hasConnectedRef = useRef(false);
    const [reviewDialog, setReviewDialog] = useState<MarkdownReviewDialogState>({
        open: false,
        minimized: false,
        scrollTop: 0,
        wsId: null,
        filePath: null,
        displayPath: null,
        fetchMode: 'auto',
    });

    const handleConnect = useCallback(async () => {
        const data = await fetchApi('/queue').catch(() => null);
        if (data && Array.isArray(data.queued) && Array.isArray(data.running)) {
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
        }
    }, [queueDispatch]);

    const onMessage = useCallback((msg: any) => {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'process-added':
                if (msg.process) appDispatch({ type: 'PROCESS_ADDED', process: msg.process });
                break;
            case 'process-updated':
                if (msg.process) {
                    appDispatch({ type: 'PROCESS_UPDATED', process: msg.process });
                    const terminalStatuses = ['completed', 'failed', 'cancelled'];
                    if (terminalStatuses.includes(msg.process.status)) {
                        appDispatch({ type: 'INVALIDATE_CONVERSATION', processId: msg.process.id });
                        addNotification(buildNotificationEntry(msg.process));
                    }
                }
                break;
            case 'process-removed':
                if (msg.processId) appDispatch({ type: 'PROCESS_REMOVED', processId: msg.processId });
                break;
            case 'processes-cleared':
                appDispatch({ type: 'PROCESSES_CLEARED' });
                break;
            case 'queue-updated':
                if (msg.queue) {
                    if (msg.queue.repoId) {
                        // Server always sends workspace UUID as repoId (see multi-repo-executor-bridge.ts).
                        queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: String(msg.queue.repoId), queue: msg.queue });
                    } else {
                        queueDispatch({ type: 'QUEUE_UPDATED', queue: msg.queue });
                        // Fetch history if not included
                        if (!msg.queue.history) {
                            fetchApi('/queue/history').then(data => {
                                if (data?.history) queueDispatch({ type: 'SET_HISTORY', history: data.history });
                            }).catch(() => { /* ignore */ });
                        }
                    }
                }
                break;
            case 'drain-start':
                queueDispatch({ type: 'DRAIN_START', queued: msg.queued || 0, running: msg.running || 0 });
                break;
            case 'drain-progress':
                queueDispatch({ type: 'DRAIN_PROGRESS', queued: msg.queued || 0, running: msg.running || 0 });
                break;
            case 'drain-complete':
            case 'drain-timeout':
                queueDispatch({ type: 'DRAIN_COMPLETE' });
                break;
            case 'tasks-changed':
                if (msg.workspaceId) {
                    window.dispatchEvent(new CustomEvent('tasks-changed', { detail: { wsId: msg.workspaceId } }));
                }
                break;
            case 'schedule-added':
            case 'schedule-updated':
            case 'schedule-removed':
            case 'schedule-triggered':
            case 'schedule-run-complete':
                window.dispatchEvent(new CustomEvent('schedule-changed', { detail: msg }));
                break;
            case 'templates-changed':
                window.dispatchEvent(new CustomEvent('templates-changed', { detail: msg }));
                break;
            case 'wiki-reload':
                if (msg.wiki) appDispatch({ type: 'WIKI_RELOAD', wiki: msg.wiki });
                else if (msg.data?.wiki) appDispatch({ type: 'WIKI_RELOAD', wiki: msg.data.wiki });
                break;
            case 'wiki-rebuilding':
                if (msg.wikiId) appDispatch({ type: 'WIKI_REBUILDING', wikiId: msg.wikiId });
                else if (msg.data?.wikiId) appDispatch({ type: 'WIKI_REBUILDING', wikiId: msg.data.wikiId });
                break;
            case 'wiki-error':
                if (msg.wikiId) appDispatch({ type: 'WIKI_ERROR', wikiId: msg.wikiId, error: msg.error || '' });
                else if (msg.data?.wikiId) appDispatch({ type: 'WIKI_ERROR', wikiId: msg.data.wikiId, error: msg.data.error || '' });
                addNotification({
                    type: 'warning',
                    title: 'Wiki error',
                    detail: msg.error || msg.data?.error || '',
                });
                break;
        }
    }, [appDispatch, queueDispatch, appState.workspaces, addNotification]);

    const { connect, status: wsStatus } = useWebSocket({ onMessage, onConnect: handleConnect });

    // Sync WebSocket connection status into AppContext
    useEffect(() => {
        appDispatch({ type: 'SET_WS_STATUS', status: wsStatus });
    }, [wsStatus, appDispatch]);

    // Toast on disconnect/reconnect transitions
    useEffect(() => {
        const prev = prevWsStatusRef.current;
        prevWsStatusRef.current = wsStatus;
        if (prev === 'open' && wsStatus === 'closed') {
            addToast('Connection lost — reconnecting…', 'error');
        } else if (wsStatus === 'open' && hasConnectedRef.current && prev !== 'open') {
            addToast('Reconnected', 'success');
        }
        if (wsStatus === 'open') {
            hasConnectedRef.current = true;
        }
    }, [wsStatus, addToast]);

    // Bootstrap: fetch initial data and connect WebSocket
    useEffect(() => {
        async function bootstrap() {
            try {
                const [wsRes, pRes, qRes] = await Promise.all([
                    fetchApi('/workspaces').catch(() => null),
                    fetchApi('/processes/summaries').catch(() => null),
                    fetchApi('/queue').catch(() => null),
                ]);
                if (wsRes?.workspaces) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes.workspaces });
                else if (Array.isArray(wsRes)) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes });

                if (pRes?.summaries && Array.isArray(pRes.summaries)) appDispatch({ type: 'SET_PROCESSES', processes: pRes.summaries });
                else if (pRes?.processes && Array.isArray(pRes.processes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes.processes });
                else if (Array.isArray(pRes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes });

                if (qRes && Array.isArray(qRes.queued) && Array.isArray(qRes.running)) {
                    queueDispatch({ type: 'SEED_QUEUE', queue: qRes });
                }
            } catch { /* ignore */ }
            connect();
        }
        bootstrap();
    }, [connect, appDispatch, queueDispatch]);

    // Admin and Logs are now full-page routes handled by Router.tsx via #admin and #logs hashes.
    // handleAdminOpen and handleLogsOpen just navigate to the respective hash.
    const handleAdminOpen = useCallback(() => {
        location.hash = '#admin';
    }, []);

    const handleLogsOpen = useCallback(() => {
        location.hash = '#logs';
    }, []);

    useEffect(() => {
        const handleOpenMarkdownReview = (event: Event) => {
            const detail = (event as CustomEvent<{ filePath?: string; sourceFilePath?: string; wsId?: string }>).detail;
            let filePath = typeof detail?.filePath === 'string' ? detail.filePath : '';
            if (!filePath) return;

            const wsIdHint = typeof detail?.wsId === 'string' ? detail.wsId : '';

            // Fast path: wsId hint provided — use workspace directly without path resolution
            if (wsIdHint) {
                const hintedWorkspace = (appState.workspaces as WorkspaceLike[] || []).find(ws => ws.id === wsIdHint);
                if (hintedWorkspace) {
                    if (isAbsolutePath(filePath)) {
                        // Absolute path from chat click — determine fetchMode by task membership
                        const taskRelativePath = toTaskRelativePath(filePath, hintedWorkspace.rootPath || '');
                        setReviewDialog({
                            open: true,
                            minimized: false,
                            scrollTop: 0,
                            wsId: hintedWorkspace.id,
                            filePath: taskRelativePath ?? filePath,
                            displayPath: filePath,
                            fetchMode: taskRelativePath !== null ? 'tasks' : 'auto',
                        });
                    } else {
                        // Task-relative path from TaskTree — existing behaviour
                        const rootNormalized = normalizePath(hintedWorkspace.rootPath || '').replace(/\/+$/, '');
                        const displayPath = rootNormalized ? `${rootNormalized}/.vscode/tasks/${filePath}` : filePath;
                        setReviewDialog({
                            open: true,
                            minimized: false,
                            scrollTop: 0,
                            wsId: hintedWorkspace.id,
                            filePath,
                            displayPath,
                            fetchMode: 'tasks',
                        });
                    }
                    return;
                }
            }

            // Resolve relative paths against the source file's directory
            const sourceFilePath = typeof detail?.sourceFilePath === 'string' ? detail.sourceFilePath : '';
            if (sourceFilePath && !isAbsolutePath(filePath)) {
                const sourceDir = normalizePath(sourceFilePath).replace(/\/[^/]*$/, '');
                filePath = resolveRelativePath(sourceDir, filePath);
            }

            const fullPath = filePath;

            const workspace = resolveWorkspaceForPath(fullPath, appState.workspaces || []);
            if (!workspace?.id) return;

            const taskRelativePath = toTaskRelativePath(fullPath, workspace.rootPath || '');

            setReviewDialog({
                open: true,
                minimized: false,
                scrollTop: 0,
                wsId: workspace.id,
                filePath: taskRelativePath ?? fullPath,
                displayPath: fullPath,
                fetchMode: taskRelativePath !== null ? 'tasks' : 'auto',
            });
        };

        window.addEventListener('coc-open-markdown-review', handleOpenMarkdownReview as EventListener);
        return () => {
            window.removeEventListener('coc-open-markdown-review', handleOpenMarkdownReview as EventListener);
        };
    }, [appState.workspaces]);

    const handleMinimizeReview = useCallback((scrollTop: number) => {
        setReviewDialog(prev => ({ ...prev, open: false, minimized: true, scrollTop }));
    }, []);

    const handleRestoreReview = useCallback(() => {
        setReviewDialog(prev => ({ ...prev, open: true, minimized: false }));
    }, []);

    const handleCloseReviewChip = useCallback(() => {
        setReviewDialog({ open: false, minimized: false, scrollTop: 0, wsId: null, filePath: null, displayPath: null, fetchMode: 'auto' });
    }, []);

    const reviewFileName = useMemo(() =>
        reviewDialog.filePath ? getFileName(reviewDialog.displayPath || reviewDialog.filePath) : '',
        [reviewDialog.filePath, reviewDialog.displayPath]
    );

    const minimizedReviewEntry = useMemo(() => {
        if (!reviewDialog.minimized || !reviewDialog.filePath) return null;
        return {
            id: 'markdown-review',
            icon: '📄',
            label: reviewFileName,
            onRestore: handleRestoreReview,
            onClose: handleCloseReviewChip,
        };
    }, [reviewDialog.minimized, reviewDialog.filePath, reviewFileName, handleRestoreReview, handleCloseReviewChip]);
    useMinimizedDialog(minimizedReviewEntry);

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <TopBar onAdminOpen={handleAdminOpen} onLogsOpen={handleLogsOpen} />
            <Router />
            <FloatingChatManager />
            <BottomNav />
            <ToastContainer toasts={toasts} removeToast={removeToast} />
            <EnqueueDialog />
            <MarkdownReviewDialog
                open={reviewDialog.open}
                onClose={() => setReviewDialog(prev => ({ ...prev, open: false }))}
                onMinimize={handleMinimizeReview}
                wsId={reviewDialog.wsId}
                filePath={reviewDialog.filePath}
                displayPath={reviewDialog.displayPath}
                fetchMode={reviewDialog.fetchMode}
                initialScrollTop={reviewDialog.scrollTop}
            />
            <MinimizedDialogsTray />
        </ToastProvider>
    );
}

export function App() {
    return (
        <AppProvider>
            <QueueProvider>
                <NotificationProvider>
                    <PopOutProvider>
                        <FloatingChatsProvider>
                            <MinimizedDialogsProvider>
                                <ThemeProvider>
                                    <AppInner />
                                </ThemeProvider>
                            </MinimizedDialogsProvider>
                        </FloatingChatsProvider>
                    </PopOutProvider>
                </NotificationProvider>
            </QueueProvider>
        </AppProvider>
    );
}
