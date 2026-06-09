import { describe, it, expect, beforeEach } from 'vitest';
import {
    clearReviewChatMinimized,
    getCommitChatPlacementStorageKey,
    getReviewChatMinimizedStorageKey,
    getReviewChatOpenStorageKey,
    getReviewChatPlacementStorageKey,
    getReviewChatTargetStorageId,
    isCommitChatPinned,
    isReviewChatPinned,
    pinCommitChat,
    pinReviewChat,
    readCommitChatOpen,
    readReviewChatMinimized,
    readReviewChatOpen,
    resolveCommitChatPresentation,
    resolveReviewChatPresentation,
    unpinCommitChat,
    unpinReviewChat,
    writeCommitChatOpen,
    writeReviewChatMinimized,
    writeReviewChatOpen,
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

    it('scopes Work Item review-chat storage by workspace and work item', () => {
        const target = { type: 'work-item' as const, workspaceId: 'repo/one', workItemId: 'WI:123' };

        expect(getReviewChatTargetStorageId(target)).toBe('work-item.repo%2Fone.WI%3A123');
        expect(getReviewChatOpenStorageKey(target)).toBe('coc.reviewChat.open.work-item.repo%2Fone.WI%3A123');
        expect(getReviewChatPlacementStorageKey(target)).toBe('coc.reviewChat.placement.work-item.repo%2Fone.WI%3A123');
        expect(getReviewChatMinimizedStorageKey(target)).toBe('coc.reviewChat.minimized.work-item.repo%2Fone.WI%3A123');
    });

    it('updates only the matching Work Item review-chat open, minimized, and pinned state', () => {
        const targetOne = { type: 'work-item' as const, workspaceId: 'repo/one', workItemId: 'WI:123' };
        const targetTwo = { type: 'work-item' as const, workspaceId: 'repo/one', workItemId: 'WI:456' };
        const otherWorkspaceTarget = { type: 'work-item' as const, workspaceId: 'repo/two', workItemId: 'WI:123' };

        writeReviewChatOpen(targetOne, true);
        writeReviewChatMinimized(targetOne, true);
        writeReviewChatOpen(targetTwo, true);
        writeReviewChatMinimized(targetTwo, true);
        writeReviewChatOpen(otherWorkspaceTarget, true);
        writeReviewChatMinimized(otherWorkspaceTarget, true);

        pinReviewChat(targetOne);

        expect(readReviewChatOpen(targetOne)).toBe(true);
        expect(isReviewChatPinned(targetOne)).toBe(true);
        expect(readReviewChatMinimized(targetOne)).toBe(false);
        expect(readReviewChatOpen(targetTwo)).toBe(true);
        expect(readReviewChatMinimized(targetTwo)).toBe(true);
        expect(readReviewChatOpen(otherWorkspaceTarget)).toBe(true);
        expect(readReviewChatMinimized(otherWorkspaceTarget)).toBe(true);

        unpinReviewChat(targetOne);
        writeReviewChatOpen(targetOne, false);
        clearReviewChatMinimized(targetOne);

        expect(readReviewChatOpen(targetOne)).toBe(false);
        expect(isReviewChatPinned(targetOne)).toBe(false);
        expect(readReviewChatMinimized(targetOne)).toBe(false);
        expect(readReviewChatOpen(targetTwo)).toBe(true);
        expect(readReviewChatMinimized(targetTwo)).toBe(true);
        expect(readReviewChatOpen(otherWorkspaceTarget)).toBe(true);
        expect(readReviewChatMinimized(otherWorkspaceTarget)).toBe(true);
    });

    it('keeps Work Item lens presentation on non-desktop when requested', () => {
        expect(resolveReviewChatPresentation({
            lensEnabled: true,
            isDesktop: false,
            pinned: false,
            forceLensOnNonDesktop: true,
        })).toBe('lens');

        expect(resolveReviewChatPresentation({
            lensEnabled: true,
            isDesktop: false,
            pinned: true,
            forceLensOnNonDesktop: true,
        })).toBe('side-panel');
    });
});
