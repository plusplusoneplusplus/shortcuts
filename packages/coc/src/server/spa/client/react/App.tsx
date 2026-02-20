/**
 * App — root React component.
 * Wraps providers around the layout shell.
 */

import { useEffect, useCallback, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { QueueProvider, useQueue } from './context/QueueContext';
import { ToastProvider } from './context/ToastContext';
import { ThemeProvider } from './layout/ThemeProvider';
import { TopBar } from './layout/TopBar';
import { Router } from './layout/Router';
import { useWebSocket } from './hooks/useWebSocket';
import { fetchApi } from './hooks/useApi';
import { ToastContainer, useToast } from './shared';
import { MarkdownReviewDialog } from './processes/MarkdownReviewDialog';

interface MarkdownReviewDialogState {
    open: boolean;
    wsId: string | null;
    filePath: string | null;
    displayPath: string | null;
    fetchMode: 'tasks' | 'auto';
}

interface WorkspaceLike {
    id: string;
    rootPath?: string;
}

function normalizePath(pathValue: string): string {
    return pathValue.replace(/\\/g, '/');
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

function AppInner() {
    const { state: appState, dispatch: appDispatch } = useApp();
    const { dispatch: queueDispatch } = useQueue();
    const { toasts, addToast, removeToast } = useToast();
    const [reviewDialog, setReviewDialog] = useState<MarkdownReviewDialogState>({
        open: false,
        wsId: null,
        filePath: null,
        displayPath: null,
        fetchMode: 'auto',
    });

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
                    queueDispatch({ type: 'QUEUE_UPDATED', queue: msg.queue });
                    // Fetch history if not included
                    if (!msg.queue.history) {
                        fetchApi('/queue/history').then(data => {
                            if (data?.history) queueDispatch({ type: 'SET_HISTORY', history: data.history });
                        }).catch(() => { /* ignore */ });
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
    }, [appDispatch, queueDispatch]);

    const { connect } = useWebSocket({ onMessage });

    // Bootstrap: fetch initial data and connect WebSocket
    useEffect(() => {
        async function bootstrap() {
            try {
                const [wsRes, pRes] = await Promise.all([
                    fetchApi('/workspaces').catch(() => null),
                    fetchApi('/processes').catch(() => null),
                ]);
                if (wsRes?.workspaces) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes.workspaces });
                else if (Array.isArray(wsRes)) appDispatch({ type: 'WORKSPACES_LOADED', workspaces: wsRes });

                if (pRes?.processes && Array.isArray(pRes.processes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes.processes });
                else if (Array.isArray(pRes)) appDispatch({ type: 'SET_PROCESSES', processes: pRes });
            } catch { /* ignore */ }
            connect();
        }
        bootstrap();
    }, [connect, appDispatch]);

    useEffect(() => {
        const handleOpenMarkdownReview = (event: Event) => {
            const detail = (event as CustomEvent<{ filePath?: string }>).detail;
            const fullPath = typeof detail?.filePath === 'string' ? detail.filePath : '';
            if (!fullPath) return;

            const matchedWorkspace = resolveWorkspaceForPath(fullPath, appState.workspaces || []);
            const fallbackWorkspace = appState.workspaces?.[0];
            const workspace = matchedWorkspace || fallbackWorkspace;
            if (!workspace?.id) return;

            const taskRelativePath = toTaskRelativePath(fullPath, workspace.rootPath || '');

            setReviewDialog({
                open: true,
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

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <TopBar />
            <Router />
            <ToastContainer toasts={toasts} removeToast={removeToast} />
            <MarkdownReviewDialog
                open={reviewDialog.open}
                onClose={() => setReviewDialog(prev => ({ ...prev, open: false }))}
                wsId={reviewDialog.wsId}
                filePath={reviewDialog.filePath}
                displayPath={reviewDialog.displayPath}
                fetchMode={reviewDialog.fetchMode}
            />
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
