/**
 * AC-03 — last-active LOCAL workspace persistence (pure module).
 *
 * The scope switcher must keep showing (and switch back to) the last-active
 * workspace after a reload that lands on a virtual scope. Remote clones already
 * persist their stable pair; this covers the LOCAL counterpart: a plain workspace
 * id is written on selection and resolved back after `repos` aggregation.
 *
 * The persisted value must stay a PLAIN id (no composite / encoded id).
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetLocalWorkspaceForTests,
    clearPersistedLocalWorkspaceSelection,
    loadPersistedLocalWorkspaceSelection,
    persistLocalWorkspaceSelection,
    resolvePersistedLocalWorkspace,
} from '../../../../src/server/spa/client/react/repos/lastLocalWorkspacePersistence';
import {
    tagRemoteWorkspaces,
    type RemoteWorkspaceInfo,
} from '../../../../src/server/spa/client/react/repos/remoteWorkspaceAggregation';
import { buildRemoteCloneKey } from '../../../../src/server/spa/client/react/repos/cloneIdentity';

const STORAGE_KEY = 'coc-last-local-workspace';

/** A local (non-remote) repo row, as aggregated into ReposContext.repos. */
function localRepo(id: string, name = id) {
    return { workspace: { id, name, rootPath: `/repos/${id}` }, gitInfo: { isGitRepo: true, branch: 'main', dirty: false } };
}

/** A remote repo row, tagged via the real tagger so the marker shape stays authoritative. */
function remoteRepo(serverId: string, baseUrl: string, id: string) {
    const ws = tagRemoteWorkspaces(
        { id: serverId, label: serverId },
        baseUrl,
        [{ id, name: id, rootPath: `/repos/${id}` }] as any,
        false,
    )[0] as RemoteWorkspaceInfo;
    return { workspace: ws, gitInfo: { isGitRepo: true, branch: 'main', dirty: false } };
}

beforeEach(() => {
    _resetLocalWorkspaceForTests();
});

afterEach(() => {
    _resetLocalWorkspaceForTests();
});

describe('persist / load / clear', () => {
    it('round-trips a plain local workspace id', () => {
        persistLocalWorkspaceSelection('ws-a');
        expect(loadPersistedLocalWorkspaceSelection()).toBe('ws-a');
    });

    it('persists a PLAIN id — no composite / encoded scheme', () => {
        persistLocalWorkspaceSelection('ws-a');
        const raw = localStorage.getItem(STORAGE_KEY)!;
        expect(raw).toBe('ws-a');
        expect(raw).not.toContain('remote:');
        expect(raw).not.toContain(':');
    });

    it('returns null when nothing is persisted', () => {
        expect(loadPersistedLocalWorkspaceSelection()).toBeNull();
    });

    it('clears the persisted id', () => {
        persistLocalWorkspaceSelection('ws-a');
        clearPersistedLocalWorkspaceSelection();
        expect(loadPersistedLocalWorkspaceSelection()).toBeNull();
    });

    it('ignores an empty id (never writes a blank key)', () => {
        persistLocalWorkspaceSelection('');
        expect(loadPersistedLocalWorkspaceSelection()).toBeNull();
    });
});

describe('resolvePersistedLocalWorkspace', () => {
    it('resolves a persisted id to the matching local workspace after aggregation', () => {
        const repos = [localRepo('ws-a'), localRepo('ws-b')];
        expect(resolvePersistedLocalWorkspace('ws-a', repos)).toBe('ws-a');
    });

    it('round-trips write → load → resolve against aggregated repos', () => {
        persistLocalWorkspaceSelection('ws-b');
        const repos = [localRepo('ws-a'), localRepo('ws-b')];
        const resolved = resolvePersistedLocalWorkspace(loadPersistedLocalWorkspaceSelection(), repos);
        expect(resolved).toBe('ws-b');
    });

    it('returns null when no id was persisted', () => {
        expect(resolvePersistedLocalWorkspace(null, [localRepo('ws-a')])).toBeNull();
    });

    it('returns null when the workspace folder is gone (no match)', () => {
        expect(resolvePersistedLocalWorkspace('ws-gone', [localRepo('ws-a')])).toBeNull();
    });

    it('prefers the local row when a remote workspace shares the id', () => {
        // A remote clone happens to share the persisted plain id; the local row wins
        // so the resolved value stays the plain local id (not a remote clone key).
        const repos = [localRepo('ws-a'), remoteRepo('srv-1', 'http://127.0.0.1:4000', 'ws-a')];
        expect(resolvePersistedLocalWorkspace('ws-a', repos)).toBe('ws-a');
        expect(resolvePersistedLocalWorkspace('ws-a', repos)).not.toBe(buildRemoteCloneKey('srv-1', 'ws-a'));
    });
});
