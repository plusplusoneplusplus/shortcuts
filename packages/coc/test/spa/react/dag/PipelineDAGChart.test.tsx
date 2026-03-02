import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PipelineDAGChart } from '../../../../src/server/spa/client/react/processes/dag/PipelineDAGChart';
import type { DAGChartData } from '../../../../src/server/spa/client/react/processes/dag/types';
import type { PhaseDetail } from '../../../../src/server/spa/client/react/processes/dag/PipelinePhasePopover';
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';

function makeData(overrides: Partial<DAGChartData> = {}): DAGChartData {
    return {
        nodes: [
            { phase: 'input', state: 'completed', label: 'Input' },
            { phase: 'map', state: 'completed', label: 'Map', totalItems: 10 },
            { phase: 'reduce', state: 'completed', label: 'Reduce' },
        ],
        totalDurationMs: 5000,
        ...overrides,
    };
}

function makePhaseDetails(): Record<string, PhaseDetail> {
    return {
        input: { phase: 'input', status: 'completed', sourceType: 'CSV', itemCount: 10 },
        map: { phase: 'map', status: 'completed', concurrency: 4, model: 'gpt-4' },
        reduce: { phase: 'reduce', status: 'completed', reduceType: 'ai', model: 'gpt-4' },
    };
}

describe('PipelineDAGChart — node interaction', () => {
    it('clicking a node sets it as selected', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        const inputNode = screen.getByTestId('dag-node-input');
        fireEvent.click(inputNode);
        // Selected node should have thicker stroke
        const rect = inputNode.querySelector('rect');
        expect(rect?.getAttribute('stroke-width')).toBe('2.5');
        expect(rect?.getAttribute('stroke')).toBe('#0078d4');
    });

    it('clicking the same node again deselects it', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        const inputNode = screen.getByTestId('dag-node-input');
        fireEvent.click(inputNode);
        // Should be selected
        expect(inputNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('2.5');
        // Click again to deselect
        fireEvent.click(inputNode);
        expect(inputNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.5');
    });

    it('clicking a different node switches selection', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        const inputNode = screen.getByTestId('dag-node-input');
        const mapNode = screen.getByTestId('dag-node-map');

        fireEvent.click(inputNode);
        expect(inputNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('2.5');
        expect(mapNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.5');

        fireEvent.click(mapNode);
        expect(inputNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('1.5');
        expect(mapNode.querySelector('rect')?.getAttribute('stroke-width')).toBe('2.5');
    });

    it('renders PipelinePhasePopover when a node is selected', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        expect(screen.queryByTestId('phase-popover')).toBeNull();

        fireEvent.click(screen.getByTestId('dag-node-input'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();
        expect(screen.getByTestId('phase-popover').textContent).toContain('Input Phase');
    });

    it('does not render PipelinePhasePopover when no node is selected', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('pressing Escape clears selection', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />);
        fireEvent.click(screen.getByTestId('dag-node-input'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();

        act(() => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        });
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('clicking outside the chart clears selection', () => {
        render(
            <div>
                <div data-testid="outside">Outside</div>
                <PipelineDAGChart data={makeData()} isDark={false} phaseDetails={makePhaseDetails()} />
            </div>
        );
        fireEvent.click(screen.getByTestId('dag-node-input'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();

        act(() => {
            fireEvent.mouseDown(screen.getByTestId('outside'));
        });
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('does not render popover when phaseDetails is not provided', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        fireEvent.click(screen.getByTestId('dag-node-input'));
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('forwards onNodeClick callback', () => {
        const onNodeClick = vi.fn();
        render(<PipelineDAGChart data={makeData()} isDark={false} onNodeClick={onNodeClick} />);
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(onNodeClick).toHaveBeenCalledWith('map');
    });

    it('passes onScrollToConversation for failed phases', () => {
        const onScroll = vi.fn();
        const details: Record<string, PhaseDetail> = {
            input: { phase: 'input', status: 'completed' },
            map: { phase: 'map', status: 'failed', error: 'timeout' },
            reduce: { phase: 'reduce', status: 'completed' },
        };
        const data = makeData({
            nodes: [
                { phase: 'input', state: 'completed', label: 'Input' },
                { phase: 'map', state: 'failed', label: 'Map' },
                { phase: 'reduce', state: 'completed', label: 'Reduce' },
            ],
        });
        render(<PipelineDAGChart data={data} isDark={false} phaseDetails={details} onScrollToConversation={onScroll} />);
        fireEvent.click(screen.getByTestId('dag-node-map'));
        const scrollLink = screen.queryByTestId('scroll-to-conversation');
        expect(scrollLink).not.toBeNull();
        fireEvent.click(scrollLink!);
        expect(onScroll).toHaveBeenCalledWith('map');
    });
});

describe('PipelineDAGChart — visual context layer', () => {
    it('renders dag-legend', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('dag-legend')).toBeDefined();
    });

    it('renders dag-breadcrumb', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('dag-breadcrumb')).toBeDefined();
    });

    it('breadcrumb step count matches node count', () => {
        const data = makeData();
        render(<PipelineDAGChart data={data} isDark={false} />);
        for (const node of data.nodes) {
            expect(screen.getByTestId(`breadcrumb-step-${node.phase}`)).toBeDefined();
        }
    });

    it('parallelCount prop causes parallel badge on map node', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} parallelCount={4} />);
        const badge = screen.getByTestId('dag-parallel-badge-map');
        expect(badge).toBeDefined();
        expect(badge.textContent).toBe('×4');
    });

    it('does not show parallel badge when parallelCount is undefined', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.queryByTestId('dag-parallel-badge-map')).toBeNull();
    });

    it('parallel badge only appears on map node, not others', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} parallelCount={3} />);
        expect(screen.getByTestId('dag-parallel-badge-map')).toBeDefined();
        expect(screen.queryByTestId('dag-parallel-badge-input')).toBeNull();
        expect(screen.queryByTestId('dag-parallel-badge-reduce')).toBeNull();
    });
});

