/**
 * DockNotesPanel — the Notes view inside the workspace right dock.
 *
 * A narrow (~380px) companion to the full Notes tab: a search + "new note" row,
 * a compact recency-ordered list of the workspace's notes across the top third,
 * and a scrolling read-only preview below. The bottom action row hands the
 * selected note off to the two places it is actually useful — the chat composer
 * ("Insert into chat", via the `composerInsert` bridge) and the full Notes tab
 * ("Open in Notes tab", via the note deep-link hash).
 *
 * The preview is deliberately read-only: the full Notes tab can be mounted at
 * the same time, and reconciling two editable surfaces over one note means
 * sharing dirty state between them (cf. `explorerDirtyStore`). Editing happens
 * in the Notes tab.
 *
 * The dock keeps every view mounted (`display:none` on the inactive one), so the
 * selected note, the query, and the preview scroll position survive a view
 * switch for free.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../ui';
import { useMarkdownPreview } from '../../../hooks/ui/useMarkdownPreview';
import { buildNoteHash } from '../../../layout/Router';
import { dispatchComposerInsert } from '../../chat/composerInsert';
import { notesApi } from '../notesApi';
import {
    filterDockNotes,
    flattenNoteFiles,
    formatNoteChatReference,
    nextUntitledNotePath,
    type DockNoteEntry,
} from './dockNotes';

export interface DockNotesPanelProps {
    workspaceId: string;
}

function SearchIcon() {
    return (
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" />
            <line x1="10.2" y1="10.2" x2="13.5" y2="13.5" />
        </svg>
    );
}

export function DockNotesPanel({ workspaceId }: DockNotesPanelProps) {
    const [notes, setNotes] = useState<DockNoteEntry[]>([]);
    const [listError, setListError] = useState<string | null>(null);
    const [listLoading, setListLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [content, setContent] = useState('');
    const [contentLoading, setContentLoading] = useState(false);
    const [contentError, setContentError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const previewRef = useRef<HTMLDivElement | null>(null);

    const loadNotes = useCallback(async () => {
        setListLoading(true);
        try {
            const res = await notesApi.getTree(workspaceId);
            setNotes(flattenNoteFiles(res.tree));
            setListError(null);
        } catch (err) {
            setListError(err instanceof Error ? err.message : 'Failed to load notes');
        } finally {
            setListLoading(false);
        }
    }, [workspaceId]);

    useEffect(() => {
        void loadNotes();
    }, [loadNotes]);

    // The server broadcasts `notes-changed` for note writes (App.tsx bridges the
    // websocket message), so a note created/renamed in the Notes tab shows up
    // here without a manual refresh.
    useEffect(() => {
        const handler = (event: Event) => {
            const detail = (event as CustomEvent).detail as { wsId?: string } | undefined;
            if (detail?.wsId && detail.wsId !== workspaceId) return;
            void loadNotes();
        };
        window.addEventListener('notes-changed', handler as EventListener);
        return () => window.removeEventListener('notes-changed', handler as EventListener);
    }, [workspaceId, loadNotes]);

    const visibleNotes = useMemo(() => filterDockNotes(notes, query), [notes, query]);

    // Keep a selection whenever there is something to select: fall back to the
    // first visible note when nothing is selected yet, or when the selected note
    // disappeared (deleted elsewhere, or filtered out by the current query).
    useEffect(() => {
        if (visibleNotes.length === 0) return;
        if (selectedPath && visibleNotes.some(n => n.path === selectedPath)) return;
        setSelectedPath(visibleNotes[0].path);
    }, [visibleNotes, selectedPath]);

    const selectedNote = useMemo(
        () => notes.find(n => n.path === selectedPath) ?? null,
        [notes, selectedPath],
    );

    useEffect(() => {
        if (!selectedPath) {
            setContent('');
            setContentError(null);
            return;
        }
        let cancelled = false;
        setContentLoading(true);
        notesApi.getContent(workspaceId, selectedPath)
            .then(res => {
                if (cancelled) return;
                setContent(res.content ?? '');
                setContentError(null);
            })
            .catch(err => {
                if (cancelled) return;
                setContent('');
                setContentError(err instanceof Error ? err.message : 'Failed to load note');
            })
            .finally(() => {
                if (!cancelled) setContentLoading(false);
            });
        return () => { cancelled = true; };
    }, [workspaceId, selectedPath]);

    const { html } = useMarkdownPreview({
        content,
        containerRef: previewRef,
        loading: contentLoading,
        stripFrontmatter: true,
    });

    const handleCreate = useCallback(async () => {
        if (creating) return;
        setCreating(true);
        try {
            const path = nextUntitledNotePath(notes.map(n => n.path));
            await notesApi.createNode(workspaceId, path, 'page');
            setQuery('');
            setSelectedPath(path);
            await loadNotes();
            setListError(null);
        } catch (err) {
            setListError(err instanceof Error ? err.message : 'Failed to create note');
        } finally {
            setCreating(false);
        }
    }, [creating, notes, workspaceId, loadNotes]);

    const handleInsertIntoChat = useCallback(() => {
        if (!selectedNote) return;
        dispatchComposerInsert({ workspaceId, text: formatNoteChatReference(selectedNote) });
    }, [selectedNote, workspaceId]);

    const handleOpenInNotesTab = useCallback(() => {
        if (!selectedNote) return;
        location.hash = buildNoteHash(workspaceId, selectedNote.path);
    }, [selectedNote, workspaceId]);

    return (
        <div
            className="flex min-h-0 min-w-0 flex-1 flex-col bg-white text-[#1f1f1f] dark:bg-[#1e1e1e] dark:text-[#cccccc]"
            data-testid="workspace-dock-notes-panel"
        >
            {/* Search + new note */}
            <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-[#e5e5e5] px-2 py-1.5 dark:border-[#333]">
                <div className="relative flex min-w-0 flex-1 items-center">
                    <span className="pointer-events-none absolute left-2 text-[#8c8c8c]">
                        <SearchIcon />
                    </span>
                    <input
                        type="search"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Search notes"
                        aria-label="Search notes"
                        data-testid="workspace-dock-notes-search"
                        className="h-6 w-full min-w-0 rounded border border-[#d0d7de] bg-white pl-7 pr-2 text-xs text-[#1f1f1f] placeholder:text-[#8c8c8c] focus:border-[#0078d4] focus:outline-none dark:border-[#3c3c3c] dark:bg-[#1e1e1e] dark:text-[#ccc]"
                    />
                </div>
                <button
                    type="button"
                    onClick={handleCreate}
                    disabled={creating}
                    title="New note"
                    aria-label="New note"
                    data-testid="workspace-dock-notes-new"
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-[#d0d7de] text-sm leading-none text-[#424242] hover:bg-[#f3f3f3] disabled:opacity-50 dark:border-[#3c3c3c] dark:text-[#ccc] dark:hover:bg-[#2a2a2a]"
                >
                    +
                </button>
            </div>

            {/* Note list — roughly the top third of the dock. */}
            <div
                className="min-h-[96px] flex-shrink-0 overflow-y-auto border-b border-[#e5e5e5] dark:border-[#333]"
                style={{ maxHeight: '33%' }}
                role="listbox"
                aria-label="Notes"
                data-testid="workspace-dock-notes-list"
            >
                {listError ? (
                    <div className="px-2 py-3 text-xs text-[#c94f4f] dark:text-[#f48771]" data-testid="workspace-dock-notes-error">{listError}</div>
                ) : listLoading && notes.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-[#8c8c8c] dark:text-[#9a9a9a]">Loading notes…</div>
                ) : visibleNotes.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-[#8c8c8c] dark:text-[#9a9a9a]" data-testid="workspace-dock-notes-empty">
                        {query.trim() ? 'No notes match this search.' : 'No notes yet.'}
                    </div>
                ) : (
                    visibleNotes.map(note => {
                        const active = note.path === selectedPath;
                        return (
                            <button
                                key={note.path}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => setSelectedPath(note.path)}
                                data-testid="workspace-dock-notes-item"
                                data-note-path={note.path}
                                className={cn(
                                    'flex w-full flex-col items-start gap-0.5 px-2 py-1 text-left',
                                    active
                                        ? 'bg-[#e8f2fc] dark:bg-[#04395e]'
                                        : 'hover:bg-[#f3f3f3] dark:hover:bg-[#2a2a2a]',
                                )}
                            >
                                <span className="w-full truncate text-xs text-[#1f1f1f] dark:text-[#ccc]">{note.title}</span>
                                {note.folder && (
                                    <span className={cn(
                                        'w-full truncate text-[10px]',
                                        // Plain #8c8c8c is unreadable on the selected
                                        // row's dark-mode blue, so tint it with the row.
                                        active ? 'text-[#4a6580] dark:text-[#a7c8e6]' : 'text-[#8c8c8c] dark:text-[#9a9a9a]',
                                    )}>{note.folder}</span>
                                )}
                            </button>
                        );
                    })
                )}
            </div>

            {/* Read-only preview. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {contentError ? (
                    <div className="px-2 py-3 text-xs text-[#c94f4f] dark:text-[#f48771]" data-testid="workspace-dock-notes-preview-error">{contentError}</div>
                ) : !selectedNote ? (
                    <div className="px-2 py-3 text-xs text-[#8c8c8c] dark:text-[#9a9a9a]">Select a note to preview it.</div>
                ) : (
                    <div
                        ref={previewRef}
                        className="markdown-body min-h-0 flex-1 overflow-y-auto px-2 py-2 text-xs text-[#1e1e1e] dark:text-[#cccccc]"
                        data-testid="workspace-dock-notes-preview"
                        dangerouslySetInnerHTML={{ __html: html }}
                    />
                )}
            </div>

            {/* Bottom actions. */}
            <div className="flex flex-shrink-0 items-center gap-1.5 border-t border-[#e5e5e5] px-2 py-1.5 dark:border-[#333]">
                <button
                    type="button"
                    onClick={handleInsertIntoChat}
                    disabled={!selectedNote}
                    data-testid="workspace-dock-notes-insert-into-chat"
                    className="h-6 flex-1 rounded border border-[#d0d7de] px-2 text-[11px] text-[#424242] hover:bg-[#f3f3f3] disabled:opacity-50 dark:border-[#3c3c3c] dark:text-[#ccc] dark:hover:bg-[#2a2a2a]"
                >
                    Insert into chat
                </button>
                <button
                    type="button"
                    onClick={handleOpenInNotesTab}
                    disabled={!selectedNote}
                    data-testid="workspace-dock-notes-open-tab"
                    className="h-6 flex-1 rounded border border-[#d0d7de] px-2 text-[11px] text-[#424242] hover:bg-[#f3f3f3] disabled:opacity-50 dark:border-[#3c3c3c] dark:text-[#ccc] dark:hover:bg-[#2a2a2a]"
                >
                    Open in Notes tab
                </button>
            </div>
        </div>
    );
}
