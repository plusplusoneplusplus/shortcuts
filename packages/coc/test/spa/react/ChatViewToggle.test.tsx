// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatViewToggle } from '../../../src/server/spa/client/react/features/chat/agent-canvas/ChatViewToggle';

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
