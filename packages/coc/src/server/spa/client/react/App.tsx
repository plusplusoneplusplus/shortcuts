/**
 * App — root React component.
 * Wraps providers around the layout shell.
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { QueueProvider, useQueue } from './contexts/QueueContext';
import { WorkItemProvider, useWorkItems } from './contexts/WorkItemContext';
import { ReposProvider } from './contexts/ReposContext';
import { NotificationProvider, useNotifications } from './contexts/NotificationContext';
import { ToastProvider } from './contexts/ToastContext';
import { MinimizedDialogsProvider, useMinimizedDialog, MinimizedDialogsTray } from './contexts/MinimizedDialogsContext';
import { PopOutProvider } from './contexts/PopOutContext';
import { MarkdownPopOutProvider } from './contexts/MarkdownPopOutContext';
import { GitReviewPopOutProvider } from './contexts/GitReviewPopOutContext';
import { FloatingChatsProvider } from './contexts/FloatingChatsContext';
import { ThemeProvider } from './layout/ThemeProvider';
import { TopBar } from './layout/TopBar';
import { SecurityBanner } from './layout/SecurityBanner';
import { BottomNav } from './layout/BottomNav';
import { Router } from './layout/Router';
import { FloatingChatManager } from './layout/FloatingChatManager';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchApi } from './hooks/useApi';
import { getSpaCocClient } from './api/cocClient';
import { ToastContainer, useToast } from './ui';
import { toForwardSlashes } from '@plusplusoneplusplus/forge/utils/path-utils';
import { MarkdownReviewDialog } from './processes/MarkdownReviewDialog';
import { EnqueueDialog } from './queue/EnqueueDialog';
import { RunScriptDialog } from './queue/RunScriptDialog';
import { isAbsolutePath, resolveRelativePath } from './utils/path-resolution';
import { buildNotificationEntry } from './utils/build-notification-entry';
import { WelcomeTour } from './welcome/WelcomeTour';
import { SHOW_WELCOME_TUTORIAL } from './featureFlags';
import { ErrorBoundary } from './ui/ErrorBoundary';

import { ContainerAgentProvider } from './contexts/ContainerAgentContext';

interface MarkdownReviewDialogState {
    open: boolean;
    minimized: boolean;
    scrollTop: number;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
    taskRootPath?: string | null;
}

/* @internal – exported for testing only */
export interface WorkspaceLike {
    id: string;
    name?: string;
    rootPath?: string;
}


function normalizePath(pathValue: string): string {
    return toForwardSlashes(pathValue);
}

