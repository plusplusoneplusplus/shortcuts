/**
 * useNotesClipboard — cut/copy/paste clipboard state for the notes sidebar tree
 * (AC-04).
 *
 * The clipboard holds a snapshot of the rows a Cut/Copy captured (pages and
 * folders alike) plus the mode. Cut+Paste moves the rows (via renameNode); the
 * clipboard is cleared once pasted. Copy+Paste duplicates them with
 * name-collision handling ("name copy", "name copy 2", …) and the clipboard
 * persists so the copy can be pasted again.
 *
 * The heavy lifting (which rows actually move/copy and to what name) lives in the
 * pure {@link planClipboardPaste} planner so it can be unit-tested directly and
 * reused by both the context-menu and keyboard-shortcut callers.
 */

import { useState, useCallback, useMemo } from 'react';
import { getNotesParentPath, type NoteDragItem, type NoteMove } from './useNotesDragDrop';

export type ClipboardMode = 'cut' | 'copy';

/** A single row captured on the clipboard (path/name/type — same shape as a drag item). */
export type NoteClipboardItem = NoteDragItem;

export interface NotesClipboard {
    mode: ClipboardMode;
    items: NoteClipboardItem[];
}

/** A single copy produced by {@link planClipboardPaste}. */
export interface NoteCopy {
    /** Source path being duplicated. */
    from: string;
    /** De-duped basename in the destination folder. */
    toName: string;
    /** Full destination path (`destParent/toName`, or `toName` at root). */
    toPath: string;
    type: NoteClipboardItem['type'];
}

export interface UseNotesClipboardResult {
    clipboard: NotesClipboard | null;
    /** Paths marked for a pending cut — rows dim until pasted/cleared. */
    cutPaths: Set<string>;
    setCut: (items: NoteClipboardItem[]) => void;
    setCopy: (items: NoteClipboardItem[]) => void;
    clearClipboard: () => void;
}

/**
 * Reduce a set of clipboard rows to their "selection roots": drop any row that
 * lives inside another captured row (moving/copying the ancestor already carries
 * the descendant). Mirrors the roots filter used by `planBulkMove`.
 */
function selectionRoots(items: NoteClipboardItem[]): NoteClipboardItem[] {
    return items.filter(
        it => !items.some(other => other.path !== it.path && it.path.startsWith(other.path + '/')),
    );
}

/**
 * De-dupe a name against the names already present in a destination folder.
 *
 * Returns the name unchanged when there is no collision; otherwise appends
 * `" copy"`, then `" copy 2"`, `" copy 3"`, … The extension of page files
 * (`.md`) is preserved so `notes.md` → `notes copy.md`.
 */
export function dedupeCopyName(name: string, existingNames: Set<string>): string {
    if (!existingNames.has(name)) return name;
    // Split off a file extension (but not a leading-dot "dotfile" name).
    const dotIdx = name.lastIndexOf('.');
    const hasExt = dotIdx > 0;
    const base = hasExt ? name.slice(0, dotIdx) : name;
    const ext = hasExt ? name.slice(dotIdx) : '';

    const first = `${base} copy${ext}`;
    if (!existingNames.has(first)) return first;

    let n = 2;
    while (existingNames.has(`${base} copy ${n}${ext}`)) n += 1;
    return `${base} copy ${n}${ext}`;
}

/**
 * Plan the concrete operations for pasting `clipboard` into `destParent`
 * (`''` = root), given the names already present there.
 *
 * - `cut`  → {@link NoteMove}[] (rename `from` → `to`). System folders, rows
 *   already living in `destParent`, and descendant-drops are skipped.
 * - `copy` → {@link NoteCopy}[] with de-duped destination names. Reserving each
 *   name as it is assigned keeps two copies of the same source from colliding.
 */
export function planClipboardPaste(
    clipboard: NotesClipboard,
    destParent: string,
    existingNames: Iterable<string>,
    isSystemFolder: (item: NoteClipboardItem) => boolean,
): { moves: NoteMove[]; copies: NoteCopy[] } {
    const roots = selectionRoots(clipboard.items);
    const existing = new Set(existingNames);

    if (clipboard.mode === 'cut') {
        const moves: NoteMove[] = [];
        for (const item of roots) {
            if (isSystemFolder(item)) continue;
            // Cannot move a folder into itself or its own subtree.
            if (destParent === item.path || destParent.startsWith(item.path + '/')) continue;
            // Already in the destination folder → nothing to do.
            if (getNotesParentPath(item.path) === destParent) continue;
            moves.push({ from: item.path, to: destParent ? `${destParent}/${item.name}` : item.name });
        }
        return { moves, copies: [] };
    }

    const copies: NoteCopy[] = [];
    for (const item of roots) {
        if (isSystemFolder(item)) continue;
        // Cannot copy a folder into itself or its own subtree.
        if (destParent === item.path || destParent.startsWith(item.path + '/')) continue;
        const toName = dedupeCopyName(item.name, existing);
        existing.add(toName); // reserve so sibling copies don't collide with each other
        const toPath = destParent ? `${destParent}/${toName}` : toName;
        copies.push({ from: item.path, toName, toPath, type: item.type });
    }
    return { moves: [], copies };
}

/**
 * Hook holding the notes clipboard. Cut/Copy replace the clipboard; the pending
 * cut paths are derived so tree rows can dim while a cut is staged.
 */
export function useNotesClipboard(): UseNotesClipboardResult {
    const [clipboard, setClipboard] = useState<NotesClipboard | null>(null);

    const setCut = useCallback((items: NoteClipboardItem[]) => {
        setClipboard(items.length > 0 ? { mode: 'cut', items } : null);
    }, []);

    const setCopy = useCallback((items: NoteClipboardItem[]) => {
        setClipboard(items.length > 0 ? { mode: 'copy', items } : null);
    }, []);

    const clearClipboard = useCallback(() => setClipboard(null), []);

    const cutPaths = useMemo(
        () => (clipboard?.mode === 'cut' ? new Set(clipboard.items.map(i => i.path)) : new Set<string>()),
        [clipboard],
    );

    return { clipboard, cutPaths, setCut, setCopy, clearClipboard };
}
