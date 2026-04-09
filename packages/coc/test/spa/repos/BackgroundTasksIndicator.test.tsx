import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BackgroundTasksIndicator } from '../../../src/server/spa/client/react/repos/BackgroundTasksIndicator';
import type { BackgroundTasksState } from '../../../src/server/spa/client/react/hooks/useChatSSE';

function makeState(overrides: Partial<BackgroundTasksState> = {}): BackgroundTasksState {
    return {
        backgroundAgents: [],
        backgroundShells: [],
        backgroundTotalActive: 0,
        backgroundWaitingForDrain: false,
        ...overrides,
    };
}

describe('BackgroundTasksIndicator', () => {
    it('renders nothing when there are no active tasks', () => {
        const { container } = render(<BackgroundTasksIndicator backgroundTasks={makeState()} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the indicator when agents are active', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText('Waiting for background tasks')).toBeDefined();
    });

    it('renders the indicator when shells are active', () => {
        const state = makeState({
            backgroundShells: [{ id: 's1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText('Waiting for background tasks')).toBeDefined();
    });

    it('shows singular agent count label for one agent', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText(/🤖 1 agent/)).toBeDefined();
    });

    it('shows plural agent count label for multiple agents', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }, { id: 'a2' }],
            backgroundTotalActive: 2,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText(/🤖 2 agents/)).toBeDefined();
    });

    it('shows singular shell count label for one shell', () => {
        const state = makeState({
            backgroundShells: [{ id: 's1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText(/💻 1 shell/)).toBeDefined();
    });

    it('shows plural shell count label for multiple shells', () => {
        const state = makeState({
            backgroundShells: [{ id: 's1' }, { id: 's2' }, { id: 's3' }],
            backgroundTotalActive: 3,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText(/💻 3 shells/)).toBeDefined();
    });

    it('shows both agent and shell count labels when both are present', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }],
            backgroundShells: [{ id: 's1' }, { id: 's2' }],
            backgroundTotalActive: 3,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText(/🤖 1 agent/)).toBeDefined();
        expect(screen.getByText(/💻 2 shells/)).toBeDefined();
    });

    it('hides the indicator when totalActive drops to 0 on re-render', () => {
        const { rerender, container } = render(
            <BackgroundTasksIndicator
                backgroundTasks={makeState({ backgroundAgents: [{ id: 'a1' }], backgroundTotalActive: 1 })}
            />,
        );
        expect(container.firstChild).not.toBeNull();

        rerender(<BackgroundTasksIndicator backgroundTasks={makeState()} />);
        expect(container.firstChild).toBeNull();
    });

    it('does not render a toggle button when no items have descriptions', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('renders header as a button when at least one item has a description', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1', description: 'Processing...' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByRole('button')).toBeDefined();
    });

    it('expands to show item details when header is clicked', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1', description: 'Running analysis' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);

        expect(screen.queryByText(/"a1"/)).toBeNull();

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText(/"a1"/)).toBeDefined();
        expect(screen.getByText(/Running analysis/)).toBeDefined();
    });

    it('collapses again when header is clicked a second time', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1', description: 'Running analysis' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);

        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText(/"a1"/)).toBeDefined();

        fireEvent.click(screen.getByRole('button'));
        expect(screen.queryByText(/"a1"/)).toBeNull();
    });

    it('shows "more" overflow label when expanded list exceeds 3 items', () => {
        const agents = Array.from({ length: 5 }, (_, i) => ({
            id: `a${i}`,
            description: `Task ${i}`,
        }));
        const state = makeState({
            backgroundAgents: agents,
            backgroundTotalActive: 5,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        fireEvent.click(screen.getByRole('button'));

        expect(screen.getByText(/\+ 2 more/)).toBeDefined();
    });

    it('shows a maximum of 3 items in the expanded list when shouldCollapse is true', () => {
        const agents = Array.from({ length: 4 }, (_, i) => ({
            id: `a${i}`,
            description: `Task ${i}`,
        }));
        const state = makeState({
            backgroundAgents: agents,
            backgroundTotalActive: 4,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        fireEvent.click(screen.getByRole('button'));

        expect(screen.getByText(/"a0"/)).toBeDefined();
        expect(screen.getByText(/"a1"/)).toBeDefined();
        expect(screen.getByText(/"a2"/)).toBeDefined();
        expect(screen.queryByText(/"a3"/)).toBeNull();
    });

    it('shows agent kind label in expanded details', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1', description: 'desc' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('agent:')).toBeDefined();
    });

    it('shows shell kind label in expanded details', () => {
        const state = makeState({
            backgroundShells: [{ id: 's1', description: 'desc' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText('shell:')).toBeDefined();
    });

    it('shows spinner emoji in the header when active', () => {
        const state = makeState({
            backgroundAgents: [{ id: 'a1' }],
            backgroundTotalActive: 1,
        });
        render(<BackgroundTasksIndicator backgroundTasks={state} />);
        expect(screen.getByText('⏳')).toBeDefined();
    });
});
