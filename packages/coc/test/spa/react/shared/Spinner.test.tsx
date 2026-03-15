/**
 * Tests for Spinner shared component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '../../../../src/server/spa/client/react/shared/Spinner';

describe('Spinner', () => {
    it('renders with aria-label="Loading"', () => {
        render(<Spinner />);
        expect(screen.getByLabelText('Loading')).toBeTruthy();
    });

    it('applies md size class by default', () => {
        render(<Spinner />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-4 w-4');
    });

    it('applies sm size class', () => {
        render(<Spinner size="sm" />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-3 w-3');
    });

    it('applies lg size class', () => {
        render(<Spinner size="lg" />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-6 w-6');
    });

    it('forwards className prop', () => {
        render(<Spinner className="my-spinner" />);
        expect(screen.getByLabelText('Loading').className).toContain('my-spinner');
    });

    it('includes animate-spin class', () => {
        render(<Spinner />);
        expect(screen.getByLabelText('Loading').className).toContain('animate-spin');
    });
});
