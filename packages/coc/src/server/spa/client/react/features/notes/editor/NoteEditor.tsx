import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type React from 'react';
import type { Editor } from '@tiptap/core';
import type { CommentThread } from '../notesApi';
import type { NoteEditorIO } from './NoteEditorIO';
import { defaultNoteEditorIO } from './NoteEditorIO';
import {
    buildImageMarkdown,
    insertTextAtSelection,
    markdownToRichEditorHtml,
    richEditorHtmlToMarkdown,
} from '../../../shared/markdown-document/markdownRichConversion';
import type { NoteEditorCommentBackend } from './NoteEditorCommentBackend';
import { defaultCommentBackend } from './NoteEditorCommentBackend';
import { NoteEditorToolbar } from './NoteEditorToolbar';
import { RichEditorCore } from './RichEditorCore';
import { SourceEditor } from '../../../shared/SourceEditor';
import { findAnchorInDoc, applyCommentMark, buildAnchorFromMark } from './commentAnchoring';
import { ContextMenu } from '../../../tasks/comments/ContextMenu';
import type { ContextMenuItem } from '../../../tasks/comments/ContextMenu';
import { wordDiff } from './noteEditDiff';
import type { DiffChunk } from './noteEditDiff';
import type { AiEditRegion } from './extensions/AiEditDecorationExtension';
import { AIEditNavigator } from './AIEditNavigator';
import type { TocEntry } from './noteTocUtils';
import { extractHeadings } from './noteTocUtils';
import './noteEditor.css';

