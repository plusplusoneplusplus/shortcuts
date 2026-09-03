/**
 * chat-folder-group-tree — filing a whole chat *group* into a folder (AC-02,
 * AC-05, AC-06).
 *
 * These are the pure bucketing rules: a filed group renders as one row inside
 * the folder, carries its children with it, counts as a single member, and
 * leaves its date bucket behind. The move is keyed on the group, so children
 * that arrive after the move need no write of their own.
 */
import { describe, it, expect } from 'vitest';
import {
    buildChatFolderRows,
    buildFolderMemberCounts,
    buildGroupFolderIndex,
    buildSearchChatFolderRows,
    groupEntriesByFolder,
    partitionFiledEntries,
    resolveEntryFolderId,
    EMPTY_GROUP_FOLDER_INDEX,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-tree';
import {
    buildGroupFolderMap,
    collectGroupProcessIds,
    getGroupFolderKey,
    getGroupFolderKeyForEntry,
    getGroupFolderTarget,
    isGroupFolderEntry,
} from '../../../../src/server/spa/client/react/features/chat/group-folder-key';
import { taskMatchesSearch } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

function folder(id: string, overrides: Record<string, any> = {}) {
    return {
        id,
        name: id,
        color: 'blue',
        sortIndex: 0,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
        ...overrides,
    } as any;
}

function chat(id: string, overrides: Record<string, any> = {}) {
    return { id, title: id, ...overrides } as any;
}

function ralphSession(sessionId: string, iterationIds: string[], overrides: Record<string, any> = {}) {
    return {
        kind: 'ralph-session',
        sessionId,
        title: `Ralph ${sessionId}`,
        grillingProcess: chat(`${sessionId}-grill`),
        iterations: iterationIds.map(id => chat(id)),
        latestTimestamp: 10,
        hasUnseen: false,
        phase: 'executing',
        loopCount: 1,
        ...overrides,
    } as any;
}

function forEachRun(runId: string, childIds: string[]) {
    return {
        kind: 'for-each-run',
        runId,
        run: { id: runId },
        children: childIds.map(id => chat(id)),
        latestTimestamp: 5,
        hasUnseen: false,
    } as any;
}

function spawnedTree(rootProcessId: string, childIds: string[]) {
    return {
        kind: 'spawned-tree',
        rootProcessId,
        root: {
            task: chat(rootProcessId),
            children: childIds.map(id => ({ task: chat(id), children: [], descendantCount: 0, subtreeLatestTimestamp: 1, hasUnseen: false })),
            descendantCount: childIds.length,
            subtreeLatestTimestamp: 1,
            hasUnseen: false,
        },
        descendantCount: childIds.length,
        latestTimestamp: 7,
        hasUnseen: false,
    } as any;
}

describe('getGroupFolderTarget', () => {
    it('keys each group type off the id that identifies the group', () => {
        expect(getGroupFolderTarget(ralphSession('s1', []))).toEqual({ type: 'ralph-session', groupId: 's1' });
        expect(getGroupFolderTarget(spawnedTree('p1', []))).toEqual({ type: 'spawned-tree', groupId: 'p1' });
        expect(getGroupFolderTarget(forEachRun('r1', []))).toEqual({ type: 'for-each-run', groupId: 'r1' });
        expect(getGroupFolderTarget({ kind: 'map-reduce-run', runId: 'r2' })).toEqual({ type: 'map-reduce-run', groupId: 'r2' });
    });

    it('is null for a plain chat row and for an unknown group kind', () => {
        expect(getGroupFolderTarget(chat('a'))).toBeNull();
        expect(getGroupFolderTarget({ kind: 'something-else', runId: 'r' })).toBeNull();
        expect(isGroupFolderEntry(chat('a'))).toBe(false);
        expect(isGroupFolderEntry(ralphSession('s1', []))).toBe(true);
    });

    it('refuses to key a group whose id is missing, rather than inventing one', () => {
        expect(getGroupFolderTarget({ kind: 'ralph-session', sessionId: '  ' })).toBeNull();
        expect(getGroupFolderKeyForEntry({ kind: 'for-each-run' })).toBeNull();
    });
});

describe('collectGroupProcessIds', () => {
    it('walks a ralph session, a spawned tree and a seeded run down to their chats', () => {
        expect(collectGroupProcessIds(ralphSession('s1', ['i1', 'i2']))).toEqual(['s1-grill', 'i1', 'i2']);
        expect(collectGroupProcessIds(spawnedTree('p1', ['c1', 'c2']))).toEqual(['p1', 'c1', 'c2']);
        expect(collectGroupProcessIds(forEachRun('r1', ['x1']))).toEqual(['x1']);
        expect(collectGroupProcessIds(chat('a'))).toEqual([]);
    });
});

describe('buildGroupFolderMap', () => {
    it('accepts either half of the group-folders response', () => {
        expect([...buildGroupFolderMap({ 'ralph-session:s1': 'f1' })]).toEqual([['ralph-session:s1', 'f1']]);
        expect([...buildGroupFolderMap([
            { type: 'for-each-run', groupId: 'r1', folderId: 'f2', updatedAt: 'x' },
        ] as any)]).toEqual([['for-each-run:r1', 'f2']]);
        expect(buildGroupFolderMap(undefined).size).toBe(0);
    });
});

describe('buildGroupFolderIndex', () => {
    it('indexes only the groups that are actually rendered', () => {
        const index = buildGroupFolderIndex(
            [ralphSession('s1', ['i1'])],
            new Map([['ralph-session:s1', 'f1'], ['ralph-session:gone', 'f1']]),
        );
        expect([...index.folderIdByGroupKey]).toEqual([['ralph-session:s1', 'f1']]);
        expect([...index.folderIdByGroupChild.keys()]).toEqual(['s1-grill', 'i1']);
    });

    it('is the shared empty index when nothing is filed', () => {
        expect(buildGroupFolderIndex([ralphSession('s1', [])], new Map())).toBe(EMPTY_GROUP_FOLDER_INDEX);
        expect(buildGroupFolderIndex([chat('a')], new Map([['ralph-session:s1', 'f1']]))).toBe(EMPTY_GROUP_FOLDER_INDEX);
    });
});

describe('resolveEntryFolderId with groups', () => {
    it('resolves a group row through the group-folder map (AC-02)', () => {
        const session = ralphSession('s1', ['i1']);
        const index = buildGroupFolderIndex([session], new Map([['ralph-session:s1', 'f1']]));
        expect(resolveEntryFolderId(session, new Map(), index)).toBe('f1');
    });

    it('still resolves an unfiled group row to null', () => {
        const session = ralphSession('s1', []);
        expect(resolveEntryFolderId(session, new Map())).toBeNull();
        expect(resolveEntryFolderId(session, new Map(), EMPTY_GROUP_FOLDER_INDEX)).toBeNull();
    });

    it("prefers the group's folder over a child's own membership, so a group never splits (AC-06)", () => {
        const session = ralphSession('s1', ['i1']);
        const index = buildGroupFolderIndex([session], new Map([['ralph-session:s1', 'folder-B']]));
        const child = chat('i1', { folderId: 'folder-A' });
        expect(resolveEntryFolderId(child, new Map([['i1', 'folder-A']]), index)).toBe('folder-B');
        // A chat outside the group keeps reading its own membership.
        expect(resolveEntryFolderId(chat('other', { folderId: 'folder-A' }), new Map(), index)).toBe('folder-A');
    });
});

describe('a filed group inside the folder tree (AC-02)', () => {
    const folders = [folder('f1')];

    function build(entries: any[], groupFolders: Record<string, string>) {
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap(groupFolders));
        const rows = buildChatFolderRows({
            folders,
            entries,
            folderIdByProcess: new Map(),
            groupIndex: index,
            collapsedIds: new Set(),
        });
        return { index, rows };
    }

    it('renders the group as a single member row, children still nested inside it', () => {
        const session = ralphSession('s1', ['i1', 'i2']);
        const { rows } = build([session, chat('loose')], { 'ralph-session:s1': 'f1' });
        expect(rows).toHaveLength(1);
        expect(rows[0].memberCount).toBe(1);
        expect(rows[0].members).toEqual([session]);
        expect(rows[0].members[0].iterations.map((i: any) => i.id)).toEqual(['i1', 'i2']);
    });

    it('counts a filed group as one member, not once per child', () => {
        const session = ralphSession('s1', ['i1', 'i2']);
        const index = buildGroupFolderIndex([session], buildGroupFolderMap({ 'ralph-session:s1': 'f1' }));
        const counts = buildFolderMemberCounts(new Map(), undefined, index);
        expect(counts.get('f1')).toBe(1);
    });

    it('does not double-count a child that also carries its own folderId', () => {
        const session = ralphSession('s1', ['i1']);
        const index = buildGroupFolderIndex([session], buildGroupFolderMap({ 'ralph-session:s1': 'f1' }));
        const counts = buildFolderMemberCounts(new Map([['i1', 'f1'], ['solo', 'f1']]), undefined, index);
        expect(counts.get('f1')).toBe(2); // the group (1) + the unrelated solo chat
    });

    it('takes the filed group out of its date bucket', () => {
        const session = ralphSession('s1', ['i1']);
        const entries = [session, chat('loose')];
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap({ 'ralph-session:s1': 'f1' }));
        const { filed, unfiled } = partitionFiledEntries(entries, new Map(), new Set(['f1']), index);
        expect(filed).toEqual([session]);
        expect(unfiled.map((e: any) => e.id)).toEqual(['loose']);
    });

    it('leaves the group in its bucket when its folder was deleted underneath us', () => {
        const session = ralphSession('s1', []);
        const entries = [session];
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap({ 'ralph-session:s1': 'gone' }));
        const { filed, unfiled } = partitionFiledEntries(entries, new Map(), new Set(['f1']), index);
        expect(filed).toEqual([]);
        expect(unfiled).toEqual([session]);
        expect(buildChatFolderRows({
            folders, entries, folderIdByProcess: new Map(), groupIndex: index, collapsedIds: new Set(),
        })[0].memberCount).toBe(0);
    });

    it('files a for-each run and a spawned tree the same way', () => {
        const run = forEachRun('r1', ['x1']);
        const tree = spawnedTree('p1', ['c1']);
        const { rows } = build([run, tree], { 'for-each-run:r1': 'f1', 'spawned-tree:p1': 'f1' });
        expect(rows[0].members).toEqual([run, tree]);
        expect(rows[0].memberCount).toBe(2);
    });

    it('marks the folder live when any chat inside a filed group is running', () => {
        const session = ralphSession('s1', ['i1']);
        const entries = [session];
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap({ 'ralph-session:s1': 'f1' }));
        const rows = buildChatFolderRows({
            folders,
            entries,
            folderIdByProcess: new Map(),
            groupIndex: index,
            collapsedIds: new Set(),
            runningIds: new Set(['i1']),
        });
        expect(rows[0].runningCount).toBe(1);
    });
});

