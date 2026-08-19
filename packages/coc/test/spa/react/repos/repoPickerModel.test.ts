/**
 * repoPickerModel — unit tests for the shared repo-picker helpers extracted out
 * of VirtualWorkspaceShellHeader so both remote dropdowns render identical rows.
 */
import { describe, expect, it } from 'vitest';
import { getGroupWsl, getRepoWsl, getServerName, isRepoOffline, shortPath } from '../../../../src/server/spa/client/react/repos/repoPickerModel';
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

function wslRepo(id: string, distro: string | null): RepoData {
    return { workspace: { id, name: id, wsl: { distro } } } as unknown as RepoData;
}

function nativeRepo(id: string): RepoData {
    return { workspace: { id, name: id } } as unknown as RepoData;
}

describe('getRepoWsl', () => {
    it('reads the server marker and its distro', () => {
        expect(getRepoWsl(wslRepo('a', 'Ubuntu'))).toEqual({ distro: 'Ubuntu' });
    });

    it('returns null when the workspace carries no marker', () => {
        expect(getRepoWsl(nativeRepo('a'))).toBeNull();
    });
});

describe('getGroupWsl (AC-03 all-or-nothing rule)', () => {
    it('marks a group whose every clone is WSL-hosted', () => {
        const group = { repos: [wslRepo('a', 'Ubuntu'), wslRepo('b', 'Ubuntu')] };
        expect(getGroupWsl(group)).toEqual({ distro: 'Ubuntu' });
    });

    it('drops the distro when clones live in different distros', () => {
        const group = { repos: [wslRepo('a', 'Ubuntu'), wslRepo('b', 'Ubuntu-24.04')] };
        expect(getGroupWsl(group)).toEqual({ distro: null });
    });

    it('does not mark a mixed group', () => {
        const group = { repos: [wslRepo('a', 'Ubuntu'), nativeRepo('b')] };
        expect(getGroupWsl(group)).toBeNull();
    });

    it('does not mark a group with no WSL clones', () => {
        expect(getGroupWsl({ repos: [nativeRepo('a'), nativeRepo('b')] })).toBeNull();
    });

    it('does not mark an empty group', () => {
        expect(getGroupWsl({ repos: [] })).toBeNull();
    });
});