import { NoteConflictBanner } from './NoteConflictBanner';
import { computeBestEffortScrollTop } from './noteScrollToLine';
import { resetEditorHistory } from './editorHistory';
import { FilePreviewTooltip } from './FilePreviewTooltip';
import { NoteVersionHistoryPanel } from './NoteVersionHistoryPanel';
import { NoteMetadataPanel } from './NoteMetadataPanel';
import type { NoteFrontMatterParseResult } from './noteFrontMatter';
import { parseNoteFrontMatter } from './noteFrontMatter';
import { notesApi } from '../notesApi';
import { useQueue } from '../../../contexts/QueueContext';
import { isGoalFile } from '../../../shared/goal-file-utils';
import { RalphLaunchDialog } from '../../../shared/RalphLaunchDialog';
import { isRalphEnabled } from '../../../utils/config';
import {
    useMarkdownDocumentKeyboardShortcuts,
    useMarkdownDocumentSession,
} from '../../../shared/markdown-document/useMarkdownDocumentSession';

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
    /** Initial view mode. Defaults to 'rich'. */
    initialViewMode?: NoteViewMode;
    /** Absolute path to the notes root directory. When provided, Run Skill context uses an absolute note path. */
    notesRoot?: string;
    /** Whether the AI chat panel is currently open. */
    chatPanelOpen?: boolean;
    /** Whether the AI chat is showing as a floating lens. The lens owns the editor's
     *  bottom-right corner, so the AI-edit pill relocates to the top-right while it is up. */
    chatLensOpen?: boolean;
    /** Called to toggle the AI chat panel. When provided, a 🤖 button appears in the toolbar. */
    onToggleChatPanel?: () => void;
    /** When set, the AI chat button stays visible but is disabled with this reason. */
    chatDisabledReason?: string;
    /** When true, the 🤖 button is tinted blue to indicate an existing chat history. */
    hasExistingChat?: boolean;
    /** Called when the user clicks a `[[note:...]]` cross-link. Receives the target path and optional heading slug. */
    onNavigateToNote?: (path: string, heading?: string) => void;
    /** Called when the user selects "Add to chat as reference" from the context menu.
     *  Only provided when the chat panel is open and below the reference cap. */
    onAddNoteReference?: (text: string, notePath: string, noteTitle: string) => void;
    /** Whether the current root is the default managed root. Defaults to true.
     *  When false, version history and git features are hidden. */
    isDefaultRoot?: boolean;
    /** Root identifier for multi-root notes support. When set, scopes content/image API calls. */
    root?: string;
    /** Best-effort: 1-based source line to scroll near when the note opens. When
     *  set, the editor proportionally scrolls toward this line once content has
     *  loaded; it falls back to the top when a precise jump is not feasible.
     *  No range highlight is applied. */
    scrollToLine?: number | null;
}

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
    initialViewMode,
    notesRoot,
    chatPanelOpen,
    chatLensOpen,
    onToggleChatPanel,
    chatDisabledReason,
    hasExistingChat,
    onNavigateToNote,
    onAddNoteReference,
    isDefaultRoot = true,
    root,
    scrollToLine,
}: NoteEditorProps) {
    const [uploadingImage, setUploadingImage] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selectedText: string } | null>(null);
    const [frontMatterResult, setFrontMatterResult] = useState<NoteFrontMatterParseResult>({ kind: 'none' });

    const canRunSkill = Boolean(notePath);
    const { dispatch: queueDispatch } = useQueue();
    const normalizedNotePath = notePath?.replace(/\\/g, '/') ?? '';
    const isGoal = useMemo(() => isGoalFile(normalizedNotePath), [normalizedNotePath]);
    const ralphEnabled = isRalphEnabled();
    const [ralphDialogOpen, setRalphDialogOpen] = useState(false);
    const contextFilePath = !normalizedNotePath ? '' : notesRoot
        ? notesRoot.replace(/\\/g, '/') + '/' + normalizedNotePath
        : normalizedNotePath;
    const contextTaskName = (() => {
        if (!normalizedNotePath) return '';
        const filename = normalizedNotePath.split('/').pop() ?? '';
        return filename.replace(/\.plan\.md$/, '').replace(/\.md$/, '');
    })();

    // Version history panel
    const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
    const [gitInitialized, setGitInitialized] = useState(false);

    // AI edit navigator state
    const [aiEditCount, setAiEditCount] = useState(0);
    const [aiEditsVisible, setAiEditsVisible] = useState(true);
    const aiEditRegionsRef = useRef<Array<{ id: string; from: number; to: number }>>([]);

    // TOC state
    const [tocOpen, setTocOpen] = useState(false);
    const [tocEntries, setTocEntries] = useState<TocEntry[]>([]);
    const [tocActiveIndex, setTocActiveIndex] = useState<number | null>(null);
    const editorScrollContainerRef = useRef<HTMLDivElement | null>(null);

    // Source mode state
    const [viewMode, setViewModeRaw] = useState<NoteViewMode>(initialViewMode ?? 'rich');
    const [sourceDirty, setSourceDirty] = useState(false);
    const viewModeRef = useRef(viewMode);
    viewModeRef.current = viewMode;

    const lastSaveAtRef = useRef(0);
    const notePathRef = useRef(notePath);
    const workspaceIdRef = useRef(workspaceId);
    const ioRef = useRef(io);
    const commentBackendRef = useRef(commentBackend);
    const frontMatterResultRef = useRef<NoteFrontMatterParseResult>(frontMatterResult);
    const onNotFoundRef = useRef(onNotFound);
    const rootRef = useRef(root);

    // Keep refs in sync
    notePathRef.current = notePath;
    workspaceIdRef.current = workspaceId;
    ioRef.current = io;
    commentBackendRef.current = commentBackend;
    rootRef.current = root;
    frontMatterResultRef.current = frontMatterResult;
    onNotFoundRef.current = onNotFound;

    const loadedThreadsRef = useRef<CommentThread[]>([]);
    const contentLoadedRef = useRef(false);

    const documentSession = useMarkdownDocumentSession({
        workspaceId,
        documentPath: notePath,
        io,
        root,
        autosaveDebounceMs: 1500,
        flushBeforeLoad: true,
        onBeforeLoad: () => {
            setViewModeRaw('rich');
            setFrontMatterResult({ kind: 'none' });
            setSourceDirty(false);
            contentLoadedRef.current = false;
            aiEditRegionsRef.current = [];
            setAiEditCount(0);
            setAiEditsVisible(false);
            setTocEntries([]);
            setTocOpen(false);
            setTocActiveIndex(null);
        },
        onLoaded: ({ content }) => {
            const { html, frontMatter } = markdownToRichEditorHtml({
                markdown: content,
                io: ioRef.current,
                workspaceId: workspaceIdRef.current,
                root: rootRef.current,
            });
            setFrontMatterResult(frontMatter);

            const ed = editorRef.current;
            if (ed && !ed.isDestroyed) {
                ed.commands.setContent(html, { emitUpdate: false });
                ed.commands.setTextSelection?.(1);
                resetEditorHistory(ed);
                setSourceDirty(false);
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
                        commentBackendRef.current.loadThreads(
                            workspaceIdRef.current,
                            notePathRef.current ?? '',
                            rootRef.current,
                        ).then((threads) => {
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
        },
        onLoadError: (err) => {
            if (err instanceof Error && err.message.includes('404')) {
                onNotFoundRef.current?.();
                return true;
            }
            return false;
        },
        onSaved: () => {
            lastSaveAtRef.current = Date.now();
            setSourceDirty(false);
            const path = notePathRef.current;
            if (commentsEnabled && editor && path) {
                const threads = loadedThreadsRef.current;
                for (const thread of threads) {
                    if (thread.status === 'resolved') continue;
                    const freshAnchor = buildAnchorFromMark(editor, thread.id);
                    if (freshAnchor && freshAnchor.quotedText !== thread.anchor.quotedText) {
                        commentBackendRef.current.updateThreadAnchor(
                            workspaceIdRef.current,
                            path,
                            thread.id,
                            thread.status,
                            rootRef.current,
                        )
                            .catch(() => { /* non-fatal */ });
                        thread.anchor = freshAnchor;
                    }
                }
            }
        },
        onDiscardDirty: () => {
            setSourceDirty(false);
        },
    });

    const rawMarkdown = documentSession.content;
    const setRawMarkdown = documentSession.setContent;
    const loading = documentSession.loading;
    const loadError = documentSession.loadError;
    const saveState = documentSession.saveState;
    const dirty = documentSession.dirty;
    const setDirty = documentSession.setDirty;
    const mtimeRef = documentSession.mtimeRef;
    const conflictContent = documentSession.conflictContent;
    const setConflictContent = documentSession.setConflictContent;
    const pendingContentRef = documentSession.pendingContentRef;
    const flushSave = documentSession.flushSave;
    const queueSave = documentSession.queueSave;
    const discardPending = documentSession.discardPending;

    const rawMarkdownRef = useRef(rawMarkdown);
    rawMarkdownRef.current = rawMarkdown;

    // View mode setter that also notifies parent
    const setViewMode = useCallback((mode: NoteViewMode) => {
        setViewModeRaw(mode);
        onViewModeChange?.(mode);
    }, [onViewModeChange]);

    // ── Get current editor content as markdown (for Ralph launch) ───────────
    const getCurrentGoalSpec = useCallback(() => {
        if (viewMode === 'source') return rawMarkdown;
        return richEditorHtmlToMarkdown({
            html: editorRef.current?.getHTML() ?? '',
            frontMatter: frontMatterResultRef.current,
        });
    }, [viewMode, rawMarkdown]);

    // ── Load git initialized state (only for default managed root) ────────

    useEffect(() => {
        if (!isDefaultRoot) {
            setGitInitialized(false);
            return;
        }
        notesApi.getGitStatus(workspaceId)
            .then(({ initialized }) => setGitInitialized(!!initialized))
            .catch(() => setGitInitialized(false));
    }, [workspaceId, isDefaultRoot]);

    // ── Tiptap editor (via RichEditorCore) ─────────────────────────────────
    const onCommentCreateRef = useRef(onCommentCreate);
    onCommentCreateRef.current = onCommentCreate;

    const [editor, setEditor] = useState<Editor | null>(null);
    const editorRef = useRef<Editor | null>(null);

    const handleEditorReady = useCallback((ed: Editor) => {
        editorRef.current = ed;
        setEditor(ed);
        setTocEntries(extractHeadings(ed));
        onEditorReady?.(ed);
    }, [onEditorReady]);

    const handleEditorChange = useCallback((ed: Editor) => {
        setDirty(true);
        setTocEntries(extractHeadings(ed));
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
                            rootRef.current,
                        );
                        const apiUrl = ioRef.current.imageApiUrl(workspaceIdRef.current, result.path, rootRef.current);
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

    function scheduleSave(ed: { getHTML: () => string }) {
        queueSave(richEditorHtmlToMarkdown({
            html: ed.getHTML(),
            frontMatter: frontMatterResultRef.current,
        }));
    }

    // ── Source mode: handle textarea change ─────────────────────────────────

    const handleSourceChange = useCallback((content: string) => {
        setRawMarkdown(content);
        setSourceDirty(true);
        queueSave(content);
    }, [queueSave, setRawMarkdown]);

    // ── Source mode: image paste ────────────────────────────────────────────

    const sourceTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const handleSourcePaste = useCallback(async (e: React.ClipboardEvent<HTMLDivElement>) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        const textarea = sourceTextareaRef.current;
        const pasteTarget = e.target as Node | null;
        const isTextareaPaste = !!textarea && pasteTarget === textarea;

        if (textarea && !isTextareaPaste) {
            textarea.focus();
        }

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
                            rootRef.current,
                        );
                        const mdImg = buildImageMarkdown(file.name || '', result.path);
                        const ta = sourceTextareaRef.current;
                        const currentMd = rawMarkdownRef.current;
                        const start = ta ? ta.selectionStart : currentMd.length;
                        const end = ta ? ta.selectionEnd : currentMd.length;
                        const newContent = insertTextAtSelection(currentMd, start, end, mdImg);
                        setRawMarkdown(newContent);
                        setSourceDirty(true);
                        queueSave(newContent);
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

        if (textarea && !isTextareaPaste) {
            const pastedText = e.clipboardData.getData('text/plain');
            if (!pastedText) return;
            e.preventDefault();
            const currentMd = rawMarkdownRef.current;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newContent = insertTextAtSelection(currentMd, start, end, pastedText);
            setRawMarkdown(newContent);
            setSourceDirty(true);
            queueSave(newContent);
            const restoreSelection = () => {
                textarea.focus();
                const nextPos = start + pastedText.length;
                textarea.setSelectionRange(nextPos, nextPos);
            };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restoreSelection);
            else setTimeout(restoreSelection, 0);
        }
    }, [queueSave, setRawMarkdown]);

    // ── Mode toggle logic ──────────────────────────────────────────────────

    const switchToSource = useCallback(async () => {
        // Flush pending WYSIWYG save before switching
        await flushSave();
        const path = notePathRef.current;
        if (!path) return;
        try {
            const { content, mtime } = await ioRef.current.loadContent(workspaceIdRef.current, path, rootRef.current);
            mtimeRef.current = mtime;
            setRawMarkdown(content);
            setSourceDirty(false);
            setViewMode('source');
        } catch (err) {
            console.error('Failed to load markdown for source mode:', err);
        }
    }, [flushSave, setViewMode]);

    const switchToRich = useCallback(async () => {
        await flushSave();
        // Convert raw markdown to HTML and load into Tiptap
        const ed = editorRef.current;
        if (ed && !ed.isDestroyed) {
            const { html, frontMatter } = markdownToRichEditorHtml({
                markdown: rawMarkdown,
                io: ioRef.current,
                workspaceId: workspaceIdRef.current,
                root: rootRef.current,
            });
            setFrontMatterResult(frontMatter);
            ed.commands.setContent(html, { emitUpdate: false });
            ed.commands.setTextSelection?.(1);
            resetEditorHistory(ed);

            // Cancel any save triggered by setContent
            discardPending();

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
    }, [rawMarkdown, commentsEnabled, setViewMode, flushSave, discardPending, setDirty]);

    // ── Conflict resolution handlers ────────────────────────────────────────

    const handleConflictKeepMine = useCallback(async () => {
        mtimeRef.current = null;
        setConflictContent(null);
        documentSession.setSaveState('idle');
        // Re-trigger save without mtime check (force overwrite)
        await flushSave({ expectedMtime: null });
    }, [flushSave, mtimeRef, setConflictContent, documentSession]);

    const handleConflictLoadDisk = useCallback(() => {
        if (!conflictContent) return;
        const ed = editorRef.current;
        if (ed && !ed.isDestroyed) {
            const { html, frontMatter } = markdownToRichEditorHtml({
                markdown: conflictContent,
                io: ioRef.current,
                workspaceId: workspaceIdRef.current,
                root: rootRef.current,
            });
            setFrontMatterResult(frontMatter);
            ed.commands.setContent(html, { emitUpdate: false });
            resetEditorHistory(ed);
        }
        setRawMarkdown(conflictContent);
        discardPending();
        setDirty(false);
        setSourceDirty(false);
        setConflictContent(null);
        documentSession.setSaveState('idle');
        // Refresh mtime from disk
        ioRef.current.loadContent(workspaceIdRef.current, notePathRef.current!, rootRef.current)
            .then(r => { mtimeRef.current = r.mtime; })
            .catch(() => {});
    }, [conflictContent, discardPending, documentSession, mtimeRef, setConflictContent, setDirty, setRawMarkdown]);

    // ── Apply comment marks from threads prop ─────────────────────────────────

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

    // ── Flush on unmount ────────────────────────────────────────────────────

    useEffect(() => {
        return () => {
            flushSave();
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

    // ── TOC: jump to heading ────────────────────────────────────────────────

    const handleTocJump = useCallback((entry: TocEntry) => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.chain().setTextSelection(entry.pos).scrollIntoView().run();
        setTocOpen(false);
    }, []);

    // ── TOC: scroll-spy ─────────────────────────────────────────────────────

    useEffect(() => {
        if (!tocOpen || !editor) return;
        const scrollContainer = editorScrollContainerRef.current;
        if (!scrollContainer) return;

        const updateActive = () => {
            const headingEls = scrollContainer.querySelectorAll<HTMLElement>(
                '.ProseMirror h1, .ProseMirror h2, .ProseMirror h3',
            );
            const containerTop = scrollContainer.getBoundingClientRect().top;
            let activeIdx: number | null = null;
            headingEls.forEach((el, i) => {
                const top = el.getBoundingClientRect().top - containerTop;
                if (top <= 8) activeIdx = i;
            });
            setTocActiveIndex(activeIdx);
        };

        scrollContainer.addEventListener('scroll', updateActive, { passive: true });
        updateActive();
        return () => scrollContainer.removeEventListener('scroll', updateActive);
    }, [tocOpen, editor, tocEntries]);

    // ── Note cross-link click handler ──────────────────────────────────────

    const onNavigateToNoteRef = useRef(onNavigateToNote);
    onNavigateToNoteRef.current = onNavigateToNote;

    useEffect(() => {
        const container = editorScrollContainerRef.current;
        if (!container) return;
        const handler = (e: MouseEvent) => {
            const target = (e.target as HTMLElement).closest?.('.note-link');
            if (!target) return;
            e.preventDefault();
            const path = target.getAttribute('data-note-path');
            if (!path) return;
            const heading = target.getAttribute('data-note-heading') || undefined;
            onNavigateToNoteRef.current?.(path, heading);
        };
        container.addEventListener('click', handler);
        return () => container.removeEventListener('click', handler);
    }, []);

    // ── File-path reference hover & click handlers ─────────────────────────

    const [filePreviewTooltip, setFilePreviewTooltip] = useState<{
        filePath: string;
        anchorEl: HTMLElement;
    } | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const container = editorScrollContainerRef.current;
        if (!container) return;

        const handleMouseEnter = (e: MouseEvent) => {
            const target = (e.target as HTMLElement).closest?.('.file-ref-link') as HTMLElement | null;
            if (!target) return;
            const fp = target.getAttribute('data-file-path');
            if (!fp) return;
            // Debounce: wait 300ms before showing tooltip
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = setTimeout(() => {
                setFilePreviewTooltip({ filePath: fp, anchorEl: target });
            }, 300);
        };

        const handleMouseLeave = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const related = e.relatedTarget as HTMLElement | null;
            // Don't dismiss if moving to the tooltip itself
            if (related?.closest?.('.file-preview-tooltip-card')) return;
            if (target.closest?.('.file-ref-link')) {
                if (hoverTimerRef.current) {
                    clearTimeout(hoverTimerRef.current);
                    hoverTimerRef.current = null;
                }
                setFilePreviewTooltip(null);
            }
        };

        const handleClick = (e: MouseEvent) => {
            const target = (e.target as HTMLElement).closest?.('.file-ref-link');
            if (!target) return;
            e.preventDefault();
            const fp = target.getAttribute('data-file-path');
            if (!fp) return;
            // Navigate to the file — if it ends with .md and looks like a note, use note navigation
            if (fp.endsWith('.md') && onNavigateToNoteRef.current) {
                onNavigateToNoteRef.current(fp);
            }
            setFilePreviewTooltip(null);
        };

        container.addEventListener('mouseover', handleMouseEnter);
        container.addEventListener('mouseout', handleMouseLeave);
        container.addEventListener('click', handleClick);
        return () => {
            container.removeEventListener('mouseover', handleMouseEnter);
            container.removeEventListener('mouseout', handleMouseLeave);
            container.removeEventListener('click', handleClick);
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        };
    }, []);

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
            ioRef.current.loadContent(workspaceIdRef.current, notePath, rootRef.current).then(({ content, mtime }) => {
                mtimeRef.current = mtime;
                // Skip redundant reload — content already matches what's displayed
                if (content === rawMarkdownRef.current) return;

                const ed = editorRef.current;
                if (!ed || ed.isDestroyed) {
                    setRawMarkdown(content);
                    setFrontMatterResult(parseNoteFrontMatter(content));
                    return;
                }

                // Capture previous doc text before updating content
                const previousDocText = ed.state.doc.textContent;

                const { html, frontMatter } = markdownToRichEditorHtml({
                    markdown: content,
                    io: ioRef.current,
                    workspaceId: workspaceIdRef.current,
                    root: rootRef.current,
                });
                setFrontMatterResult(frontMatter);
                ed.commands.setContent(html, { emitUpdate: false });
                resetEditorHistory(ed);
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

    // ── Manual refresh ──────────────────────────────────────────────────────

    const handleRefresh = useCallback(() => {
        documentSession.refresh();
    }, [documentSession]);

    useMarkdownDocumentKeyboardShortcuts({
        onSave: flushSave,
        onRefresh: handleRefresh,
        onKeyDown: (e) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'M' || e.key === 'm')) {
                if (viewModeRef.current === 'source') return;
                e.preventDefault();
                onCommentCreateRef.current?.();
            }
        },
    });

    const isEmpty = notePath === null;

    // ── Best-effort scroll to a referenced source line (AC-04) ──────────────
    //
    // Runs once content has loaded (loading flips false) for the current note.
    // The rich editor has no exact line→position map, so we scroll the editor
    // container proportionally; when nothing is scrollable (e.g. jsdom, or a
    // short note) it simply stays at the top. No range is highlighted.
    useEffect(() => {
        if (!scrollToLine || scrollToLine <= 1) return;
        if (isEmpty || loading || loadError) return;
        let raf = 0;
        const run = () => {
            const container = editorScrollContainerRef.current;
            if (!container) return;
            const totalLines = Math.max(1, rawMarkdownRef.current.split('\n').length);
            const top = computeBestEffortScrollTop({
                line: scrollToLine,
                totalLines,
                scrollHeight: container.scrollHeight,
                clientHeight: container.clientHeight,
            });
            if (top > 0) container.scrollTop = top;
        };
        if (typeof requestAnimationFrame === 'function') {
            raf = requestAnimationFrame(run);
        } else {
            run();
        }
        return () => {
            if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [notePath, scrollToLine, loading, loadError]);

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
                    toolbarRight={
                        <>
                            {canRunSkill && (
                                <button
                                    type="button"
                                    className="h-7 px-2 rounded flex items-center gap-1 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                                    title="Run Skill"
                                    aria-label="Run Skill"
                                    data-testid="note-run-skills-btn"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => queueDispatch({
                                        type: 'OPEN_DIALOG',
                                        workspaceId,
                                        contextFiles: [contextFilePath],
                                        contextTaskName,
                                    })}
                                >
                                    <span>⚡</span> Run Skill
                                </button>
                            )}
                            {isGoal && canRunSkill && ralphEnabled && (
                                <button
                                    type="button"
                                    className="h-7 px-2 rounded flex items-center gap-1 text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
                                    title="Run Ralph"
                                    aria-label="Run Ralph"
                                    data-testid="note-run-ralph-btn"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setRalphDialogOpen(true)}
                                >
                                    <span>🔄</span> Run Ralph
                                </button>
                            )}
                            {isDefaultRoot && (
                            <button
                                type="button"
                                className={
                                    'text-xs px-2 py-0.5 rounded ' +
                                    (versionHistoryOpen
                                        ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                        : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                                }
                                title={versionHistoryOpen ? 'Hide version history' : 'Show version history'}
                                aria-label={versionHistoryOpen ? 'Hide version history' : 'Show version history'}
                                data-testid="version-history-toggle-btn"
                                onClick={() => setVersionHistoryOpen(v => !v)}
                            >
                                🕐
                            </button>
                            )}
                            {toolbarRight}
                        </>
                    }
                    onRefresh={handleRefresh}
                    refreshing={loading}
                    chatPanelOpen={chatPanelOpen}
                    onToggleChatPanel={onToggleChatPanel}
                    chatDisabledReason={chatDisabledReason}
                    hasExistingChat={hasExistingChat}
                    tocOpen={tocOpen}
                    onToggleToc={() => setTocOpen(v => !v)}
                    tocEntries={viewMode === 'source' ? [] : tocEntries}
                    tocActiveIndex={tocActiveIndex}
                    onTocJump={handleTocJump}
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
                                <button className="save-btn" onClick={() => flushSave()} disabled={saveState === 'saving'} data-testid="note-source-save-btn">
                                    {saveState === 'saving' ? 'Saving…' : 'Save'}
                                </button>
                            )}
                        </div>
                    }
                />
            )}

            {/* Conflict banner — between toolbar and editor content */}
            {saveState === 'conflict' && conflictContent !== null && !editorHidden && (
                <NoteConflictBanner
                    onKeepMine={handleConflictKeepMine}
                    onLoadDisk={handleConflictLoadDisk}
                />
            )}

            {/* Source editor + Rich editor wrapped in a row to accommodate the version history panel */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
                <div className="flex flex-col flex-1 min-h-0 min-w-0 relative">
                    {/* Source editor — mounted only when in source mode */}
                    {viewMode === 'source' && !editorHidden && (
                        <div
                            className="flex-1 overflow-y-auto"
                            onPaste={handleSourcePaste}
                            data-testid="note-source-container"
                            onContextMenu={(e) => {
                                if (!onAddNoteReference) return;
                                const ta = sourceTextareaRef.current;
                                const selectedText = ta
                                    ? ta.value.slice(ta.selectionStart, ta.selectionEnd)
                                    : (window.getSelection()?.toString() ?? '');
                                if (!selectedText.trim()) return;
                                e.preventDefault();
                                setContextMenu({ x: e.clientX, y: e.clientY, selectedText });
                            }}
                        >
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
                        ref={editorScrollContainerRef}
                        className="flex-1 overflow-y-auto relative"
                        style={viewMode === 'source' && !editorHidden ? { display: 'none' } : undefined}
                        onContextMenu={(e) => {
                            if (!editorHidden && viewMode !== 'source') {
                                const hasSelection = editor && !editor.state.selection.empty;
                                if (hasSelection) {
                                    e.preventDefault();
                                    const selectedText = window.getSelection()?.toString() ?? '';
                                    setContextMenu({ x: e.clientX, y: e.clientY, selectedText });
                                }
                            }
                        }}
                    >
                        {!editorHidden && viewMode === 'rich' && frontMatterResult.kind === 'valid' && (
                            <NoteMetadataPanel frontMatter={frontMatterResult.frontMatter} />
                        )}

                        {!editorHidden && viewMode === 'rich' && frontMatterResult.kind === 'invalid' && (
                            <div
                                className="mx-4 mt-4 mb-1 rounded-md border border-[#d8a100] bg-[#fff8d6] px-3 py-2 text-xs text-[#6f5200] dark:border-[#8a6a00] dark:bg-[#332b00] dark:text-[#f0d66b]"
                                role="status"
                                title={frontMatterResult.message}
                                data-testid="note-metadata-warning"
                            >
                                Metadata could not be parsed. Open MD mode to fix YAML.
                            </div>
                        )}

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

                    {/* AI edit navigator pill — anchored to the content column rather than
                        the editor root, so it clears the toolbar however many rows it wraps to. */}
                    {aiEditCount > 0 && viewMode === 'rich' && (
                        <AIEditNavigator
                            editCount={aiEditCount}
                            onNext={handleAiEditNext}
                            onDismiss={handleAiEditDismiss}
                            narrow={chatLensOpen}
                            placement={chatLensOpen ? 'top-right' : 'bottom-right'}
                        />
                    )}
                </div>

                {/* Version history side panel */}
                {versionHistoryOpen && notePath && (
                    <NoteVersionHistoryPanel
                        workspaceId={workspaceId}
                        notePath={notePath}
                        currentContent={rawMarkdown}
                        gitInitialized={gitInitialized}
                        onReload={() => documentSession.refresh()}
                        onClose={() => setVersionHistoryOpen(false)}
                    />
                )}
            </div>

            {/* Right-click context menu */}
            {contextMenu && (() => {
                const noteTitle = notePath?.split('/').pop()?.replace(/\.md$/, '') ?? '';
                const hasSelectedText = !!contextMenu.selectedText?.trim();
                const items: ContextMenuItem[] = [];

                // Add comment — only in rich mode with a live selection
                if (viewMode === 'rich' && commentsEnabled) {
                    items.push({
                        label: 'Add comment',
                        icon: '💬',
                        disabled: editor?.state.selection.empty ?? true,
                        onClick: () => {
                            onCommentCreate?.();
                            setContextMenu(null);
                        },
                    });
                }

                // Add to chat as reference — only when handler provided and text is selected
                if (onAddNoteReference && hasSelectedText) {
                    if (items.length > 0) {
                        items.push({ label: '', separator: true, onClick: () => {} });
                    }
                    items.push({
                        label: 'Add to chat as reference',
                        icon: '📎',
                        onClick: () => {
                            onAddNoteReference(contextMenu.selectedText, notePath ?? '', noteTitle);
                            setContextMenu(null);
                        },
                    });
                }

                if (items.length === 0) return null;
                return (
                    <ContextMenu
                        position={{ x: contextMenu.x, y: contextMenu.y }}
                        items={items}
                        onClose={() => setContextMenu(null)}
                    />
                );
            })()}

            {/* File path reference hover tooltip */}
            {filePreviewTooltip && (
                <FilePreviewTooltip
                    filePath={filePreviewTooltip.filePath}
                    workspaceId={workspaceId}
                    anchorEl={filePreviewTooltip.anchorEl}
                    onOpen={(fp, type) => {
                        if (type === 'note' && onNavigateToNote) {
                            onNavigateToNote(fp);
                        }
                        setFilePreviewTooltip(null);
                    }}
                    onMouseLeave={() => setFilePreviewTooltip(null)}
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
                {saveState === 'conflict' && (
                    <span className="text-amber-600 dark:text-amber-400">
                        ⚠ Conflict detected
                    </span>
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

            {/* Ralph launch dialog */}
            {ralphDialogOpen && isGoal && (
                <RalphLaunchDialog
                    open={ralphDialogOpen}
                    workspaceId={workspaceId}
                    sourceLabel={normalizedNotePath.split('/').pop() ?? ''}
                    goalSpec={getCurrentGoalSpec()}
                    folderPath={notesRoot}
                    onClose={() => setRalphDialogOpen(false)}
                    onLaunched={(processId, executionWorkspaceId) => {
                        setRalphDialogOpen(false);
                        location.hash = '#repos/' + encodeURIComponent(executionWorkspaceId ?? workspaceId) + '/chats/' + encodeURIComponent(processId);
                    }}
                />
            )}
        </div>
    );
}
