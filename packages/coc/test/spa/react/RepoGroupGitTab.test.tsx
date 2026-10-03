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
import type { ReactNode } from 'react';

// The real panel drags in websockets, clone routing and a dozen git hooks; the
// point here is WHICH workspace id it is handed, so stub it down to that. The
// stub is deliberately STATEFUL — it records every mount and holds a scratch
// value — so the tests below can prove the host remounts it per member instead
// of leaking one repo's panel state into the next.
const panelMounts: string[] = [];
const panelProps: Record<string, unknown>[] = [];
vi.mock('../../../src/server/spa/client/react/features/git/RepoGitTab', async () => {
    const { useEffect, useState } = await import('react');
    return {
        RepoGitTab: (props: { workspaceId: string; repositorySelector?: ReactNode }) => {
            const { workspaceId, repositorySelector } = props;
            const [scratch, setScratch] = useState('clean');
            panelProps.push(props);
            useEffect(() => {
                panelMounts.push(workspaceId);
            }, [workspaceId]);
            return (
                <div data-testid="stub-repo-git-tab" data-workspace={workspaceId} data-scratch={scratch}>
                    <div data-testid="stub-git-toolbar">{repositorySelector}</div>
                    <button type="button" data-testid="stub-panel-dirty" onClick={() => setScratch('dirty')}>
                        dirty
                    </button>
                </div>
            );
        },
    };
});

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

function openMemberPicker() {
    fireEvent.click(screen.getByTestId('repo-group-git-member-trigger'));
}

function selectMember(id: string) {
    openMemberPicker();
    fireEvent.click(screen.getByTestId(`repo-group-git-member-${id}`));
}

beforeEach(() => {
    wsListener = undefined;
    panelMounts.length = 0;
    panelProps.length = 0;
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
    it('uses one listbox inside the Git toolbar and switches the hosted panel', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);

        const picker = screen.getByTestId('repo-group-git-member-trigger');
        expect(screen.getAllByTestId('repo-group-git-member-trigger')).toHaveLength(1);
        openMemberPicker();
        expect(screen.getAllByRole('option')).toHaveLength(2);
        expect(screen.queryByRole('tablist', { name: 'Member repositories' })).toBeNull();
        expect(screen.getByTestId('stub-git-toolbar').contains(picker)).toBe(true);
        expect(screen.getByTestId('repo-group-git-member-picker').getAttribute('data-selected-member')).toBe('repo-a');
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');

        fireEvent.click(screen.getByTestId('repo-group-git-member-repo-b'));

        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-b');
        expect(screen.getByTestId('repo-group-git-member-picker').getAttribute('data-selected-member')).toBe('repo-b');
    });

    it('reads every badge from ONE batch request, not one call per member', async () => {
        batchSpy.mockResolvedValue({
            results: {
                'repo-a': gitInfo({ branch: 'feature/x', dirty: true, ahead: 2 }),
                'repo-b': gitInfo({ branch: 'main', behind: 3 }),
            },
        });

        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        openMemberPicker();

        await waitFor(() => expect(screen.getByTestId('repo-group-git-member-repo-a').textContent).toContain('feature/x'));
        expect(batchSpy).toHaveBeenCalledTimes(1);
        expect(batchSpy.mock.calls[0][0]).toEqual(['repo-a', 'repo-b']);
        expect(singleSpy).not.toHaveBeenCalled();

        expect(screen.getByTestId('repo-group-git-member-repo-b').textContent).toContain('↓3');
    });

    it('refreshes just the changed member on a git-changed event', async () => {
        batchSpy.mockResolvedValue({ results: { 'repo-a': gitInfo({ ahead: 1 }), 'repo-b': gitInfo() } });
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        openMemberPicker();
        await waitFor(() => expect(screen.getByTestId('repo-group-git-member-repo-a').textContent).toContain('↑1'));

        singleSpy.mockResolvedValue(gitInfo({ ahead: 0 }));
        await act(async () => { wsListener?.({ type: 'git-changed', workspaceId: 'repo-a' }); });

        await waitFor(() => expect(screen.getByTestId('repo-group-git-member-repo-a').textContent).not.toContain('↑1'));
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

    it('disables unavailable options and explains why they cannot be selected', async () => {
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

        openMemberPicker();
        const gone = screen.getByTestId('repo-group-git-member-gone') as HTMLButtonElement;
        expect(gone.disabled).toBe(true);
        expect(gone.textContent).toContain('Workspace removed');
        expect((screen.getByTestId('repo-group-git-member-moved') as HTMLButtonElement).disabled).toBe(true);

        fireEvent.click(gone);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');

        // Stale members are never sent to the batch — they have no worktree.
        await waitFor(() => expect(batchSpy).toHaveBeenCalledTimes(1));
        expect(batchSpy.mock.calls[0][0]).toEqual(['repo-a']);
    });

    it('falls back to the first healthy member when the selected one goes stale', () => {
        const healthy = [member('repo-a'), member('repo-b')];
        const { rerender } = render(<RepoGroupGitTab workspaceId={GROUP_ID} members={healthy} />);
        selectMember('repo-b');
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
        openMemberPicker();
        expect(screen.getByTestId('repo-group-git-member-gone')).toBeTruthy();
        expect(screen.getByTestId('repo-group-git-member-picker').getAttribute('data-selected-member')).toBe('');
        expect(screen.getByTestId('repo-group-git-member-label').textContent).toBe('No usable repositories');
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('disables the selector when the group has no members', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[]} />);
        expect((screen.getByTestId('repo-group-git-member-trigger') as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByTestId('repo-group-git-empty')).toBeTruthy();
        expect(batchSpy).not.toHaveBeenCalled();
    });

    it('uses workspace ids to distinguish repositories with the same name', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[
            member('repo-a', { name: 'api' }), member('repo-b', { name: 'api' }),
        ]} />);
        openMemberPicker();
        expect(screen.getAllByRole('option').filter(option => option.textContent?.includes('api'))).toHaveLength(2);
        fireEvent.click(screen.getByTestId('repo-group-git-member-repo-b'));
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-b');
    });

    it('preserves keyboard focus when switching remounts the hosted panel', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        const picker = screen.getByTestId('repo-group-git-member-trigger');
        picker.focus();
        selectMember('repo-b');
        const nextPicker = screen.getByTestId('repo-group-git-member-trigger');
        expect(nextPicker).not.toBe(picker);
        expect(document.activeElement).toBe(nextPicker);
        selectMember('repo-a');
        expect(document.activeElement).toBe(screen.getByTestId('repo-group-git-member-trigger'));
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-a');
    });
});

