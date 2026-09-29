// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepoGroupGitMemberPicker } from '../../../../src/server/spa/client/react/repos/RepoGroupGitMemberPicker';
import type { RepoGroupMember } from '../../../../src/server/spa/client/react/repos/repoGroupService';
import type { RepoGroupMemberGitInfo } from '../../../../src/server/spa/client/react/repos/useRepoGroupMemberGitInfo';

const members: RepoGroupMember[] = [
    { workspaceId: 'nccl', name: 'nccl', rootPath: '/repos/nccl', stale: false, readOnly: false },
    { workspaceId: 'nixl', name: 'nixl', rootPath: '/repos/nixl', stale: false, readOnly: false },
    { workspaceId: 'vllm', name: 'vllm', rootPath: '/repos/vllm', stale: false, readOnly: false },
    { workspaceId: 'tensorrt', name: 'TensorRT-LLM', rootPath: '/repos/tensorrt', stale: false, readOnly: false },
    { workspaceId: 'sglang', name: 'sglang', rootPath: '/repos/sglang', stale: false, readOnly: false },
    {
        workspaceId: 'removed',
        name: 'onnxruntime',
        rootPath: '/repos/onnxruntime',
        stale: true,
        staleReason: 'workspace-removed',
        readOnly: false,
    },
];

const gitInfo: RepoGroupMemberGitInfo = {
    nccl: { branch: 'master', dirty: true, ahead: 2, behind: 1, isGitRepo: true, remoteUrl: null },
    nixl: { branch: 'main', dirty: false, ahead: 0, behind: 0, isGitRepo: true, remoteUrl: null },
    vllm: { branch: 'release', dirty: false, ahead: 0, behind: 3, isGitRepo: true, remoteUrl: null },
    tensorrt: { branch: null, dirty: false, isGitRepo: false, remoteUrl: null },
};

function renderPicker(onSelect = vi.fn(), selectedId: string | undefined = 'nccl') {
    render(
        <RepoGroupGitMemberPicker
            members={members}
            selectedId={selectedId}
            onSelect={onSelect}
            gitInfo={gitInfo}
        />,
    );
    return { onSelect, trigger: screen.getByTestId('repo-group-git-member-trigger') };
}

afterEach(cleanup);

describe('RepoGroupGitMemberPicker', () => {
    it('shows the selected repo and its compact Git status in the toolbar', () => {
        const { trigger } = renderPicker();

        expect(screen.getByTestId('repo-group-git-member-label').textContent).toBe('nccl');
        expect(trigger.getAttribute('title')).toBe('/repos/nccl');
        expect(trigger.textContent).toContain('↑2');
        expect(trigger.textContent).toContain('↓1');
        expect(trigger.querySelector('[aria-label="Uncommitted changes"]')).toBeTruthy();
    });

    it('opens a portaled list with separated branch, path, and status details', () => {
        const { trigger } = renderPicker();
        fireEvent.click(trigger);

        const list = screen.getByTestId('repo-group-git-member-list');
        expect(list.parentElement).toBe(document.body);
        expect(list.getAttribute('role')).toBe('listbox');
        expect(screen.getByTestId('repo-group-git-member-nccl').textContent).toContain('master');
        expect(screen.getByTestId('repo-group-git-member-nccl').textContent).toContain('/repos/nccl');
        expect(screen.getByTestId('repo-group-git-member-vllm').textContent).toContain('↓3');
        expect(screen.getByTestId('repo-group-git-member-tensorrt').textContent).toContain('Not a Git repo');
    });

    it('selects a healthy repo, closes the list, and restores trigger focus', () => {
        const onSelect = vi.fn();
        const { trigger } = renderPicker(onSelect);
        fireEvent.click(trigger);
        fireEvent.click(screen.getByTestId('repo-group-git-member-nixl'));

        expect(onSelect).toHaveBeenCalledWith('nixl');
        expect(screen.queryByTestId('repo-group-git-member-list')).toBeNull();
        expect(document.activeElement).toBe(trigger);
    });

    it('keeps stale repos visible with a reason but prevents selection', () => {
        const onSelect = vi.fn();
        const { trigger } = renderPicker(onSelect);
        fireEvent.click(trigger);

        const removed = screen.getByTestId('repo-group-git-member-removed') as HTMLButtonElement;
        expect(removed.disabled).toBe(true);
        expect(removed.getAttribute('aria-disabled')).toBe('true');
        expect(removed.textContent).toContain('Unavailable');
        expect(removed.textContent).toContain('Workspace removed');
        fireEvent.click(removed);
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('searches by repository name, path, and branch', () => {
        const { trigger } = renderPicker();
        fireEvent.click(trigger);
        const search = screen.getByTestId('repo-group-git-member-search');

        fireEvent.change(search, { target: { value: 'release' } });
        expect(screen.getByTestId('repo-group-git-member-vllm')).toBeTruthy();
        expect(screen.queryByTestId('repo-group-git-member-nccl')).toBeNull();

        fireEvent.change(search, { target: { value: 'missing-value' } });
        expect(screen.getByTestId('repo-group-git-member-empty-search').textContent)
            .toContain('No repositories match');
    });

    it('supports arrow navigation, Enter selection, Escape, and outside-click dismissal', () => {
        const onSelect = vi.fn();
        const { trigger } = renderPicker(onSelect);

        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const search = screen.getByTestId('repo-group-git-member-search');
        fireEvent.keyDown(search, { key: 'ArrowDown' });
        expect(search.getAttribute('aria-activedescendant')).toContain('nixl');
        fireEvent.keyDown(search, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledWith('nixl');

        fireEvent.click(trigger);
        fireEvent.keyDown(screen.getByTestId('repo-group-git-member-search'), { key: 'Escape' });
        expect(screen.queryByTestId('repo-group-git-member-list')).toBeNull();
        expect(document.activeElement).toBe(trigger);

        fireEvent.click(trigger);
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('repo-group-git-member-list')).toBeNull();
    });

    it('disables the trigger when the group has no members', () => {
        render(
            <RepoGroupGitMemberPicker members={[]} selectedId={undefined} onSelect={() => {}} gitInfo={{}} />,
        );
        const trigger = screen.getByTestId('repo-group-git-member-trigger') as HTMLButtonElement;
        expect(trigger.disabled).toBe(true);
        expect(trigger.textContent).toContain('No usable repositories');
    });
});
