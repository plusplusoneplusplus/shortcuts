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

    it('opens the inspector with the clicked sub-agent details and highlights the node', () => {
        render(<AgentCanvas root={tree([sub('explore', { name: 'map data', prompt: 'go map it', result: 'mapped ok' })])} />);
        expect(screen.queryByTestId('agent-inspector')).toBeNull();
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        const inspector = screen.getByTestId('agent-inspector');
        expect(within(inspector).getByText('map data')).toBeTruthy();
        expect(within(inspector).getByText('go map it')).toBeTruthy();
        expect(within(inspector).getByText('mapped ok')).toBeTruthy();
        expect(screen.getByTestId('agent-canvas-node-explore').className).toContain('sel');
    });

    it('closes the inspector when the root node is clicked', () => {
        render(<AgentCanvas root={tree([sub('explore')])} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        expect(screen.getByTestId('agent-inspector')).toBeTruthy();
        fireEvent.click(screen.getByTestId('agent-canvas-node-root'));
        expect(screen.queryByTestId('agent-inspector')).toBeNull();
    });

    it('closes the inspector via the close button', () => {
        render(<AgentCanvas root={tree([sub('explore')])} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        fireEvent.click(within(screen.getByTestId('agent-inspector')).getByLabelText('Close inspector'));
        expect(screen.queryByTestId('agent-inspector')).toBeNull();
    });

    it('calls onOpenAgentDetail from the inspector', () => {
        const onOpenAgentDetail = vi.fn();
        render(<AgentCanvas root={tree([sub('explore')])} onOpenAgentDetail={onOpenAgentDetail} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        fireEvent.click(screen.getByTestId('agent-inspector-open-detail'));
        expect(onOpenAgentDetail).toHaveBeenCalledTimes(1);
        expect(onOpenAgentDetail.mock.calls[0][0]).toMatchObject({ id: 'explore' });
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
