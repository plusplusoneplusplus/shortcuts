/**
 * Pure route parsing and derived labels for the pop-out git review window.
 *
 * URL formats:
 *   Commit:       `/?workspace=<wsId>#popout/git-review/<commitHash>`
 *   Branch-range: `/?workspace=<wsId>#popout/git-review/branch-range`
 *   PR:           `/?workspace=<wsId>&repo=<repoId>#popout/git-review/pr/<prId>`
 *
 * Nothing here touches React, so commit / PR / branch-range routes can be
 * covered by plain unit tests.
 */

import { lookupCloneBaseUrl, registerCloneBaseUrls } from '../../repos/cloneRegistry';
import type { GitRangeBaseMode } from '@plusplusoneplusplus/coc-client';

export interface PopOutGitReviewParams {
    workspaceId: string;
    reviewType: 'commit' | 'branch-range' | 'pr';
    commitHash?: string;
    prId?: string;
    repoId?: string;
    originId?: string;
    /** Remote clone baseUrl for the workspace, when the workspace lives on a remote CoC server. */
    cloneBaseUrl?: string;
    /** Branch-range comparison base. Defaults to 'default-branch'. */
    baseMode?: GitRangeBaseMode;
}

export interface PopOutCloneRegistration {
    workspaceId: string;
    baseUrl: string;
}

export function parsePopOutGitReviewRoute(hash: string, search: string): PopOutGitReviewParams | null {
    const cleaned = hash.replace(/^#/, '');
    const parts = cleaned.split('/');
    if (parts[0] !== 'popout' || parts[1] !== 'git-review') return null;

    const searchParams = new URLSearchParams(search);
    const workspaceId = searchParams.get('workspace');
    if (!workspaceId) return null;

    const cloneBaseUrl = searchParams.get('cloneBaseUrl') || undefined;

    if (parts[2] === 'branch-range') {
        const baseMode: GitRangeBaseMode = searchParams.get('base') === 'upstream' ? 'upstream' : 'default-branch';
        return { workspaceId, reviewType: 'branch-range', cloneBaseUrl, baseMode };
    }

    if (parts[2] === 'pr' && parts[3]) {
        const repoId = searchParams.get('repo') ?? workspaceId;
        const originId = searchParams.get('origin')?.trim() || undefined;
        return { workspaceId, reviewType: 'pr', prId: decodeURIComponent(parts[3]), repoId, originId, cloneBaseUrl };
    }

    // 'pr' without a prId is invalid
    if (parts[2] === 'pr') {
        return null;
    }

    if (parts[2]) {
        return { workspaceId, reviewType: 'commit', commitHash: decodeURIComponent(parts[2]), cloneBaseUrl };
    }

    return null;
}

/** Short label shown in the pop-out top bar and used as the document-title base. */
export function popOutGitReviewLabel(params: PopOutGitReviewParams): string {
    if (params.reviewType === 'commit') return `Commit ${(params.commitHash ?? '').slice(0, 7)}`;
    if (params.reviewType === 'pr') return `PR #${params.prId}`;
    return 'Branch Range Review';
}

/** Full `document.title` for the pop-out window. */
export function popOutGitReviewDocumentTitle(
    params: PopOutGitReviewParams,
    options: { hostname?: string; prTitle?: string } = {},
): string {
    const brand = options.hostname ? `CoC @ ${options.hostname}` : 'CoC';
    const base = popOutGitReviewLabel(params);
    const title = params.reviewType === 'pr' && options.prTitle ? `${base} — ${options.prTitle}` : base;
    return `${title} — ${brand}`;
}

/** Clone-registry entries implied by the route. Empty for local workspaces. */
export function popOutCloneRegistrations(params: PopOutGitReviewParams | null): PopOutCloneRegistration[] {
    if (!params?.cloneBaseUrl) return [];
    return [{ workspaceId: params.workspaceId, baseUrl: params.cloneBaseUrl }];
}

/**
 * Guard so React re-renders of the shell do not re-seed the module-level clone
 * registry. Registration still happens before any child renders (and therefore
 * before any adapter issues a workspace-scoped request), but only once per
 * parsed route.
 */
let lastRegisteredRouteKey: string | null = null;

/**
 * Seed the clone registry so workspace-scoped calls inside the pop-out route to
 * the remote CoC server. Returns true when this call performed the registration.
 */
export function registerPopOutCloneBases(params: PopOutGitReviewParams | null): boolean {
    const registrations = popOutCloneRegistrations(params);
    if (registrations.length === 0) return false;
    const routeKey = registrations.map(entry => `${entry.workspaceId}|${entry.baseUrl}`).join(',');
    const alreadyRegistered = registrations.every(
        entry => lookupCloneBaseUrl(entry.workspaceId) === entry.baseUrl,
    );
    if (routeKey === lastRegisteredRouteKey && alreadyRegistered) return false;
    lastRegisteredRouteKey = routeKey;
    registerCloneBaseUrls(registrations);
    return true;
}

/** Test seam — forget which route was registered last. */
export function resetPopOutCloneRegistration(): void {
    lastRegisteredRouteKey = null;
}
