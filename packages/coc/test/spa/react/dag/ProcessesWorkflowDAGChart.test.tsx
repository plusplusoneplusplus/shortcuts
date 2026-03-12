/**
 * Tests for the interactive processes/dag/WorkflowDAGChart component:
 * node click → WorkflowPhasePopover, Escape key dismiss, hover tooltip,
 * DAGLegend visibility in normal vs preview mode.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkflowDAGChart } from '../../../../src/server/spa/client/react/processes/dag/WorkflowDAGChart';
import type { DAGChartData } from '../../../../src/server/spa/client/react/processes/dag/types';
import type { PhaseDetail } from '../../../../src/server/spa/client/react/processes/dag/WorkflowPhasePopover';
import type { PipelineConfig } from '@plusplusoneplusplus/pipeline-core';

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true }),
}));

function makeData(): DAGChartData {
    return {
        nodes: [
            { phase: 'map', state: 'completed', label: 'Map', durationMs: 1200 },
            { phase: 'reduce', state: 'completed', label: 'Reduce', durationMs: 500 },
        ],
        totalDurationMs: 1700,
    };
}

function makePhaseDetails(): Record<string, PhaseDetail> {
    return {
        map: { phase: 'map', status: 'completed', model: 'gpt-4', concurrency: 2 },
        reduce: { phase: 'reduce', status: 'completed', reduceType: 'ai' },
    };
}

function makePipelineConfig(): PipelineConfig {
    return {
        name: 'test',
        map: { prompt: 'Analyze {{item}}', model: 'gpt-4', parallel: 2 },
    };
}

describe('processes/dag/WorkflowDAGChart — phase popover', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clicking a node with phaseDetails shows WorkflowPhasePopover', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        expect(screen.queryByTestId('phase-popover')).toBeNull();
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();
    });

    it('popover content reflects the clicked phase', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('phase-popover').textContent).toContain('Map Phase');
    });

    it('clicking close button (×) hides the popover', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();
        fireEvent.click(screen.getByTestId('phase-popover-close'));
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('clicking same node again toggles popover off', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('Escape key dismisses the phase popover', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.getByTestId('phase-popover')).toBeDefined();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('popover is not shown when phaseDetails not provided', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-map'));
        expect(screen.queryByTestId('phase-popover')).toBeNull();
    });

    it('clicking a different node shows that node popover', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                phaseDetails={makePhaseDetails()}
            />,
        );
        fireEvent.click(screen.getByTestId('dag-node-reduce'));
        expect(screen.getByTestId('phase-popover').textContent).toContain('Reduce Phase');
    });
});

describe('processes/dag/WorkflowDAGChart — hover tooltip', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('mouseenter with pipelineConfig shows DAGHoverTooltip', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                pipelineConfig={makePipelineConfig()}
            />,
        );
        expect(screen.queryByTestId('dag-hover-tooltip')).toBeNull();
        fireEvent.mouseEnter(screen.getByTestId('dag-node-map'), { clientX: 100, clientY: 80 });
        expect(screen.getByTestId('dag-hover-tooltip')).toBeDefined();
    });

    it('tooltip is hidden after mouseleave debounce (150 ms)', () => {
        vi.useFakeTimers();
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
                pipelineConfig={makePipelineConfig()}
            />,
        );
        fireEvent.mouseEnter(screen.getByTestId('dag-node-map'), { clientX: 100, clientY: 80 });
        expect(screen.getByTestId('dag-hover-tooltip')).toBeDefined();
        fireEvent.mouseLeave(screen.getByTestId('dag-node-map'));
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByTestId('dag-hover-tooltip')).toBeNull();
        vi.useRealTimers();
    });

    it('tooltip is not shown without pipelineConfig', () => {
        render(
            <WorkflowDAGChart
                data={makeData()}
                isDark={false}
            />,
        );
        fireEvent.mouseEnter(screen.getByTestId('dag-node-map'), { clientX: 100, clientY: 80 });
        expect(screen.queryByTestId('dag-hover-tooltip')).toBeNull();
    });
});

describe('processes/dag/WorkflowDAGChart — DAGLegend visibility', () => {
    it('renders DAGLegend in normal mode', () => {
        render(<WorkflowDAGChart data={makeData()} isDark={false} />);
        expect(screen.getByTestId('dag-legend')).toBeDefined();
    });

    it('does not render DAGLegend in previewMode', () => {
        render(<WorkflowDAGChart data={makeData()} isDark={false} previewMode={true} />);
        expect(screen.queryByTestId('dag-legend')).toBeNull();
    });
});
