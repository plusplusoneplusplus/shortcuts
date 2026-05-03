/**
 * Unit tests for AttentionGroupSection — grouped PR rows.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttentionGroupSection } from '../../../../../src/server/spa/client/react/features/pull-requests/AttentionGroupSection';
import { AttentionGroup, type AttentionGroupConfig } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-attention-groups';
import type { PullRequest } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

function makeConfig(group: AttentionGroup): AttentionGroupConfig {
    return {
        group,
        key: group,
        label: 'Reviewer nudge needed',
        description: 'No reviewer has voted and the PR has gone stale.',
        defaultAction: '/nudge',
        icon: '👋',
        emoji: '👋',
        color: 'bg-yellow-100 text-yellow-800',
    };
}

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        id: 7,
        number: 107,
        title: 'Refresh PR grouping',
        sourceBranch: 'feature/pr-groups',
        targetBranch: 'main',
        status: 'open',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-16T12:30:00Z',
        reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'noVote' }],
        ...overrides,
    };
}

describe('AttentionGroupSection', () => {
    it('passes operational group badge and reason props to each PR row', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ReviewerNudge)}
                prs={[makePr()]}
                selectedPrId={null}
                onRowClick={vi.fn()}
            />,
        );

        const badge = screen.getByTestId('pr-group-badge');
        expect(badge.textContent).toContain('Nudge reviewer');
        expect(badge.textContent).toContain('💬');
        expect(badge.className).toContain('bg-blue-100');
        expect(screen.getByTestId('pr-group-reason').textContent).toBe('No reviewer response in 2+ days');
        expect(document.querySelector('.pr-status-badge')).toBeNull();
    });

    it('uses reviewer-requested-change reason for manual update rows when reviewer votes require author action', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ManualUpdateNeeded)}
                prs={[makePr({ reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }] })]}
                selectedPrId={107}
                onRowClick={vi.fn()}
            />,
        );

        expect(screen.getByTestId('pr-group-badge').textContent).toContain('Update needed');
        expect(screen.getByTestId('pr-group-reason').textContent).toBe('Requested changes from reviewer');
        expect(screen.getByTestId('pr-row').className).toContain('bg-blue-50');
    });
});
