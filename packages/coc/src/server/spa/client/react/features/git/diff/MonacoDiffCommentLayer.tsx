/**
 * MonacoDiffCommentLayer — diff comments inside the Monaco diff editor (AC-05).
 *
 * Renders no editor itself. Given the attached `DiffEditorAdapter` it:
 *   - decorates commented ranges (open / resolved / recovered);
 *   - hosts one view zone per placed thread and portals the caller's thread
 *     component into it, so the app's React context survives inside Monaco;
 *   - feeds each thread's measured height back to its zone (ResizeObserver);
 *   - shows an add-comment glyph beside a selection and adds Add comment /
 *     Ask AI / Copy as context to the editor context menu;
 *   - lists orphaned comments (anchor text gone) above the editor.
 *
 * Coordinates go through `diffCoords` only; zone bookkeeping lives in
 * `monacoCommentThreads`.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { DiffComment, DiffCommentSelection } from '../../../../comments/diff-comment-types';
import {
    createLineSource,
    monacoToSelection,
    textInRange,
    type DiffLineChange,
    type MonacoToSelectionContext,
} from './diffCoords';
import type { DiffEditorAdapter, DiffEditorSelection } from './monacoDiffController';
import {
    writeMonacoDiffSelectionDragStart,
    type DiffSelectionDragSource,
} from './diffSelectionContext';
import {
    buildCommentDecorations,
    createCommentZoneManager,
    isThreadInitiallyExpanded,
    placeDiffComments,
    type CommentThreadPlacement,
    type CommentZoneManager,
    type PlacedCommentThread,
} from './monacoCommentThreads';

/** The diff the editor currently shows, as last computed by Monaco. */
export interface MonacoDiffCommentState {
    original: string;
    modified: string;
    lineChanges: readonly DiffLineChange[];
    /** Maps file lines to classic patch rows so new comments place in both engines. */
    diffLineIndexOf?: MonacoToSelectionContext['diffLineIndexOf'];
}

