import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PipelineDAGChart } from '../../../../src/server/spa/client/react/processes/dag/PipelineDAGChart';
import type { DAGChartData } from '../../../../src/server/spa/client/react/processes/dag/types';
import type { PhaseDetail } from '../../../../src/server/spa/client/react/processes/dag/PipelinePhasePopover';

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
