import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PipelineDAGSection } from '../../../../src/server/spa/client/react/processes/dag/PipelineDAGSection';

function makeProcess(overrides: Record<string, any> = {}) {
    return {
        id: 'proc-1',
        status: 'completed',
        durationMs: 5000,
        metadata: {
            pipelineName: 'Bug Triage',
            executionStats: {
                totalItems: 10,
                successfulMaps: 8,
                failedMaps: 2,
                mapPhaseTimeMs: 3000,
                reducePhaseTimeMs: 500,
                maxConcurrency: 4,
            },
        },
        ...overrides,
    };
}

describe('PipelineDAGSection', () => {
    it('returns null for non-pipeline processes', () => {
        const { container } = render(<PipelineDAGSection process={{ id: 'x', status: 'completed' }} />);
        expect(container.querySelector('[data-testid="pipeline-dag-section"]')).toBeNull();
    });

    it('returns null when metadata is empty', () => {
        const { container } = render(<PipelineDAGSection process={{ id: 'x', status: 'completed', metadata: {} }} />);
        expect(container.querySelector('[data-testid="pipeline-dag-section"]')).toBeNull();
    });

    it('renders pipeline-dag-section for pipeline processes', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        expect(screen.getByTestId('pipeline-dag-section')).toBeDefined();
    });

    it('displays Pipeline Flow header text', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        expect(screen.getByTestId('dag-section-header').textContent).toContain('Pipeline Flow');
    });

    it('toggles collapsed state on header click', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        // Initially expanded — chart visible
        expect(screen.getByTestId('dag-chart')).toBeDefined();

        // Click to collapse
        fireEvent.click(screen.getByTestId('dag-section-header'));
        expect(screen.queryByTestId('dag-chart')).toBeNull();

        // Click to expand again
        fireEvent.click(screen.getByTestId('dag-section-header'));
        expect(screen.getByTestId('dag-chart')).toBeDefined();
    });

    it('shows total duration in header', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        const header = screen.getByTestId('dag-section-header');
        expect(header.textContent).toContain('5s');
    });

    it('shows status caption with correct icon for completed', () => {
        const { container } = render(<PipelineDAGSection process={makeProcess()} />);
        expect(container.textContent).toContain('✅');
        expect(container.textContent).toContain('Pipeline completed');
    });

    it('shows running caption for running process', () => {
        const proc = makeProcess({ status: 'running', durationMs: undefined });
        const { container } = render(<PipelineDAGSection process={proc} />);
        expect(container.textContent).toContain('🔄');
        expect(container.textContent).toContain('Running...');
    });

    it('shows failed caption for failed process', () => {
        const proc = makeProcess({ status: 'failed' });
        const { container } = render(<PipelineDAGSection process={proc} />);
        expect(container.textContent).toContain('❌');
        expect(container.textContent).toContain('Pipeline failed');
    });

    it('shows cancelled caption for cancelled process', () => {
        const proc = makeProcess({ status: 'cancelled' });
        const { container } = render(<PipelineDAGSection process={proc} />);
        expect(container.textContent).toContain('🚫');
        expect(container.textContent).toContain('Pipeline cancelled');
    });

    it('renders DAG chart with correct node count', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        const chart = screen.getByTestId('dag-chart');
        const nodes = chart.querySelectorAll('[data-testid^="dag-node-"]');
        expect(nodes.length).toBe(3); // input, map, reduce
    });

    it('renders edges between nodes', () => {
        render(<PipelineDAGSection process={makeProcess()} />);
        const chart = screen.getByTestId('dag-chart');
        const edges = chart.querySelectorAll('[data-testid="dag-edge"]');
        expect(edges.length).toBe(2); // input→map, map→reduce
    });
});
