/**
 * useFileMentionRepos — maps a chat's workspace onto the repo list the
 * file-mention popup searches (AC-03/AC-06).
 *
 * Both composers already resolve a repo group for `#repo` mentions, so this
 * only reshapes what they have: a group contributes every live member in group
 * order (the order breaks score ties in `mergeFileMentionResults`), a plain
 * single-repo chat contributes just itself, and a chat with no repo — or a
 * group whose membership has not resolved yet — contributes nothing, which
 * keeps the popup shut.
 */

import { useMemo } from 'react';
import { isRepoGroupWorkspaceId } from '../../../repos/virtualWorkspaceIds';
import type { RepoGroupMember } from '../../../repos/repoGroupService';
import type { FileMentionRepo } from './useFileMentionSearch';

export function useFileMentionRepos(
    workspaceId: string | undefined,
    members: RepoGroupMember[] | undefined,
): FileMentionRepo[] {
    return useMemo(() => {
        if (!workspaceId) return [];
        if (isRepoGroupWorkspaceId(workspaceId)) {
            // Stale members point at a removed workspace or a missing path;
            // searching them would only produce errors, not rows.
            return (members ?? [])
                .filter(m => !m.stale)
                .map(m => ({ workspaceId: m.workspaceId, name: m.name ?? m.workspaceId }));
        }
        return [{ workspaceId, name: workspaceId }];
    }, [workspaceId, members]);
}
