import type {
    PullRequest,
    Reviewer,
    PrComment,
    CommentThread,
} from '../../../src/server/spa/client/react/repos/pull-requests/pr-utils';

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

export function createMockPullRequest(overrides?: Partial<PullRequest>): PullRequest {
    return {
        id: 1,
        number: 1,
        title: 'feat: add new feature',
        description: 'This PR adds a new feature.',
        createdBy: {
            displayName: 'Alice Developer',
            email: 'alice@example.com',
            avatarUrl: 'https://example.com/avatar/alice.png',
        },
        sourceBranch: 'feature/new-feature',
        targetBranch: 'main',
        status: 'open',
        isDraft: false,
        createdAt: '2024-01-15T10:00:00.000Z',
        updatedAt: '2024-01-15T12:00:00.000Z',
        url: 'https://example.com/repos/org/repo/pullrequest/1',
        labels: [],
        reviewers: [],
        commentCount: 0,
        ...overrides,
    };
}

export function createMockReviewer(overrides?: Partial<Reviewer>): Reviewer {
    return {
        identity: {
            displayName: 'Bob Reviewer',
            email: 'bob@example.com',
            avatarUrl: 'https://example.com/avatar/bob.png',
        },
        vote: 'noVote',
        isRequired: false,
        ...overrides,
    };
}

export function createMockPrComment(overrides?: Partial<PrComment>): PrComment {
    return {
        id: 1,
        author: {
            displayName: 'Alice Developer',
            email: 'alice@example.com',
        },
        content: 'This is a comment.',
        publishedDate: '2024-01-15T11:00:00.000Z',
        createdDate: '2024-01-15T11:00:00.000Z',
        ...overrides,
    };
}

export function createMockCommentThread(overrides?: Partial<CommentThread>): CommentThread {
    return {
        id: 1,
        comments: [createMockPrComment()],
        status: 'active',
        threadContext: undefined,
        ...overrides,
    };
}

/**
 * Returns an array of `count` PullRequest objects with sequential ids, numbers,
 * and titles. The optional `overrides` are applied to every item.
 */
export function createMockPrList(count: number, overrides?: Partial<PullRequest>): PullRequest[] {
    return Array.from({ length: count }, (_, i) =>
        createMockPullRequest({
            id: i + 1,
            number: i + 1,
            title: `feat: pull request number ${i + 1}`,
            ...overrides,
        }),
    );
}

// ---------------------------------------------------------------------------
// Pre-built scenario constants
// ---------------------------------------------------------------------------

/** Three PRs with mixed statuses: open, draft, merged. */
export const MOCK_PR_LIST: PullRequest[] = [
    createMockPullRequest({
        id: 1,
        number: 1,
        title: 'feat: open pull request',
        status: 'open',
        isDraft: false,
    }),
    createMockPullRequest({
        id: 2,
        number: 2,
        title: 'feat: draft pull request',
        status: 'draft',
        isDraft: true,
        sourceBranch: 'feature/draft-work',
    }),
    createMockPullRequest({
        id: 3,
        number: 3,
        title: 'feat: merged pull request',
        status: 'merged',
        mergedAt: '2024-01-14T09:00:00.000Z',
        sourceBranch: 'feature/merged-work',
    }),
];

/** Single open PR with reviewers, a description, and a non-zero comment count. */
export const MOCK_PR_OPEN: PullRequest = createMockPullRequest({
    id: 42,
    number: 42,
    title: 'feat: detailed open PR',
    description: 'A detailed description of this pull request explaining the changes made.',
    status: 'open',
    commentCount: 3,
    reviewers: [
        createMockReviewer({
            identity: { displayName: 'Bob Reviewer', email: 'bob@example.com' },
            vote: 'approved',
            isRequired: true,
        }),
        createMockReviewer({
            identity: { displayName: 'Carol Reviewer', email: 'carol@example.com' },
            vote: 'waitingForAuthor',
            isRequired: false,
        }),
    ],
});

/** Two comment threads: one active with a file path, one resolved. */
export const MOCK_PR_THREADS: CommentThread[] = [
    createMockCommentThread({
        id: 1,
        status: 'active',
        threadContext: { filePath: '/src/index.ts' },
        comments: [
            createMockPrComment({
                id: 1,
                content: 'Please consider extracting this into a helper.',
                author: { displayName: 'Bob Reviewer', email: 'bob@example.com' },
            }),
            createMockPrComment({
                id: 2,
                content: 'Good point, I will refactor this.',
                author: { displayName: 'Alice Developer', email: 'alice@example.com' },
                publishedDate: '2024-01-15T11:30:00.000Z',
                createdDate: '2024-01-15T11:30:00.000Z',
            }),
        ],
    }),
    createMockCommentThread({
        id: 2,
        status: 'fixed',
        threadContext: undefined,
        comments: [
            createMockPrComment({
                id: 3,
                content: 'Typo in variable name.',
                author: { displayName: 'Carol Reviewer', email: 'carol@example.com' },
            }),
        ],
    }),
];
