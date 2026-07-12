/**
 * repoPickerModel — unit tests for the shared repo-picker helpers extracted out
 * of VirtualWorkspaceShellHeader so both remote dropdowns render identical rows.
 */
import { describe, expect, it } from 'vitest';
import { getServerName, isRepoOffline, shortPath } from '../../../../src/server/spa/client/react/repos/repoPickerModel';
import type { RepoData } from '../../../../src/server/spa/client/react/repos/repoGrouping';

function remoteRepo(remote: Record<string, unknown> | null, baseUrl?: string): RepoData {
    return { workspace: { id: 'r', name: 'r', baseUrl, remote } } as unknown as RepoData;
}

describe('getServerName', () => {
    it('prefers serverLabel over serverId and baseUrl', () => {
        expect(getServerName(remoteRepo({ serverLabel: 'Dev Box', serverId: 'srv-1' }, 'https://x'))).toBe('Dev Box');
    });

    it('falls back to serverId when no label', () => {
        expect(getServerName(remoteRepo({ serverId: 'srv-1' }, 'https://x'))).toBe('srv-1');
    });

    it('falls back to baseUrl when no label or id', () => {
        expect(getServerName(remoteRepo({}, 'https://host.example'))).toBe('https://host.example');
    });

    it('falls back to the literal "remote" when nothing is available', () => {
        expect(getServerName(remoteRepo(null))).toBe('remote');
    });
});

describe('isRepoOffline', () => {
    it('is false for local repos (no remote marker)', () => {
        expect(isRepoOffline({ workspace: { id: 'l', name: 'l' } } as unknown as RepoData)).toBe(false);
    });

    it('is true for offline and failed connections', () => {
        expect(isRepoOffline(remoteRepo({ connection: 'offline' }))).toBe(true);
        expect(isRepoOffline(remoteRepo({ connection: 'failed' }))).toBe(true);
    });

    it('defaults to offline when a remote marker has no connection', () => {
        expect(isRepoOffline(remoteRepo({}))).toBe(true);
    });

    it('is false for online / connecting connections', () => {
        expect(isRepoOffline(remoteRepo({ connection: 'online' }))).toBe(false);
        expect(isRepoOffline(remoteRepo({ connection: 'connecting' }))).toBe(false);
    });
});

describe('shortPath', () => {
    it('returns the trailing two segments', () => {
        expect(shortPath('/home/user/projects/myrepo')).toBe('projects/myrepo');
    });

    it('normalizes backslashes and drops empty segments', () => {
        expect(shortPath('C:\\Users\\me\\repo')).toBe('me/repo');
    });

    it('returns the whole path when it has fewer than two segments', () => {
        expect(shortPath('repo')).toBe('repo');
    });

    it('returns empty string for empty input', () => {
        expect(shortPath('')).toBe('');
    });
});
