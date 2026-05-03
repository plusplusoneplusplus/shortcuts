/**
 * Unit tests for PullRequestRow — renders a single row in the PR list.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PullRequestRow } from '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestRow';
import type { PullRequest } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        id: 1,
        number: 42,
        title: 'Fix login bug',
        sourceBranch: 'feature/login-fix',
        targetBranch: 'main',
        status: 'open',
        createdAt: '2026-01-15T10:00:00Z',
        updatedAt: '2026-01-16T12:30:00Z',
        author: { displayName: 'Alice' },
        reviewers: [],
        ...overrides,
    };
}

describe('PullRequestRow — title and metadata', () => {
    it('renders PR title', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        expect(screen.getByText('Fix login bug')).toBeTruthy();
    });

    it('renders PR number when present', () => {
        render(<PullRequestRow pr={makePr({ number: 99 })} onClick={vi.fn()} />);
        expect(screen.getByText('#99')).toBeTruthy();
    });

    it('omits PR number when not present', () => {
        render(<PullRequestRow pr={makePr({ number: undefined })} onClick={vi.fn()} />);
        expect(screen.queryByText(/#\d+/)).toBeNull();
    });

    it('renders source and target branches', () => {
        render(<PullRequestRow pr={makePr({ sourceBranch: 'dev', targetBranch: 'main' })} onClick={vi.fn()} />);
        expect(screen.getByText('dev')).toBeTruthy();
        expect(screen.getByText('main')).toBeTruthy();
    });

    it('renders updated timestamp', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        const timeEl = document.querySelector('.pr-time');
        expect(timeEl?.textContent).toContain('Updated');
    });
});

describe('PullRequestRow — author', () => {
    it('renders author display name', () => {
        render(<PullRequestRow pr={makePr({ author: { displayName: 'Bob' } })} onClick={vi.fn()} />);
        expect(screen.getByText('Bob')).toBeTruthy();
    });

    it('renders author initial as avatar fallback', () => {
        render(<PullRequestRow pr={makePr({ author: { displayName: 'Carol' } })} onClick={vi.fn()} />);
        expect(screen.getByText('C')).toBeTruthy();
    });

    it('does not render author section when author is absent', () => {
        render(<PullRequestRow pr={makePr({ author: undefined })} onClick={vi.fn()} />);
        expect(document.querySelector('.pr-author')).toBeNull();
    });

    it('does not render author section when displayName is empty', () => {
        render(<PullRequestRow pr={makePr({ author: { displayName: '' } })} onClick={vi.fn()} />);
        expect(document.querySelector('.pr-author')).toBeNull();
    });
});

describe('PullRequestRow — status badge', () => {
    it('shows Open badge for open PRs', () => {
        render(<PullRequestRow pr={makePr({ status: 'open' })} onClick={vi.fn()} />);
        const badge = document.querySelector('.pr-status-badge');
        expect(badge?.textContent).toContain('Open');
    });

    it('shows Merged badge for merged PRs', () => {
        render(<PullRequestRow pr={makePr({ status: 'merged' })} onClick={vi.fn()} />);
        const badge = document.querySelector('.pr-status-badge');
        expect(badge?.textContent).toContain('Merged');
    });

    it('shows Closed badge for closed PRs', () => {
        render(<PullRequestRow pr={makePr({ status: 'closed' })} onClick={vi.fn()} />);
        const badge = document.querySelector('.pr-status-badge');
        expect(badge?.textContent).toContain('Closed');
    });

    it('shows Draft badge for draft PRs', () => {
        render(<PullRequestRow pr={makePr({ status: 'draft' })} onClick={vi.fn()} />);
        const badge = document.querySelector('.pr-status-badge');
        expect(badge?.textContent).toContain('Draft');
    });
});

describe('PullRequestRow — operational group badge', () => {
    it('renders the group badge and reason instead of the status badge when group label is supplied', () => {
        render(
            <PullRequestRow
                pr={makePr({ status: 'open' })}
                onClick={vi.fn()}
                groupLabel="Nudge reviewer"
                groupColor="bg-blue-100 text-blue-800"
                groupEmoji="💬"
                groupReason="No reviewer response in 2+ days"
            />,
        );

        const groupBadge = screen.getByTestId('pr-group-badge');
        expect(groupBadge.textContent).toContain('Nudge reviewer');
        expect(groupBadge.textContent).toContain('💬');
        expect(groupBadge.className).toContain('bg-blue-100');
        expect(groupBadge.className).toContain('text-blue-800');
        expect(screen.getByTestId('pr-group-reason').textContent).toBe('No reviewer response in 2+ days');
        expect(document.querySelector('.pr-status-badge')).toBeNull();
    });

    it('falls back to the old status badge when group label is absent', () => {
        render(<PullRequestRow pr={makePr({ status: 'draft' })} onClick={vi.fn()} />);

        expect(document.querySelector('.pr-status-badge')?.textContent).toContain('Draft');
        expect(screen.queryByTestId('pr-group-badge')).toBeNull();
        expect(screen.queryByTestId('pr-group-reason')).toBeNull();
    });

    it('keeps author, branch, reviewer, timestamp, and comment metadata with the group reason', () => {
        render(
            <PullRequestRow
                pr={makePr({
                    sourceBranch: 'feature/metadata',
                    targetBranch: 'main',
                    commentCount: 3,
                    reviewers: [{ identity: { displayName: 'Reviewer' }, vote: undefined }],
                })}
                onClick={vi.fn()}
                groupLabel="Validate merge"
                groupColor="bg-purple-100 text-purple-800"
                groupEmoji="✅"
                groupReason="All checks passed — ready to merge"
            />,
        );

        expect(screen.getByText('Alice')).toBeTruthy();
        expect(screen.getByText('feature/metadata')).toBeTruthy();
        expect(screen.getByText('main')).toBeTruthy();
        expect(screen.getByText('1 reviewer')).toBeTruthy();
        expect(screen.getByText('3 comments')).toBeTruthy();
        expect(document.querySelector('.pr-time')?.textContent).toContain('Updated');
    });
});

describe('PullRequestRow — click handling', () => {
    it('calls onClick when row is clicked', () => {
        const onClick = vi.fn();
        render(<PullRequestRow pr={makePr()} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('pr-row'));
        expect(onClick).toHaveBeenCalledOnce();
    });
});

describe('PullRequestRow — reviewer count', () => {
    it('shows reviewer count when reviewers are present', () => {
        const pr = makePr({
            reviewers: [
                { identity: { displayName: 'R1' }, vote: undefined, isRequired: false },
                { identity: { displayName: 'R2' }, vote: undefined, isRequired: false },
            ],
        });
        render(<PullRequestRow pr={pr} onClick={vi.fn()} />);
        expect(screen.getByText('2 reviewers')).toBeTruthy();
    });

    it('uses singular "reviewer" for count of 1', () => {
        const pr = makePr({
            reviewers: [{ identity: { displayName: 'R1' }, vote: undefined, isRequired: false }],
        });
        render(<PullRequestRow pr={pr} onClick={vi.fn()} />);
        expect(screen.getByText('1 reviewer')).toBeTruthy();
    });

    it('does not show reviewer count when reviewers list is empty', () => {
        render(<PullRequestRow pr={makePr({ reviewers: [] })} onClick={vi.fn()} />);
        expect(screen.queryByText(/reviewer/)).toBeNull();
    });

    it('does not show reviewer count when reviewers is undefined', () => {
        render(<PullRequestRow pr={makePr({ reviewers: undefined })} onClick={vi.fn()} />);
        expect(screen.queryByText(/reviewer/)).toBeNull();
    });
});

describe('PullRequestRow — comment count', () => {
    it('shows comment count when comments exist', () => {
        render(<PullRequestRow pr={makePr({ commentCount: 5 })} onClick={vi.fn()} />);
        expect(screen.getByText('5 comments')).toBeTruthy();
    });

    it('uses singular "comment" for count of 1', () => {
        render(<PullRequestRow pr={makePr({ commentCount: 1 })} onClick={vi.fn()} />);
        expect(screen.getByText('1 comment')).toBeTruthy();
    });

    it('does not show comment count when zero', () => {
        render(<PullRequestRow pr={makePr({ commentCount: 0 })} onClick={vi.fn()} />);
        expect(screen.queryByText(/comment/)).toBeNull();
    });

    it('does not show comment count when undefined', () => {
        render(<PullRequestRow pr={makePr({ commentCount: undefined })} onClick={vi.fn()} />);
        expect(screen.queryByText(/comment/)).toBeNull();
    });
});

describe('PullRequestRow — selection styling', () => {
    it('applies selected styling when isSelected is true', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} isSelected />);
        const row = screen.getByTestId('pr-row');
        expect(row.className).toContain('bg-blue-50');
    });

    it('applies hover styling when isSelected is false', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} isSelected={false} />);
        const row = screen.getByTestId('pr-row');
        expect(row.className).toContain('hover:bg-gray-50');
    });
});

describe('PullRequestRow — title truncation', () => {
    it('applies truncate class to title element', () => {
        render(<PullRequestRow pr={makePr({ title: 'A'.repeat(200) })} onClick={vi.fn()} />);
        const title = document.querySelector('.pr-title');
        expect(title?.className).toContain('truncate');
    });
});
