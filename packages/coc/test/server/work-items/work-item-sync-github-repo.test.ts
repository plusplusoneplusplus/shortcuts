import { describe, expect, it } from 'vitest';
import { detectWorkItemSyncProviderFromRemoteUrl } from '../../../src/server/work-items';
import {
    parseGitHubRemoteUrl,
    resolveGitHubWorkItemSyncRepo,
} from '../../../src/server/work-items/work-item-sync-github-repo';

describe('work item GitHub sync repo detection', () => {
    it('classifies supported work item sync providers from repo remote URL forms', () => {
        expect(detectWorkItemSyncProviderFromRemoteUrl('https://github.com/octo-org/octo-repo.git')).toBe('github');
        expect(detectWorkItemSyncProviderFromRemoteUrl('git@github.com:octo-org/octo-repo.git')).toBe('github');
        expect(detectWorkItemSyncProviderFromRemoteUrl('ssh://git@github.com/octo-org/octo-repo.git')).toBe('github');
        expect(detectWorkItemSyncProviderFromRemoteUrl('https://dev.azure.com/octo-org/Project/_git/octo-repo')).toBe('azure-boards');
        expect(detectWorkItemSyncProviderFromRemoteUrl('git@ssh.dev.azure.com:v3/octo-org/Project/octo-repo')).toBe('azure-boards');
        expect(detectWorkItemSyncProviderFromRemoteUrl('https://octo-org.visualstudio.com/Project/_git/octo-repo')).toBe('azure-boards');
        expect(detectWorkItemSyncProviderFromRemoteUrl('https://example.com/octo-org/octo-repo.git')).toBeUndefined();
        expect(detectWorkItemSyncProviderFromRemoteUrl(undefined)).toBeUndefined();
    });

    it('parses common GitHub origin remote URL forms', () => {
        expect(parseGitHubRemoteUrl('https://github.com/octo-org/octo-repo.git')).toEqual({
            owner: 'octo-org',
            repo: 'octo-repo',
            url: 'https://github.com/octo-org/octo-repo',
        });
        expect(parseGitHubRemoteUrl('git@github.com:octo-org/octo-repo.git')).toEqual({
            owner: 'octo-org',
            repo: 'octo-repo',
            url: 'https://github.com/octo-org/octo-repo',
        });
        expect(parseGitHubRemoteUrl('ssh://git@github.com/octo-org/octo-repo.git')).toEqual({
            owner: 'octo-org',
            repo: 'octo-repo',
            url: 'https://github.com/octo-org/octo-repo',
        });
    });

    it('defaults owner and repo from the workspace git origin remote', () => {
        const result = resolveGitHubWorkItemSyncRepo({
            workspace: { rootPath: '/repo' },
            readOriginRemote: () => 'https://github.com/octo-org/octo-repo.git',
        });

        expect(result).toEqual({
            available: true,
            provider: 'github',
            owner: 'octo-org',
            repo: 'octo-repo',
            url: 'https://github.com/octo-org/octo-repo',
            source: 'origin',
        });
    });

    it('returns a clear unavailable result when origin is missing', () => {
        const result = resolveGitHubWorkItemSyncRepo({
            workspace: { rootPath: '/repo' },
            readOriginRemote: () => undefined,
        });

        expect(result).toEqual({
            available: false,
            provider: 'github',
            reason: 'missing-origin',
        });
    });

    it('uses the workspace preference override for non-standard remotes', () => {
        const result = resolveGitHubWorkItemSyncRepo({
            workspace: { rootPath: '/repo' },
            preferences: {
                workItems: {
                    sync: {
                        github: {
                            owner: 'override-org',
                            repo: 'override-repo',
                        },
                    },
                },
            },
            readOriginRemote: () => 'ssh://git@example.com/non/github.git',
        });

        expect(result).toEqual({
            available: true,
            provider: 'github',
            owner: 'override-org',
            repo: 'override-repo',
            url: 'https://github.com/override-org/override-repo',
            source: 'preference',
        });
    });

    it('rejects incomplete preference overrides rather than falling back silently', () => {
        const result = resolveGitHubWorkItemSyncRepo({
            workspace: { rootPath: '/repo' },
            preferences: {
                workItems: {
                    sync: {
                        github: {
                            owner: 'override-org',
                        },
                    },
                },
            },
            readOriginRemote: () => 'https://github.com/octo-org/octo-repo.git',
        });

        expect(result).toEqual({
            available: false,
            provider: 'github',
            reason: 'incomplete-preference',
        });
    });
});
