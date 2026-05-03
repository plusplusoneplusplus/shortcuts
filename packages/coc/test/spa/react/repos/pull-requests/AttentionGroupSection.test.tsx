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
    it('shows the group reason on each PR row without a redundant group badge', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ReviewerNudge)}
                prs={[makePr()]}
                selectedPrId={null}
                onRowClick={vi.fn()}
            />,
        );

        // The section header carries the group label; rows should not repeat it as a badge
        expect(screen.queryByTestId('pr-group-badge')).toBeNull();
        // The status badge is shown instead on the row
        expect(document.querySelector('.pr-status-badge')).not.toBeNull();
        // The contextual reason is still shown beneath the title
        expect(screen.getByTestId('pr-group-reason').textContent).toBe('No reviewer response in 2+ days');
    });

    it('uses reviewer-requested-change reason for manual update rows', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ManualUpdateNeeded)}
                prs={[makePr({ reviewers: [{ identity: { displayName: 'Reviewer' }, vote: 'waitingForAuthor' }] })]}
                selectedPrId={107}
                onRowClick={vi.fn()}
            />,
        );

        // No redundant group badge on the row
        expect(screen.queryByTestId('pr-group-badge')).toBeNull();
        expect(screen.getByTestId('pr-group-reason').textContent).toBe('Requested changes from reviewer');
        expect(screen.getByTestId('pr-row').className).toContain('bg-blue-50');
    });

    it('hides group select-all and row checkboxes by default (no batchMode)', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ReviewerNudge)}
                prs={[makePr()]}
                selectedPrId={null}
                onRowClick={vi.fn()}
            />,
        );

        expect(screen.queryByTestId('group-select-all')).toBeNull();
        expect(screen.queryByTestId('pr-row-checkbox')).toBeNull();
    });

    it('shows group select-all and row checkboxes when batchMode is true', () => {
        render(
            <AttentionGroupSection
                config={makeConfig(AttentionGroup.ReviewerNudge)}
                prs={[makePr()]}
                selectedPrId={null}
                onRowClick={vi.fn()}
                batchMode={true}
            />,
        );

        expect(screen.getByTestId('group-select-all')).toBeTruthy();
        expect(screen.getByTestId('pr-row-checkbox')).toBeTruthy();
    });
});
