/**
 * Tests for the AICommandMenu extracted component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AICommandMenu } from '../../../../src/server/spa/client/react/tasks/comments/AICommandMenu';

const noop = () => {};

describe('AICommandMenu', () => {
    it('renders the trigger button', () => {
        render(<AICommandMenu onCommand={noop} />);
        expect(screen.getByLabelText('Ask AI')).toBeTruthy();
    });

    it('opens dropdown on click', () => {
        render(<AICommandMenu onCommand={noop} />);
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        expect(screen.getByTestId('ai-command-menu')).toBeTruthy();
    });

    it('fires onCommand("clarify") on Clarify click', () => {
        const onCommand = vi.fn();
        render(<AICommandMenu onCommand={onCommand} />);
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-clarify'));
        expect(onCommand).toHaveBeenCalledWith('clarify');
    });

    it('fires onCommand("go-deeper") on Go Deeper click', () => {
        const onCommand = vi.fn();
        render(<AICommandMenu onCommand={onCommand} />);
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-go-deeper'));
        expect(onCommand).toHaveBeenCalledWith('go-deeper');
    });

    it('shows custom input on Custom click and fires onCommand("custom", text) on Enter', () => {
        const onCommand = vi.fn();
        render(<AICommandMenu onCommand={onCommand} />);
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        fireEvent.click(screen.getByTestId('ai-cmd-custom'));
        const input = screen.getByTestId('ai-custom-input');
        expect(input).toBeTruthy();
        fireEvent.change(input, { target: { value: 'my question' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onCommand).toHaveBeenCalledWith('custom', 'my question');
    });

    it('shows spinner when loading=true', () => {
        render(<AICommandMenu onCommand={noop} loading={true} />);
        const trigger = screen.getByTestId('ai-menu-trigger');
        expect(trigger).toHaveProperty('disabled', true);
        expect(trigger.querySelector('[aria-label="Loading"]')).toBeTruthy();
    });

    it('closes on Escape', () => {
        render(<AICommandMenu onCommand={noop} />);
        fireEvent.click(screen.getByTestId('ai-menu-trigger'));
        expect(screen.getByTestId('ai-command-menu')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('ai-command-menu')).toBeNull();
    });

    it('uses custom data-testid prefix', () => {
        render(<AICommandMenu onCommand={noop} data-testid="popover-ai" />);
        expect(screen.getByTestId('popover-ai-menu-trigger')).toBeTruthy();
        fireEvent.click(screen.getByTestId('popover-ai-menu-trigger'));
        expect(screen.getByTestId('popover-ai-command-menu')).toBeTruthy();
    });

    it('does not open when disabled', () => {
        render(<AICommandMenu onCommand={noop} disabled={true} />);
        const trigger = screen.getByTestId('ai-menu-trigger');
        expect(trigger).toHaveProperty('disabled', true);
    });
});
