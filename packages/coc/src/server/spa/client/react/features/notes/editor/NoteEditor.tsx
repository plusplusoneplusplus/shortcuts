import { useState, useEffect, useRef, useCallback } from 'react';
import type React from 'react';
import type { Editor } from '@tiptap/core';
import type { CommentThread } from '../notesApi';
import { markdownToHtml, htmlToMarkdown, rewriteImageSrcToRelative } from './noteMarkdown';
import type { NoteEditorIO } from './NoteEditorIO';
import { defaultNoteEditorIO, rewriteHtmlImageSrc } from './NoteEditorIO';
import type { NoteEditorCommentBackend } from './NoteEditorCommentBackend';
import { defaultCommentBackend } from './NoteEditorCommentBackend';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import { RichEditorCore } from './RichEditorCore';
import { SourceEditor } from '../../../shared/SourceEditor';
import { findAnchorInDoc, applyCommentMark, buildAnchorFromMark } from './commentAnchoring';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import { wordDiff } from './noteEditDiff';
import type { DiffChunk } from './noteEditDiff';
import type { AiEditRegion } from './extensions/AiEditDecorationExtension';
import { AIEditNavigator } from './AIEditNavigator';
import './noteEditor.css';

export type NoteViewMode = 'rich' | 'source';

export interface NoteEditorProps {
    workspaceId: string;
    notePath: string | null;
    /** Injectable content I/O adapter. Defaults to the notes-backed implementation. */
    io?: NoteEditorIO;
    /** Injectable comment-thread backend. Defaults to the notes-backed implementation. */
    commentBackend?: NoteEditorCommentBackend;
    /** Pre-loaded comment threads (from useComments). When provided, NoteEditor
     *  uses these for mark application instead of calling commentBackend.loadThreads. */
    threads?: CommentThread[];
    onCommentActivated?: (commentId: string | null) => void;
    onEditorReady?: (editor: Editor) => void;
    onCommentCreate?: () => void;
    commentsEnabled?: boolean;
    onViewModeChange?: (mode: NoteViewMode) => void;
    commentsPanelOpen?: boolean;
    onToggleCommentsPanel?: () => void;
    commentCount?: number;
    /** Called with the flushSave function so the parent can trigger a save before sending chat messages. */
    onFlushSave?: (flush: () => Promise<void>) => void;
    /** Called when the note file is not found (404). Allows the parent to hide the editor silently. */
    onNotFound?: () => void;
    /** Extra content rendered at the right end of the toolbar (before the mode toggle). */
    toolbarRight?: React.ReactNode;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Find contiguous changed regions in the editor document from word diff chunks.
 * Groups runs of add/remove chunks, maps text offsets to ProseMirror positions.
 */
function findChangedRegionsInDoc(
    chunks: DiffChunk[],
    doc: { descendants: (callback: (node: { isText: boolean; text?: string }, pos: number) => void) => void },
): AiEditRegion[] {
    // Group chunks into contiguous changed regions and track new-text offsets
    const rawRegions: Array<{ fromOffset: number; toOffset: number; chunks: DiffChunk[] }> = [];
    let newTextOffset = 0;
    let i = 0;

    while (i < chunks.length) {
        if (chunks[i].type === 'equal') {
            newTextOffset += chunks[i].text.length;
            i++;
            continue;
        }
        const regionFrom = newTextOffset;
        const regionChunks: DiffChunk[] = [];
        while (i < chunks.length && chunks[i].type !== 'equal') {
            regionChunks.push(chunks[i]);
            if (chunks[i].type === 'add') {
                newTextOffset += chunks[i].text.length;
            }
            i++;
        }
        rawRegions.push({ fromOffset: regionFrom, toOffset: newTextOffset, chunks: regionChunks });
    }

    if (rawRegions.length === 0) return [];

    // Build text-offset → doc-position map
    const posMap: Array<{ textOffset: number; docPos: number; len: number }> = [];
    let currentTextOffset = 0;
    doc.descendants((node, pos) => {
        if (!node.isText) return;
        const len = (node.text ?? '').length;
        posMap.push({ textOffset: currentTextOffset, docPos: pos, len });
        currentTextOffset += len;
    });

    function textOffsetToDocPos(offset: number): number {
        for (let j = posMap.length - 1; j >= 0; j--) {
            if (posMap[j].textOffset <= offset) {
                return posMap[j].docPos + (offset - posMap[j].textOffset);
            }
        }
        return offset === 0 && posMap.length > 0 ? posMap[0].docPos : -1;
    }

    const now = Date.now();
    const regions: AiEditRegion[] = [];

    for (const raw of rawRegions) {
        const from = textOffsetToDocPos(raw.fromOffset);
        const to = raw.toOffset > raw.fromOffset ? textOffsetToDocPos(raw.toOffset) : from;
        if (from === -1) continue;

        regions.push({
            id: `ai-edit-${now}-${regions.length}`,
            from,
            to: to === -1 ? from : to,
            chunks: raw.chunks,
        });
    }

    return regions;
}

export function NoteEditor({
    workspaceId,
    notePath,
    io = defaultNoteEditorIO,
    commentBackend = defaultCommentBackend,
    threads: threadsProp,
    onCommentActivated,
    onEditorReady,
    onCommentCreate,
    commentsEnabled = true,
    onViewModeChange,
    commentsPanelOpen,
    onToggleCommentsPanel,
    commentCount,
    onFlushSave,
    onNotFound,
    toolbarRight,
}: NoteEditorProps) {
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>('idle');
    const [dirty, setDirty] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // AI edit navigator state
    const [aiEditCount, setAiEditCount] = useState(0);
    const [aiEditsVisible, setAiEditsVisible] = useState(true);
    const aiEditRegionsRef = useRef<Array<{ id: string; from: number; to: number }>>([]);

    // Source mode state
    const [viewMode, setViewModeRaw] = useState<NoteViewMode>('rich');
    const [rawMarkdown, setRawMarkdown] = useState('');
    const [sourceDirty, setSourceDirty] = useState(false);
    const viewModeRef = useRef(viewMode);
    viewModeRef.current = viewMode;

    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sourceSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingContentRef = useRef<string | null>(null);
    const pendingSourceContentRef = useRef<string | null>(null);
    const lastSaveAtRef = useRef(0);
    const notePathRef = useRef(notePath);
    const workspaceIdRef = useRef(workspaceId);
    const ioRef = useRef(io);
    const commentBackendRef = useRef(commentBackend);

    // Keep refs in sync
    notePathRef.current = notePath;
    workspaceIdRef.current = workspaceId;
    ioRef.current = io;
    commentBackendRef.current = commentBackend;

    // View mode setter that also notifies parent
    const setViewMode = useCallback((mode: NoteViewMode) => {
        setViewModeRaw(mode);
        onViewModeChange?.(mode);
    }, [onViewModeChange]);

    // ── Tiptap editor (via RichEditorCore) ─────────────────────────────────

    const onCommentCreateRef = useRef(onCommentCreate);
    onCommentCreateRef.current = onCommentCreate;

    const [editor, setEditor] = useState<Editor | null>(null);
    const editorRef = useRef<Editor | null>(null);

    const handleEditorReady = useCallback((ed: Editor) => {
        editorRef.current = ed;
        setEditor(ed);
        onEditorReady?.(ed);
    }, [onEditorReady]);

    const handleEditorChange = useCallback((ed: Editor) => {
        setDirty(true);
        scheduleSave(ed);
    }, []);

    const handlePaste = useCallback((view: any, event: ClipboardEvent) => {
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
                        const result = await ioRef.current.uploadImage(
                            workspaceIdRef.current,
                            file.name || 'pasted-image',
                            dataUrl,
                        );
                        const apiUrl = ioRef.current.imageApiUrl(workspaceIdRef.current, result.path);
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
    }, []);

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
            await ioRef.current.saveContent(workspaceIdRef.current, path, content);
            lastSaveAtRef.current = Date.now();
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
                        commentBackendRef.current.updateThreadAnchor(workspaceIdRef.current, path, thread.id, thread.status)
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
            await ioRef.current.saveContent(workspaceIdRef.current, path, content);
            lastSaveAtRef.current = Date.now();
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
                        const result = await ioRef.current.uploadImage(
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
            const { content } = await ioRef.current.loadContent(workspaceIdRef.current, path);
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
                    await ioRef.current.saveContent(workspaceIdRef.current, path, pendingSource);
                    pendingSourceContentRef.current = null;
                } catch { /* continue anyway */ }
            }
        }
        if (sourceSaveTimerRef.current) {
            clearTimeout(sourceSaveTimerRef.current);
            sourceSaveTimerRef.current = null;
        }
        // Convert raw markdown to HTML and load into Tiptap
        const ed = editorRef.current;
        if (ed && !ed.isDestroyed) {
            let html = markdownToHtml(rawMarkdown);
            html = rewriteHtmlImageSrc(html, ioRef.current, workspaceIdRef.current);
            ed.commands.setContent(html);

            // Cancel any save triggered by setContent
            pendingContentRef.current = null;
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }

            // Re-anchor comments
            if (commentsEnabled) {
                const threads = loadedThreadsRef.current;
                for (const thread of threads) {
                    if (thread.status === 'resolved') continue;
                    const result = findAnchorInDoc(ed.state.doc, thread.anchor);
                    if (result) {
                        applyCommentMark(ed, thread.id, result.from, result.to);
                    }
                }
            }
        }
        setSourceDirty(false);
        setDirty(false);
        setViewMode('rich');
    }, [rawMarkdown, commentsEnabled, setViewMode]);

    // ── Apply comment marks from threads prop ─────────────────────────────────

    const contentLoadedRef = useRef(false);

    useEffect(() => {
        if (!editor || !threadsProp || !notePath || !contentLoadedRef.current || !commentsEnabled) return;
        loadedThreadsRef.current = threadsProp;
        for (const thread of threadsProp) {
            if (thread.status === 'resolved') continue;
            const result = findAnchorInDoc(editor.state.doc, thread.anchor);
            if (result) {
                applyCommentMark(editor, thread.id, result.from, result.to);
            }
        }
    }, [threadsProp, editor, notePath, commentsEnabled]);

    // ── Load content on path change ─────────────────────────────────────────
    //
    // The editor is kept mounted (hidden behind a loading overlay) so the
    // TipTap instance is never destroyed during note switches.  This means
    // editorRef.current is always a live editor once it has been created,
    // and we can safely call setContent on it from the fetch callback.

    const flushSaveRef = useRef(flushSave);
    flushSaveRef.current = flushSave;

    useEffect(() => {
        flushSaveRef.current();

        // Reset to rich mode when switching notes
        setViewModeRaw('rich');
        setRawMarkdown('');
        setSourceDirty(false);
        contentLoadedRef.current = false;
        // Clear AI edit decorations from previous note
        aiEditRegionsRef.current = [];
        setAiEditCount(0);
        setAiEditsVisible(false);

        if (!notePath) {
            editorRef.current?.commands.clearContent({ emitUpdate: false });
            setLoadError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setLoadError(null);
        setSaveState('idle');

        ioRef.current
            .loadContent(workspaceId, notePath)
            .then(({ content }) => {
                if (cancelled) return;
                let html = markdownToHtml(content);
                html = rewriteHtmlImageSrc(html, ioRef.current, workspaceId);

                const ed = editorRef.current;
                if (ed && !ed.isDestroyed) {
                    ed.commands.setContent(html);
                    pendingContentRef.current = null;
                    if (saveTimerRef.current) {
                        clearTimeout(saveTimerRef.current);
                        saveTimerRef.current = null;
                    }
                    setDirty(false);
                    setRawMarkdown(content);
                    contentLoadedRef.current = true;

                    if (commentsEnabled) {
                        if (threadsProp) {
                            loadedThreadsRef.current = threadsProp;
                            for (const thread of threadsProp) {
                                if (thread.status === 'resolved') continue;
                                const result = findAnchorInDoc(ed.state.doc, thread.anchor);
                                if (result) {
                                    applyCommentMark(ed, thread.id, result.from, result.to);
                                }
                            }
                        } else {
                            commentBackendRef.current.loadThreads(workspaceId, notePath).then((threads) => {
                                if (cancelled) return;
                                const edInner = editorRef.current;
                                if (!edInner || edInner.isDestroyed) return;
                                loadedThreadsRef.current = threads;
                                for (const thread of threads) {
                                    if (thread.status === 'resolved') continue;
                                    const result = findAnchorInDoc(edInner.state.doc, thread.anchor);
                                    if (result) {
                                        applyCommentMark(edInner, thread.id, result.from, result.to);
                                    }
                                }
                            }).catch(() => { /* non-fatal — comments just won't highlight */ });
                        }
                    }
                }
            })
            .catch((err) => {
                if (cancelled) return;
                if (err?.message?.includes('404')) {
                    onNotFound?.();
                    return;
                }
                setLoadError(err?.message ?? 'Failed to load note');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [notePath, workspaceId, onNotFound]);

    // ── Flush on unmount ────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            flushSave();
            if (sourceSaveTimerRef.current) clearTimeout(sourceSaveTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Expose flushSave to parent (for save-before-send) ────────────────

    useEffect(() => {
        onFlushSave?.(flushSave);
    }, [onFlushSave, flushSave]);

    // ── AI edit navigator: dismiss all decorations ──────────────────────

    const handleAiEditDismiss = useCallback(() => {
        const ed = editorRef.current;
        if (ed && !ed.isDestroyed) {
            ed.commands.clearAiEdits?.();
        }
        aiEditRegionsRef.current = [];
        setAiEditCount(0);
        setAiEditsVisible(false);
    }, []);

    // ── AI edit navigator: jump to next region ──────────────────────────

    const handleAiEditNext = useCallback(() => {
        const ed = editorRef.current;
        if (!ed || aiEditRegionsRef.current.length === 0) return;
        const first = aiEditRegionsRef.current[0];
        ed.chain().setTextSelection({ from: first.from, to: first.to }).scrollIntoView().run();
    }, []);

    // ── AI edit toggle: show/hide decorations ───────────────────────────

    const handleAiEditToggle = useCallback(() => {
        const ed = editorRef.current;
        if (!ed || ed.isDestroyed) return;
        if (aiEditsVisible) {
            ed.commands.clearAiEdits?.();
            setAiEditsVisible(false);
        } else {
            if (aiEditRegionsRef.current.length > 0) {
                ed.commands.setAiEdits(aiEditRegionsRef.current as any);
            }
            setAiEditsVisible(true);
        }
    }, [aiEditsVisible]);

    // ── Auto-reload on notes-changed WS event (with diff decorations) ───

    useEffect(() => {
        if (!notePath) return;
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId: string; changedPaths: string[] } | undefined;
            if (!detail || detail.wsId !== workspaceIdRef.current) return;
            const normalizedNotePath = notePath.replace(/\\/g, '/');
            const match = detail.changedPaths.some(p => p.replace(/\\/g, '/') === normalizedNotePath);
            if (!match) return;
            // Skip reload when it's an echo of our own save
            if (Date.now() - lastSaveAtRef.current < 1000) return;
            // Skip reload if user has unsaved edits
            if (pendingContentRef.current !== null) return;
            ioRef.current.loadContent(workspaceIdRef.current, notePath).then(({ content }) => {
                // Skip redundant reload — content already matches what's displayed
                if (content === rawMarkdownRef.current) return;

                const ed = editorRef.current;
                if (!ed || ed.isDestroyed) {
                    setRawMarkdown(content);
                    return;
                }

                // Capture previous doc text before updating content
                const previousDocText = ed.state.doc.textContent;

                let html = markdownToHtml(content);
                html = rewriteHtmlImageSrc(html, ioRef.current, workspaceIdRef.current);
                ed.commands.setContent(html, { emitUpdate: false });
                setDirty(false);
                setRawMarkdown(content);

                // Skip diff decorations in source mode
                if (viewModeRef.current === 'source') return;

                // Compute diff on plain text (doc text, not markdown)
                const newDocText = ed.state.doc.textContent;
                if (previousDocText === newDocText) return;

                const chunks = wordDiff(previousDocText, newDocText);
                if (chunks.every(c => c.type === 'equal')) return;

                // Skip decoration if diff is too large (>50% of new text is changed)
                const equalChars = chunks.filter(c => c.type === 'equal').reduce((sum, c) => sum + c.text.length, 0);
                if (newDocText.length > 0 && equalChars / newDocText.length < 0.5) return;

                // Find changed regions and map to ProseMirror positions
                const regions = findChangedRegionsInDoc(chunks, ed.state.doc);
                if (regions.length === 0) return;

                // Apply decorations and update count
                aiEditRegionsRef.current = [...aiEditRegionsRef.current, ...regions];
                ed.commands.setAiEdits(aiEditRegionsRef.current as any);
                setAiEditCount(prev => prev + regions.length);
            }).catch(() => { /* non-fatal */ });
        };
        window.addEventListener('notes-changed', handler);
        return () => window.removeEventListener('notes-changed', handler);
    }, [notePath]);

    // ── note-edit-show / note-edit-hide events from chat panel ──────────
    useEffect(() => {
        const showHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as {
                editId: string; wsId: string;
                preEditContent: string; postEditContent: string;
                notePath: string;
            } | undefined;
            if (!detail || detail.wsId !== workspaceIdRef.current || detail.notePath !== notePath) return;
            if (viewModeRef.current === 'source') return;
            const ed = editorRef.current;
            if (!ed || ed.isDestroyed) return;
            const chunks = wordDiff(detail.preEditContent, detail.postEditContent);
            if (chunks.every(c => c.type === 'equal')) return;
            const regions = findChangedRegionsInDoc(chunks, ed.state.doc);
            if (regions.length === 0) return;
            aiEditRegionsRef.current = regions;
            ed.commands.setAiEdits(regions as any);
            setAiEditCount(regions.length);
            setAiEditsVisible(true);
        };
        const hideHandler = (e: Event) => {
            const detail = (e as CustomEvent).detail as { wsId: string } | undefined;
            if (!detail || detail.wsId !== workspaceIdRef.current) return;
            const ed = editorRef.current;
            if (ed && !ed.isDestroyed) ed.commands.clearAiEdits?.();
            setAiEditCount(0);
            setAiEditsVisible(false);
        };
        window.addEventListener('note-edit-show', showHandler);
        window.addEventListener('note-edit-hide', hideHandler);
        return () => {
            window.removeEventListener('note-edit-show', showHandler);
            window.removeEventListener('note-edit-hide', hideHandler);
        };
    }, [notePath]);

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

    const isEmpty = notePath === null;

    // ── Render ────────────────────────────────────────────────────────────────
    //
    // The RichEditorCore is always mounted so the TipTap instance survives
    // across load cycles.  Loading/error states are rendered as overlays on
    // top of the (hidden) editor.  This avoids destroying and re-creating
    // the editor on every note switch, which previously caused infinite
    // fetch loops and race conditions where content was lost.

    const editorHidden = isEmpty || loading || loadError;

    return (
        <div className="note-editor flex-1 flex flex-col min-h-0 relative" data-testid={isEmpty ? 'note-editor-empty' : 'note-editor'}>
            {!editorHidden && (
                <NoteEditorToolbar
                    editor={editor}
                    hidden={viewMode === 'source'}
                    commentsPanelOpen={commentsPanelOpen}
                    onToggleCommentsPanel={onToggleCommentsPanel}
                    commentCount={commentCount}
                    aiEditCount={aiEditCount}
                    aiEditsVisible={aiEditsVisible}
                    onDismissAiEdits={handleAiEditDismiss}
                    onToggleAiEdits={handleAiEditToggle}
                    toolbarRight={toolbarRight}
                    modeToggle={
                        <div className="flex items-center gap-1" data-testid="note-mode-toggle">
                            <div className="flex h-5 rounded border border-[#c0c0c0] dark:border-[#555] overflow-hidden text-[10px]">
                                <button
                                    type="button"
                                    className={`px-1.5 h-full flex items-center transition-colors ${
                                        viewMode === 'rich'
                                            ? 'bg-[#0078d4] text-white active'
                                            : 'bg-transparent text-[#888] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#3c3c3c]'
                                    }`}
                                    onClick={() => viewMode !== 'rich' && switchToRich()}
                                    title="Rich editor"
                                    data-testid="note-mode-rich"
                                >Rich</button>
                                <button
                                    type="button"
                                    className={`px-1.5 h-full flex items-center transition-colors ${
                                        viewMode === 'source'
                                            ? 'bg-[#0078d4] text-white active'
                                            : 'bg-transparent text-[#888] dark:text-[#999] hover:bg-[#e8e8e8] dark:hover:bg-[#3c3c3c]'
                                    }`}
                                    onClick={() => viewMode !== 'source' && switchToSource()}
                                    title={sourceDirty ? 'MD (modified)' : 'Source editor'}
                                    data-testid="note-mode-source"
                                >{sourceDirty && viewMode === 'source' ? 'MD ●' : 'MD'}</button>
                            </div>
                            {viewMode === 'source' && sourceDirty && (
                                <button className="save-btn" onClick={flushSourceSave} disabled={saveState === 'saving'} data-testid="note-source-save-btn">
                                    {saveState === 'saving' ? 'Saving…' : 'Save'}
                                </button>
                            )}
                        </div>
                    }
                />
            )}

            {/* Source editor — mounted only when in source mode */}
            {viewMode === 'source' && !editorHidden && (
                <div className="flex-1 overflow-y-auto" onPaste={handleSourcePaste} data-testid="note-source-container">
                    <SourceEditor
                        content={rawMarkdown}
                        onChange={handleSourceChange}
                        ref={sourceTextareaRef}
                    />
                </div>
            )}

            {/* Rich editor — always mounted so the TipTap instance is never
                destroyed.  Hidden via CSS when source mode, loading, error,
                or empty state is active. */}
            <div
                className="flex-1 overflow-y-auto relative"
                style={viewMode === 'source' && !editorHidden ? { display: 'none' } : undefined}
                onContextMenu={(e) => {
                    if (!editorHidden && viewMode !== 'source' && editor && !editor.state.selection.empty) {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY });
                    }
                }}
            >
                <div style={editorHidden ? { visibility: 'hidden', height: 0, overflow: 'hidden' } : undefined}>
                    <RichEditorCore
                        commentsEnabled={commentsEnabled}
                        onCommentActivated={onCommentActivated}
                        onChange={handleEditorChange}
                        onEditorReady={handleEditorReady}
                        handlePaste={handlePaste}
                    />
                </div>

                {isEmpty && (
                    <div
                        className="flex-1 flex flex-col items-center justify-center text-sm text-[#616161] dark:text-[#999] select-none gap-2 absolute inset-0"
                    >
                        <span className="text-3xl">📄</span>
                        <span className="italic">Select a page to start editing</span>
                    </div>
                )}

                {loading && (
                    <div
                        className="flex-1 flex items-center justify-center text-sm text-[#616161] dark:text-[#999] absolute inset-0"
                        data-testid="note-editor-loading"
                    >
                        <span className="animate-spin mr-2">⏳</span> Loading…
                    </div>
                )}

                {loadError && (
                    <div
                        className="flex-1 flex items-center justify-center absolute inset-0"
                        data-testid="note-editor-error"
                    >
                        <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 rounded px-4 py-2">
                            {loadError}
                        </div>
                    </div>
                )}
            </div>

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

            {/* AI edit navigator pill */}
            {aiEditCount > 0 && viewMode === 'rich' && (
                <AIEditNavigator
                    editCount={aiEditCount}
                    onNext={handleAiEditNext}
                    onDismiss={handleAiEditDismiss}
                />
            )}
        </div>
    );
}
