/**
 * chat-folder-tree — the pure bucketing rules behind the Folders section (AC-04).
 *
 * Everything the renderer decides — which folders show, what their counts say,
 * which rows leave their date bucket — is decided here, so these are the tests
 * that pin the behaviour down.
 */
import { describe, it, expect } from 'vitest';
import {
    buildChatFolderRows,
    buildFolderIdByProcess,
    buildFolderMemberCounts,
    chatFolderColorHex,
    partitionFiledEntries,
    resolveEntryFolderId,
    sortChatFolders,
    CHAT_FOLDER_COLOR_HEX,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-tree';

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

describe('chatFolderColorHex', () => {
    it('maps each preset color name to its hex', () => {
        expect(Object.keys(CHAT_FOLDER_COLOR_HEX)).toEqual(['purple', 'green', 'amber', 'blue', 'red', 'pink']);
        expect(chatFolderColorHex('purple')).toBe('#c586c0');
    });

    it('falls back for an unknown or missing color rather than rendering untinted', () => {
        expect(chatFolderColorHex('chartreuse')).toBe(CHAT_FOLDER_COLOR_HEX.blue);
        expect(chatFolderColorHex(undefined)).toBe(CHAT_FOLDER_COLOR_HEX.blue);
    });
});

describe('sortChatFolders', () => {
    it('orders by sortIndex ascending, breaking ties on createdAt descending', () => {
        const sorted = sortChatFolders([
            folder('c', { sortIndex: 1 }),
            folder('a', { sortIndex: 0, createdAt: '2026-08-01T00:00:00.000Z' }),
            folder('b', { sortIndex: 0, createdAt: '2026-08-20T00:00:00.000Z' }),
        ]);
        expect(sorted.map(f => f.id)).toEqual(['b', 'a', 'c']);
    });

    it('does not mutate its input', () => {
        const input = [folder('b', { sortIndex: 1 }), folder('a', { sortIndex: 0 })];
        sortChatFolders(input);
        expect(input.map(f => f.id)).toEqual(['b', 'a']);
    });
});

describe('buildFolderIdByProcess', () => {
    it('reads folderId off the process summaries and skips unfiled entries', () => {
        const map = buildFolderIdByProcess([
            { id: 'p1', folderId: 'f1' },
            { id: 'p2', folderId: null },
            { id: 'p3' },
            { id: 'p4', folderId: 'f2' },
        ]);
        expect([...map.entries()]).toEqual([['p1', 'f1'], ['p4', 'f2']]);
    });

    it('tolerates a missing process list', () => {
        expect(buildFolderIdByProcess(undefined).size).toBe(0);
    });
});

describe('buildFolderMemberCounts', () => {
    it('counts workspace-wide members per folder', () => {
        const counts = buildFolderMemberCounts(new Map([['p1', 'f1'], ['p2', 'f1'], ['p3', 'f2']]));
        expect(counts.get('f1')).toBe(2);
        expect(counts.get('f2')).toBe(1);
    });
});

describe('resolveEntryFolderId', () => {
    const map = new Map([['p1', 'f1'], ['queue-proc', 'f2']]);

    it('prefers a folderId already on the row', () => {
        expect(resolveEntryFolderId({ id: 'p1', folderId: 'f9' }, map)).toBe('f9');
    });

    it('falls back to the row id, then the processId', () => {
        expect(resolveEntryFolderId({ id: 'p1' }, map)).toBe('f1');
        expect(resolveEntryFolderId({ id: 'task-7', processId: 'queue-proc' }, map)).toBe('f2');
    });

    it('never files a group entry — only individual process rows are filable', () => {
        expect(resolveEntryFolderId({ id: 'p1', kind: 'ralph-session' }, map)).toBeNull();
        expect(resolveEntryFolderId({ id: 'p1', kind: 'for-each-run' }, map)).toBeNull();
    });

    it('returns null for an unfiled row', () => {
        expect(resolveEntryFolderId({ id: 'nope' }, map)).toBeNull();
    });
});

describe('buildChatFolderRows', () => {
    const folders = [folder('f1', { name: 'Auth rewrite', sortIndex: 0 }), folder('f2', { name: 'Perf', sortIndex: 1 })];
    const folderIdByProcess = new Map([['a', 'f1'], ['b', 'f1'], ['c', 'f2']]);

    it('buckets members and reports a tab-filtered count', () => {
        const rows = buildChatFolderRows({
            folders,
            entries: [{ id: 'a' }, { id: 'c' }, { id: 'unfiled' }],
            folderIdByProcess,
            folderMemberCounts: buildFolderMemberCounts(folderIdByProcess),
            collapsedIds: new Set(),
        });
        expect(rows.map(r => r.folder.id)).toEqual(['f1', 'f2']);
        // 'b' is filed in f1 but is not a candidate on this tab, so it is not counted.
        expect(rows[0].memberCount).toBe(1);
        expect(rows[0].members.map((m: any) => m.id)).toEqual(['a']);
    });

    it('preserves the supplied (recency-descending) member order', () => {
        const rows = buildChatFolderRows({
            folders: [folders[0]],
            entries: [{ id: 'b' }, { id: 'a' }],
            folderIdByProcess,
            collapsedIds: new Set(),
        });
        expect(rows[0].members.map((m: any) => m.id)).toEqual(['b', 'a']);
    });

    it('hides a folder whose members all fall outside this tab', () => {
        const rows = buildChatFolderRows({
            folders,
            entries: [{ id: 'a' }],
            folderIdByProcess,
            folderMemberCounts: buildFolderMemberCounts(folderIdByProcess),
            collapsedIds: new Set(),
        });
        expect(rows.map(r => r.folder.id)).toEqual(['f1']);
    });

    it('still shows a folder that is empty everywhere, marked as empty', () => {
        const rows = buildChatFolderRows({
            folders: [folder('f3', { name: 'Release 1.9' })],
            entries: [],
            folderIdByProcess,
            folderMemberCounts: buildFolderMemberCounts(folderIdByProcess),
            collapsedIds: new Set(),
        });
        expect(rows).toHaveLength(1);
        expect(rows[0].isEmpty).toBe(true);
        expect(rows[0].memberCount).toBe(0);
    });

    it('counts running members for the live-run dot', () => {
        const rows = buildChatFolderRows({
            folders: [folders[0]],
            entries: [{ id: 'a' }, { id: 'b' }],
            folderIdByProcess,
            collapsedIds: new Set(),
            runningIds: new Set(['b']),
        });
        expect(rows[0].runningCount).toBe(1);
    });

    it('treats a membership pointing at a deleted folder as unfiled', () => {
        const rows = buildChatFolderRows({
            folders: [folders[0]],
            entries: [{ id: 'a' }, { id: 'c' }],
            folderIdByProcess,
            collapsedIds: new Set(),
        });
        expect(rows[0].members.map((m: any) => m.id)).toEqual(['a']);
    });

    it('carries collapse state through', () => {
        const rows = buildChatFolderRows({
            folders,
            entries: [{ id: 'a' }, { id: 'c' }],
            folderIdByProcess,
            collapsedIds: new Set(['f2']),
        });
        expect(rows.find(r => r.folder.id === 'f2')!.collapsed).toBe(true);
        expect(rows.find(r => r.folder.id === 'f1')!.collapsed).toBe(false);
    });
});

describe('partitionFiledEntries', () => {
    const folderIdByProcess = new Map([['a', 'f1'], ['b', 'f2']]);

    it('pulls filed rows out of the date bucket', () => {
        const { filed, unfiled } = partitionFiledEntries(
            [{ id: 'a' }, { id: 'z' }],
            folderIdByProcess,
            new Set(['f1']),
        );
        expect(filed.map((e: any) => e.id)).toEqual(['a']);
        expect(unfiled.map((e: any) => e.id)).toEqual(['z']);
    });

    it('leaves a row in place when its folder is not rendered on this tab', () => {
        const { filed, unfiled } = partitionFiledEntries(
            [{ id: 'b' }],
            folderIdByProcess,
            new Set(['f1']),
        );
        expect(filed).toHaveLength(0);
        expect(unfiled.map((e: any) => e.id)).toEqual(['b']);
    });
});
