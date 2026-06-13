// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentInspector } from '../../../src/server/spa/client/react/features/chat/agent-canvas/AgentInspector';
import type { AgentRunNode } from '../../../src/server/spa/client/react/features/chat/agent-canvas/types';

function node(overrides: Partial<AgentRunNode> = {}): AgentRunNode {
    return { id: 'r1', name: 'explore-thing', role: 'Explore', status: 'done', children: [], ...overrides };
}

describe('AgentInspector', () => {
    it('renders name, role, status, duration, task and result for a finished run', () => {
        render(<AgentInspector node={node({ prompt: 'do the thing', result: 'did it', startedAt: 1000, completedAt: 10000 })} now={0} onClose={vi.fn()} />);
        expect(screen.getByText('explore-thing')).toBeTruthy();
        expect(screen.getByText('Explore')).toBeTruthy();
        expect(screen.getByText('Done')).toBeTruthy();
        expect(screen.getByText('0:09')).toBeTruthy(); // (9000-0)ms
        expect(screen.getByText('do the thing')).toBeTruthy();
        expect(screen.getByText('did it')).toBeTruthy();
    });

    it('shows a running placeholder when there is no result yet', () => {
        render(<AgentInspector node={node({ status: 'running', startedAt: 1000 })} now={1000} onClose={vi.fn()} />);
        expect(screen.getByText('Running…')).toBeTruthy();
    });

    it('shows a queued message for queued runs', () => {
        render(<AgentInspector node={node({ status: 'queued' })} now={0} onClose={vi.fn()} />);
        expect(screen.getByText(/waiting for a worker/)).toBeTruthy();
    });

    it('lists children and drills into one when clicked', () => {
        const onSelectChild = vi.fn();
        const root: AgentRunNode = {
            id: 'root', name: 'CoC', role: 'orchestrator', status: 'running', isRoot: true,
            children: [node({ id: 'a', name: 'child-a' }), node({ id: 'b', name: 'child-b' })],
        };
        render(<AgentInspector node={root} now={0} onClose={vi.fn()} onSelectChild={onSelectChild} />);
        expect(screen.getByText('child-a')).toBeTruthy();
        fireEvent.click(screen.getByTestId('agent-inspector-child-b'));
        expect(onSelectChild).toHaveBeenCalledTimes(1);
        expect(onSelectChild.mock.calls[0][0]).toMatchObject({ id: 'b' });
    });

    it('calls onClose from the close button', () => {
        const onClose = vi.fn();
        render(<AgentInspector node={node()} now={0} onClose={onClose} />);
        fireEvent.click(screen.getByLabelText('Close inspector'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hides the result section and Open-in-thread for the orchestrator root', () => {
        const onOpenInThread = vi.fn();
        const root: AgentRunNode = {
            id: 'root', name: 'CoC', role: 'orchestrator', status: 'running', isRoot: true, children: [],
        };
        render(<AgentInspector node={root} now={0} onClose={vi.fn()} onOpenInThread={onOpenInThread} />);
        expect(screen.queryByTestId('agent-inspector-open-thread')).toBeNull();
        expect(screen.queryByText('Result')).toBeNull();
    });
});
