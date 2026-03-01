import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DAGBreadcrumb } from '../../../../src/server/spa/client/react/processes/dag/DAGBreadcrumb';
import type { DAGNodeData } from '../../../../src/server/spa/client/react/processes/dag/types';

function makeNodes(overrides: Partial<DAGNodeData>[] = []): DAGNodeData[] {
    const defaults: DAGNodeData[] = [
        { phase: 'input', state: 'completed', label: 'Input' },
        { phase: 'map', state: 'running', label: 'Map' },
        { phase: 'reduce', state: 'waiting', label: 'Reduce' },
    ];
    return defaults.map((node, i) => ({ ...node, ...(overrides[i] || {}) }));
}

describe('DAGBreadcrumb', () => {
    it('renders with data-testid="dag-breadcrumb"', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        expect(screen.getByTestId('dag-breadcrumb')).toBeDefined();
    });

    it('returns null for empty nodes array', () => {
        const { container } = render(<DAGBreadcrumb nodes={[]} isDark={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('shows correct number of steps matching nodes.length', () => {
        const nodes = makeNodes();
        render(<DAGBreadcrumb nodes={nodes} isDark={false} />);
        for (const node of nodes) {
            expect(screen.getByTestId(`breadcrumb-step-${node.phase}`)).toBeDefined();
        }
    });

    it('completed step shows checkmark ✓', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const step = screen.getByTestId('breadcrumb-step-input');
        expect(step.textContent).toContain('✓');
    });

    it('running step has animate-pulse class', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const step = screen.getByTestId('breadcrumb-step-map');
        expect(step.className).toContain('animate-pulse');
    });

    it('waiting step shows step number', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const step = screen.getByTestId('breadcrumb-step-reduce');
        expect(step.textContent).toContain('3');
    });

    it('running step shows step number', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const step = screen.getByTestId('breadcrumb-step-map');
        expect(step.textContent).toContain('2');
    });

    it('displays phase labels', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const breadcrumb = screen.getByTestId('dag-breadcrumb');
        expect(breadcrumb.textContent).toContain('Input');
        expect(breadcrumb.textContent).toContain('Map');
        expect(breadcrumb.textContent).toContain('Reduce');
    });

    it('renders connecting lines between steps (not after last)', () => {
        const { container } = render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const lines = container.querySelectorAll('.w-6.h-\\[1px\\]');
        // 3 nodes → 2 connecting lines
        expect(lines.length).toBe(2);
    });

    it('uses dark mode colors for completed step', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={true} />);
        const step = screen.getByTestId('breadcrumb-step-input');
        expect(step.className).toContain('text-[#89d185]');
    });

    it('uses light mode colors for running step', () => {
        render(<DAGBreadcrumb nodes={makeNodes()} isDark={false} />);
        const step = screen.getByTestId('breadcrumb-step-map');
        expect(step.className).toContain('text-[#0078d4]');
    });
});
