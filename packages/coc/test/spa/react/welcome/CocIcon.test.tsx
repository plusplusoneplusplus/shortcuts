/**
 * Unit tests for the inline CoC brand icon component.
 *
 * Covers:
 *   - Renders an <svg> with the expected default size
 *   - Honours the `size` and `className` props
 *   - Generates unique gradient ids per `idPrefix` (no SVG defs collisions)
 *   - Exposes an aria-label for screen readers
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CocIcon } from '../../../../src/server/spa/client/react/welcome/CocIcon';

describe('CocIcon', () => {
    it('renders an SVG with default size 100', () => {
        const { container } = render(<CocIcon />);
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg!.getAttribute('width')).toBe('100');
        expect(svg!.getAttribute('height')).toBe('100');
        expect(svg!.getAttribute('viewBox')).toBe('0 0 100 100');
    });

    it('honours the size prop', () => {
        const { container } = render(<CocIcon size={48} />);
        const svg = container.querySelector('svg');
        expect(svg!.getAttribute('width')).toBe('48');
        expect(svg!.getAttribute('height')).toBe('48');
    });

    it('applies className to the SVG element', () => {
        const { container } = render(<CocIcon className="custom-class" />);
        const svg = container.querySelector('svg');
        expect(svg!.classList.contains('custom-class')).toBe(true);
    });

    it('exposes the aria-label on the SVG (default "CoC")', () => {
        const { container, rerender } = render(<CocIcon />);
        let svg = container.querySelector('svg');
        expect(svg!.getAttribute('role')).toBe('img');
        expect(svg!.getAttribute('aria-label')).toBe('CoC');

        rerender(<CocIcon aria-label="Custom" />);
        svg = container.querySelector('svg');
        expect(svg!.getAttribute('aria-label')).toBe('Custom');
    });

    it('generates unique <defs> ids per idPrefix to avoid collisions', () => {
        const { container } = render(
            <>
                <CocIcon idPrefix="alpha" />
                <CocIcon idPrefix="beta" />
            </>,
        );
        const ids = Array.from(container.querySelectorAll('[id]')).map(el => el.id);
        // Each icon owns 4 defs (g1, g2, glow, pulse).
        expect(ids).toEqual(
            expect.arrayContaining([
                'alpha-g1', 'alpha-g2', 'alpha-glow', 'alpha-pulse',
                'beta-g1', 'beta-g2', 'beta-glow', 'beta-pulse',
            ]),
        );
        // No duplicates.
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('forwards data-testid to the SVG element', () => {
        const { getByTestId } = render(<CocIcon data-testid="my-icon" />);
        expect(getByTestId('my-icon').tagName.toLowerCase()).toBe('svg');
    });
});