function makePipelineConfig(): PipelineConfig {
    return {
        name: 'test',
        input: { items: [{ name: 'a' }] },
        map: { prompt: 'Analyze {{name}}', model: 'gpt-4', parallel: 4 },
        reduce: { type: 'ai', prompt: 'Summarize results', model: 'gpt-4' },
    };
}

describe('PipelineDAGChart — hover tooltip', () => {
    it('does not render hover tooltip when pipelineConfig is not provided', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        fireEvent.mouseEnter(screen.getByTestId('dag-node-input'));
        expect(screen.queryByTestId('dag-hover-tooltip')).toBeNull();
    });

    it('renders hover tooltip when pipelineConfig is provided and a node is hovered', () => {
        // Note: getBoundingClientRect returns zeros in jsdom, so anchor computes to (0,0),
        // but the tooltip should still render.
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={makePipelineConfig()} />);
        fireEvent.mouseEnter(screen.getByTestId('dag-node-map'), { clientX: 200, clientY: 50 });
        expect(screen.getByTestId('dag-hover-tooltip')).toBeDefined();
        expect(screen.getByTestId('dag-hover-tooltip').textContent).toContain('Map Phase');
    });

    it('tooltip anchor is derived from mouse clientX/clientY relative to container', () => {
        // getBoundingClientRect returns zeros in jsdom, so container offset is (0,0).
        // The anchor should equal (clientX, clientY).
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={makePipelineConfig()} />);
        fireEvent.mouseEnter(screen.getByTestId('dag-node-input'), { clientX: 150, clientY: 40 });
        const tooltip = screen.getByTestId('dag-hover-tooltip');
        expect(tooltip.style.left).toBe('150px');
        expect(tooltip.style.top).toBe('40px');
    });

    it('hover tooltip disappears when selectedPhase is set (click takes precedence)', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={makePipelineConfig()} phaseDetails={makePhaseDetails()} />);
        // Hover first
        fireEvent.mouseEnter(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('dag-hover-tooltip')).toBeDefined();
        // Click to select — tooltip should disappear
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.queryByTestId('dag-hover-tooltip')).toBeNull();
        // Popover should be shown
        expect(screen.getByTestId('phase-popover')).toBeDefined();
    });
});

