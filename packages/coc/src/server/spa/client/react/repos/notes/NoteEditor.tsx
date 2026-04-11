import { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
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
import { ResizableImage } from './extensions/resizableImage';
import { CommentExtension } from '@sereneinserenade/tiptap-comment-extension';
import { notesApi } from '../notesApi';
import type { CommentThread } from '../notesApi';
import { markdownToHtml, htmlToMarkdown, rewriteImageSrcToApi, rewriteImageSrcToRelative } from './noteMarkdown';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import { SourceEditor } from '../../shared/SourceEditor';
import { findAnchorInDoc, applyCommentMark, buildAnchorFromMark } from './commentAnchoring';
import { ContextMenu } from '../../tasks/comments/ContextMenu';
import './noteEditor.css';

export type NoteViewMode = 'rich' | 'source';

export interface NoteEditorProps {
    workspaceId: string;
    notePath: string | null;
    onCommentActivated?: (commentId: string | null) => void;
    onEditorReady?: (editor: Editor) => void;
    onCommentCreate?: () => void;
    commentsEnabled?: boolean;
    onViewModeChange?: (mode: NoteViewMode) => void;
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function NoteEditor({
    workspaceId,
    notePath,
    onCommentActivated,
    onEditorReady,
    onCommentCreate,
    commentsEnabled = true,
    onViewModeChange,
    commentsPanelOpen,
    onToggleCommentsPanel,
    commentCount,
}: NoteEditorProps) {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [dirty, setDirty] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Source mode state
    const [viewMode, setViewModeRaw] = useState<NoteViewMode>('rich');
    const [rawMarkdown, setRawMarkdown] = useState('');
    const [sourceDirty, setSourceDirty] = useState(false);

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sourceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingContentRef = useRef<string | null>(null);
    const pendingSourceContentRef = useRef<string | null>(null);
    const notePathRef = useRef(notePath);
    const workspaceIdRef = useRef(workspaceId);

    // Keep refs in sync
    notePathRef.current = notePath;
    workspaceIdRef.current = workspaceId;

    // View mode setter that also notifies parent
    const setViewMode = useCallback((mode: NoteViewMode) => {
        setViewModeRaw(mode);
        onViewModeChange?.(mode);
    }, [onViewModeChange]);

    // ── Tiptap editor ───────────────────────────────────────────────────────

    // Stable callback refs for extension config (avoids editor recreation)
    const onCommentActivatedRef = useRef(onCommentActivated);
    onCommentActivatedRef.current = onCommentActivated;
    const onCommentCreateRef = useRef(onCommentCreate);
    onCommentCreateRef.current = onCommentCreate;

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
            ResizableImage.configure({ inline: false, allowBase64: false }),
            ...(commentsEnabled
                ? [
                    CommentExtension.configure({
                        onCommentActivated: (commentId: string | null) => {
                            onCommentActivatedRef.current?.(commentId);
                        },
                    }),
                ]
                : []),
        ],
        editorProps: {
            handlePaste: (view, event) => {
                const items = event.clipboardData?.items;
                if (!items) return false;

                for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.startsWith('image/')) {
                        event.preventDefault();
                        const file = item.getAsFile();
                        if (!file) continue;

                        const reader = new FileReader();
                        reader.onload = async (e) => {
                            const dataUrl = e.target?.result as string;
                            if (!dataUrl || !notePathRef.current) return;

                            setUploadingImage(true);
                            try {
                                const result = await notesApi.uploadImage(
                                    workspaceIdRef.current,
                                    file.name || 'pasted-image',
                                    dataUrl,
                                );
                                const apiUrl = `/api/workspaces/${encodeURIComponent(workspaceIdRef.current)}/notes/image?path=${encodeURIComponent(result.path)}`;
                                view.dispatch(
                                    view.state.tr.replaceSelectionWith(
                                        view.state.schema.nodes.image.create({ src: apiUrl, alt: file.name || '' }),
                                    ),
                                );
                            } catch (err) {
                                console.error('Failed to upload pasted image:', err);
                            } finally {
                                setUploadingImage(false);
                            }
                        };
                        reader.readAsDataURL(file);
                        return true;
                    }
                }
                return false;
            },
        },
        onUpdate: ({ editor: ed }) => {
            setDirty(true);
            scheduleSave(ed);
        },
    });

    // ── Expose editor to parent ────────────────────────────────────────────

    useEffect(() => {
        if (editor) onEditorReady?.(editor);
    }, [editor, onEditorReady]);

    // ── Autosave ────────────────────────────────────────────────────────────

    // Ref to track loaded threads for re-anchoring
    const loadedThreadsRef = useRef<CommentThread[]>([]);

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

            // Re-anchor threads after save to keep context fresh
            if (commentsEnabled && editor) {
                const threads = loadedThreadsRef.current;
                for (const thread of threads) {
                    if (thread.status === 'resolved') continue;
                    const freshAnchor = buildAnchorFromMark(editor, thread.id);
                    if (freshAnchor && freshAnchor.quotedText !== thread.anchor.quotedText) {
                        notesApi.updateThread(workspaceIdRef.current, path, thread.id, thread.status)
                            .catch(() => { /* non-fatal */ });
                        thread.anchor = freshAnchor;
                    }
                }
            }
        } catch {
            setSaveState('error');
        }
    }, [editor, commentsEnabled]);

    function scheduleSave(ed: { getHTML: () => string }) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        let md = htmlToMarkdown(ed.getHTML());
        md = rewriteImageSrcToRelative(md);
        pendingContentRef.current = md;
        saveTimerRef.current = setTimeout(() => flushSave(), 1500);
    }

    // ── Source mode: save raw markdown directly ─────────────────────────────

    const flushSourceSave = useCallback(async () => {
        if (sourceSaveTimerRef.current) {
            clearTimeout(sourceSaveTimerRef.current);
            sourceSaveTimerRef.current = null;
        }
        const content = pendingSourceContentRef.current;
        const path = notePathRef.current;
        if (content === null || !path) return;
        pendingSourceContentRef.current = null;
        setSaveState('saving');
        try {
            await notesApi.saveContent(workspaceIdRef.current, path, content);
            setSaveState('saved');
            setSourceDirty(false);
            setDirty(false);
            setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 3000);
        } catch {
            setSaveState('error');
        }
    }, []);

    function scheduleSourceSave() {
        if (sourceSaveTimerRef.current) clearTimeout(sourceSaveTimerRef.current);
        sourceSaveTimerRef.current = setTimeout(() => flushSourceSave(), 1500);
    }

    // ── Source mode: handle textarea change ─────────────────────────────────

    const handleSourceChange = useCallback((content: string) => {
        setRawMarkdown(content);
        pendingSourceContentRef.current = content;
        setSourceDirty(true);
        setDirty(true);
        scheduleSourceSave();
    }, []);

    // ── Source mode: image paste ────────────────────────────────────────────

    const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const rawMarkdownRef = useRef(rawMarkdown);
    rawMarkdownRef.current = rawMarkdown;

    const handleSourcePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file || !notePathRef.current) return;

                setUploadingImage(true);
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const dataUrl = ev.target?.result as string;
                    if (!dataUrl) { setUploadingImage(false); return; }
                    try {
                        const result = await notesApi.uploadImage(
                            workspaceIdRef.current,
                            file.name || 'pasted-image',
                            dataUrl,
                        );
                        const mdImg = `![${file.name || ''}](${result.path})`;
                        const ta = sourceTextareaRef.current;
                        const currentMd = rawMarkdownRef.current;
                        let newContent: string;
                        if (ta) {
                            const start = ta.selectionStart;
                            const end = ta.selectionEnd;
                            newContent = currentMd.slice(0, start) + mdImg + currentMd.slice(end);
                        } else {
                            newContent = currentMd + mdImg;
                        }
                        setRawMarkdown(newContent);
                        pendingSourceContentRef.current = newContent;
                        setSourceDirty(true);
                        setDirty(true);
                        scheduleSourceSave();
                    } catch (err) {
                        console.error('Failed to upload pasted image:', err);
                    } finally {
                        setUploadingImage(false);
                    }
                };
                reader.readAsDataURL(file);
                return;
            }
        }
    }, [rawMarkdown]);

    // ── Mode toggle logic ──────────────────────────────────────────────────

    const switchToSource = useCallback(async () => {
        // Flush pending WYSIWYG save before switching
        await flushSave();
        const path = notePathRef.current;
        if (!path) return;
        try {
            const { content } = await notesApi.getContent(workspaceIdRef.current, path);
            setRawMarkdown(content);
            setSourceDirty(false);
            setViewMode('source');
        } catch (err) {
            console.error('Failed to load markdown for source mode:', err);
        }
    }, [flushSave, setViewMode]);

    const switchToRich = useCallback(async () => {
        // Save dirty source content first
        const pendingSource = pendingSourceContentRef.current;
        if (pendingSource !== null) {
            const path = notePathRef.current;
            if (path) {
                try {
                    await notesApi.saveContent(workspaceIdRef.current, path, pendingSource);
                    pendingSourceContentRef.current = null;
                } catch { /* continue anyway */ }
            }
        }
        if (sourceSaveTimerRef.current) {
            clearTimeout(sourceSaveTimerRef.current);
            sourceSaveTimerRef.current = null;
        }
        // Convert raw markdown to HTML and load into Tiptap
        if (editor) {
            let html = markdownToHtml(rawMarkdown);
            html = rewriteImageSrcToApi(html, workspaceIdRef.current);
            editor.commands.setContent(html);

            // Re-anchor comments
            if (commentsEnabled) {
                const threads = loadedThreadsRef.current;
                for (const thread of threads) {
                    if (thread.status === 'resolved') continue;
                    const result = findAnchorInDoc(editor.state.doc, thread.anchor);
                    if (result) {
                        applyCommentMark(editor, thread.id, result.from, result.to);
                    }
                }
            }
        }
        setSourceDirty(false);
        setDirty(false);
        setViewMode('rich');
    }, [rawMarkdown, editor, commentsEnabled, setViewMode]);

    // ── Load content on path change ─────────────────────────────────────────

    useEffect(() => {
        // Flush pending save for previous page
        flushSave();

        // Reset to rich mode when switching notes
        setViewModeRaw('rich');
        setRawMarkdown('');
        setSourceDirty(false);

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
                let html = markdownToHtml(content);
                html = rewriteImageSrcToApi(html, workspaceId);
                editor?.commands.setContent(html);
                setDirty(false);

                // Apply comment marks from persisted threads
                if (commentsEnabled && editor) {
                    notesApi.getComments(workspaceId, notePath).then((sidecar) => {
                        if (cancelled) return;
                        const threads = Object.values(sidecar.threads);
                        loadedThreadsRef.current = threads;
                        for (const thread of threads) {
                            if (thread.status === 'resolved') continue;
                            const result = findAnchorInDoc(editor.state.doc, thread.anchor);
                            if (result) {
                                applyCommentMark(editor, thread.id, result.from, result.to);
                            }
                        }
                    }).catch(() => { /* non-fatal — comments just won't highlight */ });
                }
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
            if (sourceSaveTimerRef.current) clearTimeout(sourceSaveTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Ctrl+S / Cmd+S: suppress browser dialog & flush save ──────────────

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                if (viewMode === 'source') {
                    flushSourceSave();
                } else {
                    flushSave();
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
                if (viewMode === 'source') return; // comments not available in source mode
                e.preventDefault();
                onCommentCreateRef.current?.();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [flushSave, flushSourceSave, viewMode]);

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
            {/* Mode toggle bar */}
            <div className="mode-toggle" data-testid="note-mode-toggle">
                <button
                    className={`mode-btn${viewMode === 'rich' ? ' active' : ''}`}
                    onClick={() => { if (viewMode !== 'rich') switchToRich(); }}
                    data-testid="note-mode-rich"
                >Rich</button>
                <button
                    className={`mode-btn${viewMode === 'source' ? ' active' : ''}`}
                    onClick={() => { if (viewMode !== 'source') switchToSource(); }}
                    aria-label={sourceDirty ? 'Source (modified)' : undefined}
                    data-testid="note-mode-source"
                >{sourceDirty ? 'Source ●' : 'Source'}</button>
                {viewMode === 'source' && sourceDirty && (
                    <button
                        className="save-btn"
                        onClick={() => flushSourceSave()}
                        data-testid="note-source-save-btn"
                    >Save</button>
                )}
            </div>

            <NoteEditorToolbar
                editor={editor}
                hidden={viewMode === 'source'}
                commentsPanelOpen={commentsPanelOpen}
                onToggleCommentsPanel={onToggleCommentsPanel}
                commentCount={commentCount}
            />

            {viewMode === 'source' ? (
                <div className="flex-1 overflow-y-auto" onPaste={handleSourcePaste} data-testid="note-source-container">
                    <SourceEditor
                        content={rawMarkdown}
                        onChange={handleSourceChange}
                        ref={sourceTextareaRef}
                    />
                </div>
            ) : (
                <div
                    className="flex-1 overflow-y-auto"
                    onContextMenu={(e) => {
                        if (editor && !editor.state.selection.empty) {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY });
                        }
                    }}
                >
                    <EditorContent editor={editor} />
                </div>
            )}

            {/* Right-click context menu for adding comments */}
            {contextMenu && (
                <ContextMenu
                    position={contextMenu}
                    items={[
                        {
                            label: 'Add comment',
                            icon: '💬',
                            disabled: editor?.state.selection.empty ?? true,
                            onClick: () => {
                                onCommentCreate?.();
                                setContextMenu(null);
                            },
                        },
                    ]}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {/* Save indicator */}
            <div className="absolute bottom-3 right-3 text-xs select-none" data-testid="save-indicator">
                {uploadingImage && (
                    <span className="text-[#888] mr-2">
                        <span className="animate-spin inline-block mr-1">📷</span>Uploading…
                    </span>
                )}
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
                        <button className="underline" onClick={() => viewMode === 'source' ? flushSourceSave() : flushSave()}>
                            Retry
                        </button>
                    </span>
                )}
            </div>
        </div>
    );
}
