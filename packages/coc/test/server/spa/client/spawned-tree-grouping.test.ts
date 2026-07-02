import { describe, it, expect } from 'vitest';
import {
    getSpawnedParentId,
    groupBySpawnedTree,
    isSpawnedTreeEntry,
    getSpawnedEntryTimestamp,
    collectSpawnedDescendantIds,
    collectSpawnedEntryTasks,
    buildSpawnedTreeChatView,
    partitionSpawnedTreesByArchived,
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

    it('collectSpawnedEntryTasks returns the root and every descendant task', () => {
        const root = chat('root');
        const child = chat('child', { parentProcessId: 'root' });
        const grand = chat('grand', { parentProcessId: 'child' });
        const entry = treeEntry(groupBySpawnedTree([root, child, grand]), 'root');
        const tasks = collectSpawnedEntryTasks(entry).map(t => t.id);
        expect(tasks).toContain('root');
        expect(tasks).toContain('child');
        expect(tasks).toContain('grand');
        expect(tasks).toHaveLength(3);
    });
});

describe('buildSpawnedTreeChatView', () => {
    it('returns the items untouched with no hidden ids when disabled (toggle off restores flat)', () => {
        const items = [chat('root'), chat('child', { parentProcessId: 'root' })];
        const view = buildSpawnedTreeChatView(items, { enabled: false });
        // Same array reference, no grouping, nothing hidden → flat rendering.
        expect(view.entries).toBe(items);
        expect(view.groups).toHaveLength(0);
        expect(view.hiddenIds.size).toBe(0);
    });

    it('hides the root AND every descendant id from the flat list when enabled', () => {
        const items = [
            chat('root'),
            chat('child', { parentProcessId: 'root' }),
            chat('grand', { parentProcessId: 'child' }),
            chat('lonely'),
        ];
        const view = buildSpawnedTreeChatView(items, { enabled: true });
        expect(view.groups).toHaveLength(1);
        expect(view.groups[0].rootProcessId).toBe('root');
        // root + all descendants leave the flat list; the unrelated chat does not.
        expect(view.hiddenIds.has('root')).toBe(true);
        expect(view.hiddenIds.has('child')).toBe(true);
        expect(view.hiddenIds.has('grand')).toBe(true);
        expect(view.hiddenIds.has('lonely')).toBe(false);
    });

    it('keeps a childless root in the flat list (no group, nothing hidden)', () => {
        const items = [chat('a'), chat('b')];
        const view = buildSpawnedTreeChatView(items, { enabled: true });
        expect(view.groups).toHaveLength(0);
        expect(view.hiddenIds.size).toBe(0);
    });

    it('skips chats already owned by another group via excludeIds', () => {
        const items = [
            chat('root'),
            chat('child', { parentProcessId: 'root' }),
        ];
        // 'root' is already a for-each/map-reduce child → do not re-group its subtree.
        const view = buildSpawnedTreeChatView(items, { enabled: true, excludeIds: new Set(['root']) });
        expect(view.groups).toHaveLength(0);
        expect(view.hiddenIds.size).toBe(0);
    });

    it('matches excludeIds on either id or processId', () => {
        const items = [
            { id: 'task-1', processId: 'proc-1', lastActivityAt: 1_000 },
            { id: 'task-2', processId: 'proc-2', parentProcessId: 'proc-1', lastActivityAt: 2_000 },
        ];
        const view = buildSpawnedTreeChatView(items, { enabled: true, excludeIds: new Set(['proc-1']) });
        expect(view.groups).toHaveLength(0);
    });
});

/** Build the spawned-tree groups from a flat chat list, the way ChatListPane does. */
function groupsOf(items: any[], unseen?: Set<string>): SpawnedTreeEntry[] {
    return groupBySpawnedTree(items, unseen).filter(isSpawnedTreeEntry);
}

