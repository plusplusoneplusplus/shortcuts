import { describe, it, expect, beforeEach } from 'vitest';
import {
    getCommitChatPlacementStorageKey,
    isCommitChatPinned,
    pinCommitChat,
    readCommitChatOpen,
    resolveCommitChatPresentation,
    unpinCommitChat,
    writeCommitChatOpen,
} from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

describe('commit chat placement', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('preserves the legacy global open state key', () => {
        expect(readCommitChatOpen()).toBe(false);

        writeCommitChatOpen(true);
        expect(localStorage.getItem('coc.commitChat.open')).toBe('true');
        expect(readCommitChatOpen()).toBe(true);

        writeCommitChatOpen(false);
        expect(localStorage.getItem('coc.commitChat.open')).toBe('false');
        expect(readCommitChatOpen()).toBe(false);
    });

    it('scopes pinned side-panel placement by workspace and commit', () => {
        pinCommitChat('ws-one', 'commit-one');

        expect(isCommitChatPinned('ws-one', 'commit-one')).toBe(true);
        expect(isCommitChatPinned('ws-one', 'commit-two')).toBe(false);
        expect(isCommitChatPinned('ws-two', 'commit-one')).toBe(false);
    });

    it('removes only the matching workspace and commit pin when unpinned', () => {
        pinCommitChat('ws-one', 'commit-one');
        pinCommitChat('ws-one', 'commit-two');

        unpinCommitChat('ws-one', 'commit-one');

        expect(isCommitChatPinned('ws-one', 'commit-one')).toBe(false);
        expect(isCommitChatPinned('ws-one', 'commit-two')).toBe(true);
    });

    it('uses encoded localStorage keys for workspace and commit identifiers', () => {
        const key = getCommitChatPlacementStorageKey('repo/one', 'abc:def');

        expect(key).toBe('coc.commitChat.placement.repo%2Fone.abc%3Adef');
    });

    it('resolves legacy side-panel presentation when the flag is disabled', () => {
        expect(resolveCommitChatPresentation({
            lensEnabled: false,
            isDesktop: true,
            pinned: false,
        })).toBe('side-panel');
    });

    it('resolves lens presentation for unpinned desktop commit chat when enabled', () => {
        expect(resolveCommitChatPresentation({
            lensEnabled: true,
            isDesktop: true,
            pinned: false,
        })).toBe('lens');
    });

    it('resolves side-panel presentation for pinned or non-desktop commit chat', () => {
        expect(resolveCommitChatPresentation({
            lensEnabled: true,
            isDesktop: true,
            pinned: true,
        })).toBe('side-panel');

        expect(resolveCommitChatPresentation({
            lensEnabled: true,
            isDesktop: false,
            pinned: false,
        })).toBe('side-panel');
    });
});
