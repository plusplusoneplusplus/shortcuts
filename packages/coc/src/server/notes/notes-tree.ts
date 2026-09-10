/**
 * Shape the native Notes tree scan into the `TreeNode` tree the API and the
 * note-create executor both consume.
 *
 * The scan itself lives in Rust (`notes_fs::tree`), which returns entries in
 * raw readdir order plus each directory's `.order.json` list. Sibling order
 * stays here on purpose: it is `localeCompare`, i.e. ICU collation, and that is
 * what the SPA has always shown — reimplementing it in Rust would drift.
 */

import type { NativeNotesTreeEntry } from '@plusplusoneplusplus/coc-native';
import { applyOrder } from './notes-order';

/** A notebook, section, or page in the tree the API returns. */
export interface TreeNode {
    name: string;
    path: string;
    type: 'notebook' | 'section' | 'page';
    children?: TreeNode[];
    lastModifiedAt?: string;
}

/** Directories before files, then alphabetically within each group. */
function compareSiblings(a: NativeNotesTreeEntry, b: NativeNotesTreeEntry): number {
    const aDir = a.kind === 'page' ? 1 : 0;
    const bDir = b.kind === 'page' ? 1 : 0;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
}

/**
 * Sort one level and recurse.
 *
 * `applyExplicitOrder` is off for the AI executor, which never read
 * `.order.json` and only needs folder names for its prompt.
 */
function shapeLevel(
    entries: NativeNotesTreeEntry[],
    explicitOrder: string[],
    applyExplicitOrder: boolean,
): TreeNode[] {
    const sorted = [...entries].sort(compareSiblings);
    const ordered = applyExplicitOrder
        ? applyOrder(sorted, e => e.name, explicitOrder)
        : sorted;

    return ordered.map(entry => {
        if (entry.kind === 'page') {
            return { name: entry.name, path: entry.path, type: 'page' as const, lastModifiedAt: entry.lastModifiedAt };
        }
        return {
            name: entry.name,
            path: entry.path,
            type: entry.kind as 'notebook' | 'section',
            children: shapeLevel(entry.children ?? [], entry.explicitOrder ?? [], applyExplicitOrder),
        };
    });
}

/** Convert a whole native scan into `TreeNode`s. */
export function shapeNotesTree(
    result: { entries: NativeNotesTreeEntry[]; explicitOrder: string[] },
    options: { applyExplicitOrder: boolean },
): TreeNode[] {
    return shapeLevel(result.entries, result.explicitOrder, options.applyExplicitOrder);
}
