import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getReviewChatOpenStorageKey,
    getReviewChatPlacementStorageKey,
    isCommitChatPinned,
    isReviewChatPinned,
    pinReviewChat,
    readReviewChatOpen,
    resolveReviewChatPresentation,
    unpinReviewChat,
    writeReviewChatOpen,
    type ReviewChatTarget,
} from '../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';
import { ReviewChatPlacementFrame } from '../../../src/server/spa/client/react/features/git/reviewChat/ReviewChatPlacementFrame';

beforeEach(() => {
    localStorage.clear();
});

describe('review chat placement storage', () => {
    it('resolves lens only when the feature is enabled, desktop, and unpinned', () => {
        expect(resolveReviewChatPresentation({ lensEnabled: false, isDesktop: true, pinned: false })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: false, pinned: false })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: true, pinned: true })).toBe('side-panel');
        expect(resolveReviewChatPresentation({ lensEnabled: true, isDesktop: true, pinned: false })).toBe('lens');
    });

    it('scopes open state by review target and workspace', () => {
        const first: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        const sameCommitOtherWorkspace: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-b', commitHash: 'abc123' };

        writeReviewChatOpen(first, true);

        expect(readReviewChatOpen(first)).toBe(true);
        expect(readReviewChatOpen(sameCommitOtherWorkspace)).toBe(false);
    });

    it('builds PR storage keys with workspace, repo, PR id, and head SHA', () => {
        const target: ReviewChatTarget = {
            type: 'pr',
            workspaceId: 'ws-a',
            repoId: 'repo-a',
            prId: '#123',
            headSha: 'head/sha',
        };

        expect(getReviewChatOpenStorageKey(target)).toBe('coc.reviewChat.open.pr.ws-a.repo-a.%23123.head%2Fsha');
        expect(getReviewChatPlacementStorageKey(target)).toBe('coc.reviewChat.placement.pr.ws-a.repo-a.%23123.head%2Fsha');
        expect(getReviewChatPlacementStorageKey({ ...target, headSha: undefined })).toBe('coc.reviewChat.placement.pr.ws-a.repo-a.%23123.current');
    });

    it('scopes pinned placement by review target and preserves legacy commit pinned reads', () => {
        const commit: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-a', commitHash: 'abc123' };
        const otherWorkspace: ReviewChatTarget = { type: 'commit', workspaceId: 'ws-b', commitHash: 'abc123' };
        const pr: ReviewChatTarget = { type: 'pr', workspaceId: 'ws-a', repoId: 'repo-a', prId: '123', headSha: 'sha-a' };

        pinReviewChat(commit);
        pinReviewChat(pr);

        expect(isReviewChatPinned(commit)).toBe(true);
        expect(isReviewChatPinned(pr)).toBe(true);
        expect(isReviewChatPinned(otherWorkspace)).toBe(false);

        unpinReviewChat(commit);
        expect(isReviewChatPinned(commit)).toBe(false);

        localStorage.setItem('coc.commitChat.placement.ws-a.abc123', 'side-panel');
        expect(isCommitChatPinned('ws-a', 'abc123')).toBe(true);
    });
});

describe('ReviewChatPlacementFrame', () => {
    it('renders shared lens chrome with contextual title, identifier, close, and pin controls', () => {
        const onClose = vi.fn();
        const onPin = vi.fn();

        render(
            <ReviewChatPlacementFrame
                title="PR Chat"
                identifier="#123"
                presentation="lens"
                onClose={onClose}
                onPin={onPin}
                testIdPrefix="pr-chat"
            >
                <div data-testid="chat-body">Body</div>
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('pr-chat-lens')).toBeInTheDocument();
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('PR Chat');
        expect(screen.getByTestId('pr-chat-lens-header')).toHaveTextContent('#123');
        expect(screen.getByTestId('chat-body')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('pr-chat-pin-btn'));
        expect(onPin).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByTestId('pr-chat-frame-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders side-panel chrome with an unpin control', () => {
        const onUnpin = vi.fn();

        render(
            <ReviewChatPlacementFrame
                title="Commit Chat"
                identifier="abc1234"
                presentation="side-panel"
                onClose={vi.fn()}
                onUnpin={onUnpin}
                testIdPrefix="commit-chat"
            >
                <div />
            </ReviewChatPlacementFrame>,
        );

        expect(screen.getByTestId('commit-chat-side-panel')).toBeInTheDocument();
        expect(screen.queryByTestId('commit-chat-pin-btn')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('commit-chat-unpin-btn'));
        expect(onUnpin).toHaveBeenCalledTimes(1);
    });
});
