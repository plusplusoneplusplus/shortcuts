/**
 * notes-order.ts — helpers for `.order.json` custom sort order in notes directories.
 *
 * Each notes directory may contain a `.order.json` file with the shape:
 *   { "order": ["name-a", "section-b", "page.md"] }
 *
 * Items listed in `.order.json` are shown first (in the specified order).
 * Items NOT listed fall back to alphabetical sort, appended after the explicitly-ordered items.
 */

import * as fs from 'fs';
import * as path from 'path';

export const ORDER_FILE_NAME = '.order.json';

interface OrderFile {
    order: string[];
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Read the ordered name list from a directory's `.order.json`. Returns `[]` when absent or malformed. */
export async function readOrderFile(dir: string): Promise<string[]> {
    try {
        const raw = await fs.promises.readFile(path.join(dir, ORDER_FILE_NAME), 'utf-8');
        const parsed: OrderFile = JSON.parse(raw);
        if (Array.isArray(parsed.order)) return parsed.order;
    } catch {
        // File missing or malformed — fall through
    }
    return [];
}

/** Persist a name list to a directory's `.order.json`. */
export async function writeOrderFile(dir: string, order: string[]): Promise<void> {
    await fs.promises.writeFile(
        path.join(dir, ORDER_FILE_NAME),
        JSON.stringify({ order }, null, 2),
        'utf-8',
    );
}

/**
 * Remove an entry from a directory's `.order.json` (called on delete).
 * No-ops if the file is absent or the name is not listed.
 */
export async function removeFromOrder(dir: string, name: string): Promise<void> {
    const order = await readOrderFile(dir);
    const filtered = order.filter(n => n !== name);
    if (filtered.length !== order.length) {
        await writeOrderFile(dir, filtered);
    }
}

/**
 * Rename an entry within a directory's `.order.json` (called on rename within same parent).
 * No-ops if the file is absent or the old name is not listed.
 */
export async function updateOrderOnRename(dir: string, oldName: string, newName: string): Promise<void> {
    const order = await readOrderFile(dir);
    const idx = order.indexOf(oldName);
    if (idx !== -1) {
        order[idx] = newName;
        await writeOrderFile(dir, order);
    }
}

// ── Sorting ──────────────────────────────────────────────────────────────────

/**
 * Sort items according to an explicit order list.
 *
 * Items whose names appear in `explicitOrder` are placed first, in the order
 * they appear in the list. Remaining items preserve their original relative
 * order from the input array (the caller is responsible for pre-sorting `items`
 * to establish the desired fallback order).
 *
 * When `explicitOrder` is empty, returns `items` unchanged.
 */
export function applyOrder<T>(items: T[], getName: (item: T) => string, explicitOrder: string[]): T[] {
    if (explicitOrder.length === 0) return items;

    const positionMap = new Map<string, number>();
    explicitOrder.forEach((name, i) => positionMap.set(name, i));

    const ordered: T[] = [];
    const unordered: T[] = [];

    for (const item of items) {
        if (positionMap.has(getName(item))) {
            ordered.push(item);
        } else {
            unordered.push(item);
        }
    }

    ordered.sort((a, b) => positionMap.get(getName(a))! - positionMap.get(getName(b))!);

    // unordered keeps its original relative order (caller pre-sorts for fallback)
    return [...ordered, ...unordered];
}
