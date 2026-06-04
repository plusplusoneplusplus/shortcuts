import { describe, expect, it } from 'vitest';
import type { GitInfoResponse, WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import {
    buildCrossCloneCherryPickTargetGroups,
    normalizeWorkspaceRemoteUrl,
} from '../../../src/server/spa/client/react/features/git/crossCloneCherryPickTargets';

function workspace(id: string, name: string, remoteUrl?: string): WorkspaceInfo {
    return {
        id,
        name,
        rootPath: `/repos/${id}`,
        ...(remoteUrl ? { remoteUrl } : {}),
    };
}

function gitInfo(overrides: Partial<GitInfoResponse> = {}): GitInfoResponse {
    return {
        branch: 'main',
        dirty: false,
        ahead: 0,
        behind: 0,
        isGitRepo: true,
        remoteUrl: null,
        ...overrides,
    };
}

describe('buildCrossCloneCherryPickTargetGroups', () => {
    it('excludes the source workspace and puts same-remote clone groups first', () => {
        const groups = buildCrossCloneCherryPickTargetGroups(
            'source',
            'git@github.com:org/repo.git',
            [
                workspace('source', 'Source', 'git@github.com:org/repo.git'),
                workspace('same-b', 'Same B', 'https://github.com/org/repo.git'),
                workspace('other', 'Other', 'https://github.com/other/repo.git'),
                workspace('same-a', 'Same A', 'git@github.com:org/repo.git'),
            ],
            {
                'same-b': gitInfo(),
                other: gitInfo(),
                'same-a': gitInfo(),
            },
        );

        expect(groups[0].remoteStatus).toBe('same-remote');
        expect(groups[0].normalizedRemoteUrl).toBe('github.com/org/repo');
        expect(groups[0].targets.map(t => t.workspace.id)).toEqual(['same-a', 'same-b']);
        expect(groups.flatMap(g => g.targets).map(t => t.workspace.id)).not.toContain('source');
        expect(groups[1].remoteStatus).toBe('cross-remote');
    });

    it('marks cross-remote targets separately from recommended same-remote targets', () => {
        const groups = buildCrossCloneCherryPickTargetGroups(
            'source',
            'https://github.com/org/source.git',
            [
                workspace('target', 'Target', 'https://github.com/org/target.git'),
            ],
            { target: gitInfo() },
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].remoteStatus).toBe('cross-remote');
        expect(groups[0].targets[0].recommended).toBe(false);
    });

    it('uses existing normalized remote URL semantics across workspace and git-info remotes', () => {
        const workspaceOnly = workspace('workspace-only', 'Workspace Only', 'git@ssh.dev.azure.com:v3/org/project/repo.git');
        const gitInfoOnly = workspace('git-info-only', 'Git Info Only');

        expect(normalizeWorkspaceRemoteUrl(workspaceOnly, null)).toBe('dev.azure.com/org/project/repo');
        expect(normalizeWorkspaceRemoteUrl(gitInfoOnly, gitInfo({ remoteUrl: 'https://dev.azure.com/org/project/_git/repo' })))
            .toBe('dev.azure.com/org/project/repo');
    });

    it('keeps dirty git targets selectable but disables non-git workspaces', () => {
        const groups = buildCrossCloneCherryPickTargetGroups(
            'source',
            'https://github.com/org/repo.git',
            [
                workspace('dirty', 'Dirty', 'https://github.com/org/repo.git'),
                workspace('plain-folder', 'Plain Folder', 'https://github.com/org/repo.git'),
            ],
            {
                dirty: gitInfo({ dirty: true }),
                'plain-folder': gitInfo({ isGitRepo: false, branch: null }),
            },
        );

        const targets = groups.flatMap(g => g.targets);
        expect(targets.find(t => t.workspace.id === 'dirty')?.disabledReason).toBeUndefined();
        expect(targets.find(t => t.workspace.id === 'dirty')?.gitInfo?.dirty).toBe(true);
        expect(targets.find(t => t.workspace.id === 'plain-folder')?.disabledReason).toBe('Not a Git repository');
    });
});
