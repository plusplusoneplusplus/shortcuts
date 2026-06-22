/**
 * Unit tests for the redesigned PullRequestRow used by the PR review
 * command queue. Verifies the new state-dot + title + meta + risk pill
 * layout and selection / batch-mode behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PullRequestRow } from '../../../../../src/server/spa/client/react/features/pull-requests/PullRequestRow';
import type { PullRequest } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';
import {
    POINTER_CONTEXT_DRAG_MIME,
    PULL_REQUEST_CONTEXT_DRAG_KIND,
    type PullRequestContextDragPayload,
} from '../../../../../src/server/spa/client/react/features/chat/sessionContextDrag';

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

describe('PullRequestRow — title and meta', () => {
    it('renders the PR title', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        expect(screen.getByText('Fix login bug')).toBeTruthy();
    });

    it('renders the PR number when present', () => {
        render(<PullRequestRow pr={makePr({ number: 99 })} onClick={vi.fn()} />);
        expect(screen.getByText('#99')).toBeTruthy();
    });

    it('omits the PR number when not present', () => {
        render(<PullRequestRow pr={makePr({ number: undefined })} onClick={vi.fn()} />);
        expect(screen.queryByText(/#\d+/)).toBeNull();
    });

    it('renders file count from real diff stats', () => {
        render(<PullRequestRow pr={makePr({
            diffStats: { changedFiles: 4, additions: 100, deletions: 50 },
        })} onClick={vi.fn()} />);
        expect(document.querySelector('.pr-meta')?.textContent).toContain('4 files');
        expect(document.querySelector('.pr-meta')?.textContent).not.toContain('min');
    });

    it('shows an unavailable state when diff stats are not supplied', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        expect(document.querySelector('.pr-meta')?.textContent).toContain('n/a files');
        expect(document.querySelector('.pr-meta')?.textContent).not.toContain('min');
    });

    it('renders the last update time when updatedAt is present', () => {
        render(<PullRequestRow pr={makePr({ updatedAt: '2026-05-17T10:00:00Z' })} onClick={vi.fn()} />);
        const el = screen.getByTestId('pr-updated-at');
        expect(el).toBeTruthy();
        expect(el.textContent).toBeTruthy();
    });

    it('shows exact timestamp as tooltip on the updated-at element', () => {
        render(<PullRequestRow pr={makePr({ updatedAt: '2026-05-17T10:00:00Z' })} onClick={vi.fn()} />);
        const el = screen.getByTestId('pr-updated-at');
        expect(el.getAttribute('title')).toContain('2026');
    });

    it('omits the updated-at element when updatedAt is an empty string', () => {
        render(<PullRequestRow pr={makePr({ updatedAt: '' })} onClick={vi.fn()} />);
        expect(screen.queryByTestId('pr-updated-at')).toBeNull();
    });

    it('truncates long titles', () => {
        render(<PullRequestRow pr={makePr({ title: 'A'.repeat(200) })} onClick={vi.fn()} />);
        expect(document.querySelector('.pr-title')?.className).toContain('truncate');
    });
});

describe('PullRequestRow — state dot', () => {
    it('renders an "open" dot for open PRs that are not high-risk', () => {
        render(<PullRequestRow pr={makePr({ status: 'open' })} onClick={vi.fn()} risk="low" />);
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('open');
    });

    it('uses the "blocked" dot when the AI flags the PR as high risk', () => {
        render(<PullRequestRow pr={makePr({ status: 'open' })} onClick={vi.fn()} risk="high" />);
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('blocked');
    });

    it('uses the draft dot for draft PRs', () => {
        render(<PullRequestRow pr={makePr({ status: 'draft' })} onClick={vi.fn()} />);
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('draft');
    });

    it('uses the ready dot for merged / closed PRs (when not high risk)', () => {
        const { unmount } = render(
            <PullRequestRow pr={makePr({ status: 'merged' })} onClick={vi.fn()} risk="low" />,
        );
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('ready');
        unmount();
        render(<PullRequestRow pr={makePr({ status: 'closed' })} onClick={vi.fn()} risk="med" />);
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('ready');
    });

    it('respects an explicit dotState override', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} dotState="blocked" />);
        expect(screen.getByTestId('pr-state-dot').getAttribute('data-state')).toBe('blocked');
    });

    it('hides the state dot in batch mode (checkbox replaces it)', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} batchMode />);
        expect(screen.queryByTestId('pr-state-dot')).toBeNull();
        expect(screen.getByTestId('pr-row-checkbox')).toBeTruthy();
    });
});

describe('PullRequestRow — risk pill', () => {
    it('renders a deterministic risk pill from real diff stats', () => {
        render(<PullRequestRow pr={makePr({
            diffStats: { changedFiles: 2, additions: 150, deletions: 50 },
        })} onClick={vi.fn()} />);
        const pill = screen.getByTestId('pr-risk-pill');
        expect(pill.getAttribute('data-risk')).toBe('med');
        expect(pill.textContent).toBe('Med');
    });

    it('shows an unavailable risk state when diff stats are missing', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        const pill = screen.getByTestId('pr-risk-pill');
        expect(pill.getAttribute('data-risk')).toBe('unknown');
        expect(pill.textContent).toBe('N/A');
    });

    it('respects an explicit risk override', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} risk="high" />);
        const pill = screen.getByTestId('pr-risk-pill');
        expect(pill.getAttribute('data-risk')).toBe('high');
        expect(pill.textContent).toBe('High');
    });
});

describe('PullRequestRow — classification badge', () => {
    it('renders accessible Team auto-classification badge states', () => {
        const { rerender } = render(<PullRequestRow pr={makePr()} onClick={vi.fn()} classificationStatus="ready" />);
        expect(screen.getByTestId('pr-classification-badge')).toHaveTextContent('AI ready');
        expect(screen.getByTestId('pr-classification-badge')).toHaveAccessibleName('AI classification ready');

        rerender(<PullRequestRow pr={makePr()} onClick={vi.fn()} classificationStatus="running" />);
        expect(screen.getByTestId('pr-classification-badge')).toHaveTextContent('AI running');

        rerender(<PullRequestRow pr={makePr()} onClick={vi.fn()} classificationStatus="missing" />);
        expect(screen.getByTestId('pr-classification-badge')).toHaveTextContent('AI missing');
    });

    it('omits the classification badge in compact mode', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} compact classificationStatus="ready" />);
        expect(screen.queryByTestId('pr-classification-badge')).toBeNull();
    });
});

describe('PullRequestRow — selection styling', () => {
    it('applies the selected styling when isSelected is true', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} isSelected />);
        const row = screen.getByTestId('pr-row');
        expect(row.className).toContain('bg-gray-100');
        expect(row.className).toContain('border-l-gray-500');
    });

    it('applies the hover styling when isSelected is false', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} isSelected={false} />);
        expect(screen.getByTestId('pr-row').className).toContain('hover:bg-gray-50');
    });
});

describe('PullRequestRow — click handling', () => {
    it('calls onClick when the row is clicked', () => {
        const onClick = vi.fn();
        render(<PullRequestRow pr={makePr()} onClick={onClick} />);
        fireEvent.click(screen.getByTestId('pr-row'));
        expect(onClick).toHaveBeenCalledOnce();
    });
});

describe('PullRequestRow — context drag source', () => {
    it('writes pointer-only PR context on drag start', () => {
        const payload: PullRequestContextDragPayload = {
            kind: PULL_REQUEST_CONTEXT_DRAG_KIND,
            version: 1,
            sourceWorkspaceId: 'ws-test',
            pullRequestId: 'pr-node-42',
            number: 42,
            label: 'PR #42',
            title: 'Fix login bug',
            status: 'open',
        };
        const dataTransfer = {
            setData: vi.fn(),
            effectAllowed: 'move' as DataTransfer['effectAllowed'],
        };

        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} sessionContextPayload={payload} />);
        fireEvent.dragStart(screen.getByTestId('pr-row'), { dataTransfer });

        expect(dataTransfer.effectAllowed).toBe('copy');
        expect(dataTransfer.setData).toHaveBeenCalledWith(POINTER_CONTEXT_DRAG_MIME, JSON.stringify(payload));
        expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'CoC pointer context: PR #42 - Fix login bug');
    });
});

describe('PullRequestRow — compact mode', () => {
    it('renders only the state dot when compact', () => {
        render(<PullRequestRow pr={makePr({ title: 'Hidden title' })} onClick={vi.fn()} compact risk="med" />);
        expect(screen.getByTestId('pr-state-dot')).toBeInTheDocument();
        expect(screen.getByTestId('pr-row').getAttribute('data-compact')).toBe('true');
        expect(screen.queryByText('Hidden title')).toBeNull();
        expect(screen.queryByText(/#\d+/)).toBeNull();
        expect(screen.queryByTestId('pr-risk-pill')).toBeNull();
    });

    it('still calls onClick when the compact dot is clicked', () => {
        const onClick = vi.fn();
        render(<PullRequestRow pr={makePr()} onClick={onClick} compact />);
        fireEvent.click(screen.getByTestId('pr-row'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('exposes the PR title via title and aria-label for tooltips', () => {
        render(<PullRequestRow pr={makePr({ title: 'Tooltip PR' })} onClick={vi.fn()} compact />);
        const row = screen.getByTestId('pr-row');
        expect(row.getAttribute('title')).toBe('Tooltip PR');
        expect(row.getAttribute('aria-label')).toBe('Tooltip PR');
    });
});

describe('PullRequestRow — batch mode checkbox', () => {
    it('hides the checkbox by default', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} />);
        expect(screen.queryByTestId('pr-row-checkbox')).toBeNull();
    });

    it('hides the checkbox when batchMode is explicitly false', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} batchMode={false} />);
        expect(screen.queryByTestId('pr-row-checkbox')).toBeNull();
    });

    it('shows the checkbox when batchMode is true', () => {
        render(<PullRequestRow pr={makePr()} onClick={vi.fn()} batchMode />);
        expect(screen.getByTestId('pr-row-checkbox')).toBeTruthy();
    });

    it('reflects isChecked state', () => {
        const { rerender } = render(
            <PullRequestRow pr={makePr()} onClick={vi.fn()} batchMode isChecked={false} />,
        );
        expect((screen.getByTestId('pr-row-checkbox') as HTMLInputElement).checked).toBe(false);

        rerender(<PullRequestRow pr={makePr()} onClick={vi.fn()} batchMode isChecked />);
        expect((screen.getByTestId('pr-row-checkbox') as HTMLInputElement).checked).toBe(true);
    });

    it('invokes onSelect with the selection id when toggled', () => {
        const onSelect = vi.fn();
        render(<PullRequestRow pr={makePr({ number: 7 })} onClick={vi.fn()} batchMode onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));
        expect(onSelect).toHaveBeenCalledWith('7', true, false);
    });

    it('does not bubble row click when checkbox is toggled', () => {
        const onClick = vi.fn();
        render(<PullRequestRow pr={makePr()} onClick={onClick} batchMode />);
        fireEvent.click(screen.getByTestId('pr-row-checkbox'));
        expect(onClick).not.toHaveBeenCalled();
    });
});
