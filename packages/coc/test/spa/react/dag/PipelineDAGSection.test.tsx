import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkflowDAGSection } from '../../../../src/server/spa/client/react/processes/dag/WorkflowDAGSection';

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

/**
 * Minimal mock EventSource for testing live DAG updates in WorkflowDAGSection.
 */
function createMockEventSource() {
    const listeners = new Map<string, Set<(e: Event) => void>>();
    return {
        addEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(handler);
        }),
        removeEventListener: vi.fn((type: string, handler: (e: Event) => void) => {
            listeners.get(type)?.delete(handler);
        }),
        close: vi.fn(),
        _emit(type: string, data: any) {
            const event = { data: JSON.stringify(data) } as MessageEvent;
            for (const handler of listeners.get(type) ?? []) handler(event);
        },
        _emitError() {
            for (const handler of listeners.get('error') ?? []) handler(new Event('error'));
        },
    };
}

describe('WorkflowDAGSection', () => {
    it('returns null for non-pipeline processes', () => {
        const { container } = render(<WorkflowDAGSection process={{ id: 'x', status: 'completed' }} />);
        expect(container.querySelector('[data-testid="workflow-dag-section"]')).toBeNull();
    });

    it('returns null when metadata is empty', () => {
        const { container } = render(<WorkflowDAGSection process={{ id: 'x', status: 'completed', metadata: {} }} />);
        expect(container.querySelector('[data-testid="workflow-dag-section"]')).toBeNull();
    });

    it('renders pipeline-dag-section for pipeline processes', () => {
        render(<WorkflowDAGSection process={makeProcess()} />);
        expect(screen.getByTestId('workflow-dag-section')).toBeDefined();
    });

    it('displays Workflow Flow header text', () => {
        render(<WorkflowDAGSection process={makeProcess()} />);
        expect(screen.getByTestId('dag-section-header').textContent).toContain('Workflow Flow');
    });

    it('toggles collapsed state on header click', () => {
        render(<WorkflowDAGSection process={makeProcess()} />);
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
        render(<WorkflowDAGSection process={makeProcess()} />);
        const header = screen.getByTestId('dag-section-header');
        expect(header.textContent).toContain('5s');
    });

    it('shows status caption with correct icon for completed', () => {
        const { container } = render(<WorkflowDAGSection process={makeProcess()} />);
        expect(container.textContent).toContain('✅');
        expect(container.textContent).toContain('Workflow completed');
    });

    it('shows running caption for running process', () => {
        const proc = makeProcess({ status: 'running', durationMs: undefined });
        const { container } = render(<WorkflowDAGSection process={proc} />);
        expect(container.textContent).toContain('🔄');
        expect(container.textContent).toContain('Running...');
    });

    it('shows failed caption for failed process', () => {
        const proc = makeProcess({ status: 'failed' });
        const { container } = render(<WorkflowDAGSection process={proc} />);
        expect(container.textContent).toContain('❌');
        expect(container.textContent).toContain('Workflow failed');
    });

    it('shows cancelled caption for cancelled process', () => {
        const proc = makeProcess({ status: 'cancelled' });
        const { container } = render(<WorkflowDAGSection process={proc} />);
        expect(container.textContent).toContain('🚫');
        expect(container.textContent).toContain('Workflow cancelled');
    });

    it('renders DAG chart with correct node count', () => {
        render(<WorkflowDAGSection process={makeProcess()} />);
        const chart = screen.getByTestId('dag-chart');
        const nodes = chart.querySelectorAll('[data-testid^="dag-node-"]');
        expect(nodes.length).toBe(3); // input, map, reduce
    });

    it('renders edges between nodes', () => {
        render(<WorkflowDAGSection process={makeProcess()} />);
        const chart = screen.getByTestId('dag-chart');
        const edges = chart.querySelectorAll('[data-testid="dag-edge"]');
        expect(edges.length).toBe(2); // input→map, map→reduce
    });
});

describe('WorkflowDAGSection — live mode', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses static data for terminal processes even with eventSourceRef', () => {
        const es = createMockEventSource();
        const ref = { current: es as unknown as EventSource };
        const proc = makeProcess({ status: 'completed' });

        render(<WorkflowDAGSection process={proc} eventSourceRef={ref} />);
        expect(screen.getByTestId('workflow-dag-section')).toBeDefined();
        // Static data should produce completed nodes
        const chart = screen.getByTestId('dag-chart');
        const nodes = chart.querySelectorAll('[data-testid^="dag-node-"]');
        expect(nodes.length).toBe(3);
    });

    it('updates DAG nodes on SSE pipeline-phase events for running process', () => {
        const es = createMockEventSource();
        const ref = { current: es as unknown as EventSource };
        const proc = makeProcess({
            status: 'running',
            durationMs: undefined,
            metadata: {
                pipelineName: 'Test',
                pipelinePhases: [
                    { phase: 'input', status: 'completed' },
                    { phase: 'map', status: 'started' },
                    { phase: 'reduce', status: 'pending' },
                ],
            },
        });

        render(<WorkflowDAGSection process={proc} eventSourceRef={ref} />);

        // Emit phase events
        act(() => {
            es._emit('workflow-phase', { phase: 'input', status: 'completed', durationMs: 50 });
            es._emit('workflow-phase', { phase: 'map', status: 'started' });
        });

        // Should have at least the live nodes
        const chart = screen.getByTestId('dag-chart');
        expect(chart.querySelector('[data-testid="dag-node-input"]')).toBeDefined();
        expect(chart.querySelector('[data-testid="dag-node-map"]')).toBeDefined();
    });

    it('shows disconnect warning when EventSource errors', () => {
        const es = createMockEventSource();
        const ref = { current: es as unknown as EventSource };
        const proc = makeProcess({ status: 'running', durationMs: undefined });

        render(<WorkflowDAGSection process={proc} eventSourceRef={ref} />);

        // Emit some phases first so we have data
        act(() => {
            es._emit('workflow-phase', { phase: 'input', status: 'completed' });
        });

        act(() => {
            es._emitError();
        });

        const warning = screen.queryByTestId('dag-disconnect-warning');
        expect(warning).not.toBeNull();
    });

    it('does not show disconnect warning when connected', () => {
        const es = createMockEventSource();
        const ref = { current: es as unknown as EventSource };
        const proc = makeProcess({ status: 'running', durationMs: undefined });

        render(<WorkflowDAGSection process={proc} eventSourceRef={ref} />);

        act(() => {
            es._emit('workflow-phase', { phase: 'input', status: 'completed' });
        });

        const warning = screen.queryByTestId('dag-disconnect-warning');
        expect(warning).toBeNull();
    });
});