describe('PipelineDAGChart — edge annotations', () => {
    it('renders edge labels when pipelineConfig is provided with input data', () => {
        const config: PipelineConfig = {
            name: 'test',
            input: { items: [{ name: 'a' }, { name: 'b' }] },
            map: { prompt: 'Analyze {{name}}', model: 'gpt-4', output: ['result', 'score'] },
            reduce: { type: 'ai', prompt: 'Summarize', model: 'gpt-4' },
        };
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={config} />);
        const edgeLabels = screen.getAllByTestId('dag-edge-label');
        expect(edgeLabels.length).toBeGreaterThanOrEqual(1);
    });

    it('renders "2 items" badge on input→map edge', () => {
        const config: PipelineConfig = {
            name: 'test',
            input: { items: [{ name: 'a' }, { name: 'b' }] },
            map: { prompt: 'Analyze {{name}}', model: 'gpt-4' },
            reduce: { type: 'ai', prompt: 'Summarize', model: 'gpt-4' },
        };
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={config} />);
        const edgeLabels = screen.getAllByTestId('dag-edge-label');
        // textContent includes badge text + <title>; check that badge text is present
        expect(edgeLabels.some(el => el.textContent?.includes('2 items'))).toBe(true);
    });

    it('renders output fields badge on map→reduce edge', () => {
        const config: PipelineConfig = {
            name: 'test',
            input: { items: [{ name: 'a' }] },
            map: { prompt: 'test', model: 'gpt-4', output: ['category', 'summary'] },
            reduce: { type: 'ai', prompt: 'Summarize', model: 'gpt-4' },
        };
        render(<PipelineDAGChart data={makeData()} isDark={false} pipelineConfig={config} />);
        const edgeLabels = screen.getAllByTestId('dag-edge-label');
        expect(edgeLabels.some(el => el.textContent?.includes('[category, summary]'))).toBe(true);
    });

    it('does not render edge labels when pipelineConfig is not provided', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.queryAllByTestId('dag-edge-label')).toHaveLength(0);
    });

    it('renders "filtered" badge when filter phase is present', () => {
        const config: PipelineConfig = {
            name: 'test',
            input: { items: [{ name: 'a' }] },
            filter: { type: 'rule' },
            map: { prompt: 'test', model: 'gpt-4' },
            reduce: { type: 'ai', prompt: 'Summarize', model: 'gpt-4' },
        };
        const data: DAGChartData = {
            nodes: [
                { phase: 'input', state: 'completed', label: 'Input' },
                { phase: 'filter', state: 'completed', label: 'Filter' },
                { phase: 'map', state: 'completed', label: 'Map' },
                { phase: 'reduce', state: 'completed', label: 'Reduce' },
            ],
            totalDurationMs: 5000,
        };
        render(<PipelineDAGChart data={data} isDark={false} pipelineConfig={config} />);
        const edgeLabels = screen.getAllByTestId('dag-edge-label');
        expect(edgeLabels.some(el => el.textContent?.includes('filtered'))).toBe(true);
    });
});

describe('PipelineDAGChart — validation error pins', () => {
    it('distributes errors to correct nodes', () => {
        const data: DAGChartData = {
            nodes: [
                { phase: 'input', state: 'completed', label: 'Input' },
                { phase: 'filter', state: 'completed', label: 'Filter' },
                { phase: 'map', state: 'completed', label: 'Map' },
            ],
            totalDurationMs: 0,
        };
        render(
            <PipelineDAGChart
                data={data}
                isDark={false}
                validationErrors={['Missing input path', 'Invalid filter expression']}
            />
        );
        const inputNode = screen.getByTestId('dag-node-input');
        const filterNode = screen.getByTestId('dag-node-filter');
        const mapNode = screen.getByTestId('dag-node-map');
        expect(inputNode.querySelector('[data-testid="dag-error-pin"]')).not.toBeNull();
        expect(filterNode.querySelector('[data-testid="dag-error-pin"]')).not.toBeNull();
        expect(mapNode.querySelector('[data-testid="dag-error-pin"]')).toBeNull();
    });

    it('unmapped errors appear on all nodes', () => {
        render(
            <PipelineDAGChart
                data={makeData()}
                isDark={false}
                validationErrors={['Unknown error']}
            />
        );
        const pins = screen.getAllByTestId('dag-error-pin');
        expect(pins.length).toBe(3); // input, map, reduce all get the unmapped error
    });

    it('no error pins when validationErrors is undefined', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.queryAllByTestId('dag-error-pin')).toHaveLength(0);
    });

    it('no error pins when validationErrors is empty array', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} validationErrors={[]} />);
        expect(screen.queryAllByTestId('dag-error-pin')).toHaveLength(0);
    });
});

