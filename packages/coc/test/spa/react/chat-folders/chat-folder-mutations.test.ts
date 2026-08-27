/**
 * chat-folder-mutations + the shared name/color validation (AC-05).
 *
 * The optimistic list arithmetic and the input rules are pure, so they are
 * tested here rather than through a render: what a create does to `sortIndex`,
 * what a delete leaves behind for the undo, and exactly which names the client
 * accepts — which must be the same set the server accepts, since both call
 * `normalizeChatFolderName`.
 */
import { describe, it, expect } from 'vitest';
import {
    applyFolderPatch,
    collectFolderMemberIds,
    folderNameExists,
    insertFolderAtTop,
    removeFolderFromList,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-mutations';
import {
    MAX_CHAT_FOLDER_NAME_LENGTH,
    clampChatFolderNameInput,
    normalizeChatFolderColor,
    normalizeChatFolderName,
} from '../../../../src/server/processes/chat-folder-validation';

function folder(id: string, overrides: Record<string, any> = {}): any {
    return {
        id,
        name: id,
        color: 'blue',
        sortIndex: 0,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
        ...overrides,
    };
}

describe('insertFolderAtTop', () => {
    it('puts the new folder at sortIndex 0 and shifts the rest down', () => {
        const existing = [folder('a', { sortIndex: 0 }), folder('b', { sortIndex: 1 })];
        const next = insertFolderAtTop(existing, folder('new'));
        expect(next.map(f => f.id)).toEqual(['new', 'a', 'b']);
        expect(next.map(f => f.sortIndex)).toEqual([0, 1, 2]);
    });

    it('does not duplicate a folder that is already in the list', () => {
        const existing = [folder('a', { sortIndex: 0 })];
        const next = insertFolderAtTop(existing, folder('a', { name: 'renamed' }));
        expect(next).toHaveLength(1);
        expect(next[0].name).toBe('renamed');
    });
});

describe('applyFolderPatch', () => {
    it('patches only the target folder and keeps manual order', () => {
        const existing = [folder('a', { sortIndex: 0 }), folder('b', { sortIndex: 1 })];
        const next = applyFolderPatch(existing, 'b', { name: 'Auth rewrite', color: 'purple' });
        expect(next.map(f => f.id)).toEqual(['a', 'b']);
        expect(next[1]).toMatchObject({ name: 'Auth rewrite', color: 'purple' });
        expect(next[0].name).toBe('a');
    });

    it('is a no-op for an unknown folder id', () => {
        const existing = [folder('a')];
        expect(applyFolderPatch(existing, 'missing', { name: 'x' })).toEqual(existing);
    });
});

describe('removeFolderFromList', () => {
    it('drops the folder', () => {
        expect(removeFolderFromList([folder('a'), folder('b')], 'a').map(f => f.id)).toEqual(['b']);
    });
});

describe('folderNameExists', () => {
    it('matches case-insensitively and ignores surrounding space', () => {
        const folders = [folder('a', { name: 'Auth rewrite' })];
        expect(folderNameExists(folders, '  auth REWRITE ')).toBe(true);
    });

    it('excludes the folder being renamed, so its own name is not "taken"', () => {
        const folders = [folder('a', { name: 'Auth rewrite' })];
        expect(folderNameExists(folders, 'Auth rewrite', 'a')).toBe(false);
    });

    it('never reports an empty name as a duplicate', () => {
        expect(folderNameExists([folder('a', { name: '' })], '   ')).toBe(false);
    });
});

describe('collectFolderMemberIds', () => {
    it('snapshots exactly the processes filed in one folder', () => {
        const map = new Map([['p1', 'f1'], ['p2', 'f2'], ['p3', 'f1']]);
        expect(collectFolderMemberIds(map, 'f1').sort()).toEqual(['p1', 'p3']);
        expect(collectFolderMemberIds(map, 'missing')).toEqual([]);
    });
});

describe('folder name validation (shared with the server)', () => {
    it('trims and accepts a normal name', () => {
        expect(normalizeChatFolderName('  Auth rewrite  ')).toEqual({ ok: true, value: 'Auth rewrite' });
    });

    it('rejects an empty or whitespace-only name — an empty name is a cancel', () => {
        expect(normalizeChatFolderName('   ').ok).toBe(false);
        expect(normalizeChatFolderName(undefined).ok).toBe(false);
    });

    it('strips newlines from a pasted name', () => {
        expect(normalizeChatFolderName('one\ntwo\r\nthree')).toEqual({ ok: true, value: 'one two three' });
    });

    it('rejects a name over the 60-character limit', () => {
        expect(normalizeChatFolderName('x'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH)).ok).toBe(true);
        expect(normalizeChatFolderName('x'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH + 1)).ok).toBe(false);
    });

    it('accepts only the six preset colors', () => {
        expect(normalizeChatFolderColor('purple').ok).toBe(true);
        expect(normalizeChatFolderColor('chartreuse').ok).toBe(false);
    });
});

describe('clampChatFolderNameInput', () => {
    it('caps the typed value at the stored maximum', () => {
        expect(clampChatFolderNameInput('y'.repeat(200))).toHaveLength(MAX_CHAT_FOLDER_NAME_LENGTH);
    });

    it('flattens a multi-line paste to one line', () => {
        expect(clampChatFolderNameInput('one\ntwo')).toBe('one two');
    });

    it('does not trim while typing, so a trailing space survives the keystroke', () => {
        expect(clampChatFolderNameInput('Auth ')).toBe('Auth ');
    });
});
