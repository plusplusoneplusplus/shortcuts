// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ConversationArea is heavy (renders ConversationTurnBubble + many deps); stub
// it so we can assert the props SubAgentDetailView hands it in isolation.
vi.mock('../../../src/server/spa/client/react/features/chat/ConversationArea', () => ({
    ConversationArea: (props: any) => (
        <div
            data-testid="conversation-area"
            data-turns={props.turns.length}
            data-status={props.task?.status}
            data-has-cancel-cb={typeof props.onCancel === 'function' ? '1' : '0'}
        />
    ),
}));

import { SubAgentDetailView } from '../../../src/server/spa/client/react/features/chat/agent-canvas/SubAgentDetailView';
import type { AgentRunNode } from '../../../src/server/spa/client/react/features/chat/agent-canvas/types';
import type { ClientConversationTurn } from '../../../src/server/spa/client/react/types/dashboard';

function node(id: string, extra: Partial<AgentRunNode> = {}): AgentRunNode {
    return { id, name: id, role: 'agent', status: 'done', children: [], ...extra };
}

const root = node('root', { isRoot: true, role: 'orchestrator', name: 'Orch' });
const mid = node('mid', { name: 'middle-agent' });
const leaf = node('leaf', {
    name: 'leaf-agent',
    status: 'done',
    startedAt: 1000,
    completedAt: 10000,
    model: 'gpt-test',
    mode: 'background',
    children: [node('spawned-child')],
});
const path = [root, mid, leaf];
const turns: ClientConversationTurn[] = [
    { role: 'user', content: 'do it', turnIndex: 0, timeline: [] },
    { role: 'assistant', content: 'done', turnIndex: 1, timeline: [], toolCalls: [] },
];

function renderView(over: Partial<Parameters<typeof SubAgentDetailView>[0]> = {}) {
    return render(
        <SubAgentDetailView
            node={leaf}
            path={path}
            turns={turns}
            onNavigate={vi.fn()}
            task={{ status: 'running' }}
            taskId="task-1"
            variant="inline"
            {...over}
        />,
    );
}

describe('SubAgentDetailView', () => {
    it('renders a breadcrumb crumb for each node in the path', () => {
        renderView();
        expect(screen.getByTestId('sub-agent-crumb-root')).toBeTruthy();
        expect(screen.getByTestId('sub-agent-crumb-mid')).toBeTruthy();
        expect(screen.getByTestId('sub-agent-crumb-leaf')).toBeTruthy();
    });

    it('disables the last crumb and keeps ancestors clickable', () => {
        renderView();
        expect((screen.getByTestId('sub-agent-crumb-leaf') as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByTestId('sub-agent-crumb-mid') as HTMLButtonElement).disabled).toBe(false);
        expect((screen.getByTestId('sub-agent-crumb-root') as HTMLButtonElement).disabled).toBe(false);
    });

    it('navigates to null for the orchestrator root crumb and to the id for a sub-agent crumb', () => {
        const onNavigate = vi.fn();
        renderView({ onNavigate });
        fireEvent.click(screen.getByTestId('sub-agent-crumb-root'));
        expect(onNavigate).toHaveBeenCalledWith(null);
        fireEvent.click(screen.getByTestId('sub-agent-crumb-mid'));
        expect(onNavigate).toHaveBeenCalledWith('mid');
    });

    it('passes the synthetic turns to the (reused) ConversationArea', () => {
        renderView();
        expect(screen.getByTestId('conversation-area').getAttribute('data-turns')).toBe('2');
    });

    it('shapes the task status to the sub-agent, not the orchestrator', () => {
        // Orchestrator passed as running, but a done sub-agent must not show a live tail.
        renderView({ node: leaf, task: { status: 'running' } });
        expect(screen.getByTestId('conversation-area').getAttribute('data-status')).toBe('completed');
    });

    it('keeps a running sub-agent live', () => {
        renderView({ node: node('r', { status: 'running', name: 'r' }), path: [root, node('r', { status: 'running', name: 'r' })] });
        expect(screen.getByTestId('conversation-area').getAttribute('data-status')).toBe('running');
    });

    it('marks the view read-only', () => {
        renderView();
        expect(screen.getByText('read-only')).toBeTruthy();
    });

    it('renders status, duration, model, mode and spawned metadata', () => {
        renderView();
        expect(screen.getByTestId('sub-agent-status').textContent).toContain('Done');
        expect(screen.getByTestId('sub-agent-duration').textContent).toContain('0:09');
        expect(screen.getByTestId('sub-agent-model').textContent).toContain('gpt-test');
        expect(screen.getByTestId('sub-agent-mode').textContent).toContain('background');
        expect(screen.getByTestId('sub-agent-spawned').textContent).toContain('1 spawned');
    });

    it('does not duplicate task prompt or result outside ConversationArea', () => {
        renderView({
            node: node('no-dupe', {
                name: 'no-dupe',
                prompt: 'unique task prompt',
                result: 'unique task result',
            }),
            path: [root, node('no-dupe', { name: 'no-dupe' })],
        });
        expect(screen.queryByText('unique task prompt')).toBeNull();
        expect(screen.queryByText('unique task result')).toBeNull();
    });
});
