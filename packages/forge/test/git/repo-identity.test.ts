import { describe, it, expect } from 'vitest';
import {
    isSameNormalizedOrigin,
    isSameRepoClone,
    resolveRepoIdentity,
} from '../../src/git/repo-identity';

describe('resolveRepoIdentity', () => {
    it('derives origin and repo name from an https remote', () => {
        expect(resolveRepoIdentity({ remoteUrl: 'https://github.com/AI-Dynamo/nixl.git' })).toEqual({
            normalizedOrigin: 'github.com/AI-Dynamo/nixl',
            repoName: 'nixl',
        });
    });

    it('keeps the original casing of the origin for display', () => {
        expect(resolveRepoIdentity({ remoteUrl: 'git@github.com:AI-Dynamo/NIXL.git' }).normalizedOrigin)
            .toBe('github.com/AI-Dynamo/NIXL');
    });

    it('falls back to the workspace name when there is no remote', () => {
        expect(resolveRepoIdentity({ name: 'Shortcuts-2', rootPath: '/home/me/other' })).toEqual({
            normalizedOrigin: null,
            repoName: 'shortcuts-2',
        });
    });

    it('falls back to the rootPath basename when there is no remote or name', () => {
        expect(resolveRepoIdentity({ rootPath: '/home/me/projects/shortcuts-2' }).repoName)
            .toBe('shortcuts-2');
    });

    it('handles Windows rootPath separators and trailing slashes', () => {
        expect(resolveRepoIdentity({ rootPath: 'C:\\src\\Shortcuts-2\\' }).repoName).toBe('shortcuts-2');
    });

    it('strips a trailing .git from a name fallback', () => {
        expect(resolveRepoIdentity({ name: 'nccl.git' }).repoName).toBe('nccl');
    });

    it('treats a blank remote as no remote', () => {
        expect(resolveRepoIdentity({ remoteUrl: '   ', name: 'nixl' })).toEqual({
            normalizedOrigin: null,
            repoName: 'nixl',
        });
    });

    it('returns an empty identity for missing input', () => {
        expect(resolveRepoIdentity(undefined)).toEqual({ normalizedOrigin: null, repoName: '' });
    });
});

describe('isSameNormalizedOrigin', () => {
    it('compares case-insensitively', () => {
        expect(isSameNormalizedOrigin('github.com/AI-Dynamo/nixl', 'github.com/ai-dynamo/nixl')).toBe(true);
    });

    it('is false when either side is missing', () => {
        expect(isSameNormalizedOrigin(null, 'github.com/a/b')).toBe(false);
        expect(isSameNormalizedOrigin('github.com/a/b', null)).toBe(false);
    });
});

describe('isSameRepoClone', () => {
    const identity = (input: { remoteUrl?: string; name?: string; rootPath?: string }) =>
        resolveRepoIdentity(input);

    it('matches the same origin in different case', () => {
        expect(isSameRepoClone(
            identity({ remoteUrl: 'https://github.com/AI-Dynamo/nixl.git' }),
            identity({ remoteUrl: 'https://github.com/ai-dynamo/nixl.git' }),
        )).toBe(true);
    });

    it('matches the SSH and HTTPS forms of the same origin', () => {
        expect(isSameRepoClone(
            identity({ remoteUrl: 'git@github.com:acme/shortcuts-2.git' }),
            identity({ remoteUrl: 'https://github.com/acme/shortcuts-2' }),
        )).toBe(true);
    });

    it('does not match different origins that share a repo name', () => {
        expect(isSameRepoClone(
            identity({ remoteUrl: 'https://github.com/acme/nixl.git' }),
            identity({ remoteUrl: 'https://github.com/other-org/nixl.git' }),
        )).toBe(false);
    });

    it('matches when the source has no remote and the names agree', () => {
        expect(isSameRepoClone(
            identity({ name: 'shortcuts-2' }),
            identity({ remoteUrl: 'https://github.com/acme/Shortcuts-2.git' }),
        )).toBe(true);
    });

    it('does not match when the source has no remote and the names differ', () => {
        expect(isSameRepoClone(
            identity({ name: 'shortcuts-2' }),
            identity({ remoteUrl: 'https://github.com/acme/nccl.git' }),
        )).toBe(false);
    });

    it('matches when neither side has a remote and the names agree', () => {
        expect(isSameRepoClone(
            identity({ name: 'shortcuts-2' }),
            identity({ rootPath: '/srv/clones/shortcuts-2' }),
        )).toBe(true);
    });

    it('does not match when a repo name is unknown on either side', () => {
        expect(isSameRepoClone(identity({}), identity({ name: 'nixl' }))).toBe(false);
        expect(isSameRepoClone(identity({ name: 'nixl' }), identity({}))).toBe(false);
    });

    it('is symmetric', () => {
        const a = identity({ name: 'nixl' });
        const b = identity({ remoteUrl: 'https://github.com/acme/nixl.git' });
        expect(isSameRepoClone(a, b)).toBe(isSameRepoClone(b, a));
    });
});