describe('PipelineDAGChart — zoom and pan', () => {
    it('renders zoom controls', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('zoom-controls')).toBeDefined();
    });

    it('SVG has transform group wrapping content', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const svg = screen.getByTestId('dag-chart');
        const g = svg.querySelector('g[transform]');
        expect(g).not.toBeNull();
    });

    it('initial transform contains scale(1)', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const svg = screen.getByTestId('dag-chart');
        const g = svg.querySelector('g[transform]');
        expect(g?.getAttribute('transform')).toContain('scale(1)');
        expect(g?.getAttribute('transform')).toContain('translate(0, 0)');
    });

    it('zoom in button updates transform', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const zoomInBtn = screen.getByTitle('Zoom in');
        fireEvent.click(zoomInBtn);
        const svg = screen.getByTestId('dag-chart');
        const g = svg.querySelector('g[transform]');
        expect(g?.getAttribute('transform')).toContain('scale(1.25)');
    });

    it('zoom label shows current percentage', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('zoom-label').textContent).toBe('100%');
    });

    it('container has overflow hidden', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const container = screen.getByTestId('dag-chart-container');
        // overflow hidden is on the inner wrapper, not the outer container
        const inner = container.firstElementChild as HTMLElement;
        expect(inner.style.overflow).toBe('hidden');
    });
});

describe('PipelineDAGChart — preview mode', () => {
    it('does not render legend when previewMode is true', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} previewMode />);
        expect(screen.queryByTestId('dag-legend')).toBeNull();
    });

    it('renders legend when previewMode is false/undefined', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('dag-legend')).toBeDefined();
    });

    it('uses smaller maxHeight in preview mode', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} previewMode />);
        const container = screen.getByTestId('dag-chart-container');
        // maxHeight is on the inner overflow wrapper, not the outer container
        const inner = container.firstElementChild as HTMLElement;
        expect(inner.style.maxHeight).toBe('180px');
    });

    it('uses larger maxHeight in non-preview mode', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const container = screen.getByTestId('dag-chart-container');
        const inner = container.firstElementChild as HTMLElement;
        expect(inner.style.maxHeight).toBe('300px');
    });

    it('SVG has maxHeight style in preview mode', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} previewMode />);
        const svg = screen.getByTestId('dag-chart');
        expect(svg.style.maxHeight).toBe('140px');
    });

    it('SVG has no maxHeight style in non-preview mode', () => {
        render(<PipelineDAGChart data={makeData()} isDark={false} />);
        const svg = screen.getByTestId('dag-chart');
        expect(svg.style.maxHeight).toBe('');
    });

    it('unmapped errors only appear on first node in preview mode', () => {
        render(
            <PipelineDAGChart
                data={makeData()}
                isDark={false}
                validationErrors={['Unknown error']}
                previewMode
            />
        );
        const inputNode = screen.getByTestId('dag-node-input');
        const mapNode = screen.getByTestId('dag-node-map');
        const reduceNode = screen.getByTestId('dag-node-reduce');
        expect(inputNode.querySelector('[data-testid="dag-error-pin"]')).not.toBeNull();
        expect(mapNode.querySelector('[data-testid="dag-error-pin"]')).toBeNull();
        expect(reduceNode.querySelector('[data-testid="dag-error-pin"]')).toBeNull();
    });

    it('unmapped errors still appear on all nodes without preview mode', () => {
        render(
            <PipelineDAGChart
                data={makeData()}
                isDark={false}
                validationErrors={['Unknown error']}
            />
        );
        const pins = screen.getAllByTestId('dag-error-pin');
        expect(pins.length).toBe(3);
    });

    it('phase-specific errors still show on correct node in preview mode', () => {
        render(
            <PipelineDAGChart
                data={makeData()}
                isDark={false}
                validationErrors={['Missing prompt template']}
                previewMode
            />
        );
        const mapNode = screen.getByTestId('dag-node-map');
        expect(mapNode.querySelector('[data-testid="dag-error-pin"]')).not.toBeNull();
    });
});