export interface MonacoDiffCommentHandlers {
    onAddComment?: (selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => void;
    onAskAI?: (selection: DiffCommentSelection, selectedText: string) => void;
    onCopyAsContext?: (selection: DiffCommentSelection, selectedText: string) => void;
}

export interface MonacoDiffCommentLayerProps extends MonacoDiffCommentHandlers {
    editor: DiffEditorAdapter | null;
    /** Bumped each time a new model pair reaches the editor (zones were dropped). */
    modelsVersion: number;
    diff: MonacoDiffCommentState | null;
    viewMode: 'unified' | 'split';
    comments: readonly DiffComment[];
    /** Renders one comment thread (the app's existing comment component). */
    renderThread: (comment: DiffComment) => ReactNode;
    /** Enables dragging the current editor selection into chat context. */
    diffSelectionDragSource?: DiffSelectionDragSource;
}

export interface MonacoDiffCommentLayerHandle {
    /** Scrolls to a comment and expands its thread; false when unknown. */
    revealComment(id: string): boolean;
}

// Monaco handles mouse-down on its own DOM (moving the cursor, collapsing the
// selection, stealing focus). Thread and glyph content is ours: stop those
// events at the node so textareas and buttons behave normally.
const EDITOR_CAPTURED_EVENTS = ['mousedown', 'pointerdown', 'contextmenu'] as const;

function createIsolatedNode(className: string): HTMLElement {
    const node = document.createElement('div');
    node.className = className;
    for (const type of EDITOR_CAPTURED_EVENTS) node.addEventListener(type, e => e.stopPropagation());
    return node;
}

const EMPTY_POSITION = { top: 0, left: 0 };

export const MonacoDiffCommentLayer = forwardRef<MonacoDiffCommentLayerHandle, MonacoDiffCommentLayerProps>(
    function MonacoDiffCommentLayer({
        editor, modelsVersion, diff, viewMode, comments, renderThread,
        onAddComment, onAskAI, onCopyAsContext, diffSelectionDragSource,
    }, ref) {
        const placements = useMemo<CommentThreadPlacement[]>(
            () => (diff ? placeDiffComments({ comments, ...diff, viewMode }) : []),
            [comments, diff, viewMode],
        );
        const placed = useMemo(
            () => placements.filter((p): p is PlacedCommentThread => p.status !== 'orphaned'),
            [placements],
        );
        const orphaned = useMemo(() => placements.filter(p => p.status === 'orphaned'), [placements]);

        // ── Zones ────────────────────────────────────────────────────────
        const managerRef = useRef<CommentZoneManager | null>(null);
        const [zoneNodes, setZoneNodes] = useState<ReadonlyMap<string, HTMLElement>>(() => new Map());
        useEffect(() => {
            if (!editor) return;
            const manager = createCommentZoneManager(editor, () => createIsolatedNode('coc-diff-comment-zone'));
            managerRef.current = manager;
            return () => {
                manager.dispose();
                managerRef.current = null;
                setZoneNodes(new Map());
            };
        }, [editor]);

        const syncedVersion = useRef(modelsVersion);
        useEffect(() => {
            const manager = managerRef.current;
            if (!manager) return;
            if (syncedVersion.current !== modelsVersion) {
                manager.invalidate();
                syncedVersion.current = modelsVersion;
            }
            setZoneNodes(manager.sync(placed.map(p => ({ id: p.comment.id, anchor: p.zone }))));
        }, [editor, placed, modelsVersion]);

        useEffect(() => {
            editor?.setCommentDecorations(buildCommentDecorations(placed));
        }, [editor, placed, modelsVersion]);

        const handleHeight = useCallback((id: string, height: number) => {
            managerRef.current?.setHeight(id, height);
        }, []);

        // ── Expansion / reveal ───────────────────────────────────────────
        const [expandedOverrides, setExpandedOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map());
        const [focusRequest, setFocusRequest] = useState<{ id: string; token: number } | null>(null);
        const [orphansOpen, setOrphansOpen] = useState(false);
        const setExpanded = useCallback((id: string, expanded: boolean) => {
            setExpandedOverrides(prev => new Map(prev).set(id, expanded));
        }, []);
        const isExpanded = (comment: DiffComment) =>
            expandedOverrides.get(comment.id) ?? isThreadInitiallyExpanded(comment);

        const latest = useRef({ placements, editor, diff, onAddComment, onAskAI, onCopyAsContext });
        latest.current = { placements, editor, diff, onAddComment, onAskAI, onCopyAsContext };

        useImperativeHandle(ref, () => ({
            revealComment(id) {
                const placement = latest.current.placements.find(p => p.comment.id === id);
                if (!placement) return false;
                if (placement.status === 'orphaned') {
                    setOrphansOpen(true);
                    return true;
                }
                latest.current.editor?.revealLine(placement.zone.side, Math.max(1, placement.zone.afterLineNumber));
                setExpanded(id, true);
                setFocusRequest(prev => ({ id, token: (prev?.token ?? 0) + 1 }));
                return true;
            },
        }), [setExpanded]);

        // ── Selection → new comment / ask AI / copy as context ───────────
        const [selection, setSelection] = useState<DiffEditorSelection | null>(null);
        useEffect(() => {
            if (!editor) return;
            const subscription = editor.onDidChangeSelection(setSelection);
            return () => {
                subscription.dispose();
                setSelection(null);
            };
        }, [editor]);
        useEffect(() => { setSelection(null); }, [modelsVersion]);

        const buildRequest = useCallback((sel: DiffEditorSelection) => {
            const { diff: current, editor: ed } = latest.current;
            if (!current) return null;
            const source = createLineSource(sel.side === 'original' ? current.original : current.modified);
            return {
                selection: monacoToSelection(sel.side, sel.range, {
                    lineChanges: current.lineChanges,
                    diffLineIndexOf: current.diffLineIndexOf,
                }),
                selectedText: textInRange(source, sel.range),
                position: ed?.getClientPosition(sel.side, sel.range.endLineNumber, sel.range.endColumn) ?? EMPTY_POSITION,
            };
        }, []);

        const addComment = useCallback((sel: DiffEditorSelection) => {
            const request = buildRequest(sel);
            if (request) latest.current.onAddComment?.(request.selection, request.selectedText, request.position);
        }, [buildRequest]);

        useEffect(() => {
            if (!editor) return;
            const actions = editor.addSelectionActions([
                { id: 'coc.diff.comment.add', label: 'Add Comment', run: addComment },
                {
                    id: 'coc.diff.comment.askAI', label: 'Ask AI About Selection', run: (sel) => {
                        const request = buildRequest(sel);
                        if (request) latest.current.onAskAI?.(request.selection, request.selectedText);
                    },
                },
                {
                    id: 'coc.diff.comment.copyContext', label: 'Copy Selection as Context', run: (sel) => {
                        const request = buildRequest(sel);
                        if (request) latest.current.onCopyAsContext?.(request.selection, request.selectedText);
                    },
                },
            ]);
            return () => actions.dispose();
        }, [editor, addComment, buildRequest]);

        const glyphNode = useMemo(() => createIsolatedNode('coc-diff-comment-glyph'), []);
        useEffect(() => {
            if (!editor || !selection || (!onAddComment && !diffSelectionDragSource)) return;
            editor.setGlyphWidget({ side: selection.side, line: selection.range.endLineNumber, domNode: glyphNode });
            return () => editor.setGlyphWidget(null);
        }, [editor, selection, onAddComment, diffSelectionDragSource, glyphNode]);

        return (
            <>
                {orphaned.length > 0 && (
                    <div className="border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fff8e1] dark:bg-[#3a3000] text-xs" data-testid="monaco-comment-orphans">
                        <button
                            type="button"
                            className="w-full text-left px-3 py-1 text-[#6b5900] dark:text-[#e2c08d]"
                            onClick={() => setOrphansOpen(o => !o)}
                            aria-expanded={orphansOpen}
                            data-testid="monaco-comment-orphans-toggle"
                        >
                            {orphansOpen ? '▾' : '▸'} {orphaned.length} comment{orphaned.length > 1 ? 's' : ''} no longer match this version of the file
                        </button>
                        {orphansOpen && (
                            <div className="flex flex-col gap-1 px-3 pb-2">
                                {orphaned.map(p => (
                                    <div key={p.comment.id} data-testid="monaco-comment-orphan" data-comment-id={p.comment.id}>
                                        {renderThread(p.comment)}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
                {placed.map(p => {
                    const node = zoneNodes.get(p.comment.id);
                    if (!node) return null;
                    return createPortal(
                        <CommentThreadZone
                            placement={p}
                            expanded={isExpanded(p.comment)}
                            onExpandedChange={setExpanded}
                            onHeight={handleHeight}
                            focusToken={focusRequest?.id === p.comment.id ? focusRequest.token : 0}
                        >
                            {renderThread(p.comment)}
                        </CommentThreadZone>,
                        node,
                        p.comment.id,
                    );
                })}
                {selection && (onAddComment || diffSelectionDragSource) && createPortal(
                    <div className="flex items-center">
                        {onAddComment && (
                            <button
                                type="button"
                                className="coc-diff-comment-glyph-button"
                                title="Add comment"
                                aria-label="Add comment"
                                onClick={() => addComment(selection)}
                                data-testid="monaco-diff-add-comment"
                            >
                                +
                            </button>
                        )}
                        {diffSelectionDragSource && (
                            <button
                                type="button"
                                draggable
                                className="coc-diff-comment-glyph-button cursor-grab"
                                title="Drag selection to chat"
                                aria-label="Drag selection to chat"
                                onDragStart={(event) => {
                                    const request = buildRequest(selection);
                                    if (request) writeMonacoDiffSelectionDragStart(event, {
                                        selection: request.selection,
                                        selectedText: request.selectedText,
                                        source: diffSelectionDragSource,
                                    });
                                }}
                                data-testid="monaco-diff-drag-selection"
                            >
                                ⋮
                            </button>
                        )}
                    </div>,
                    glyphNode,
                )}
            </>
        );
    },
);

interface CommentThreadZoneProps {
    placement: PlacedCommentThread;
    expanded: boolean;
    onExpandedChange: (id: string, expanded: boolean) => void;
    onHeight: (id: string, height: number) => void;
    /** Changes when the sidebar reveals this thread: take focus. */
    focusToken: number;
    children: ReactNode;
}

function CommentThreadZone({ placement, expanded, onExpandedChange, onHeight, focusToken, children }: CommentThreadZoneProps) {
    const { comment, status } = placement;
    const rootRef = useRef<HTMLDivElement>(null);

    // The zone cannot size itself: report the thread's height on every change.
    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) return;
        const report = () => onHeight(comment.id, Math.ceil(root.getBoundingClientRect().height));
        report();
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(report);
        observer.observe(root);
        return () => observer.disconnect();
    }, [comment.id, onHeight]);

    useEffect(() => {
        if (focusToken) rootRef.current?.focus();
    }, [focusToken]);

    const resolved = comment.status === 'resolved';
    return (
        <div
            ref={rootRef}
            tabIndex={-1}
            className={`coc-diff-comment-thread px-2 py-1 ${resolved ? 'opacity-80' : ''}`}
            onKeyDown={(e) => {
                if (e.key === 'Escape' && expanded) {
                    e.stopPropagation();
                    onExpandedChange(comment.id, false);
                }
            }}
            data-testid="monaco-comment-thread"
            data-comment-id={comment.id}
            data-status={status}
            data-side={placement.range.side}
            data-expanded={expanded}
        >
            <button
                type="button"
                className="text-[11px] text-[#616161] dark:text-[#999] hover:underline"
                onClick={() => onExpandedChange(comment.id, !expanded)}
                aria-expanded={expanded}
                data-testid="monaco-comment-thread-toggle"
            >
                {expanded ? '▾' : '▸'} {resolved ? 'Resolved comment' : 'Comment'}
                {status === 'recovered' && <span className="ml-1 italic" data-testid="monaco-comment-thread-recovered">(relocated)</span>}
            </button>
            {expanded && <div className="max-w-[720px]">{children}</div>}
        </div>
    );
}
