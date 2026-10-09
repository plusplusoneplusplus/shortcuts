import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/features/git/commits/CommitList';
import type { RepoGitDetailPaneProps } from '../../../../src/server/spa/client/react/features/git/repoGitTab/RepoGitDetailPane';
import type { UseCommitChatPresentationReturn } from '../../../../src/server/spa/client/react/features/git/hooks/useCommitChatPresentation';

import { attachSelectionToChat, resetActiveChatAttach, subscribeActiveChatAttach } from '../../../../src/server/spa/client/react/features/chat/activeChatAttach';
import { createFileSelectionContextPayload } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { resetNewChatSeedContext } from '../../../../src/server/spa/client/react/features/chat/newChatSeedContext';

const mounts = vi.fn();
const unmounts = vi.fn();
let lensEnabled = true;
vi.mock('../../../../src/server/spa/client/react/utils/config', async importOriginal => ({
    ...await importOriginal<typeof import('../../../../src/server/spa/client/react/utils/config')>(),
    isCommitChatLensEnabled: () => lensEnabled,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isDesktop: true, isMobile: false, isTablet: false }),
}));
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({ width: 360, handleMouseDown: vi.fn(), handleTouchStart: vi.fn() }),
}));
function Chat({ workspaceId, commitHash, sourceSelectionId }: { workspaceId: string; commitHash: string; sourceSelectionId?: string }) {
    const [snippet, setSnippet] = useState('');
    useEffect(() => {
        const subscription = subscribeActiveChatAttach(sourceSelectionId ?? workspaceId, payload => {
            if (payload.kind !== 'coc.file-selection-context' || payload.sourceWorkspaceId !== workspaceId) return false;
            setSnippet(payload.snippet); return true;
        });
        return subscription.unsubscribe;
    }, [sourceSelectionId, workspaceId]);
    useEffect(() => {
        mounts(workspaceId, commitHash);
        return () => { unmounts(workspaceId, commitHash); };
    }, []);
    return <div data-testid="conversation"><input aria-label="Chat draft" defaultValue="" /><span data-testid="attached-snippet">{snippet}</span></div>;
}
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPanel', () => ({ CommitChatPanel: Chat }));
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitChatPlacementFrame', () => ({
    CommitChatPlacementFrame: (props: { workspaceId: string; commitHash: string; sourceSelectionId?: string; onPin?: () => void; onUnpin?: () => void }) => <>
        {props.onPin && <button onClick={props.onPin}>Pin chat</button>}
        {props.onUnpin && <button onClick={props.onUnpin}>Unpin chat</button>}
        <Chat {...props} />
    </>,
}));
function Diff({ reviewChat, filePath }: { reviewChat: UseCommitChatPresentationReturn; filePath?: string }) {
    return <><button onClick={reviewChat.toggleChat}>Toggle chat</button>
        <input aria-label="Diff instance" defaultValue="" /><span>{filePath ?? 'Overview'}</span></>;
}
vi.mock('../../../../src/server/spa/client/react/features/git/commits/CommitDetail', () => ({ CommitDetail: Diff }));
vi.mock('../../../../src/server/spa/client/react/features/git/diff/FileDiffPanel', () => ({ FileDiffPanel: Diff }));
vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchRangeOverview', () => ({ BranchRangeOverview: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/git/branches/BranchRangeAllComments', () => ({ BranchRangeAllComments: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeFileDiff', () => ({ WorkingTreeFileDiff: () => null }));
vi.mock('../../../../src/server/spa/client/react/features/git/working-tree/WorkingTreeAllComments', () => ({ WorkingTreeAllComments: () => null }));

import { RepoGitDetailPane } from '../../../../src/server/spa/client/react/features/git/repoGitTab/RepoGitDetailPane';

const commit: GitCommitItem = { hash: 'abc123', shortHash: 'abc123', subject: 'Review me', author: 'Author', date: '2026-10-07', parentHashes: [] };
function props(view: RepoGitDetailPaneProps['view'], workspaceId = 'ws-a'): RepoGitDetailPaneProps {
    return {
        workspaceId, view, commits: [commit], unpushedCount: 0,
        branchRangeData: null, branchRangeFiles: [], baseMode: 'default-branch',
        onBaseModeChange: vi.fn(), repoRoot: '', hunkTarget: undefined, onBranchFileSelect: vi.fn(),
        onNavigateToBranchFile: vi.fn(), onNavigateToCommitFile: vi.fn(),
        onNavigateToWorkingTreeFile: vi.fn(), onAllBranchCommentsClick: vi.fn(), onBranchAskAI: vi.fn(), onCommitClassified: vi.fn(),
    };
}
const file = (path: string): RepoGitDetailPaneProps['view'] => ({ type: 'commit-file', hash: commit.hash, filePath: path });

beforeEach(() => {
    localStorage.clear();
    resetActiveChatAttach();
    resetNewChatSeedContext();
    vi.clearAllMocks();
    lensEnabled = true;
});

describe('commit review lifetime', () => {
    it.each(['lens', 'pinned', 'legacy'] as const)('%s preserves the chat across overview and file navigation', placement => {
        lensEnabled = placement !== 'legacy';
        const view = render(<RepoGitDetailPane {...props({ type: 'commit', commit })} />);
        fireEvent.click(screen.getByText('Toggle chat'));
        if (placement === 'pinned') fireEvent.click(screen.getByText('Pin chat'));
        const conversation = screen.getByTestId('conversation');
        const draft = screen.getByLabelText('Chat draft');
        fireEvent.change(draft, { target: { value: 'Keep this draft' } });
        conversation.scrollTop = 123;
        const initialMounts = mounts.mock.calls.length;
        for (const selection of [file('src/a.ts'), file('src/b.ts'), { type: 'commit' as const, commit }]) {
            view.rerender(<RepoGitDetailPane {...props(selection)} />);
            expect(screen.getByTestId('conversation')).toBe(conversation);
            expect(screen.getByLabelText('Chat draft')).toBe(draft);
            expect(draft).toHaveValue('Keep this draft');
            expect(conversation.scrollTop).toBe(123);
            expect(mounts).toHaveBeenCalledTimes(initialMounts);
        }
        fireEvent.click(screen.getByText('Toggle chat'));
        expect(screen.queryByTestId('conversation')).toBeNull();
    });

    it('preserves the file panel instance when switching files within the commit', () => {
        const view = render(<RepoGitDetailPane {...props(file('src/a.ts'))} />);
        const instance = screen.getByLabelText('Diff instance');
        view.rerender(<RepoGitDetailPane {...props(file('src/b.ts'))} />);
        expect(screen.getByLabelText('Diff instance')).toBe(instance);
        expect(screen.getByText('src/b.ts')).toBeTruthy();
    });

    it.each(['workspace', 'commit'] as const)('isolates chat and editor state on a %s change', scope => {
        const view = render(<RepoGitDetailPane {...props(file('src/a.ts'))} />);
        fireEvent.click(screen.getByText('Toggle chat'));
        fireEvent.change(screen.getByLabelText('Chat draft'), { target: { value: 'Private draft' } });
        const oldInstance = screen.getByLabelText('Diff instance');
        const next = scope === 'workspace' ? props(file('src/a.ts'), 'ws-b')
            : props({ type: 'commit-file', hash: 'def456', filePath: 'src/a.ts' });
        view.rerender(<RepoGitDetailPane {...next} />);
        expect(screen.queryByTestId('conversation')).toBeNull();
        expect(screen.getByLabelText('Diff instance')).not.toBe(oldInstance);
        expect(unmounts).toHaveBeenCalledWith('ws-a', commit.hash);
        fireEvent.click(screen.getByText('Toggle chat'));
        expect(screen.getByLabelText('Chat draft')).toHaveValue('');
        expect(mounts).toHaveBeenLastCalledWith(next.workspaceId, scope === 'commit' ? 'def456' : commit.hash);
    });
});

describe('inline commit attachment owner', () => {
    it.each(['lens', 'pinned', 'legacy'] as const)('%s routes clone selections and resets a colliding server owner', placement => {
        lensEnabled = placement !== 'legacy';
        const first = { ...props(file('src/a.ts')), attachmentDestinationId: 'remote:one:ws-a' };
        const view = render(<RepoGitDetailPane {...first} />);
        const open = () => {
            fireEvent.click(screen.getByText('Toggle chat'));
            if (placement === 'pinned') fireEvent.click(screen.getByText('Pin chat'));
        };
        open();
        const payload = createFileSelectionContextPayload({ sourceWorkspaceId: 'ws-a', filePath: 'src/a.ts',
            range: { start: 1, end: 1 }, snippet: 'first server' })!;
        act(() => { expect(attachSelectionToChat('remote:two:ws-a', payload)).toBe('new-chat'); });
        expect(screen.getByTestId('attached-snippet')).toHaveTextContent('');
        act(() => { expect(attachSelectionToChat(first.attachmentDestinationId, payload)).toBe('active-chat'); });
        expect(screen.getByTestId('attached-snippet')).toHaveTextContent('first server');
        fireEvent.change(screen.getByLabelText('Chat draft'), { target: { value: 'Private draft' } });
        const previousConversation = screen.getByTestId('conversation');
        view.rerender(<RepoGitDetailPane {...first} attachmentDestinationId="remote:two:ws-a" />);
        expect(screen.getByTestId('conversation')).not.toBe(previousConversation);
        expect(screen.getByLabelText('Chat draft')).toHaveValue('');
        act(() => { expect(attachSelectionToChat(first.attachmentDestinationId, payload)).toBe('new-chat'); });
        act(() => { expect(attachSelectionToChat('remote:two:ws-a', { ...payload, snippet: 'second server' })).toBe('active-chat'); });
        expect(screen.getByTestId('attached-snippet')).toHaveTextContent('second server');
    });
});
