/**
 * Tests for AmendMessageModal — required title, 72-char soft warn, Escape/Enter.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmendMessageModal } from '../../../../src/server/spa/client/react/repos/AmendMessageModal';
import type { GitCommitItem } from '../../../../src/server/spa/client/react/repos/CommitList';

const mockCommit: GitCommitItem = {
    hash: 'abc123',
    shortHash: 'abc',
    subject: 'feat: initial commit',
    body: 'Body text',
    author: 'Dev',
    date: '2024-01-01',
    parentHashes: [],
};

function renderModal(overrides: Partial<Parameters<typeof AmendMessageModal>[0]> = {}) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const result = render(
        <AmendMessageModal
            commit={mockCommit}
            onConfirm={onConfirm}
            onCancel={onCancel}
            {...overrides}
        />
    );
    return { ...result, onConfirm, onCancel };
}

describe('AmendMessageModal — pre-population', () => {
    it('pre-populates title from commit.subject', () => {
        renderModal();
        expect(screen.getByDisplayValue('feat: initial commit')).toBeTruthy();
    });

    it('pre-populates body from commit.body', () => {
        renderModal();
        expect(screen.getByDisplayValue('Body text')).toBeTruthy();
    });
});

describe('AmendMessageModal — validation', () => {
    it('shows error when title is empty and Confirm is clicked', async () => {
        const user = userEvent.setup();
        renderModal();
        await user.clear(screen.getByDisplayValue('feat: initial commit'));
        await user.click(screen.getByRole('button', { name: /amend/i }));
        expect(screen.getByText('Commit title is required.')).toBeTruthy();
    });

    it('does not call onConfirm when title is whitespace-only', async () => {
        const user = userEvent.setup();
        const { onConfirm } = renderModal();
        const titleInput = screen.getByDisplayValue('feat: initial commit');
        await user.clear(titleInput);
        await user.type(titleInput, '   ');
        await user.click(screen.getByRole('button', { name: /amend/i }));
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('calls onConfirm with trimmed title and body on success', async () => {
        const user = userEvent.setup();
        const { onConfirm } = renderModal();
        const titleInput = screen.getByDisplayValue('feat: initial commit');
        await user.clear(titleInput);
        await user.type(titleInput, '  fixed: trimmed  ');
        await user.click(screen.getByRole('button', { name: /amend/i }));
        expect(onConfirm).toHaveBeenCalledWith('fixed: trimmed', 'Body text');
    });
});

describe('AmendMessageModal — cancel / Escape', () => {
    it('calls onCancel when Cancel button is clicked', async () => {
        const user = userEvent.setup();
        const { onCancel } = renderModal();
        await user.click(screen.getByRole('button', { name: /cancel/i }));
        expect(onCancel).toHaveBeenCalled();
    });

    it('calls onCancel when Escape key is pressed', () => {
        const { onCancel, container } = renderModal();
        fireEvent.keyDown(container.firstChild as Element, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalled();
    });
});

describe('AmendMessageModal — 72-char soft warning', () => {
    it('shows soft warning when title exceeds 72 chars', async () => {
        const user = userEvent.setup();
        renderModal();
        const titleInput = screen.getByDisplayValue('feat: initial commit');
        await user.clear(titleInput);
        await user.type(titleInput, 'a'.repeat(73));
        // Warning includes the char count and the threshold
        expect(screen.getByText(/73 chars/)).toBeTruthy();
        expect(screen.getByText(/72/)).toBeTruthy();
    });

    it('does not show soft warning when title is within 72 chars', () => {
        renderModal();
        expect(screen.queryByText(/chars/)).toBeNull();
    });
});
