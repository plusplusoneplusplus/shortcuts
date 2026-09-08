/**
 * gitRoute — the one parser/builder for every `#repos/{wsId}/git…` URL.
 *
 * A repo GROUP is not a git repo: its Git tab hosts one member repository at a
 * time. That splits the route into two identities — the workspace that owns the
 * PAGE (the group, so the group stays selected while you browse a member's
 * history) and the workspace that owns the git DATA (the member). A group route
 * therefore serializes the member as a `member/<id>` segment pair:
 *
 *   #repos/{repoId}/git[/{sha|branch-range}[/{filePath}]]
 *   #repos/{groupId}/git[/member/{memberId}[/{sha|branch-range}[/{filePath}]]]
 *
 * The `member` marker is structural only for group ids, so an ordinary repo can
 * still have a ref literally called `member` and a group link can never mistake
 * a member id for a commit SHA. Everything is encoded with the shared per-segment
 * helpers, keeping the file path one encoded segment exactly as before.
 */

import { isRepoGroupWorkspaceId } from '../repos/virtualWorkspaceIds';
import { decodeSegment, encodeSegment, repoHashBase, tokenizeHash } from './routePath';

/** The structural marker that introduces a group route's member id. */
export const GIT_ROUTE_MEMBER_MARKER = 'member';

export interface GitRouteDescriptor {
    /** Workspace that owns the page — the group id, or the repo itself. */
    routeWorkspaceId: string;
    /**
     * Workspace that owns the git data. The repo itself for a single-repo route,
     * the named member for an explicit group route, and `null` for a bare group
     * entry that still needs the host to resolve a member.
     */
    workspaceId: string | null;
    /** A commit SHA, the `branch-range` sentinel, or null for plain history. */
    commitHash: string | null;
    filePath: string | null;
}

/**
 * Parse a Git route. Returns null when the hash does not address a Git tab at
 * all, so callers can tell "not a git route" from "git history, no selection".
 */
export function parseGitRoute(hash: string): GitRouteDescriptor | null {
    const { segments } = tokenizeHash(hash);
    if (segments[0] !== 'repos' || !segments[1] || segments[2] !== 'git') return null;

    const routeWorkspaceId = decodeSegment(segments[1]);
    let workspaceId: string | null = routeWorkspaceId;
    let rest = segments.slice(3);

    if (isRepoGroupWorkspaceId(routeWorkspaceId)) {
        if (rest[0] === GIT_ROUTE_MEMBER_MARKER) {
            // `…/git/member` with nothing after it is an incomplete link, not a
            // commit called "member": drop the marker and resolve like a bare entry.
            workspaceId = rest[1] ? decodeSegment(rest[1]) : null;
            rest = rest.slice(2);
        } else {
            // Legacy group link — the member was never serialized.
            workspaceId = null;
        }
    }

    return {
        routeWorkspaceId,
        workspaceId,
        commitHash: rest[0] ? decodeSegment(rest[0]) : null,
        filePath: rest[0] && rest[1] ? decodeSegment(rest[1]) : null,
    };
}

/** The `/git…` suffix of a Git route, i.e. everything after `#repos/{wsId}`. */
export function buildGitRouteSuffix(descriptor: GitRouteDescriptor): string {
    let suffix = '/git';
    if (isRepoGroupWorkspaceId(descriptor.routeWorkspaceId) && descriptor.workspaceId) {
        suffix += '/' + GIT_ROUTE_MEMBER_MARKER + '/' + encodeSegment(descriptor.workspaceId);
    }
    if (descriptor.commitHash) {
        suffix += '/' + encodeSegment(descriptor.commitHash);
        if (descriptor.filePath) suffix += '/' + encodeSegment(descriptor.filePath);
    }
    return suffix;
}

/** The full `#repos/{wsId}/git…` hash for a Git route. */
export function buildGitRouteHash(descriptor: GitRouteDescriptor): string {
    return repoHashBase(descriptor.routeWorkspaceId) + buildGitRouteSuffix(descriptor);
}

/** True when both routes name the same page owner AND the same data member. */
export function isSameGitRouteScope(
    a: { routeWorkspaceId: string; workspaceId: string | null } | null | undefined,
    b: { routeWorkspaceId: string; workspaceId: string | null } | null | undefined,
): boolean {
    if (!a || !b) return false;
    return a.routeWorkspaceId === b.routeWorkspaceId && a.workspaceId === b.workspaceId;
}
