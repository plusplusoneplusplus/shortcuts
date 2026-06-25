/**
 * AC-08 — remote-clone selection persistence (pure module).
 *
 * Persistence uses the STABLE { serverId, workspaceId } pair, resolved to the
 * clone's CURRENT id on load by matching `remote.serverId` (not `baseUrl`). The
 * port-reassignment variant is the load-bearing case: the persisted serverId is
 * unchanged but the server's baseUrl differs on reload → still resolves.
 *
 * Local clones are never persisted here, so local-clone persistence is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceInfo } from '@plusplusoneplusplus/coc-client';
import {
    _resetRemoteSelectionForTests,
    clearPersistedRemoteSelection,
    loadPersistedRemoteSelection,
    persistRemoteSelection,
    resolvePersistedRemoteSelection,
} from '../../../../src/server/spa/client/react/repos/remoteSelectionPersistence';
import {
    tagRemoteWorkspaces,
    type RemoteWorkspaceInfo,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';

const STORAGE_KEY = 'coc-remote-clone-selection';

function ws(id: string, name = id): WorkspaceInfo {
    return { id, name, rootPath: `/repos/${id}` };
}

/** Tag one remote workspace via the real tagger so the marker shape stays authoritative. */
function remoteWs(serverId: string, baseUrl: string, id: string): RemoteWorkspaceInfo {
    return tagRemoteWorkspaces({ id: serverId, label: serverId }, baseUrl, [ws(id)], false)[0];
}

beforeEach(() => {
    _resetRemoteSelectionForTests();
});

afterEach(() => {
    _resetRemoteSelectionForTests();
});

describe('persist / load / clear', () => {
    it('round-trips a { serverId, workspaceId } pair', () => {
        persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' });
        expect(loadPersistedRemoteSelection()).toEqual({ serverId: 'srv-1', workspaceId: 'ws-a' });
    });

    it('persists neither the baseUrl nor a composite id (only the stable pair)', () => {
        persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' });
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
        expect(Object.keys(raw).sort()).toEqual(['serverId', 'workspaceId']);
        expect(JSON.stringify(raw)).not.toContain('http');
        expect(JSON.stringify(raw)).not.toContain('127.0.0.1');
    });

    it('returns null when nothing is persisted', () => {
        expect(loadPersistedRemoteSelection()).toBeNull();
    });

    it('clears the persisted pair', () => {
        persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' });
        clearPersistedRemoteSelection();
        expect(loadPersistedRemoteSelection()).toBeNull();
    });

    it('returns null for a malformed / partial persisted value', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverId: 'srv-1' })); // no workspaceId
        expect(loadPersistedRemoteSelection()).toBeNull();
        localStorage.setItem(STORAGE_KEY, 'not json');
        expect(loadPersistedRemoteSelection()).toBeNull();
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ serverId: '', workspaceId: 'ws-a' }));
        expect(loadPersistedRemoteSelection()).toBeNull();
    });
});

describe('resolvePersistedRemoteSelection', () => {
    it('resolves the pair to the matching remote workspace id', () => {
        const workspaces = [remoteWs('srv-1', 'http://127.0.0.1:4000', 'ws-a')];
        const resolved = resolvePersistedRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' }, workspaces);
        expect(resolved).toBe(buildRemoteCloneKey('srv-1', 'ws-a'));
    });

    it('returns null when no persisted pair is given', () => {
        expect(resolvePersistedRemoteSelection(null, [remoteWs('srv-1', 'http://127.0.0.1:4000', 'ws-a')])).toBeNull();
    });

    it('returns null when the server is gone (no remote workspace matches)', () => {
        const workspaces = [remoteWs('srv-2', 'http://127.0.0.1:4001', 'ws-b')];
        expect(resolvePersistedRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' }, workspaces)).toBeNull();
    });

    it('ignores local workspaces with a colliding id (only remote rows match)', () => {
        // A LOCAL workspace happens to share the persisted workspace id, but it has
        // no remote marker, so it must not resolve as the remote selection.
        const workspaces = [ws('ws-a') as RemoteWorkspaceInfo];
        expect(resolvePersistedRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' }, workspaces)).toBeNull();
    });

    it('survives devtunnel PORT REASSIGNMENT — resolves by serverId though baseUrl changed', () => {
        // Persisted at one port; on reload the SAME server has a NEW baseUrl/port.
        persistRemoteSelection({ serverId: 'srv-1', workspaceId: 'ws-a' });
        const reloadedWorkspaces = [remoteWs('srv-1', 'http://127.0.0.1:9999', 'ws-a')];
        const resolved = resolvePersistedRemoteSelection(loadPersistedRemoteSelection(), reloadedWorkspaces);
        expect(resolved).toBe(buildRemoteCloneKey('srv-1', 'ws-a'));
        // And the matched workspace carries the CURRENT (reassigned) baseUrl.
        expect(reloadedWorkspaces[0].baseUrl).toBe('http://127.0.0.1:9999');
    });

    it('disambiguates a workspace id that collides ACROSS two servers by serverId', () => {
        // Two different servers each expose a workspace with id 'ws-shared'.
        const workspaces = [
            remoteWs('srv-1', 'http://127.0.0.1:4000', 'ws-shared'),
            remoteWs('srv-2', 'http://127.0.0.1:4001', 'ws-shared'),
        ];
        // The persisted pair pins srv-2 → it must resolve to srv-2's row, routed at :4001.
        const resolved = resolvePersistedRemoteSelection({ serverId: 'srv-2', workspaceId: 'ws-shared' }, workspaces);
        expect(resolved).toBe(buildRemoteCloneKey('srv-2', 'ws-shared'));
        const matched = workspaces.find(w => w.remote.serverId === 'srv-2')!;
        expect(matched.baseUrl).toBe('http://127.0.0.1:4001');
    });
});
