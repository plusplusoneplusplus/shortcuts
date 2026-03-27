/**
 * Tests for SectionHeader shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionHeader } from '../../../../src/server/spa/client/react/shared/SectionHeader';

describe('SectionHeader', () => {
    it('renders the title', () => {
        render(<SectionHeader title="My Section" />);
        expect(screen.getByText('My Section')).toBeTruthy();
    });

    it('does not render refresh button when onRefresh is not provided', () => {
        render(<SectionHeader title="My Section" />);
        expect(screen.queryByText('Refresh')).toBeNull();
    });

    it('renders refresh button when onRefresh is provided', () => {
        const onRefresh = vi.fn();
        render(<SectionHeader title="My Section" onRefresh={onRefresh} />);
        expect(screen.getByText(/Refresh/)).toBeTruthy();
    });

    it('calls onRefresh when button is clicked', () => {
        const onRefresh = vi.fn();
        render(<SectionHeader title="My Section" onRefresh={onRefresh} />);
        fireEvent.click(screen.getByTestId('my-section-refresh-btn'));
        expect(onRefresh).toHaveBeenCalledOnce();
    });

    it('disables refresh button when refreshing', () => {
        const onRefresh = vi.fn();
        render(<SectionHeader title="My Section" onRefresh={onRefresh} refreshing />);
        const btn = screen.getByTestId('my-section-refresh-btn');
        expect(btn).toHaveProperty('disabled', true);
    });

    it('renders actions slot', () => {
        render(<SectionHeader title="Test" actions={<button data-testid="custom-action">Action</button>} />);
        expect(screen.getByTestId('custom-action')).toBeTruthy();
    });

    it('applies className prop', () => {
        const { container } = render(<SectionHeader title="Test" className="mb-4" />);
        expect(container.firstElementChild?.className).toContain('mb-4');
    });
});