describe('partitionSpawnedTreesByArchived', () => {
    it('passes groups through untouched when nothing is archived (same reference)', () => {
        const groups = groupsOf([chat('root'), chat('child', { parentProcessId: 'root' })]);
        const part = partitionSpawnedTreesByArchived(groups, new Set());
        expect(part.activeGroups).toBe(groups);
        expect(part.activeTasks).toEqual([]);
        expect(part.archivedGroups).toEqual([]);
        expect(part.archivedTasks).toEqual([]);
        expect(part.effectiveArchivedIds.size).toBe(0);
    });

    it('treats a null/undefined archived set as no-op', () => {
        const groups = groupsOf([chat('root'), chat('child', { parentProcessId: 'root' })]);
        expect(partitionSpawnedTreesByArchived(groups, null).activeGroups).toBe(groups);
        expect(partitionSpawnedTreesByArchived(groups, undefined).activeGroups).toBe(groups);
    });

    it('AC-01/AC-02: archiving the ROOT moves the whole subtree out of active into archived', () => {
        const groups = groupsOf([
            chat('root'),
            chat('child', { parentProcessId: 'root' }),
            chat('grand', { parentProcessId: 'child' }),
        ]);
        const part = partitionSpawnedTreesByArchived(groups, new Set(['root']));

        expect(part.activeGroups).toHaveLength(0);
        expect(part.activeTasks).toHaveLength(0);
        expect(part.archivedGroups).toHaveLength(1);
        expect(part.archivedGroups[0].rootProcessId).toBe('root');
        expect(part.archivedGroups[0].descendantCount).toBe(2);
        // root + every descendant is effectively archived
        expect([...part.effectiveArchivedIds].sort()).toEqual(['child', 'grand', 'root']);
    });

    it('AC-01: an archived MIDDLE node splits off; the active root keeps its non-archived branch', () => {
        const groups = groupsOf([
            chat('root', { lastActivityAt: 1_000 }),
            chat('childA', { parentProcessId: 'root', lastActivityAt: 2_000 }),
            chat('grandA', { parentProcessId: 'childA', lastActivityAt: 3_000 }),
            chat('childB', { parentProcessId: 'root', lastActivityAt: 8_000 }),
            chat('grandB', { parentProcessId: 'childB', lastActivityAt: 9_000 }),
        ]);
        const part = partitionSpawnedTreesByArchived(groups, new Set(['childB']));

        // Active root keeps only the childA branch, re-finalized.
        expect(part.activeGroups).toHaveLength(1);
        const activeRoot = part.activeGroups[0];
        expect(activeRoot.rootProcessId).toBe('root');
        expect(activeRoot.root.children.map(c => c.task.id)).toEqual(['childA']);
        expect(activeRoot.descendantCount).toBe(2); // childA + grandA
        // The archived childB branch carried the latest activity; pruning it drops
        // the active root's subtree-latest back to grandA's 3_000.
        expect(activeRoot.latestTimestamp).toBe(3_000);

        // Archived subtree is rooted at childB (the shallowest archived node).
        expect(part.archivedGroups).toHaveLength(1);
        expect(part.archivedGroups[0].rootProcessId).toBe('childB');
        expect(part.archivedGroups[0].descendantCount).toBe(1); // grandB
        expect([...part.effectiveArchivedIds].sort()).toEqual(['childB', 'grandB']);
    });

    it('AC-02: an archived LEAF (no descendants) becomes a flat archived task', () => {
        const groups = groupsOf([
            chat('root'),
            chat('childA', { parentProcessId: 'root' }),
            chat('childB', { parentProcessId: 'root' }),
        ]);
        const part = partitionSpawnedTreesByArchived(groups, new Set(['childB']));

        expect(part.activeGroups).toHaveLength(1);
        expect(part.activeGroups[0].root.children.map(c => c.task.id)).toEqual(['childA']);
        // childB has no descendants → flat archived task, not a tree.
        expect(part.archivedGroups).toHaveLength(0);
        expect(part.archivedTasks.map(t => t.id)).toEqual(['childB']);
        expect([...part.effectiveArchivedIds]).toEqual(['childB']);
    });

    it('demotes an active root to a flat task when ALL its children are archived', () => {
        const groups = groupsOf([
            chat('root'),
            chat('childA', { parentProcessId: 'root' }),
            chat('childB', { parentProcessId: 'root' }),
        ]);
        const part = partitionSpawnedTreesByArchived(groups, new Set(['childA', 'childB']));

        // Root survives (not archived) but is childless → flat active task.
        expect(part.activeGroups).toHaveLength(0);
        expect(part.activeTasks.map(t => t.id)).toEqual(['root']);
        expect(part.archivedTasks.map(t => t.id).sort()).toEqual(['childA', 'childB']);
    });

    it('AC-03: a deeper archived node inside an archived subtree does NOT re-root', () => {
        const groups = groupsOf([
            chat('root'),
            chat('mid', { parentProcessId: 'root' }),
            chat('grand', { parentProcessId: 'mid' }),
        ]);
        // Both mid and grand are explicitly archived; mid is the shallowest.
        const part = partitionSpawnedTreesByArchived(groups, new Set(['mid', 'grand']));

        expect(part.archivedGroups).toHaveLength(1);
        expect(part.archivedGroups[0].rootProcessId).toBe('mid');
        expect(part.archivedGroups[0].descendantCount).toBe(1); // grand travels with mid
        expect(part.activeGroups).toHaveLength(0); // root left childless
        expect(part.activeTasks.map(t => t.id)).toEqual(['root']);
    });

    it('AC-03: unarchiving the ancestor re-roots the independently-archived descendant (recompute)', () => {
        const items = [
            chat('root'),
            chat('mid', { parentProcessId: 'root' }),
            chat('grand', { parentProcessId: 'mid' }),
        ];
        // While both archived, mid owns the subtree (grand does not re-root)…
        const bothArchived = partitionSpawnedTreesByArchived(groupsOf(items), new Set(['mid', 'grand']));
        expect(bothArchived.archivedGroups[0].rootProcessId).toBe('mid');

        // …after unarchiving mid, grand becomes the shallowest archived node and
        // re-roots as its own archived sub-tree; root+mid stay active.
        const afterUnarchiveMid = partitionSpawnedTreesByArchived(groupsOf(items), new Set(['grand']));
        expect(afterUnarchiveMid.activeGroups).toHaveLength(1);
        expect(afterUnarchiveMid.activeGroups[0].rootProcessId).toBe('root');
        expect(afterUnarchiveMid.activeGroups[0].root.children.map(c => c.task.id)).toEqual(['mid']);
        expect(afterUnarchiveMid.archivedTasks.map(t => t.id)).toEqual(['grand']);
    });

    it('recomputes hasUnseen for both sides after the split', () => {
        const unseen = new Set(['grandB']);
        const groups = groupsOf([
            chat('root'),
            chat('childA', { parentProcessId: 'root' }),
            chat('childB', { parentProcessId: 'root' }),
            chat('grandB', { parentProcessId: 'childB' }),
        ], unseen);
        // Whole tree is unseen because grandB is unseen.
        expect(groups[0].hasUnseen).toBe(true);

        const part = partitionSpawnedTreesByArchived(groups, new Set(['childB']), unseen);
        // Active side (root + childA) no longer contains the unseen node.
        expect(part.activeGroups[0].hasUnseen).toBe(false);
        // Archived side (childB → grandB) carries the unseen flag.
        expect(part.archivedGroups[0].hasUnseen).toBe(true);
    });

    it('resolves archived state by id OR processId', () => {
        const groups = groupsOf([
            { id: 'task-root', processId: 'proc-root', lastActivityAt: 1_000 },
            { id: 'task-child', processId: 'proc-child', parentProcessId: 'proc-root', lastActivityAt: 2_000 },
        ]);
        // Archive keyed on the child's processId (not its id).
        const part = partitionSpawnedTreesByArchived(groups, new Set(['proc-child']));
        expect(part.archivedTasks.map(t => t.id)).toEqual(['task-child']);
        expect(part.effectiveArchivedIds.has('task-child')).toBe(true);
        expect(part.effectiveArchivedIds.has('proc-child')).toBe(true);
    });

    it('partitions several trees independently in one call', () => {
        const groups = groupsOf([
            chat('r1', { lastActivityAt: 5_000 }),
            chat('r1c', { parentProcessId: 'r1', lastActivityAt: 6_000 }),
            chat('r2', { lastActivityAt: 1_000 }),
            chat('r2c', { parentProcessId: 'r2', lastActivityAt: 2_000 }),
        ]);
        // Archive the whole r2 tree; leave r1 active.
        const part = partitionSpawnedTreesByArchived(groups, new Set(['r2']));
        expect(part.activeGroups.map(g => g.rootProcessId)).toEqual(['r1']);
        expect(part.archivedGroups.map(g => g.rootProcessId)).toEqual(['r2']);
        expect([...part.effectiveArchivedIds].sort()).toEqual(['r2', 'r2c']);
    });
});
