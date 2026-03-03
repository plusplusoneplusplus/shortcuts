/**
 * App — root React component.
 * Wraps providers around the layout shell.
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { QueueProvider, useQueue } from './context/QueueContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './layout/ThemeProvider';
import { TopBar } from './layout/TopBar';
import { BottomNav } from './layout/BottomNav';
import { Router } from './layout/Router';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchApi } from './hooks/useApi';
import { ToastContainer, useToast } from './shared';
import { toForwardSlashes } from '@plusplusoneplusplus/pipeline-core/utils/path-utils';
import { MarkdownReviewDialog } from './processes/MarkdownReviewDialog';
import { MarkdownReviewMinimizedChip } from './processes/MarkdownReviewMinimizedChip';
import { EnqueueDialog } from './queue/EnqueueDialog';
import { isAbsolutePath, resolveRelativePath } from './utils/path-resolution';

interface MarkdownReviewDialogState {
    open: boolean;
    minimized: boolean;
    scrollTop: number;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
}

interface WorkspaceLike {
    id: string;
    rootPath?: string;
}

interface QueueMessageTaskLike {
    workingDirectory?: string;
    payload?: { workingDirectory?: string };
}

interface QueueMessageLike {
    queued?: QueueMessageTaskLike[];
    running?: QueueMessageTaskLike[];
    history?: QueueMessageTaskLike[];
}

function normalizePath(pathValue: string): string {
    return toForwardSlashes(pathValue);
}

function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
}

function normalizeComparablePath(pathValue: string): string {
    return normalizePath(pathValue).replace(/\/+$/, '').toLowerCase();
}

function resolveWorkspaceForPath(filePath: string, workspaces: WorkspaceLike[]): WorkspaceLike | null {
    const normalizedPath = normalizePath(filePath);
    let best: WorkspaceLike | null = null;

    for (const ws of workspaces) {
        if (!ws?.rootPath) continue;
        const normalizedRoot = normalizePath(ws.rootPath).replace(/\/+$/, '');
        if (!normalizedRoot) continue;

        if (normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + '/')) {
            if (!best || normalizedRoot.length > normalizePath(best.rootPath || '').length) {
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

function getQueueWorkingDirectory(queue: QueueMessageLike): string | null {
    const buckets = [queue.running, queue.queued, queue.history];
    for (const bucket of buckets) {
        if (!Array.isArray(bucket)) continue;
        for (const task of bucket) {
            const candidate = task?.workingDirectory || task?.payload?.workingDirectory;
            if (typeof candidate === 'string' && candidate.trim()) {
                return candidate;
            }
        }
    }
    return null;
}

function resolveWorkspaceIdForQueueMessage(
    queue: QueueMessageLike,
    workspaces: WorkspaceLike[],
): string | null {
    const workingDirectory = getQueueWorkingDirectory(queue);
    if (!workingDirectory) return null;
    const normalizedWorkingDirectory = normalizeComparablePath(workingDirectory);
    const matchedWorkspace = workspaces.find(ws =>
        typeof ws.rootPath === 'string' && normalizeComparablePath(ws.rootPath) === normalizedWorkingDirectory
    );
    return matchedWorkspace?.id ?? null;
}

function AppInner() {
    const { state: appState, dispatch: appDispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { toasts, addToast, removeToast } = useToast();
    const repoIdAliasRef = useRef<Record<string, string>>({});
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
                if (msg.process) appDispatch({ type: 'PROCESS_UPDATED', process: msg.process });
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
                        const queueRepoId = String(msg.queue.repoId);
                        queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: queueRepoId, queue: msg.queue });

                        // Per-repo WS events use internal queue repo IDs (sha256 hash).
                        // Mirror updates onto workspace IDs so repo tabs/badges stay in sync.
                        const resolvedWorkspaceId = resolveWorkspaceIdForQueueMessage(msg.queue, appState.workspaces as WorkspaceLike[]);
                        if (resolvedWorkspaceId) {
                            repoIdAliasRef.current[queueRepoId] = resolvedWorkspaceId;
                            if (resolvedWorkspaceId !== queueRepoId) {
                                queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: resolvedWorkspaceId, queue: msg.queue });
                            }
                        } else {
                            const aliasedWorkspaceId = repoIdAliasRef.current[queueRepoId];
                            if (aliasedWorkspaceId && aliasedWorkspaceId !== queueRepoId) {
                                queueDispatch({ type: 'REPO_QUEUE_UPDATED', repoId: aliasedWorkspaceId, queue: msg.queue });
                            }
                        }
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
            case 'workspace-registered':
                if (msg.data) appDispatch({ type: 'WORKSPACE_REGISTERED', workspace: msg.data });
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
                break;
        }
    }, [appDispatch, queueDispatch, appState.workspaces]);

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
                    fetchApi('/processes').catch(() => null),
                    fetchApi('/queue').catch(() => null),
                ]);
                if (wsRes?.workspaces) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes.workspaces });
                else if (Array.isArray(wsRes)) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes });

                if (pRes?.processes && Array.isArray(pRes.processes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes.processes });
                else if (Array.isArray(pRes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes });

                if (qRes && Array.isArray(qRes.queued) && Array.isArray(qRes.running)) {
                    queueDispatch({ type: 'SEED_QUEUE', queue: qRes });
                }
            } catch { /* ignore */ }
            connect();
        }
        bootstrap();
    }, [connect, appDispatch, queueDispatch]);

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

            const matchedWorkspace = resolveWorkspaceForPath(fullPath, appState.workspaces || []);
            const fallbackWorkspace = appState.workspaces?.[0];
            const workspace = matchedWorkspace || fallbackWorkspace;
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

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <TopBar />
            <Router />
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
            {reviewDialog.minimized && reviewDialog.filePath && (
                <MarkdownReviewMinimizedChip
                    fileName={getFileName(reviewDialog.displayPath || reviewDialog.filePath)}
                    onRestore={handleRestoreReview}
                    onClose={handleCloseReviewChip}
                />
            )}
        </ToastProvider>
    );
}

export function App() {
    return (
        <AppProvider>
            <QueueProvider>
                <ThemeProvider>
                    <AppInner />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
