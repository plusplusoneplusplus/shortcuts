import { describe, expect, it } from 'vitest';
import { resolveCanonicalOriginId } from '@plusplusoneplusplus/forge';
import {
    resolveRepoWorkItemOriginScope,
    resolveWorkItemOriginId,
} from '../../../../src/server/spa/client/react/features/work-items/workItemOriginScope';

describe('workItemOriginScope', () => {
    it('matches the Forge canonical origin resolver for GitHub, Azure DevOps, generic git, and local origins', () => {
        const cases = [
            { workspaceId: 'ws-a', remoteUrl: 'https://github.com/Owner/Repo.git' },
            { workspaceId: 'ws-b', remoteUrl: 'git@github.com:owner/repo.git' },
            { workspaceId: 'ws-c', remoteUrl: 'https://dev.azure.com/Org/My%20Project/_git/Repo' },
            { workspaceId: 'ws-d', remoteUrl: 'git@ssh.dev.azure.com:v3/Org/My%20Project/Repo' },
            { workspaceId: 'ws-e', remoteUrl: 'https://USER:TOKEN@git.example.com/Org/Repo.git' },
            { workspaceId: 'ws-local', remoteUrl: undefined },
        ];

        for (const input of cases) {
            expect(resolveWorkItemOriginId(input)).toBe(resolveCanonicalOriginId(input));
        }
    });

    it('prefers detected git info remote URLs over stale workspace metadata', () => {
        expect(resolveRepoWorkItemOriginScope({
            workspace: {
                id: 'ws-local',
                remoteUrl: null,
            },
            gitInfo: {
                branch: 'main',
                dirty: false,
                isGitRepo: true,
                remoteUrl: 'https://github.com/octo/repo.git',
            },
        }).originId).toBe('gh_octo_repo');
    });

    it('keeps no-remote workspaces isolated by local workspace ID', () => {
        expect(resolveWorkItemOriginId({ workspaceId: 'ws-one' })).toBe('local_ws-one');
        expect(resolveWorkItemOriginId({ workspaceId: 'ws-two' })).toBe('local_ws-two');
    });
});
