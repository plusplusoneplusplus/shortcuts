/**
 * Helpers for the AC-04 PR review-progress REST endpoints.
 * Kept thin and dependency-free so usePrReviewProgress can drop them into
 * effects without dragging hook-internals into the client API.
 */

import { requestSpaApi } from '../../../api/cocClient';

export interface ReviewProgressDto {
    repoId: string;
    prId: string;
    headSha: string;
    reviewedFiles: string[];
    visitedFiles: string[];
    lastSelectedFile: string | null;
    updatedAt: string;
}

export interface ReviewProgressClientKey {
    workspaceId: string;
    repoId: string;
    prId: string;
}

function buildPath(key: ReviewProgressClientKey, suffix: string): string {
    return `/repos/${encodeURIComponent(key.repoId)}/pull-requests/${encodeURIComponent(key.prId)}/review-progress${suffix}`;
}

export async function fetchReviewProgress(
    key: ReviewProgressClientKey,
    headSha: string,
): Promise<ReviewProgressDto> {
    const params = new URLSearchParams({ headSha, workspaceId: key.workspaceId });
    return await requestSpaApi<ReviewProgressDto>(buildPath(key, `?${params.toString()}`));
}

export async function putReviewProgress(
    key: ReviewProgressClientKey,
    payload: {
        headSha: string;
        reviewedFiles: string[];
        visitedFiles: string[];
        lastSelectedFile: string | null;
    },
): Promise<ReviewProgressDto> {
    return await requestSpaApi<ReviewProgressDto>(buildPath(key, ''), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, workspaceId: key.workspaceId }),
    });
}
