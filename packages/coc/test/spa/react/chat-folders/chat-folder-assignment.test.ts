/**
 * chat-folder-assignment + the submenu filter rule (AC-06).
 *
 * The context menu's label, its filter threshold, and the diff between "rows
 * selected" and "rows the move actually writes" are all pure, so they are
 * asserted here rather than through a render.
 */
import { describe, it, expect } from 'vitest';
import {
    CHAT_FOLDER_FILTER_THRESHOLD,
    anySelectionFiled,
    buildMoveToFolderLabel,
    filterFoldersByQuery,
    resolveMoveTargets,
    shouldShowFolderFilter,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-assignment';
import { filterSubmenuItems } from '../../../../src/server/spa/client/react/tasks/comments/ContextMenu';

function folder(id: string, name = id): any {
    return { id, name, color: 'blue', sortIndex: 0, createdAt: '', updatedAt: '' };
}

describe('buildMoveToFolderLabel', () => {
    it('reads singular for one row', () => {
        expect(buildMoveToFolderLabel(1)).toBe('Move to folder');
    });

    it('names the selection count once more than one row is selected', () => {
        expect(buildMoveToFolderLabel(3)).toBe('Move 3 chats to folder');
        expect(buildMoveToFolderLabel(12)).toBe('Move 12 chats to folder');
    });

    it('treats a zero-length selection as singular rather than "0 chats"', () => {
        expect(buildMoveToFolderLabel(0)).toBe('Move to folder');
    });
});

describe('shouldShowFolderFilter', () => {
    it('stays hidden at and below the threshold', () => {
        expect(CHAT_FOLDER_FILTER_THRESHOLD).toBe(10);
        expect(shouldShowFolderFilter(0)).toBe(false);
        expect(shouldShowFolderFilter(10)).toBe(false);
    });

    it('appears past the threshold', () => {
        expect(shouldShowFolderFilter(11)).toBe(true);
    });
});

describe('filterFoldersByQuery', () => {
    const folders = [folder('a', 'Auth rewrite'), folder('b', 'Perf: chat list'), folder('c', 'Release 1.9')];

    it('is the identity for a blank query', () => {
        expect(filterFoldersByQuery(folders, '   ').map(f => f.id)).toEqual(['a', 'b', 'c']);
    });

    it('matches case-insensitively on a substring and keeps order', () => {
        expect(filterFoldersByQuery(folders, 'e').map(f => f.id)).toEqual(['a', 'b', 'c']);
        expect(filterFoldersByQuery(folders, 'AUTH').map(f => f.id)).toEqual(['a']);
        expect(filterFoldersByQuery(folders, 'chat list').map(f => f.id)).toEqual(['b']);
    });

    it('returns nothing when nothing matches', () => {
        expect(filterFoldersByQuery(folders, 'zzz')).toEqual([]);
    });
});

describe('resolveMoveTargets', () => {
    const membership = new Map([['p1', 'f1'], ['p2', 'f2']]);

    it('skips a row already in the target folder', () => {
        expect(resolveMoveTargets(['p1', 'p2'], membership, 'f1')).toEqual(['p2']);
    });

    it('returns nothing when every row is already filed there', () => {
        expect(resolveMoveTargets(['p1'], membership, 'f1')).toEqual([]);
    });

    it('treats an unfiled row as a no-op for a remove', () => {
        expect(resolveMoveTargets(['p3'], membership, null)).toEqual([]);
        expect(resolveMoveTargets(['p1', 'p3'], membership, null)).toEqual(['p1']);
    });

    it('moves a mixed selection wholesale into a third folder', () => {
        expect(resolveMoveTargets(['p1', 'p2', 'p3'], membership, 'f9')).toEqual(['p1', 'p2', 'p3']);
    });

    it('de-duplicates ids', () => {
        expect(resolveMoveTargets(['p3', 'p3'], membership, 'f1')).toEqual(['p3']);
    });
});

describe('anySelectionFiled', () => {
    const membership = new Map([['p1', 'f1']]);

    it('is true when at least one row is filed', () => {
        expect(anySelectionFiled(['p1', 'p2'], membership)).toBe(true);
    });

    it('is false when nothing in the selection is filed', () => {
        expect(anySelectionFiled(['p2', 'p3'], membership)).toBe(false);
        expect(anySelectionFiled([], membership)).toBe(false);
    });
});

describe('filterSubmenuItems', () => {
    const children: any[] = [
        { label: 'Auth rewrite', onClick: () => {} },
        { label: 'Perf: chat list', onClick: () => {} },
        { label: '', separator: true, onClick: () => {} },
        { label: '+ New folder…', keepOnFilter: true, onClick: () => {} },
    ];

    it('is the identity for a blank query, separators included', () => {
        expect(filterSubmenuItems(children, '')).toHaveLength(4);
    });

    it('drops separators and non-matches but keeps the escape hatch', () => {
        expect(filterSubmenuItems(children, 'auth').map(c => c.label)).toEqual(['Auth rewrite', '+ New folder…']);
    });

    it('leaves the escape hatch reachable when nothing matches', () => {
        expect(filterSubmenuItems(children, 'zzz').map(c => c.label)).toEqual(['+ New folder…']);
    });
});
