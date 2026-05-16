/**
 * Tests for LoopIcon — className pass-through, currentColor stroke, a11y.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoopIcon } from '../../../src/server/spa/client/react/features/chat/icons/LoopIcon';

describe('LoopIcon', () => {
    it('renders an svg with currentColor stroke', () => {
        const { container } = render(<LoopIcon />);
        const svg = container.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg?.getAttribute('stroke')).toBe('currentColor');
    });

    it('passes className through to the svg root', () => {
        const { container } = render(<LoopIcon className="w-3 h-3 custom" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('class')).toContain('w-3');
        expect(svg?.getAttribute('class')).toContain('h-3');
        expect(svg?.getAttribute('class')).toContain('custom');
    });

    it('is aria-hidden by default and has no role', () => {
        const { container } = render(<LoopIcon />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('aria-hidden')).toBe('true');
        expect(svg?.getAttribute('role')).toBeNull();
    });

    it('exposes role=img and a <title> when title prop is provided', () => {
        const { container } = render(<LoopIcon title="Has active loops" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('role')).toBe('img');
        expect(svg?.getAttribute('aria-hidden')).toBeNull();
        expect(container.querySelector('svg > title')?.textContent).toBe('Has active loops');
    });

    it('has data-testid="loop-icon" for selector use', () => {
        const { container } = render(<LoopIcon />);
        expect(container.querySelector('[data-testid="loop-icon"]')).toBeTruthy();
    });
});
