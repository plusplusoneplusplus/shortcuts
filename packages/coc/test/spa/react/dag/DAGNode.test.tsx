import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DAGNode } from '../../../../src/server/spa/client/react/processes/dag/DAGNode';
import type { DAGNodeData } from '../../../../src/server/spa/client/react/processes/dag/types';

function makeNode(overrides: Partial<DAGNodeData> = {}): DAGNodeData {
    return {
        phase: 'map',
        state: 'completed',
        label: 'Map',
        ...overrides,
    };
}

function renderNode(nodeOverrides: Partial<DAGNodeData> = {}, props: Record<string, any> = {}) {
    return render(
        <svg>
            <DAGNode node={makeNode(nodeOverrides)} x={0} y={0} isDark={false} {...props} />
        </svg>
    );
}

describe('DAGNode', () => {
    it('renders rect with correct fill/stroke for completed state', () => {
        const { container } = renderNode({ state: 'completed' });
        const rect = container.querySelector('rect');
        expect(rect).toBeDefined();
        expect(rect?.getAttribute('fill')).toBe('#e6f4ea');
        expect(rect?.getAttribute('stroke')).toBe('#16825d');
    });

    it('renders rect with correct colors for failed state', () => {
        const { container } = renderNode({ state: 'failed' });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('fill')).toBe('#fde8e8');
        expect(rect?.getAttribute('stroke')).toBe('#f14c4c');
    });

    it('renders rect with correct colors for running state', () => {
        const { container } = renderNode({ state: 'running' });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('fill')).toBe('#e8f3ff');
        expect(rect?.getAttribute('stroke')).toBe('#0078d4');
    });

    it('displays phase label text', () => {
        const { container } = renderNode({ label: 'Map' });
        const texts = container.querySelectorAll('text');
        const labelText = Array.from(texts).find(t => t.textContent?.includes('Map'));
        expect(labelText).toBeDefined();
    });

    it('shows item count when totalItems is provided', () => {
        const { container } = renderNode({ totalItems: 10 });
        const texts = container.querySelectorAll('text');
        const itemText = Array.from(texts).find(t => t.textContent?.includes('10 items'));
        expect(itemText).toBeDefined();
    });

    it('shows item count with failed items', () => {
        const { container } = renderNode({ totalItems: 10, failedItems: 2 });
        const texts = container.querySelectorAll('text');
        const itemText = Array.from(texts).find(t => t.textContent?.includes('8/10 items'));
        expect(itemText).toBeDefined();
    });

    it('shows duration when provided', () => {
        const { container } = renderNode({ durationMs: 5000 });
        const texts = container.querySelectorAll('text');
        const durText = Array.from(texts).find(t => t.textContent?.includes('5s'));
        expect(durText).toBeDefined();
    });

    it('applies animate-pulse class for running state', () => {
        const { container } = renderNode({ state: 'running' });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('class')).toContain('animate-pulse');
    });

    it('does not apply animate-pulse for completed state', () => {
        const { container } = renderNode({ state: 'completed' });
        const rect = container.querySelector('rect');
        const cls = rect?.getAttribute('class') || '';
        expect(cls).not.toContain('animate-pulse');
    });

    it('fires onClick with correct phase', () => {
        const onClick = vi.fn();
        const { container } = renderNode({ phase: 'reduce', label: 'Reduce' }, { onClick });
        const g = container.querySelector('[data-testid="dag-node-reduce"]');
        expect(g).toBeDefined();
        fireEvent.click(g!);
        expect(onClick).toHaveBeenCalledWith('reduce');
    });

    it('renders data-testid with phase name', () => {
        const { container } = renderNode({ phase: 'input', label: 'Input' });
        const g = container.querySelector('[data-testid="dag-node-input"]');
        expect(g).toBeDefined();
    });

    it('includes tooltip with phase name and state', () => {
        const { container } = renderNode({ label: 'Map', state: 'running' });
        const title = container.querySelector('title');
        expect(title?.textContent).toContain('Map');
        expect(title?.textContent).toContain('running');
    });

    it('includes item count in tooltip when present', () => {
        const { container } = renderNode({ label: 'Map', state: 'completed', totalItems: 10 });
        const title = container.querySelector('title');
        expect(title?.textContent).toContain('10 items');
    });

    it('applies stroke-width 2.5 and blue stroke when selected is true', () => {
        const { container } = renderNode({ state: 'completed' }, { selected: true });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('stroke-width')).toBe('2.5');
        expect(rect?.getAttribute('stroke')).toBe('#0078d4');
    });

    it('applies stroke-width 2.5 and dark-mode blue stroke when selected and isDark', () => {
        const { container } = render(
            <svg>
                <DAGNode node={makeNode({ state: 'completed' })} x={0} y={0} isDark={true} selected={true} />
            </svg>
        );
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('stroke')).toBe('#3794ff');
    });

    it('applies default stroke-width when selected is false', () => {
        const { container } = renderNode({ state: 'completed' }, { selected: false });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('stroke-width')).toBe('1.5');
    });

    it('applies default stroke-width when selected is undefined', () => {
        const { container } = renderNode({ state: 'completed' });
        const rect = container.querySelector('rect');
        expect(rect?.getAttribute('stroke-width')).toBe('1.5');
    });

    it('has cursor: pointer style on the group element when onClick provided', () => {
        const { container } = renderNode({ phase: 'map', label: 'Map' }, { onClick: vi.fn() });
        const g = container.querySelector('[data-testid="dag-node-map"]');
        expect(g).toBeDefined();
        expect((g as HTMLElement)?.style.cursor).toBe('pointer');
    });
});
