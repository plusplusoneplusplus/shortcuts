/**
 * chat-folder-view-state — per-workspace collapse persistence (AC-04).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    collapseAllChatFolders,
    loadCollapsedChatFolderIds,
    persistCollapsedChatFolderIds,
    toggleCollapsedChatFolder,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-view-state';

describe('chat-folder-view-state', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults every folder to expanded', () => {
        expect(loadCollapsedChatFolderIds('ws-1').size).toBe(0);
    });

    it('round-trips a collapsed set through localStorage', () => {
        persistCollapsedChatFolderIds('ws-1', new Set(['folder-a', 'folder-b']));
        expect([...loadCollapsedChatFolderIds('ws-1')].sort()).toEqual(['folder-a', 'folder-b']);
    });

    it('keys collapse state per workspace, so a repo group keeps its own', () => {
        persistCollapsedChatFolderIds('ws-1', new Set(['folder-a']));
        expect(loadCollapsedChatFolderIds('group-demo').size).toBe(0);
    });

    it('toggles without mutating the input set, and persists', () => {
        const before = new Set<string>();
        const after = toggleCollapsedChatFolder('ws-1', before, 'folder-a');
        expect(before.size).toBe(0);
        expect(after.has('folder-a')).toBe(true);
        expect(loadCollapsedChatFolderIds('ws-1').has('folder-a')).toBe(true);

        const reopened = toggleCollapsedChatFolder('ws-1', after, 'folder-a');
        expect(reopened.has('folder-a')).toBe(false);
        expect(loadCollapsedChatFolderIds('ws-1').size).toBe(0);
    });

    it('collapses every supplied folder at once', () => {
        const collapsed = collapseAllChatFolders('ws-1', ['a', 'b', 'c']);
        expect(collapsed.size).toBe(3);
        expect(loadCollapsedChatFolderIds('ws-1').size).toBe(3);
    });

    it('treats malformed persisted JSON as "nothing collapsed"', () => {
        localStorage.setItem('coc-chat-folder-collapsed:ws-1', '{not json');
        expect(loadCollapsedChatFolderIds('ws-1').size).toBe(0);
        localStorage.setItem('coc-chat-folder-collapsed:ws-1', '{"a":1}');
        expect(loadCollapsedChatFolderIds('ws-1').size).toBe(0);
    });
});
