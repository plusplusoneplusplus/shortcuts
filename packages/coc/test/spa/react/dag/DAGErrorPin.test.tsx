import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DAGErrorPin } from '../../../../src/server/spa/client/react/processes/dag/DAGErrorPin';

function renderPin(props: Partial<Parameters<typeof DAGErrorPin>[0]> = {}) {
    const defaultProps = { x: 120, y: 20, errors: ['Bad input'], isDark: false, ...props };
    return render(
        <svg>
            <DAGErrorPin {...defaultProps} />
        </svg>
    );
}

describe('DAGErrorPin', () => {
    it('renders circle and text for single error', () => {
        const { container } = renderPin({ errors: ['Bad input'] });
        const circle = container.querySelector('circle');
        expect(circle).not.toBeNull();
        expect(circle?.getAttribute('fill')).toBe('#f14c4c');
        const texts = container.querySelectorAll('text');
        const pinText = Array.from(texts).find(t => t.textContent === '!');
        expect(pinText).toBeDefined();
    });

    it('renders count for multiple errors', () => {
        const { container } = renderPin({ errors: ['err1', 'err2'] });
        const texts = container.querySelectorAll('text');
        const pinText = Array.from(texts).find(t => t.textContent === '2');
        expect(pinText).toBeDefined();
    });

    it('returns null for empty errors', () => {
        const { container } = renderPin({ errors: [] });
        const g = container.querySelector('[data-testid="dag-error-pin"]');
        expect(g).toBeNull();
    });

    it('shows tooltip with error message', () => {
        const { container } = renderPin({ errors: ['Bad input'] });
        const title = container.querySelector('[data-testid="dag-error-pin"] title');
        expect(title?.textContent).toBe('Bad input');
    });

    it('joins multiple errors with newline in tooltip', () => {
        const { container } = renderPin({ errors: ['err1', 'err2'] });
        const title = container.querySelector('[data-testid="dag-error-pin"] title');
        expect(title?.textContent).toBe('err1\nerr2');
    });

    it('uses dark color when isDark is true', () => {
        const { container } = renderPin({ isDark: true });
        const circle = container.querySelector('circle');
        expect(circle?.getAttribute('fill')).toBe('#f48771');
    });

    it('has white stroke on circle', () => {
        const { container } = renderPin();
        const circle = container.querySelector('circle');
        expect(circle?.getAttribute('stroke')).toBe('#fff');
        expect(circle?.getAttribute('stroke-width')).toBe('1.5');
    });

    it('has data-testid attribute', () => {
        const { container } = renderPin();
        expect(container.querySelector('[data-testid="dag-error-pin"]')).not.toBeNull();
    });

    it('renders count of 3 for three errors', () => {
        const { container } = renderPin({ errors: ['e1', 'e2', 'e3'] });
        const texts = container.querySelectorAll('text');
        const pinText = Array.from(texts).find(t => t.textContent === '3');
        expect(pinText).toBeDefined();
    });
});
