/**
 * Helpers for the AC-04 PR review-progress origin endpoints.
 */

import { getSpaCocClient } from '../../../api/cocClient';

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
    originId: string;
    workspaceId: string;
    repoId: string;
    prId: string;
}

export async function fetchReviewProgress(
    key: ReviewProgressClientKey,
    headSha: string,
): Promise<ReviewProgressDto> {
    return await getSpaCocClient().pullRequests.getReviewProgressForOrigin(
        key.originId,
        key.prId,
        headSha,
        { workspaceId: key.workspaceId, repoId: key.repoId },
    );
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
    return await getSpaCocClient().pullRequests.saveReviewProgressForOrigin(
        key.originId,
        key.prId,
        payload,
        { workspaceId: key.workspaceId, repoId: key.repoId },
    );
}
