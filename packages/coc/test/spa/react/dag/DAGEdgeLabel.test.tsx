import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DAGEdgeLabel } from '../../../../src/server/spa/client/react/processes/dag/DAGEdgeLabel';

function renderInSvg(ui: React.ReactElement) {
    return render(<svg>{ui}</svg>);
}

describe('DAGEdgeLabel', () => {
    it('renders badge text', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        const label = screen.getByTestId('dag-edge-label');
        expect(label).toBeDefined();
        expect(label.textContent).toContain('CSV');
    });

    it('renders pill background rect', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        const label = screen.getByTestId('dag-edge-label');
        const rect = label.querySelector('rect');
        expect(rect).not.toBeNull();
        expect(rect?.getAttribute('rx')).toBe('9');
    });

    it('shows tooltip on hover when tooltipText is provided', () => {
        renderInSvg(
            <DAGEdgeLabel x={100} y={50} badgeText="CSV" tooltipText="Source: CSV (data.csv)" isDark={false} />
        );
        expect(screen.queryByTestId('dag-edge-tooltip')).toBeNull();
        fireEvent.mouseEnter(screen.getByTestId('dag-edge-label'));
        expect(screen.getByTestId('dag-edge-tooltip')).toBeDefined();
        expect(screen.getByTestId('dag-edge-tooltip').textContent).toContain('Source: CSV (data.csv)');
    });

    it('hides tooltip on mouse leave', () => {
        renderInSvg(
            <DAGEdgeLabel x={100} y={50} badgeText="CSV" tooltipText="Source: CSV" isDark={false} />
        );
        fireEvent.mouseEnter(screen.getByTestId('dag-edge-label'));
        expect(screen.getByTestId('dag-edge-tooltip')).toBeDefined();
        fireEvent.mouseLeave(screen.getByTestId('dag-edge-label'));
        expect(screen.queryByTestId('dag-edge-tooltip')).toBeNull();
    });

    it('does not render tooltip when tooltipText is undefined', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        fireEvent.mouseEnter(screen.getByTestId('dag-edge-label'));
        expect(screen.queryByTestId('dag-edge-tooltip')).toBeNull();
    });

    it('renders SVG title element for accessibility when tooltipText is provided', () => {
        renderInSvg(
            <DAGEdgeLabel x={100} y={50} badgeText="CSV" tooltipText="Full schema" isDark={false} />
        );
        const label = screen.getByTestId('dag-edge-label');
        const title = label.querySelector('title');
        expect(title).not.toBeNull();
        expect(title?.textContent).toBe('Full schema');
    });

    it('does not render SVG title when tooltipText is undefined', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        const label = screen.getByTestId('dag-edge-label');
        expect(label.querySelector('title')).toBeNull();
    });

    it('uses dark mode colors when isDark is true', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={true} />);
        const label = screen.getByTestId('dag-edge-label');
        const rect = label.querySelector('rect');
        expect(rect?.getAttribute('fill')).toBe('#2d2d2d');
        expect(rect?.getAttribute('stroke')).toBe('#3c3c3c');
    });

    it('uses light mode colors when isDark is false', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        const label = screen.getByTestId('dag-edge-label');
        const rect = label.querySelector('rect');
        expect(rect?.getAttribute('fill')).toBe('#f3f3f3');
        expect(rect?.getAttribute('stroke')).toBe('#e0e0e0');
    });

    it('badge width scales with text length', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="short" isDark={false} />);
        const rect1 = screen.getByTestId('dag-edge-label').querySelector('rect');
        const width1 = Number(rect1?.getAttribute('width'));

        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="a much longer badge text" isDark={false} />);
        const rects = document.querySelectorAll('[data-testid="dag-edge-label"] rect');
        const rect2 = rects[rects.length - 1];
        const width2 = Number(rect2?.getAttribute('width'));

        expect(width2).toBeGreaterThan(width1);
    });

    it('sets cursor to help when tooltipText is provided', () => {
        renderInSvg(
            <DAGEdgeLabel x={100} y={50} badgeText="CSV" tooltipText="schema" isDark={false} />
        );
        const label = screen.getByTestId('dag-edge-label');
        expect(label.style.cursor).toBe('help');
    });

    it('sets cursor to default when no tooltipText', () => {
        renderInSvg(<DAGEdgeLabel x={100} y={50} badgeText="CSV" isDark={false} />);
        const label = screen.getByTestId('dag-edge-label');
        expect(label.style.cursor).toBe('default');
    });
});
