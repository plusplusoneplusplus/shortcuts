export const TOP_BAR_ITEM_DEFAULT_ORDER = [
    'wiki',
    'skills',
    'logs',
    'memory',
    'stats',
    'models',
    'servers',
    'admin',
] as const;

export type TopBarItemId = typeof TOP_BAR_ITEM_DEFAULT_ORDER[number];

function sanitizeKnownOrder<T extends string>(savedOrder: readonly string[] | undefined, knownIds: readonly T[]): T[] {
    if (!savedOrder) {
        return [];
    }
    const known = new Set<string>(knownIds);
    const seen = new Set<string>();
    const result: T[] = [];
    for (const id of savedOrder) {
        if (!known.has(id) || seen.has(id)) {
            continue;
        }
        seen.add(id);
        result.push(id as T);
    }
    return result;
}

export function resolveTopBarItemOrder<T extends string>(
    defaultOrder: readonly T[],
    savedOrder?: readonly string[],
): T[] {
    const resolved = sanitizeKnownOrder(savedOrder, defaultOrder);
    const seen = new Set<string>(resolved);
    for (const id of defaultOrder) {
        if (!seen.has(id)) {
            resolved.push(id);
        }
    }
    return resolved;
}

export function mergeVisibleTopBarOrder(
    previousSavedOrder: readonly string[] | undefined,
    nextVisibleOrder: readonly TopBarItemId[],
    allKnownDefaultOrder: readonly TopBarItemId[] = TOP_BAR_ITEM_DEFAULT_ORDER,
): TopBarItemId[] {
    const visibleIds = new Set<string>(nextVisibleOrder);
    const visibleQueue = [...nextVisibleOrder];
    const fullOrder = resolveTopBarItemOrder(allKnownDefaultOrder, previousSavedOrder);

    const merged = fullOrder.map(id => {
        if (!visibleIds.has(id)) {
            return id;
        }
        const next = visibleQueue.shift();
        return next ?? id;
    });

    for (const id of visibleQueue) {
        if (!merged.includes(id)) {
            merged.push(id);
        }
    }

    return merged;
}

export function moveTopBarItem(ids: readonly TopBarItemId[], draggedId: TopBarItemId, targetId: TopBarItemId, position: 'before' | 'after'): TopBarItemId[] {
    if (draggedId === targetId) {
        return [...ids];
    }
    const next = ids.filter(id => id !== draggedId);
    const targetIndex = next.indexOf(targetId);
    if (targetIndex === -1) {
        return [...ids];
    }
    const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
    next.splice(insertIndex, 0, draggedId);
    return next;
}

export function moveTopBarItemToIndex(ids: readonly TopBarItemId[], draggedId: TopBarItemId, targetIndex: number): TopBarItemId[] {
    const next = ids.filter(id => id !== draggedId);
    const clampedIndex = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(clampedIndex, 0, draggedId);
    return next;
}
