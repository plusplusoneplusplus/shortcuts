/**
 * Pure helpers behind the right dock's Notes view (`DockNotesPanel`).
 *
 * The dock is a narrow (~380px) column, so it shows a flat, recency-ordered list
 * of markdown notes rather than the full tree the Notes tab renders. Everything
 * here is DOM-free so it can be unit tested without React.
 */

import type { NoteTreeNode } from '../notesApi';

/** One markdown note as the dock's flat list shows it. */
export interface DockNoteEntry {
    /** Notes-root-relative path, e.g. `Plans/mla-cache.md`. */
    path: string;
    /** File name including extension. */
    name: string;
    /** File name without the `.md` extension — what the list row shows. */
    title: string;
    /** Parent folder path, or `''` for a note at the notes root. */
    folder: string;
    /** ISO mtime when the server reported one. */
    lastModifiedAt?: string;
}

/** Directories the dock list never descends into (comment sidecars, paper cache, …). */
function isHiddenNode(node: NoteTreeNode): boolean {
    return node.name.startsWith('.');
}

/** `page` is a note file; `notebook`/`section` are folders. */
function isNoteFile(node: NoteTreeNode): boolean {
    return node.type === 'page' && /\.md$/i.test(node.name);
}

function parentFolder(notePath: string): string {
    const idx = notePath.lastIndexOf('/');
    return idx === -1 ? '' : notePath.slice(0, idx);
}

/** Millis for sorting; notes with a missing/unparsable mtime sort last. */
function mtimeValue(entry: DockNoteEntry): number {
    if (!entry.lastModifiedAt) return 0;
    const parsed = Date.parse(entry.lastModifiedAt);
    return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Flatten a notes tree into the dock's list: markdown files only, hidden
 * folders/files skipped, most-recently-modified first (name-ascending as a
 * stable tiebreak so the order never depends on server traversal order).
 */
export function flattenNoteFiles(tree: readonly NoteTreeNode[] | undefined | null): DockNoteEntry[] {
    const out: DockNoteEntry[] = [];

    const walk = (nodes: readonly NoteTreeNode[]) => {
        for (const node of nodes) {
            if (isHiddenNode(node)) continue;
            if (node.type !== 'page') {
                walk(node.children ?? []);
                continue;
            }
            if (!isNoteFile(node)) continue;
            out.push({
                path: node.path,
                name: node.name,
                title: node.name.replace(/\.md$/i, ''),
                folder: parentFolder(node.path),
                lastModifiedAt: node.lastModifiedAt,
            });
        }
    };
    walk(tree ?? []);

    return out.sort((a, b) => {
        const diff = mtimeValue(b) - mtimeValue(a);
        if (diff !== 0) return diff;
        // Codepoint order, not `localeCompare` — the tiebreak must be identical
        // on every platform/ICU build the SPA and its tests run on.
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
}

/**
 * Filter the dock list by a free-text query, matched case-insensitively against
 * the note title and its folder path. A blank query keeps every note.
 */
export function filterDockNotes(notes: readonly DockNoteEntry[], query: string): DockNoteEntry[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...notes];
    return notes.filter(note =>
        note.title.toLowerCase().includes(needle) || note.folder.toLowerCase().includes(needle),
    );
}

/**
 * Pick the next free `Untitled*.md` path at the notes root, so the "new note"
 * action never collides with an existing note (`Untitled.md`, `Untitled 2.md`, …).
 */
export function nextUntitledNotePath(existingPaths: readonly string[]): string {
    const taken = new Set(existingPaths.map(p => p.toLowerCase()));
    if (!taken.has('untitled.md')) return 'Untitled.md';
    for (let n = 2; n < 1000; n++) {
        const candidate = `Untitled ${n}.md`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `Untitled ${Date.now()}.md`;
}

/**
 * The text "Insert into chat" drops into the composer.
 *
 * Mirrors `formatPaperChatGrounding`: the client puts a readable notes-root
 * relative path in the prompt and the model resolves + reads it with its file
 * tools, rather than the client inlining note content into the message.
 */
export function formatNoteChatReference(note: Pick<DockNoteEntry, 'path' | 'title'>): string {
    const path = note.path.trim();
    if (!path) return '';
    return (
        `<note_reference path="${path}">\n` +
        `The note "${note.title}" is saved at \`${path}\` (relative to the notes root). ` +
        `Read that file with your file tools to ground your answer in the full note.\n` +
        `</note_reference>\n\n`
    );
}
