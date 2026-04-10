import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Highlight from '@tiptap/extension-highlight';
import { notesApi } from '../notesApi';
import { markdownToHtml, htmlToMarkdown } from './noteMarkdown';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import './noteEditor.css';

export interface NoteEditorProps {
    workspaceId: string;
    notePath: string | null;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NoteEditor({ workspaceId, notePath }: NoteEditorProps) {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [dirty, setDirty] = useState(false);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingContentRef = useRef<string | null>(null);
    const notePathRef = useRef(notePath);
    const workspaceIdRef = useRef(workspaceId);

    // Keep refs in sync
    notePathRef.current = notePath;
    workspaceIdRef.current = workspaceId;

    // ── Tiptap editor ───────────────────────────────────────────────────────

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3] },
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Link.configure({
                openOnClick: false,
                HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
            }),
            Placeholder.configure({
                placeholder: 'Start writing…',
            }),
            Table.configure({ resizable: false }),
            TableRow,
            TableCell,
            TableHeader,
            Highlight.configure({ multicolor: true }),
        ],
        onUpdate: ({ editor: ed }) => {
            setDirty(true);
            scheduleSave(ed);
        },
    });

    // ── Autosave ────────────────────────────────────────────────────────────

    const flushSave = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const content = pendingContentRef.current;
        const path = notePathRef.current;
        if (content === null || !path) return;
        pendingContentRef.current = null;
        setSaveState('saving');
        try {
            await notesApi.saveContent(workspaceIdRef.current, path, content);
            setSaveState('saved');
            setDirty(false);
            setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 3000);
        } catch {
            setSaveState('error');
        }
    }, []);

    function scheduleSave(ed: { getHTML: () => string }) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        const md = htmlToMarkdown(ed.getHTML());
        pendingContentRef.current = md;
        saveTimerRef.current = setTimeout(() => flushSave(), 1500);
    }

    // ── Load content on path change ─────────────────────────────────────────

    useEffect(() => {
        // Flush pending save for previous page
        flushSave();

        if (!notePath) {
            editor?.commands.clearContent();
            setLoadError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setSaveState('idle');

        notesApi
            .getContent(workspaceId, notePath)
            .then(({ content }) => {
                if (cancelled) return;
                const html = markdownToHtml(content);
                editor?.commands.setContent(html);
                setDirty(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setLoadError(err?.message ?? 'Failed to load note');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [notePath, workspaceId, editor, flushSave]);

    // ── Flush on unmount ────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            flushSave();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── beforeunload guard ──────────────────────────────────────────────────

    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    // ── Render: empty state ─────────────────────────────────────────────────

    if (notePath === null) {
        return (
            <div
                className="flex-1 flex flex-col items-center justify-center text-sm text-[#616161] dark:text-[#999] select-none gap-2"
                data-testid="note-editor-empty"
            >
                <span className="text-3xl">📄</span>
                <span className="italic">Select a page to start editing</span>
            </div>
        );
    }

    // ── Render: loading ─────────────────────────────────────────────────────

    if (loading) {
        return (
            <div
                className="flex-1 flex items-center justify-center text-sm text-[#616161] dark:text-[#999]"
                data-testid="note-editor-loading"
            >
                <span className="animate-spin mr-2">⏳</span> Loading…
            </div>
        );
    }

    // ── Render: load error ──────────────────────────────────────────────────

    if (loadError) {
        return (
            <div
                className="flex-1 flex items-center justify-center"
                data-testid="note-editor-error"
            >
                <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-4 py-2">
                    {loadError}
                </div>
            </div>
        );
    }

    // ── Render: editor ──────────────────────────────────────────────────────

    return (
        <div className="note-editor flex-1 flex flex-col min-h-0 relative" data-testid="note-editor">
            <NoteEditorToolbar editor={editor} />
            <div className="flex-1 overflow-y-auto">
                <EditorContent editor={editor} />
            </div>

            {/* Save indicator */}
            <div className="absolute bottom-3 right-3 text-xs select-none" data-testid="save-indicator">
                {saveState === 'saving' && (
                    <span className="text-[#888]">
                        <span className="animate-spin inline-block mr-1">⏳</span>Saving…
                    </span>
                )}
                {saveState === 'saved' && (
                    <span className="text-green-600 dark:text-green-400">Saved ✓</span>
                )}
                {saveState === 'error' && (
                    <span className="text-red-500">
                        Save failed{' '}
                        <button className="underline" onClick={() => flushSave()}>
                            Retry
                        </button>
                    </span>
                )}
            </div>
        </div>
    );
}
