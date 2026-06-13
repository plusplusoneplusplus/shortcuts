// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

    it('calls onSelect with the clicked node', () => {
        const onSelect = vi.fn();
        render(<AgentCanvas root={tree([sub('explore')])} onSelect={onSelect} />);
        fireEvent.click(screen.getByTestId('agent-canvas-node-explore'));
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'explore' });
    });

    it('marks the selected node with the sel class', () => {
        render(<AgentCanvas root={tree([sub('explore')])} selectedId="explore" />);
        expect(screen.getByTestId('agent-canvas-node-explore').className).toContain('sel');
        expect(screen.getByTestId('agent-canvas-node-root').className).not.toContain('sel');
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
});
