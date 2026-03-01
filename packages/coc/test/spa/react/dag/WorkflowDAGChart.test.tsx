import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkflowDAGChart } from '../../../../src/server/spa/client/react/repos/WorkflowDAGChart';
import type { WorkflowPreviewData } from '../../../../src/server/spa/client/react/repos/buildPreviewDAG';

function makeWorkflowData(): WorkflowPreviewData {
    const layers = new Map<string, number>();
    layers.set('load', 0);
    layers.set('transform', 1);
    layers.set('output', 2);
    return {
        nodes: [
            { id: 'load', type: 'load', label: 'Load Data', from: [] },
            { id: 'transform', type: 'transform', label: 'Transform', from: ['load'] },
            { id: 'output', type: 'reduce', label: 'Output', from: ['transform'] },
        ],
        edges: [
            { from: 'load', to: 'transform' },
            { from: 'transform', to: 'output' },
        ],
        layers,
        maxLayer: 2,
    };
}

describe('WorkflowDAGChart — zoom and pan', () => {
    it('renders zoom controls', () => {
        render(<WorkflowDAGChart data={makeWorkflowData()} isDark={false} />);
        expect(screen.getByTestId('zoom-controls')).toBeDefined();
    });

    it('SVG has transform group', () => {
        render(<WorkflowDAGChart data={makeWorkflowData()} isDark={false} />);
        const svg = screen.getByTestId('workflow-dag-chart');
        const g = svg.querySelector('g[transform]');
        expect(g).not.toBeNull();
    });

    it('initial transform contains scale(1)', () => {
        render(<WorkflowDAGChart data={makeWorkflowData()} isDark={false} />);
        const svg = screen.getByTestId('workflow-dag-chart');
        const g = svg.querySelector('g[transform]');
        expect(g?.getAttribute('transform')).toContain('scale(1)');
    });

    it('container has overflow hidden', () => {
        render(<WorkflowDAGChart data={makeWorkflowData()} isDark={false} />);
        const container = screen.getByTestId('workflow-dag-container');
        expect(container.style.overflow).toBe('hidden');
    });

    it('container wraps the SVG', () => {
        render(<WorkflowDAGChart data={makeWorkflowData()} isDark={false} />);
        const container = screen.getByTestId('workflow-dag-container');
        const svg = screen.getByTestId('workflow-dag-chart');
        expect(container.contains(svg)).toBe(true);
    });

    it('renders null for empty data', () => {
        const empty: WorkflowPreviewData = {
            nodes: [],
            edges: [],
            layers: new Map(),
            maxLayer: 0,
        };
        const { container } = render(<WorkflowDAGChart data={empty} isDark={false} />);
        expect(container.innerHTML).toBe('');
    });
});