describe('a filed group in search results (AC-02)', () => {
    it('shows the group under a name-matching folder, once', () => {
        const session = ralphSession('s1', ['i1']);
        const entries = [session, chat('loose')];
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap({ 'ralph-session:s1': 'f1' }));
        const membersByFolder = groupEntriesByFolder(entries, new Map(), new Set(['f1']), index);
        const rows = buildSearchChatFolderRows({
            folders: [folder('f1', { name: 'Infra' })],
            query: 'Infra',
            matches: taskMatchesSearch,
            membersByFolder: new Map([['f1', membersByFolder.get('f1') ?? []]]),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].members).toEqual([session]);
        expect(rows[0].memberCount).toBe(1);
    });
});

describe('late-arriving children (AC-05)', () => {
    it('renders a newly enqueued ralph iteration inside the folder with no extra write', () => {
        const groupFolders = buildGroupFolderMap({ 'ralph-session:s1': 'f1' });
        const before = [ralphSession('s1', ['i1'])];
        const after = [ralphSession('s1', ['i1', 'i2'])];

        const rowsAfter = buildChatFolderRows({
            folders: [folder('f1')],
            entries: after,
            folderIdByProcess: new Map(),
            groupIndex: buildGroupFolderIndex(after, groupFolders),
            collapsedIds: new Set(),
        });
        expect(rowsAfter[0].memberCount).toBe(1);
        expect(rowsAfter[0].members[0].iterations.map((i: any) => i.id)).toEqual(['i1', 'i2']);

        // The new iteration is a member of the group, not a loose folder row.
        const indexAfter = buildGroupFolderIndex(after, groupFolders);
        expect(indexAfter.folderIdByGroupChild.get('i2')).toBe('f1');
        expect(buildGroupFolderIndex(before, groupFolders).folderIdByGroupChild.has('i2')).toBe(false);
        expect(buildFolderMemberCounts(new Map(), undefined, indexAfter).get('f1')).toBe(1);
    });
});

describe('a child filed to another folder (AC-06)', () => {
    it('renders under the group folder only, and exactly once across the tree', () => {
        const session = ralphSession('s1', ['i1']);
        const folders = [folder('folder-A'), folder('folder-B', { sortIndex: 1 })];
        const entries = [session];
        const folderIdByProcess = new Map([['i1', 'folder-A']]);
        const index = buildGroupFolderIndex(entries, buildGroupFolderMap({ 'ralph-session:s1': 'folder-B' }));

        const rows = buildChatFolderRows({
            folders, entries, folderIdByProcess, groupIndex: index, collapsedIds: new Set(),
            folderMemberCounts: buildFolderMemberCounts(folderIdByProcess, undefined, index),
        });
        const byFolder = new Map(rows.map(r => [r.folder.id, r]));
        expect(byFolder.get('folder-B')?.members).toEqual([session]);
        expect(byFolder.get('folder-A')?.members).toEqual([]);
        expect(byFolder.get('folder-A')?.isEmpty).toBe(true);

        const rendered = rows.flatMap(r => r.members.map((m: any) => m.sessionId ?? m.id));
        expect(rendered).toEqual(['s1']);
    });
});
