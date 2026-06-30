import { describe, it, expect } from 'vitest';
import {
    getSpawnedParentId,
    groupBySpawnedTree,
    isSpawnedTreeEntry,
    getSpawnedEntryTimestamp,
    collectSpawnedDescendantIds,
    type SpawnedTreeEntry,
} from '../../../../src/server/spa/client/react/features/chat/spawned-tree-grouping';

function chat(id: string, overrides: Record<string, unknown> = {}): any {
    return { id, processId: id, lastActivityAt: 1_000, ...overrides };
}

function treeEntry(entries: any[], rootId: string): SpawnedTreeEntry {
    const entry = entries.find(e => isSpawnedTreeEntry(e) && e.rootProcessId === rootId);
    if (!entry) {throw new Error(`no spawned-tree entry for ${rootId}`);}
    return entry as SpawnedTreeEntry;
}

describe('getSpawnedParentId', () => {
    it('reads a non-empty parentProcessId', () => {
        expect(getSpawnedParentId({ parentProcessId: 'p1' })).toBe('p1');
        expect(getSpawnedParentId({ parentProcessId: '  ' })).toBeUndefined();
        expect(getSpawnedParentId({})).toBeUndefined();
        expect(getSpawnedParentId(null)).toBeUndefined();
    });
});

describe('groupBySpawnedTree', () => {
    it('returns the input untouched when no chat has a parent link', () => {
        const items = [chat('a'), chat('b')];
        const result = groupBySpawnedTree(items);
        expect(result).toBe(items);
    });

    it('keeps a standalone chat (no children) as a plain task, not a tree entry', () => {
        const result = groupBySpawnedTree([chat('a'), chat('b', { parentProcessId: 'missing' })]);
        // Both are roots with no descendants → emitted as plain tasks (orphan b stays flat).
        expect(result.every(e => !isSpawnedTreeEntry(e))).toBe(true);
        expect(result).toHaveLength(2);
    });

    it('nests a direct child under its parent and removes it from the flat list', () => {
        const parent = chat('root', { lastActivityAt: 1_000 });
        const child = chat('child', { parentProcessId: 'root', lastActivityAt: 2_000 });
        const entries = groupBySpawnedTree([parent, child]);

        expect(entries).toHaveLength(1);
        const entry = treeEntry(entries, 'root');
        expect(entry.root.task).toBe(parent);
        expect(entry.root.children.map(c => c.task.id)).toEqual(['child']);
        expect(entry.descendantCount).toBe(1);
        // child is no longer a standalone entry
        expect(entries.some(e => e === child)).toBe(false);
    });

    it('nests recursively and counts ALL descendants (grandchild included)', () => {
        const root = chat('root', { lastActivityAt: 1_000 });
        const child = chat('child', { parentProcessId: 'root', lastActivityAt: 1_500 });
        const grandchild = chat('grand', { parentProcessId: 'child', lastActivityAt: 3_000 });
        const entries = groupBySpawnedTree([root, child, grandchild]);

        const entry = treeEntry(entries, 'root');
        expect(entry.descendantCount).toBe(2);
        const childNode = entry.root.children[0];
        expect(childNode.task.id).toBe('child');
        expect(childNode.children.map(c => c.task.id)).toEqual(['grand']);
        expect(childNode.descendantCount).toBe(1);
    });

    it('uses the subtree-latest timestamp so an active descendant pulls the root up', () => {
        const root = chat('root', { lastActivityAt: 1_000 });
        const grandchildActive = chat('grand', { parentProcessId: 'child', lastActivityAt: 9_000 });
        const child = chat('child', { parentProcessId: 'root', lastActivityAt: 1_200 });
        const otherNewerStandalone = chat('z', { lastActivityAt: 5_000 });

        const entries = groupBySpawnedTree([root, child, grandchildActive, otherNewerStandalone]);
        const entry = treeEntry(entries, 'root');
        expect(entry.latestTimestamp).toBe(9_000);
        // root's subtree (latest 9000) sorts ahead of the standalone (5000)
        expect(getSpawnedEntryTimestamp(entries[0])).toBe(9_000);
        expect(isSpawnedTreeEntry(entries[0])).toBe(true);
    });

    it('sorts direct children oldest-first', () => {
        const root = chat('root');
        const c1 = chat('c1', { parentProcessId: 'root', lastActivityAt: 3_000 });
        const c2 = chat('c2', { parentProcessId: 'root', lastActivityAt: 2_000 });
        const entries = groupBySpawnedTree([root, c1, c2]);
        const entry = treeEntry(entries, 'root');
        expect(entry.root.children.map(c => c.task.id)).toEqual(['c2', 'c1']);
    });

    it('propagates hasUnseen up from any descendant', () => {
        const root = chat('root');
        const child = chat('child', { parentProcessId: 'root' });
        const grand = chat('grand', { parentProcessId: 'child' });
        const unseen = new Set<string>(['grand']);
        const entries = groupBySpawnedTree([root, child, grand], unseen);
        const entry = treeEntry(entries, 'root');
        expect(entry.hasUnseen).toBe(true);
    });

    it('terminates on a cycle (a → b → a) without infinite recursion', () => {
        const a = chat('a', { parentProcessId: 'b', lastActivityAt: 1_000 });
        const b = chat('b', { parentProcessId: 'a', lastActivityAt: 2_000 });
        const entries = groupBySpawnedTree([a, b]);
        // Exactly one of them is broken out as a root; no crash, both accounted for.
        const treeEntries = entries.filter(isSpawnedTreeEntry);
        expect(treeEntries).toHaveLength(1);
        expect(treeEntries[0].descendantCount).toBe(1);
    });

    it('resolves a parent referenced by its processId even when id differs', () => {
        const parent = { id: 'task-1', processId: 'proc-1', lastActivityAt: 1_000 };
        const child = { id: 'task-2', processId: 'proc-2', parentProcessId: 'proc-1', lastActivityAt: 2_000 };
        const entries = groupBySpawnedTree([parent, child]);
        const entry = treeEntry(entries, 'task-1');
        expect(entry.root.children.map(c => c.task.id)).toEqual(['task-2']);
    });

    it('collectSpawnedDescendantIds returns every descendant id (not the root)', () => {
        const root = chat('root');
        const child = chat('child', { parentProcessId: 'root' });
        const grand = chat('grand', { parentProcessId: 'child' });
        const entry = treeEntry(groupBySpawnedTree([root, child, grand]), 'root');
        const ids = collectSpawnedDescendantIds(entry);
        expect(ids.has('child')).toBe(true);
        expect(ids.has('grand')).toBe(true);
        expect(ids.has('root')).toBe(false);
    });
});
