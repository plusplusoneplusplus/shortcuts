import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DAGLegend } from '../../../../src/server/spa/client/react/processes/dag/DAGLegend';
import { getNodeColors } from '../../../../src/server/spa/client/react/processes/dag/dag-colors';
import type { DAGNodeState } from '../../../../src/server/spa/client/react/processes/dag/types';

function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${r}, ${g}, ${b})`;
}

describe('DAGLegend', () => {
    it('renders with data-testid="dag-legend"', () => {
        render(<DAGLegend isDark={false} />);
        expect(screen.getByTestId('dag-legend')).toBeDefined();
    });

    it('contains 5 legend entries', () => {
        render(<DAGLegend isDark={false} />);
        const legend = screen.getByTestId('dag-legend');
        const labels = ['Waiting', 'Running', 'Completed', 'Failed', 'Cancelled'];
        for (const label of labels) {
            expect(legend.textContent).toContain(label);
        }
    });

    it('does not include Skipped state', () => {
        render(<DAGLegend isDark={false} />);
        const legend = screen.getByTestId('dag-legend');
        expect(legend.textContent).not.toContain('Skipped');
    });

    it('renders colored dots matching getNodeColors border for light mode', () => {
        const { container } = render(<DAGLegend isDark={false} />);
        const dots = container.querySelectorAll('[data-testid="dag-legend"] > span > span:first-child');
        const states: DAGNodeState[] = ['waiting', 'running', 'completed', 'failed', 'cancelled'];
        dots.forEach((dot, i) => {
            const expected = hexToRgb(getNodeColors(states[i], false).border);
            expect((dot as HTMLElement).style.backgroundColor).toBe(expected);
        });
    });

    it('renders colored dots matching getNodeColors border for dark mode', () => {
        const { container } = render(<DAGLegend isDark={true} />);
        const dots = container.querySelectorAll('[data-testid="dag-legend"] > span > span:first-child');
        const states: DAGNodeState[] = ['waiting', 'running', 'completed', 'failed', 'cancelled'];
        dots.forEach((dot, i) => {
            const expected = hexToRgb(getNodeColors(states[i], true).border);
            expect((dot as HTMLElement).style.backgroundColor).toBe(expected);
        });
    });

    it('renders exactly 5 dot elements', () => {
        const { container } = render(<DAGLegend isDark={false} />);
        const dots = container.querySelectorAll('[data-testid="dag-legend"] > span > span:first-child');
        expect(dots.length).toBe(5);
    });
});
