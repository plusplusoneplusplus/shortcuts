/**
 * RepoGroupGitTab — the Git tab a repo group hosts (AC-01).
 *
 * The group itself is never a git repo: the tab picks one healthy member and
 * renders the ordinary single-repo `RepoGitTab` against that member's id. These
 * tests pin the selection rules and the fact that the reused panel — not a
 * group-specific reimplementation — is what gets mounted.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// The real panel drags in websockets, clone routing and a dozen git hooks; the
// point here is WHICH workspace id it is handed, so stub it down to that.
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-repo-git-tab" data-workspace={workspaceId} />
    ),
}));

// Badge plumbing: one batch call plus targeted refreshes driven by `git-changed`.
const batchSpy = vi.fn();
const singleSpy = vi.fn();
vi.mock('../../../src/server/spa/client/react/repos/repositoryService', () => ({
    getWorkspaceGitInfoBatch: (...args: unknown[]) => batchSpy(...args),
    getWorkspaceGitInfo: (...args: unknown[]) => singleSpy(...args),
}));

// Capture the websocket subscriber so a test can push a `git-changed` frame.
let wsListener: ((msg: unknown) => void) | undefined;
vi.mock('../../../src/server/spa/client/react/hooks/useWebSocket', () => ({
    useWebSocket: ({ onMessage }: { onMessage: (msg: unknown) => void }) => {
        wsListener = onMessage;
        return { status: 'open' };
    },
}));

function gitInfo(overrides: Record<string, unknown> = {}) {
    return { branch: 'main', dirty: false, ahead: 0, behind: 0, isGitRepo: true, remoteUrl: null, ...overrides };
}

import {
    RepoGroupGitTab,
    resolveRepoGroupGitMember,
} from '../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import type { RepoGroupMember } from '../../../src/server/spa/client/react/repos/repoGroupService';

const GROUP_ID = 'group-frontend';

function member(id: string, overrides: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: id, name: id, rootPath: `/r/${id}`, ...overrides } as RepoGroupMember;
}

beforeEach(() => {
    wsListener = undefined;
    batchSpy.mockReset();
    singleSpy.mockReset();
    batchSpy.mockResolvedValue({ results: {} });
    singleSpy.mockResolvedValue(gitInfo());
});

afterEach(() => cleanup());

describe('resolveRepoGroupGitMember', () => {
    it('picks the first member when nothing is preferred', () => {
        expect(resolveRepoGroupGitMember([member('a'), member('b')], null)).toBe('a');
    });

    it('honours a preferred member that is still healthy', () => {
        expect(resolveRepoGroupGitMember([member('a'), member('b')], 'b')).toBe('b');
    });

    it('skips stale members entirely', () => {
        const members = [
            member('a', { stale: true, staleReason: 'workspace-removed' }),
            member('b', { stale: true, staleReason: 'path-missing' }),
            member('c'),
        ];
        expect(resolveRepoGroupGitMember(members, null)).toBe('c');
        expect(resolveRepoGroupGitMember(members, 'a')).toBe('c');
    });

    it('returns undefined when the group has no usable member', () => {
        expect(resolveRepoGroupGitMember([], null)).toBeUndefined();
        expect(resolveRepoGroupGitMember(undefined, 'a')).toBeUndefined();
        expect(resolveRepoGroupGitMember([member('a', { stale: true, staleReason: 'path-missing' })], null))
            .toBeUndefined();
    });
});

describe('RepoGroupGitTab', () => {
    it('mounts the reused single-repo git panel against the first healthy member', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');
        // Never the group id itself — the group root is not a git repo.
        expect(screen.getByTestId('repo-group-git-tab').getAttribute('data-group')).toBe(GROUP_ID);
    });

    it('shows a loading state while membership is still being read', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={undefined} />);
        expect(screen.getByTestId('repo-group-git-loading')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
    });

    it('renders an empty state, not a git panel, when every member is stale', () => {
        render(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[member('gone', { stale: true, staleReason: 'workspace-removed' })]}
            />
        );
        expect(screen.getByTestId('repo-group-git-empty')).toBeTruthy();
        expect(screen.queryByTestId('stub-repo-git-tab')).toBeNull();
    });
});

describe('RepoGroupGitTab member picker (AC-02)', () => {
    it('lists every member and switches the hosted panel on click', async () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);

        expect(screen.getByTestId('repo-group-git-member-picker')).toBeTruthy();
        expect(screen.getByTestId('repo-group-git-member-repo-a').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');

        fireEvent.click(screen.getByTestId('repo-group-git-member-repo-b'));

        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-b');
        expect(screen.getByTestId('repo-group-git-member-repo-b').getAttribute('data-selected')).toBe('true');
        expect(screen.getByTestId('repo-group-git-member-repo-a').getAttribute('data-selected')).toBe('false');
    });

    it('reads every badge from ONE batch request, not one call per member', async () => {
        batchSpy.mockResolvedValue({
            results: {
                'repo-a': gitInfo({ branch: 'feature/x', dirty: true, ahead: 2 }),
                'repo-b': gitInfo({ branch: 'main', behind: 3 }),
            },
        });

        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);

        await waitFor(() => expect(screen.getByTestId('repo-group-git-member-badge-repo-a')).toBeTruthy());
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy.mock.calls[0][0]).toEqual(['repo-a', 'repo-b']);
        expect(singleSpy).not.toHaveBeenCalled();

        expect(screen.getByTestId('repo-group-git-member-badge-repo-a').textContent).toContain('feature/x');
        expect(screen.getByTestId('repo-group-git-member-dirty-repo-a')).toBeTruthy();
        expect(screen.getByTestId('repo-group-git-member-ahead-repo-a').textContent).toContain('2');
        expect(screen.getByTestId('repo-group-git-member-behind-repo-b').textContent).toContain('3');
        expect(screen.queryByTestId('repo-group-git-member-dirty-repo-b')).toBeNull();
    });

    it('refreshes just the changed member on a git-changed event', async () => {
        batchSpy.mockResolvedValue({ results: { 'repo-a': gitInfo({ ahead: 1 }), 'repo-b': gitInfo() } });
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        await waitFor(() => expect(screen.getByTestId('repo-group-git-member-ahead-repo-a')).toBeTruthy());

        singleSpy.mockResolvedValue(gitInfo({ ahead: 0 }));
        await act(async () => { wsListener?.({ type: 'git-changed', workspaceId: 'repo-a' }); });

        await waitFor(() => expect(screen.queryByTestId('repo-group-git-member-ahead-repo-a')).toBeNull());
        expect(singleSpy).toHaveBeenCalledTimes(1);
        expect(singleSpy).toHaveBeenCalledWith('repo-a');
        expect(batchSpy).toHaveBeenCalledTimes(1);
    });

    it('ignores git-changed for a workspace outside the group', async () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a')]} />);
        await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));

        await act(async () => { wsListener?.({ type: 'git-changed', workspaceId: 'some-other-repo' }); });

        expect(singleSpy).not.toHaveBeenCalled();
    });

    it('lists stale members as disabled rows carrying the stale badge', async () => {
        render(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[
                    member('repo-a'),
                    member('gone', { stale: true, staleReason: 'workspace-removed' }),
                    member('moved', { stale: true, staleReason: 'path-missing' }),
                ]}
            />
        );

        const gone = screen.getByTestId('repo-group-git-member-gone') as HTMLButtonElement;
        expect(gone.disabled).toBe(true);
        expect(gone.textContent).toContain('removed');
        expect((screen.getByTestId('repo-group-git-member-moved') as HTMLButtonElement).textContent)
            .toContain('path missing');

        fireEvent.click(gone);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');

        // Stale members are never sent to the batch — they have no worktree.
        await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
        expect(batchSpy.mock.calls[0][0]).toEqual(['repo-a']);
    });

    it('falls back to the first healthy member when the selected one goes stale', () => {
        const healthy = [member('repo-a'), member('repo-b')];
        const { rerender } = render(<RepoGroupGitTab workspaceId={GROUP_ID} members={healthy} />);
        fireEvent.click(screen.getByTestId('repo-group-git-member-repo-b'));
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-b');

        rerender(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[member('repo-a'), member('repo-b', { stale: true, staleReason: 'path-missing' })]}
            />
        );

        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');
    });

    it('still lists the members when every one of them is stale', () => {
        render(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[member('gone', { stale: true, staleReason: 'workspace-removed' })]}
            />
        );
        expect(screen.getByTestId('repo-group-git-empty')).toBeTruthy();
        expect(screen.getByTestId('repo-group-git-member-gone')).toBeTruthy();
        expect(batchSpy).not.toHaveBeenCalled();
    });
});
