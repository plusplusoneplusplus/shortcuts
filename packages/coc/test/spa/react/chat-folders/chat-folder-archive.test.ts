/**
 * chat-folder-archive — which of a folder's members an "Archive all chats"
 * touches, and how the confirm and undo toast phrase it (AC-09).
 */
import { describe, it, expect } from 'vitest';
import {
    buildArchiveAllTitle,
    buildArchiveUndoMessage,
    canArchiveFolder,
    formatChatCount,
    resolveFolderArchiveTargets,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-archive';

const MEMBERS = new Map<string, string>([
    ['proc-a', 'folder-auth'],
    ['proc-b', 'folder-auth'],
    ['proc-c', 'folder-auth'],
    ['proc-x', 'folder-perf'],
]);

describe('resolveFolderArchiveTargets', () => {
    it('archives every member of the folder and nothing else', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-auth');
        expect(targets.archivableIds.sort()).toEqual(['proc-a', 'proc-b', 'proc-c']);
        expect(targets.pinnedSkippedIds).toEqual([]);
        expect(targets.alreadyArchivedIds).toEqual([]);
    });

    it('skips pinned members — pinning auto-unarchives, so archiving one would undo itself', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-auth', {
            pinnedIds: new Set(['proc-b']),
        });
        expect(targets.archivableIds.sort()).toEqual(['proc-a', 'proc-c']);
        expect(targets.pinnedSkippedIds).toEqual(['proc-b']);
    });

    it('leaves already-archived members alone', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-auth', {
            archivedIds: new Set(['proc-a', 'proc-c']),
        });
        expect(targets.archivableIds).toEqual(['proc-b']);
        expect(targets.alreadyArchivedIds.sort()).toEqual(['proc-a', 'proc-c']);
    });

    it('counts a member that is both pinned and archived as archived only', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-auth', {
            pinnedIds: new Set(['proc-a']),
            archivedIds: new Set(['proc-a']),
        });
        expect(targets.alreadyArchivedIds).toEqual(['proc-a']);
        expect(targets.pinnedSkippedIds).toEqual([]);
    });

    it('returns nothing for a folder with no members', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-empty');
        expect(targets.archivableIds).toEqual([]);
        expect(canArchiveFolder(targets)).toBe(false);
    });
});

describe('canArchiveFolder', () => {
    it('is false when every member is already archived', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-perf', {
            archivedIds: new Set(['proc-x']),
        });
        expect(canArchiveFolder(targets)).toBe(false);
    });

    it('is false when the only members are pinned', () => {
        const targets = resolveFolderArchiveTargets(MEMBERS, 'folder-perf', {
            pinnedIds: new Set(['proc-x']),
        });
        expect(canArchiveFolder(targets)).toBe(false);
    });

    it('is true as soon as one member can move', () => {
        expect(canArchiveFolder(resolveFolderArchiveTargets(MEMBERS, 'folder-perf'))).toBe(true);
    });
});

describe('copy', () => {
    it('names the count in the confirm title', () => {
        expect(buildArchiveAllTitle(12)).toBe('Archive 12 chats?');
        expect(buildArchiveAllTitle(1)).toBe('Archive 1 chat?');
    });

    it('pluralizes the count', () => {
        expect(formatChatCount(1)).toBe('1 chat');
        expect(formatChatCount(0)).toBe('0 chats');
    });

    it('reports pinned skips in the undo toast, and omits the clause when there are none', () => {
        expect(buildArchiveUndoMessage('Auth rewrite', 3, 0)).toBe('Archived 3 chats in “Auth rewrite”');
        expect(buildArchiveUndoMessage('Auth rewrite', 3, 2)).toBe(
            'Archived 3 chats in “Auth rewrite” · 2 pinned skipped',
        );
    });
});
