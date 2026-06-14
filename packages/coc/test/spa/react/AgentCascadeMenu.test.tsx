// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentCascadeMenu } from '../../../src/server/spa/client/react/features/chat/agent-canvas/AgentCascadeMenu';
import type { AgentLevel } from '../../../src/server/spa/client/react/features/chat/agent-canvas/agentLevels';
import type { AgentRunNode } from '../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(id: string, extra: Partial<AgentRunNode> = {}): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children: [], ...extra };
}

const levels: AgentLevel[] = [
    { depth: 0, label: 'L0 · orchestrator', agents: [node('root', { isRoot: true, role: 'orchestrator', name: 'Orch' })] },
    { depth: 1, label: 'L1', agents: [node('a1', { name: 'agent-one', role: 'explore' }), node('a2', { name: 'agent-two', role: 'task' })] },
    { depth: 2, label: 'L2', agents: [node('b1', { name: 'deep-one' })] },
];

describe('AgentCascadeMenu', () => {
    it('renders a trigger and opens the cascade on click', () => {
        render(<AgentCascadeMenu levels={levels} selectedAgentId={null} onSelectAgent={vi.fn()} />);
        expect(screen.queryByTestId('agent-cascade-menu')).toBeNull();
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        expect(screen.getByTestId('agent-cascade-menu')).toBeTruthy();
        expect(screen.getByTestId('agent-cascade-level-0')).toBeTruthy();
        expect(screen.getByTestId('agent-cascade-level-1')).toBeTruthy();
        expect(screen.getByTestId('agent-cascade-level-2')).toBeTruthy();
    });

    it('defaults the open pane to L1 and lists its agents', () => {
        render(<AgentCascadeMenu levels={levels} selectedAgentId={null} onSelectAgent={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        expect(screen.getByTestId('agent-cascade-agent-a1')).toBeTruthy();
        expect(screen.getByTestId('agent-cascade-agent-a2')).toBeTruthy();
        expect(screen.queryByTestId('agent-cascade-agent-b1')).toBeNull();
    });

    it('reveals a deeper level\'s agents on hover', () => {
        render(<AgentCascadeMenu levels={levels} selectedAgentId={null} onSelectAgent={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        fireEvent.mouseEnter(screen.getByTestId('agent-cascade-level-2'));
        expect(screen.getByTestId('agent-cascade-agent-b1')).toBeTruthy();
    });

    it('selects a sub-agent by id and closes', () => {
        const onSelectAgent = vi.fn();
        render(<AgentCascadeMenu levels={levels} selectedAgentId={null} onSelectAgent={onSelectAgent} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        fireEvent.click(screen.getByTestId('agent-cascade-agent-a2'));
        expect(onSelectAgent).toHaveBeenCalledWith('a2');
        expect(screen.queryByTestId('agent-cascade-menu')).toBeNull();
    });

    it('selecting the orchestrator (L0) returns to the thread (null)', () => {
        const onSelectAgent = vi.fn();
        render(<AgentCascadeMenu levels={levels} selectedAgentId="a1" onSelectAgent={onSelectAgent} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        fireEvent.click(screen.getByTestId('agent-cascade-level-0'));
        fireEvent.click(screen.getByTestId('agent-cascade-agent-root'));
        expect(onSelectAgent).toHaveBeenCalledWith(null);
    });

    it('reflects the selected agent via aria-checked', () => {
        render(<AgentCascadeMenu levels={levels} selectedAgentId="a1" onSelectAgent={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        expect(screen.getByTestId('agent-cascade-agent-a1').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('agent-cascade-agent-a2').getAttribute('aria-checked')).toBe('false');
    });

    it('closes on Escape', () => {
        render(<AgentCascadeMenu levels={levels} selectedAgentId={null} onSelectAgent={vi.fn()} />);
        fireEvent.click(screen.getByTestId('agent-cascade-trigger'));
        expect(screen.getByTestId('agent-cascade-menu')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('agent-cascade-menu')).toBeNull();
    });

    it('renders nothing when there are no sub-agent levels (L0 only)', () => {
        render(<AgentCascadeMenu levels={[levels[0]]} selectedAgentId={null} onSelectAgent={vi.fn()} />);
        expect(screen.queryByTestId('agent-cascade-trigger')).toBeNull();
    });
});
