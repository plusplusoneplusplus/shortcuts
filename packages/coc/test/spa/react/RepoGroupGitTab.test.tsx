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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// The real panel drags in websockets, clone routing and a dozen git hooks; the
// point here is WHICH workspace id it is handed, so stub it down to that.
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', () => ({
    RepoGitTab: ({ workspaceId }: { workspaceId: string }) => (
        <div data-testid="stub-repo-git-tab" data-workspace={workspaceId} />
    ),
}));

import {
    RepoGroupGitTab,
    resolveRepoGroupGitMember,
} from '../../../src/server/spa/client/react/repos/RepoGroupGitTab';
import type { RepoGroupMember } from '../../../src/server/spa/client/react/repos/repoGroupService';

const GROUP_ID = 'group-frontend';

function member(id: string, overrides: Partial<RepoGroupMember> = {}): RepoGroupMember {
    return { workspaceId: id, name: id, rootPath: `/r/${id}`, ...overrides } as RepoGroupMember;
}

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
