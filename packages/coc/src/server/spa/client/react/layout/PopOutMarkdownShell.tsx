/**
 * PopOutMarkdownShell — standalone shell for markdown review in a separate browser window.
 *
 * Rendered when `window.location.hash` starts with `#popout/markdown`.
 * URL format: `/?workspace=<wsId>#popout/markdown/<encodedFilePath>?fetchMode=tasks|auto&displayPath=<encodedDisplayPath>`
 */

import { useEffect, useRef, useCallback, useMemo } from 'react';
import { AppProvider } from '../contexts/AppContext';
import { QueueProvider } from '../contexts/QueueContext';
import { ThemeProvider } from './ThemeProvider';
import { ToastProvider } from '../contexts/ToastContext';
import { ToastContainer, useToast } from '../ui';
import { NoteEditor } from '../features/notes/editor/NoteEditor';
import { noopCommentBackend } from '../features/notes/editor/NoteEditorCommentBackend';
import { createTasksNoteEditorIO } from '../tasks/TasksNoteEditorIO';
import { createWorkspaceFileNoteEditorIO } from '../tasks/WorkspaceFileNoteEditorIO';
import { useMdPopOutChannel, type MdPopOutMessage } from '../contexts/MarkdownPopOutContext';
import { getHostname } from '../utils/config';

// ── URL parsing ────────────────────────────────────────────────────────────────

export interface PopOutMarkdownParams {
    wsId: string;
    filePath: string;
    displayPath: string;
    fetchMode: 'tasks' | 'auto';
    taskRootPath?: string;
}

export function parsePopOutMarkdownRoute(hash: string, search: string): PopOutMarkdownParams | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'popout' || parts[1] !== 'markdown') return null;

    const searchParams = new URLSearchParams(search);
    const wsId = searchParams.get('workspace');
    const filePath = searchParams.get('filePath');
    if (!wsId || !filePath) return null;

    const fetchMode = searchParams.get('fetchMode') === 'tasks' ? 'tasks' : 'auto';
    const displayPath = searchParams.get('displayPath') || filePath;
    const taskRootPath = searchParams.get('taskRootPath') || undefined;

    return { wsId, filePath, displayPath, fetchMode, taskRootPath };
}

/** Build a pop-out URL key for BroadcastChannel identity */
export function mdPopOutKey(wsId: string, filePath: string): string {
    return `${wsId}::${filePath}`;
}

// ── Inner content ──────────────────────────────────────────────────────────────

function PopOutMarkdownContent({ params }: { params: PopOutMarkdownParams }) {
    const { toasts, addToast, removeToast } = useToast();
    const hasNotifiedRef = useRef(false);
    const key = mdPopOutKey(params.wsId, params.filePath);

    const handleMessage = useCallback((msg: MdPopOutMessage) => {
        if (msg.type === 'md-popout-restore' && msg.key === key) {
            window.close();
        }
    }, [key]);

    const { postMessage } = useMdPopOutChannel(handleMessage);

    useEffect(() => {
        if (hasNotifiedRef.current) return;
        hasNotifiedRef.current = true;
        postMessage({ type: 'md-popout-opened', key });

        const handleBeforeUnload = () => {
            postMessage({ type: 'md-popout-closed', key });
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [key, postMessage]);

    useEffect(() => {
        const title = params.displayPath.replace(/\\/g, '/').split('/').pop() || 'Markdown Review';
        const hostname = getHostname();
        const brand = hostname ? `CoC @ ${hostname}` : 'CoC';
        document.title = `${title} — ${brand}`;
    }, [params.displayPath]);

    const tasksIO = useMemo(() => createTasksNoteEditorIO(), []);
    const workspaceIO = useMemo(() => createWorkspaceFileNoteEditorIO(), []);
    const editorIO = params.fetchMode === 'tasks' ? tasksIO : workspaceIO;

    return (
        <ToastProvider value={{ addToast, removeToast, toasts }}>
            <div className="flex flex-col h-screen bg-white dark:bg-[#1e1e1e]" data-testid="popout-markdown-shell">
                {/* Minimal top bar */}
                <div className="flex items-center justify-between px-4 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f8f8f8] dark:bg-[#252526]" style={{ minHeight: 44 }}>
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">📄</span>
                        <span className="text-sm font-semibold text-[#1e1e1e] dark:text-[#cccccc] truncate" title={params.displayPath}>
                            {params.displayPath.replace(/\\/g, '/').split('/').pop() || params.filePath}
                        </span>
                    </div>
                </div>
                {/* Full-screen editor — both fetch modes render the shared
                    NoteEditor shell; the IO adapter differs. */}
                <div className="flex-1 min-h-0 overflow-hidden">
                    <NoteEditor
                        workspaceId={params.wsId}
                        notePath={params.filePath}
                        io={editorIO}
                        commentBackend={noopCommentBackend}
                        notesRoot={params.taskRootPath}
                    />
                </div>
            </div>
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastProvider>
    );
}

// ── Shell entry point ──────────────────────────────────────────────────────────

export function PopOutMarkdownShell() {
    const params = parsePopOutMarkdownRoute(window.location.hash, window.location.search);

    if (!params) {
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
                    <PopOutMarkdownContent params={params} />
                </ThemeProvider>
            </QueueProvider>
        </AppProvider>
    );
}
