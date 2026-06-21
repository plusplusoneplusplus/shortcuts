/**
 * @vitest-environment node
 *
 * Tests for buildImplementTargets — derives the ImplementPlanCard target list
 * from the dashboard repo list. Covers: local repos always included, online
 * remote clones included, offline / connecting remotes excluded, the current
 * repo always present and ordered first, and graceful handling of empty input.
 */
import { describe, it, expect } from 'vitest';
import { buildImplementTargets } from '../../../../../src/server/spa/client/react/features/chat/implementTargets';
import type { RepoData } from '../../../../../src/server/spa/client/react/repos/repoGrouping';

function localRepo(id: string, name: string, rootPath: string): RepoData {
    return {
        workspace: { id, name, rootPath },
    } as RepoData;
}

function remoteRepo(
    id: string,
    name: string,
    opts: { offline: boolean; connection: string; serverLabel?: string; baseUrl?: string; rootPath?: string },
): RepoData {
    const baseUrl = opts.baseUrl ?? 'http://127.0.0.1:4000';
    return {
        workspace: {
            id,
            name,
            rootPath: opts.rootPath ?? '/remote/repo',
            baseUrl,
            remote: {
                baseUrl,
                serverId: 'srv-1',
                serverLabel: opts.serverLabel ?? 'dev-vm',
                offline: opts.offline,
                connection: opts.connection,
                queue: 'idle',
            },
        },
    } as unknown as RepoData;
}

describe('buildImplementTargets', () => {
    it('returns an empty list for no repos and no current repo', () => {
        expect(buildImplementTargets([], {})).toEqual([]);
        expect(buildImplementTargets(undefined, {})).toEqual([]);
    });

    it('includes local repos as path-based (non-remote) targets', () => {
        const repos = [localRepo('ws-a', 'app-a', '/a'), localRepo('ws-b', 'app-b', '/b')];
        const targets = buildImplementTargets(repos, {});
        expect(targets).toHaveLength(2);
        expect(targets[0]).toMatchObject({ workspaceId: 'ws-a', label: 'app-a', workingDirectory: '/a', isRemote: false });
        expect(targets[0].baseUrl).toBeUndefined();
        expect(targets[1]).toMatchObject({ workspaceId: 'ws-b', isRemote: false });
    });

    it('includes ONLINE remote clones with routing metadata', () => {
        const repos = [
            localRepo('ws-local', 'my-app', '/repo'),
            remoteRepo('ws-remote', 'my-app', {
                offline: false,
                connection: 'online',
                serverLabel: 'dev-vm',
                baseUrl: 'http://127.0.0.1:5000',
                rootPath: '/remote/my-app',
            }),
        ];
        const targets = buildImplementTargets(repos, { workspaceId: 'ws-local' });
        const remote = targets.find(t => t.workspaceId === 'ws-remote');
        expect(remote).toBeDefined();
        expect(remote).toMatchObject({
            isRemote: true,
            serverLabel: 'dev-vm',
            baseUrl: 'http://127.0.0.1:5000',
            workingDirectory: '/remote/my-app',
        });
    });

    it('excludes offline remote clones', () => {
        const repos = [
            localRepo('ws-local', 'my-app', '/repo'),
            remoteRepo('ws-off', 'my-app', { offline: true, connection: 'offline' }),
        ];
        const targets = buildImplementTargets(repos, { workspaceId: 'ws-local' });
        expect(targets.some(t => t.workspaceId === 'ws-off')).toBe(false);
    });

    it('excludes remotes that are online-flagged but still connecting', () => {
        const repos = [
            localRepo('ws-local', 'my-app', '/repo'),
            // offline:false but connection not yet 'online' (still connecting) → not runnable.
            remoteRepo('ws-conn', 'my-app', { offline: false, connection: 'connecting' }),
        ];
        const targets = buildImplementTargets(repos, { workspaceId: 'ws-local' });
        expect(targets.some(t => t.workspaceId === 'ws-conn')).toBe(false);
    });

    it('hides virtual workspaces', () => {
        const repos = [
            { workspace: { id: 'ws-virtual', name: 'Global', virtual: true } } as unknown as RepoData,
            localRepo('ws-real', 'app', '/a'),
        ];
        const targets = buildImplementTargets(repos, {});
        expect(targets.map(t => t.workspaceId)).toEqual(['ws-real']);
    });

    it('places the current repo first even when it is not the first in the list', () => {
        const repos = [
            localRepo('ws-a', 'app-a', '/a'),
            localRepo('ws-current', 'current-app', '/cur'),
        ];
        const targets = buildImplementTargets(repos, { workspaceId: 'ws-current' });
        expect(targets[0].workspaceId).toBe('ws-current');
    });

    it('synthesizes the current repo target when it is absent from the repo list', () => {
        const repos = [
            remoteRepo('ws-remote', 'my-app', { offline: false, connection: 'online' }),
        ];
        const targets = buildImplementTargets(repos, {
            workspaceId: 'ws-current',
            label: 'current-app',
            workingDirectory: '/cur',
        });
        expect(targets[0]).toMatchObject({
            workspaceId: 'ws-current',
            label: 'current-app',
            workingDirectory: '/cur',
            isRemote: false,
        });
        // The online remote still follows.
        expect(targets.some(t => t.workspaceId === 'ws-remote' && t.isRemote)).toBe(true);
    });

    it('does not duplicate the current repo when it is already in the list', () => {
        const repos = [localRepo('ws-current', 'current-app', '/cur')];
        const targets = buildImplementTargets(repos, { workspaceId: 'ws-current', label: 'current-app' });
        expect(targets.filter(t => t.workspaceId === 'ws-current')).toHaveLength(1);
    });
});
