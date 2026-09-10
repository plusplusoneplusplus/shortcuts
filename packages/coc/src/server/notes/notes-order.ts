/**
 * Sibling ordering for notes directories.
 *
 * Each notes directory may contain a `.order.json` file with the shape:
 *   { "order": ["name-a", "section-b", "page.md"] }
 *
 * Items listed in `.order.json` are shown first (in the specified order).
 * Items NOT listed fall back to alphabetical sort, appended after the
 * explicitly-ordered items.
 *
 * Reading and writing that file is the native core's job. What stays here is
 * the sort itself, because the fallback order is `localeCompare` — ICU
 * collation is what the SPA has always shown, and a Rust reimplementation of
 * it would drift.
 */

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
