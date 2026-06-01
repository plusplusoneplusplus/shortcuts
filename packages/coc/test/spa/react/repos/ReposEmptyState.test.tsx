/**
 * Tests for ReposEmptyState — empty state visual for the repository sidebar.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ReposEmptyState } from '../../../../src/server/spa/client/react/repos/ReposEmptyState';

describe('ReposEmptyState', () => {
    it('full variant renders heading, subtitle, and CTA button', () => {
        render(<ReposEmptyState onAddRepo={() => {}} />);
        expect(screen.getByTestId('repos-empty')).toBeTruthy();
        expect(screen.getByText('No repositories yet')).toBeTruthy();
        expect(screen.getByText('Add a repository to start working with AI workflows.')).toBeTruthy();
        expect(screen.getByText('+ Add Repository')).toBeTruthy();
    });

    it('full variant CTA button calls onAddRepo on click', () => {
        const onAddRepo = vi.fn();
        render(<ReposEmptyState onAddRepo={onAddRepo} />);
        fireEvent.click(screen.getByText('+ Add Repository'));
        expect(onAddRepo).toHaveBeenCalledOnce();
    });

    it('full variant renders clone CTA when provided', () => {
        render(<ReposEmptyState onAddRepo={() => {}} onCloneRepo={() => {}} />);
        expect(screen.getByText('Clone Repository')).toBeTruthy();
    });

    it('full variant clone CTA calls onCloneRepo on click', () => {
        const onCloneRepo = vi.fn();
        render(<ReposEmptyState onAddRepo={() => {}} onCloneRepo={onCloneRepo} />);
        fireEvent.click(screen.getByText('Clone Repository'));
        expect(onCloneRepo).toHaveBeenCalledOnce();
    });

    it('compact variant renders icon button with aria-label', () => {
        render(<ReposEmptyState onAddRepo={() => {}} compact />);
        expect(screen.getByTestId('repos-empty-compact')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add repository' })).toBeTruthy();
    });

    it('compact variant icon button calls onAddRepo on click', () => {
        const onAddRepo = vi.fn();
        render(<ReposEmptyState onAddRepo={onAddRepo} compact />);
        fireEvent.click(screen.getByRole('button', { name: 'Add repository' }));
        expect(onAddRepo).toHaveBeenCalledOnce();
    });

    it('full variant does not render compact testid', () => {
        render(<ReposEmptyState onAddRepo={() => {}} />);
        expect(screen.queryByTestId('repos-empty-compact')).toBeNull();
    });
});
