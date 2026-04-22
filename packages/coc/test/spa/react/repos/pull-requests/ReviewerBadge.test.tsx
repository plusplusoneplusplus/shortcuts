/**
 * Tests for ReviewerBadge — vote icon for all vote values, isRequired badge.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReviewerBadge } from '../../../../../src/server/spa/client/react/features/pull-requests/ReviewerBadge';
import type { Reviewer } from '../../../../../src/server/spa/client/react/features/pull-requests/pr-utils';

function makeReviewer(overrides: Partial<Reviewer> = {}): Reviewer {
    return {
        identity: { displayName: 'Alice' },
        vote: undefined,
        isRequired: false,
        ...overrides,
    };
}

describe('ReviewerBadge — display name', () => {
    it('renders reviewer display name', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ identity: { displayName: 'Bob' } })} />);
        expect(screen.getByText('@Bob')).toBeTruthy();
    });

    it('falls back to email when displayName is absent', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ identity: { email: 'carol@example.com' } })} />);
        expect(screen.getByText('@carol@example.com')).toBeTruthy();
    });

    it('shows Unknown when neither displayName nor email present', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ identity: {} })} />);
        expect(screen.getByText('@Unknown')).toBeTruthy();
    });
});

describe('ReviewerBadge — isRequired badge', () => {
    it('shows (required) label when isRequired is true', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ isRequired: true })} />);
        expect(screen.getByText('(required)')).toBeTruthy();
    });

    it('does not show (required) label when isRequired is false', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ isRequired: false })} />);
        expect(screen.queryByText('(required)')).toBeNull();
    });
});

describe('ReviewerBadge — vote icons', () => {
    it('shows ✅ icon and "Approved" label for approved vote', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: 'approved' })} />);
        expect(screen.getByTitle('Approved')).toBeTruthy();
        expect(screen.getByText('Approved')).toBeTruthy();
    });

    it('shows ✅ icon and "Approved with suggestions" label for approvedWithSuggestions', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: 'approvedWithSuggestions' })} />);
        expect(screen.getByTitle('Approved with suggestions')).toBeTruthy();
        expect(screen.getByText('Approved with suggestions')).toBeTruthy();
    });

    it('shows ❌ icon and "Rejected" label for rejected vote', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: 'rejected' })} />);
        expect(screen.getByTitle('Rejected')).toBeTruthy();
        expect(screen.getByText('Rejected')).toBeTruthy();
    });

    it('shows ⏳ icon and "Waiting for author" label for waitingForAuthor vote', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: 'waitingForAuthor' })} />);
        expect(screen.getByTitle('Waiting for author')).toBeTruthy();
        expect(screen.getByText('Waiting for author')).toBeTruthy();
    });

    it('shows ⬜ icon and "No vote" label for undefined vote', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: undefined })} />);
        expect(screen.getByTitle('No vote')).toBeTruthy();
        expect(screen.getByText('No vote')).toBeTruthy();
    });

    it('shows ⬜ icon and "No vote" label for unknown vote value', () => {
        render(<ReviewerBadge reviewer={makeReviewer({ vote: 'unknown-value' })} />);
        expect(screen.getByTitle('No vote')).toBeTruthy();
    });
});
