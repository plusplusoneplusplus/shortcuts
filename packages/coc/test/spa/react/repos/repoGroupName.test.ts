/**
 * resolveRepoGroupName — header label lookup for repo-group workspaces (AC-02).
 *
 * A local group is in `AppContext.workspaces`; a group owned by a remote CoC
 * server only ever shows up on `ReposContext.remoteGroupWorkspaces`. Both header
 * variants label the group through this helper, so a remote group must never
 * fall back to its raw `group-<slug>` id when its name is known.
 */
import { describe, expect, it } from 'vitest';
import { resolveRepoGroupName } from '../../../../src/server/spa/client/react/repos/repoGroupName';

const LOCAL = [{ id: 'r1', name: 'shortcuts' }, { id: 'group-frontend', name: 'Frontend' }];
const REMOTE = [{ id: 'group-svc', name: 'Services' }];

describe('resolveRepoGroupName', () => {
    it('reads a local group name from the workspace registry', () => {
        expect(resolveRepoGroupName('group-frontend', LOCAL, REMOTE)).toBe('Frontend');
    });

    it('reads a remote group name from the aggregated remote groups', () => {
        expect(resolveRepoGroupName('group-svc', LOCAL, REMOTE)).toBe('Services');
    });

    it('falls back to the workspace id when the group is in neither list', () => {
        expect(resolveRepoGroupName('group-gone', LOCAL, REMOTE)).toBe('group-gone');
    });

    it('tolerates missing lists and blank names, degrading to the id', () => {
        expect(resolveRepoGroupName('group-svc', undefined, null)).toBe('group-svc');
        expect(resolveRepoGroupName('group-svc', [], [{ id: 'group-svc', name: '' }])).toBe('group-svc');
    });

    it('prefers the local registry when a local and a remote group share a slug', () => {
        expect(resolveRepoGroupName('group-x', [{ id: 'group-x', name: 'Mine' }], [{ id: 'group-x', name: 'Theirs' }])).toBe('Mine');
    });
});
