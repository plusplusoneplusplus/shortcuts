// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatViewToggle, viewForAgentSelection } from '../../../src/server/spa/client/react/features/chat/agent-canvas/ChatViewToggle';

describe('viewForAgentSelection', () => {
    it('opens the agents canvas for a selected sub-agent id', () => {
        expect(viewForAgentSelection('agent-1')).toBe('agents');
    });

    it('returns to the main thread for the orchestrator root (null)', () => {
        // Regression: clicking the "Orchestrator" breadcrumb / cascade item
        // must land on the thread, not leave the user staring at the chart.
        expect(viewForAgentSelection(null)).toBe('thread');
    });

    it('treats an empty id as the orchestrator (thread)', () => {
        expect(viewForAgentSelection('')).toBe('thread');
    });
});

describe('ChatViewToggle', () => {
    it('renders Thread and Agents segments', () => {
        render(<ChatViewToggle view="thread" onChange={vi.fn()} />);
        expect(screen.getByTestId('chat-view-thread')).toBeTruthy();
        expect(screen.getByTestId('chat-view-agents')).toBeTruthy();
    });

    it('reflects the active view via aria-pressed', () => {
        render(<ChatViewToggle view="agents" onChange={vi.fn()} />);
        expect(screen.getByTestId('chat-view-agents').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('chat-view-thread').getAttribute('aria-pressed')).toBe('false');
    });

    it('calls onChange when a segment is clicked', () => {
        const onChange = vi.fn();
        render(<ChatViewToggle view="thread" onChange={onChange} />);
        fireEvent.click(screen.getByTestId('chat-view-agents'));
        expect(onChange).toHaveBeenCalledWith('agents');
    });
});