describe('RepoGroupGitTab panel isolation across members (AC-03)', () => {
    /**
     * The manual demo's step (e)/(f): after working in member A, switching to B
     * must not show A's panel state, and coming back to A must not show B's.
     * The host gets that from `key={selectedId}` — without the key, React would
     * reuse one panel instance and carry its state across repos. These tests
     * fail the moment that key is dropped.
     */
    it('remounts the panel per member so no state leaks between repos', () => {
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />);
        expect(panelMounts).toEqual(['repo-a']);

        // Dirty up member A's panel.
        fireEvent.click(screen.getByTestId('stub-panel-dirty'));
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-scratch')).toBe('dirty');

        // Switch to B: a brand new panel, none of A's state.
        selectMember('repo-b');
        expect(panelMounts).toEqual(['repo-a', 'repo-b']);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-workspace')).toBe('repo-b');
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-scratch')).toBe('clean');

        // Back to A: also a fresh mount, so B's state cannot follow either.
        selectMember('repo-a');
        expect(panelMounts).toEqual(['repo-a', 'repo-b', 'repo-a']);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-scratch')).toBe('clean');
    });

    it('keeps a single panel mounted — one repo at a time, never the group id', () => {
        render(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[member('repo-a'), member('repo-b'), member('repo-c')]}
            />
        );
        expect(screen.getAllByTestId('stub-repo-git-tab')).toHaveLength(1);
        selectMember('repo-c');
        expect(screen.getAllByTestId('stub-repo-git-tab')).toHaveLength(1);
        expect(panelMounts).toEqual(['repo-a', 'repo-c']);
        expect(panelMounts).not.toContain(GROUP_ID);
    });

    it('does not remount the panel when an unrelated member goes stale', () => {
        const { rerender } = render(
            <RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a'), member('repo-b')]} />
        );
        fireEvent.click(screen.getByTestId('stub-panel-dirty'));
        expect(panelMounts).toEqual(['repo-a']);

        rerender(
            <RepoGroupGitTab
                workspaceId={GROUP_ID}
                members={[member('repo-a'), member('repo-b', { stale: true, staleReason: 'path-missing' })]}
            />
        );

        // Selection is unchanged, so the user's in-progress panel survives.
        expect(panelMounts).toEqual(['repo-a']);
        expect(screen.getByTestId('stub-repo-git-tab').getAttribute('data-scratch')).toBe('dirty');
    });
});

describe('RepoGroupGitTab — Workspace host', () => {
    it('passes the split layout and shared detail host to the selected member', () => {
        const detailContainer = document.createElement('div');
        render(<RepoGroupGitTab workspaceId={GROUP_ID} members={[member('repo-a')]}
            layout="split-workspace" detailContainer={detailContainer} detailActive />);
        expect(panelProps.length).toBeGreaterThan(0);
        for (const props of panelProps) {
            expect(props.workspaceId).toBe('repo-a');
            expect(props.layout).toBe('split-workspace');
            expect(props.detailContainer).toBe(detailContainer);
            expect(props.detailActive).toBe(true);
        }
    });
});
