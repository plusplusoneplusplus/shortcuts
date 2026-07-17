// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AgentCanvas } from '../../../src/server/spa/client/react/features/chat/agent-canvas/AgentCanvas';
import type { AgentRunNode } from '../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function tree(children: AgentRunNode[] = []): AgentRunNode {
    return { id: 'root', name: 'CoC · orchestrator', role: 'orchestrator', status: 'running', isRoot: true, children };
}

function sub(id: string, overrides: Partial<AgentRunNode> = {}): AgentRunNode {
    return { id, name: id, role: 'Explore', status: 'done', children: [], ...overrides };
}

function subT(id: string, turn: number, overrides: Partial<AgentRunNode> = {}): AgentRunNode {
    return sub(id, { turn, ...overrides });
}

describe('AgentCanvas', () => {
    it('renders the orchestrator root and every sub-agent node', () => {
        render(<AgentCanvas root={tree([sub('explore'), sub('review', { role: 'reviewer' })])} />);
        expect(screen.getByTestId('agent-canvas')).toBeTruthy();
        expect(screen.getByTestId('agent-canvas-node-root')).toBeTruthy();
        expect(screen.getByTestId('agent-canvas-node-explore')).toBeTruthy();
        expect(screen.getByTestId('agent-canvas-node-review')).toBeTruthy();
        expect(screen.getByText('CoC · orchestrator')).toBeTruthy();
        expect(screen.getByText('explore')).toBeTruthy();
    });

    it('shows a spawn-count pill on the root reflecting its children', () => {
        render(<AgentCanvas root={tree([sub('a'), sub('b'), sub('c')])} />);
        const rootNode = screen.getByTestId('agent-canvas-node-root');
        expect(rootNode.querySelector('.cn-spawn')?.textContent).toContain('3');
    });

    it('renders the empty-state hint when there are no sub-agents', () => {
        render(<AgentCanvas root={tree([])} />);
        expect(screen.getByText('No sub-agent runs')).toBeTruthy();
        // the root node still renders
        expect(screen.getByTestId('agent-canvas-node-root')).toBeTruthy();
    });

    it('routes a clicked sub-agent to the shared detail view', () => {
        const onOpenAgentDetail = vi.fn();
        render(<AgentCanvas root={tree([sub('explore', { name: 'map data' })])} onOpenAgentDetail={onOpenAgentDetail} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        expect(onOpenAgentDetail).toHaveBeenCalledTimes(1);
        expect(onOpenAgentDetail.mock.calls[0][0]).toMatchObject({ id: 'explore' });
        expect(screen.queryByTestId('agent-inspector')).toBeNull();
    });

    it('routes a clicked root node through the same navigation callback', () => {
        const onOpenAgentDetail = vi.fn();
        render(<AgentCanvas root={tree([sub('explore')])} onOpenAgentDetail={onOpenAgentDetail} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-root'));
        expect(onOpenAgentDetail).toHaveBeenCalledTimes(1);
        expect(onOpenAgentDetail.mock.calls[0][0]).toMatchObject({ id: 'root', isRoot: true });
    });

    it('keeps the legend visible after node clicks', () => {
        render(<AgentCanvas root={tree([sub('explore')])} onOpenAgentDetail={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        expect(screen.getByText('drag to pan · scroll to zoom')).toBeTruthy();
    });

    it('renders the zoom toolbar with a percentage label', () => {
        render(<AgentCanvas root={tree([sub('explore')])} />);
        const canvas = screen.getByTestId('agent-canvas');
        expect(canvas.querySelector('.canvas-toolbar')).toBeTruthy();
        expect(canvas.querySelector('.cz')?.textContent).toMatch(/%$/);
    });

    it('flags running children edges/nodes via data-status', () => {
        render(<AgentCanvas root={tree([sub('busy', { status: 'running' })])} />);
        expect(screen.getByTestId('agent-canvas-node-busy').getAttribute('data-status')).toBe('running');
    });

    it('opens a zoom preset menu from the % label', () => {
        render(<AgentCanvas root={tree([sub('a')])} />);
        expect(screen.queryByTestId('agent-canvas-zoom-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('agent-canvas-zoom-label'));
        const menu = screen.getByTestId('agent-canvas-zoom-menu');
        expect(within(menu).getByText('50%')).toBeTruthy();
        expect(within(menu).getByText('200%')).toBeTruthy();
        expect(within(menu).getByText('Fit to screen')).toBeTruthy();
    });

    it('closes the zoom menu after picking a preset', () => {
        render(<AgentCanvas root={tree([sub('a')])} />);
        fireEvent.click(screen.getByTestId('agent-canvas-zoom-label'));
        fireEvent.click(within(screen.getByTestId('agent-canvas-zoom-menu')).getByText('50%'));
        expect(screen.queryByTestId('agent-canvas-zoom-menu')).toBeNull();
    });
});

describe('AgentCanvas turn dividers', () => {
    it('shows a single turn label and no dividing line when all sub-agents share a turn (AC-02)', () => {
        render(<AgentCanvas root={tree([subT('a', 1), subT('b', 1)])} />);
        const dividers = screen.getAllByTestId('agent-canvas-turn-divider');
        expect(dividers).toHaveLength(1);
        expect(dividers[0].textContent).toContain('turn 1');
        expect(dividers[0].querySelector('.turn-divider-rule')).toBeNull();
    });

    it('draws a dotted line + label between groups, with no line above the first (AC-02/AC-03)', () => {
        // turns 1 and 4 spawn agents → real-ordinal labels with a gap
        render(<AgentCanvas root={tree([subT('a', 1), subT('b', 4)])} />);
        const dividers = screen.getAllByTestId('agent-canvas-turn-divider');
        expect(dividers).toHaveLength(2);
        expect(dividers[0].textContent).toContain('turn 1');
        expect(dividers[0].querySelector('.turn-divider-rule')).toBeNull(); // first: label only
        expect(dividers[1].textContent).toContain('turn 4');
        expect(dividers[1].querySelector('.turn-divider-rule')).not.toBeNull(); // boundary: dotted rule
    });

    it('renders no turn dividers when there are no sub-agents (AC-02)', () => {
        render(<AgentCanvas root={tree([])} />);
        expect(screen.queryAllByTestId('agent-canvas-turn-divider')).toHaveLength(0);
    });

    it('renders the dividers inside the zoom/pan world layer so they pan/zoom with nodes (AC-02)', () => {
        const { container } = render(<AgentCanvas root={tree([subT('a', 1), subT('b', 2)])} />);
        const world = container.querySelector('.agent-canvas .world');
        expect(world?.querySelectorAll('.turn-divider')).toHaveLength(2);
    });
});