/* @internal – exported for testing only */
export function getFileName(path: string): string {
    return toForwardSlashes(path).split('/').pop() || path;
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
    const { dispatch: workItemDispatch } = useWorkItems();
    const { addNotification } = useNotifications();
    const { toasts, addToast, removeToast } = useToast();
    const prevWsStatusRef = useRef(appState.wsStatus);
    const hasConnectedRef = useRef(false);
    const seenProcessIdsRef = useRef(new Set<string>());
    const [reviewDialog, setReviewDialog] = useState<MarkdownReviewDialogState>({
        open: false,
        minimized: false,
        scrollTop: 0,
        wsId: null,
        filePath: null,
        displayPath: null,
        fetchMode: 'auto',
    });

    const applyGlobalPreferences = useCallback((prefRes: any) => {
        appDispatch({
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                hasSeenWelcome: prefRes.hasSeenWelcome,
                onboardingProgress: prefRes.onboardingProgress,
                dismissedTips: prefRes.dismissedTips,
                activityFilters: prefRes.activityFilters,
            },
        });
        if (typeof prefRes.reposSidebarCollapsed === 'boolean') {
            appDispatch({ type: 'SET_REPOS_SIDEBAR_COLLAPSED', value: prefRes.reposSidebarCollapsed });
            try { localStorage.setItem('coc-repos-sidebar-collapsed', String(prefRes.reposSidebarCollapsed)); } catch { /* SSR / test */ }
        }
    }, [appDispatch]);

    const loadGlobalPreferences = useCallback(async (markFailure: boolean) => {
        const prefRes = await fetchApi('/preferences').catch(() => null);
        if (prefRes) {
            applyGlobalPreferences(prefRes);
            return true;
        }

        if (markFailure) {
            appDispatch({ type: 'SET_PREFERENCES_LOAD_FAILED' });
        }
        return false;
    }, [appDispatch, applyGlobalPreferences]);

    const handleConnect = useCallback(async () => {
        const [data] = await Promise.all([
            getSpaCocClient().queue.list().catch(() => null),
            loadGlobalPreferences(false),
        ]);
        if (data && Array.isArray(data.queued) && Array.isArray(data.running)) {
            queueDispatch({ type: 'QUEUE_UPDATED', queue: data });
            if (data.history) {
                queueDispatch({ type: 'SET_HISTORY', history: data.history });
            }
        }
    }, [loadGlobalPreferences, queueDispatch]);

    const onMessage = useCallback((msg: any) => {
        if (!msg || !msg.type) return;

        // Rebroadcast loop-* WebSocket messages as a generic custom event so
        // useLoops / useAllLoops hooks refresh without each switch case here.
        if (typeof msg.type === 'string' && msg.type.startsWith('loop-')) {
            window.dispatchEvent(new CustomEvent('coc-ws-message', { detail: msg }));
        }

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
                        if (!seenProcessIdsRef.current.has(msg.process.id)) {
                            seenProcessIdsRef.current.add(msg.process.id);
                            // Resolve workspace for both display name and ID.
                            const wsId = msg.process.workspaceId;
                            const ws = wsId
                                ? (appState.workspaces as WorkspaceLike[]).find(w => w.id === wsId)
                                : undefined;
                            // Fallback: longest-prefix match on workingDirectory.
                            const resolvedWs = ws
                                ?? (msg.process.workingDirectory
                                    ? resolveWorkspaceForPath(msg.process.workingDirectory, appState.workspaces as WorkspaceLike[])
                                    : null);
                            const wsName: string | undefined = msg.process.workspaceName
                                ?? resolvedWs?.name
                                ?? (resolvedWs?.rootPath ? resolvedWs.rootPath.replace(/\\/g, '/').split('/').pop() : undefined);
                            const effectiveWsId = msg.process.workspaceId ?? resolvedWs?.id;
                            addNotification(buildNotificationEntry(msg.process, wsName, effectiveWsId));
                        }
                    }
                }
                break;
            case 'process-removed':
                if (msg.processId) appDispatch({ type: 'PROCESS_REMOVED', processId: msg.processId });
                break;
            case 'processes-cleared':
                appDispatch({ type: 'PROCESSES_CLEARED' });
                seenProcessIdsRef.current.clear();
                break;
            case 'queue-updated':
                if (msg.queue) {
                    if (msg.queue.repoId) {
                        queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: String(msg.queue.repoId), queue: msg.queue });
                    } else {
                        queueDispatch({ type: 'QUEUE_UPDATED', queue: msg.queue });
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
            case 'notes-changed':
                if (msg.workspaceId) {
                    window.dispatchEvent(new CustomEvent('notes-changed', { detail: { wsId: msg.workspaceId, changedPaths: (msg as any).changedPaths ?? [] } }));
                }
                break;
            case 'wiki-reload':
                if (msg.wiki) appDispatch({ type: 'WIKI_RELOAD', wiki: msg.wiki });
                break;
            case 'wiki-rebuilding':
                if (msg.wikiId) appDispatch({ type: 'WIKI_REBUILDING', wikiId: msg.wikiId });
                break;
            case 'wiki-error':
                if (msg.wikiId) appDispatch({ type: 'WIKI_ERROR', wikiId: msg.wikiId, error: msg.error || '' });
                addNotification({
                    type: 'warning',
                    title: 'Wiki error',
                    detail: msg.error || '',
                });
                break;
            case 'work-item-added':
                if (msg.item) workItemDispatch({ type: 'WORK_ITEM_ADDED', repoId: msg.workspaceId, item: msg.item });
                break;
            case 'work-item-updated':
                if (msg.item) workItemDispatch({ type: 'WORK_ITEM_UPDATED', repoId: msg.workspaceId, item: msg.item });
                break;
            case 'work-item-removed':
                if (msg.itemId) workItemDispatch({ type: 'WORK_ITEM_REMOVED', repoId: msg.workspaceId, id: msg.itemId });
                break;
            case 'ralph-session-complete':
                window.dispatchEvent(new CustomEvent('ralph-session-complete', { detail: { repoId: msg.repoId } }));
                break;
        }
    }, [appDispatch, queueDispatch, workItemDispatch, appState.workspaces, addNotification]);

    const { connect, status: wsStatus } = useWebSocket({ onMessage, onConnect: handleConnect });

    // Sync WebSocket connection status into AppContext
    useEffect(() => {
        appDispatch({ type: 'SET_WS_STATUS', status: wsStatus });
    }, [wsStatus, appDispatch]);

    // Toast on disconnect/reconnect transitions
    useEffect(() => {
        const prev = prevWsStatusRef.current;
        prevWsStatusRef.current = wsStatus;
        if (prev === 'open' && (wsStatus === 'closed' || wsStatus === 'reconnecting')) {
            addToast('Connection lost — reconnecting…', 'error');
        } else if (wsStatus === 'open' && hasConnectedRef.current && prev !== 'open') {
            addToast('Reconnected', 'success');
        }
        if (wsStatus === 'open') {
            hasConnectedRef.current = true;
        }
    }, [wsStatus, addToast]);

    // Bootstrap: fetch preferences and connect WebSocket.
    // Process summaries are fetched by ReposContext.fetchRepos (single global call).
    useEffect(() => {
        async function bootstrap() {
            await loadGlobalPreferences(true);
            connect();
        }
        bootstrap();
    }, [connect, loadGlobalPreferences]);

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
            const detail = (event as CustomEvent<{ filePath?: string; sourceFilePath?: string; wsId?: string; taskRootPath?: string }>).detail;
            let filePath = typeof detail?.filePath === 'string' ? detail.filePath : '';
            if (!filePath) return;

            const wsIdHint = typeof detail?.wsId === 'string' ? detail.wsId : '';
            const eventTaskRootPath = typeof detail?.taskRootPath === 'string' ? detail.taskRootPath : undefined;

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
                            taskRootPath: eventTaskRootPath,
                        });
                    } else {
                        // Task-relative path from TaskTree
                        const displayBase = eventTaskRootPath
                            ? normalizePath(eventTaskRootPath).replace(/\/+$/, '')
                            : (() => {
                                const rootNormalized = normalizePath(hintedWorkspace.rootPath || '').replace(/\/+$/, '');
                                return rootNormalized ? `${rootNormalized}/.vscode/tasks` : '';
                            })();
                        const displayPath = displayBase ? `${displayBase}/${filePath}` : filePath;
                        setReviewDialog({
                            open: true,
                            minimized: false,
                            scrollTop: 0,
                            wsId: hintedWorkspace.id,
                            filePath,
                            displayPath,
                            fetchMode: 'tasks',
                            taskRootPath: eventTaskRootPath,
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
            <ReposProvider>
                <div className="flex flex-col h-full">
                    <SecurityBanner />
                    <TopBar onAdminOpen={handleAdminOpen} onLogsOpen={handleLogsOpen} />
                    <main className="flex-1 overflow-hidden min-h-0 pt-[var(--bottom-nav-height,0px)] md:pt-0">
                        <Router />
                    </main>
                </div>
                <FloatingChatManager />
                <BottomNav />
                <ToastContainer toasts={toasts} removeToast={removeToast} />
                <EnqueueDialog />
                <RunScriptDialog />
                <MarkdownReviewDialog
                    open={reviewDialog.open}
                    onClose={() => setReviewDialog(prev => ({ ...prev, open: false }))}
                    onMinimize={handleMinimizeReview}
                    wsId={reviewDialog.wsId}
                    filePath={reviewDialog.filePath}
                    displayPath={reviewDialog.displayPath}
                    fetchMode={reviewDialog.fetchMode}
                    taskRootPath={reviewDialog.taskRootPath}
                    initialScrollTop={reviewDialog.scrollTop}
                />
                <MinimizedDialogsTray />
                {SHOW_WELCOME_TUTORIAL && <WelcomeTour />}
            </ReposProvider>
        </ToastProvider>
    );
}

export function App() {
    return (
        <ErrorBoundary>
            <AppProvider>
                <ContainerAgentProvider>
                <QueueProvider>
                    <WorkItemProvider>
                    <NotificationProvider>
                        <PopOutProvider>
                            <MarkdownPopOutProvider>
                                <GitReviewPopOutProvider>
                                    <FloatingChatsProvider>
                                    <MinimizedDialogsProvider>
                                        <ThemeProvider>
                                            <AppInner />
                                        </ThemeProvider>
                                    </MinimizedDialogsProvider>
                                </FloatingChatsProvider>
                                </GitReviewPopOutProvider>
                            </MarkdownPopOutProvider>
                        </PopOutProvider>
                    </NotificationProvider>
                    </WorkItemProvider>
                </QueueProvider>
                </ContainerAgentProvider>
            </AppProvider>
        </ErrorBoundary>
    );
}
