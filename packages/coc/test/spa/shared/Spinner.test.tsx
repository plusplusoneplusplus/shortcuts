import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from '../../../src/server/spa/client/react/shared/Spinner';

describe('Spinner', () => {
    it('renders without crashing for size sm', () => {
        render(<Spinner size="sm" />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('renders without crashing for size md', () => {
        render(<Spinner size="md" />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('renders without crashing for size lg', () => {
        render(<Spinner size="lg" />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('defaults to md size', () => {
        render(<Spinner />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-4');
        expect(el.className).toContain('w-4');
    });

    it('has aria-label="Loading"', () => {
        render(<Spinner />);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('has animate-spin class', () => {
        render(<Spinner />);
        expect(screen.getByLabelText('Loading').className).toContain('animate-spin');
    });

    it('forwards className', () => {
        render(<Spinner className="extra-class" />);
        expect(screen.getByLabelText('Loading').className).toContain('extra-class');
    });

    it('applies correct size classes for sm', () => {
        render(<Spinner size="sm" />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-3');
        expect(el.className).toContain('w-3');
    });

    it('applies correct size classes for lg', () => {
        render(<Spinner size="lg" />);
        const el = screen.getByLabelText('Loading');
        expect(el.className).toContain('h-6');
        expect(el.className).toContain('w-6');
    });
});
