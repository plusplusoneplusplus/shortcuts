import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ChatHeaderOverflowMenu } from '../../../../src/server/spa/client/react/repos/ChatHeaderOverflowMenu';
import type { OverflowMenuItem } from '../../../../src/server/spa/client/react/repos/ChatHeaderOverflowMenu';

describe('ChatHeaderOverflowMenu', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function makeItems(count = 3): OverflowMenuItem[] {
        return Array.from({ length: count }, (_, i) => ({
            key: `item-${i}`,
            label: `Item ${i}`,
            onClick: vi.fn(),
        }));
    }

    it('renders nothing when items array is empty', () => {
        const { container } = render(<ChatHeaderOverflowMenu items={[]} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders the ⋮ trigger button when items are provided', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        expect(screen.getByTestId('chat-header-overflow-btn')).toBeTruthy();
    });

    it('shows the menu on trigger click', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        expect(screen.getByTestId('chat-header-overflow-menu')).toBeTruthy();
    });

    it('closes the menu on second trigger click', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        const trigger = screen.getByTestId('chat-header-overflow-btn');
        fireEvent.click(trigger);
        expect(screen.getByTestId('chat-header-overflow-menu')).toBeTruthy();
        fireEvent.click(trigger);
        expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
    });

    it('renders all items in the menu', () => {
        const items = makeItems(3);
        render(<ChatHeaderOverflowMenu items={items} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        for (let i = 0; i < 3; i++) {
            expect(screen.getByTestId(`overflow-item-item-${i}`)).toBeTruthy();
            expect(screen.getByText(`Item ${i}`)).toBeTruthy();
        }
    });

    it('calls onClick and closes menu when item is clicked', () => {
        const items = makeItems(1);
        render(<ChatHeaderOverflowMenu items={items} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        fireEvent.click(screen.getByTestId('overflow-item-item-0'));
        expect(items[0].onClick).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
    });

    it('renders custom render items instead of button', () => {
        const items: OverflowMenuItem[] = [{
            key: 'custom',
            label: 'Custom',
            onClick: vi.fn(),
            render: () => <div data-testid="custom-render">Custom Content</div>,
        }];
        render(<ChatHeaderOverflowMenu items={items} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        expect(screen.getByTestId('custom-render')).toBeTruthy();
        expect(screen.queryByTestId('overflow-item-custom')).toBeNull();
    });

    it('closes menu on Escape key', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        expect(screen.getByTestId('chat-header-overflow-menu')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
    });

    it('closes menu on outside click', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        expect(screen.getByTestId('chat-header-overflow-menu')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
    });

    it('renders icon when provided', () => {
        const items: OverflowMenuItem[] = [{
            key: 'with-icon',
            label: 'With Icon',
            icon: <span data-testid="test-icon">★</span>,
            onClick: vi.fn(),
        }];
        render(<ChatHeaderOverflowMenu items={items} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        expect(screen.getByTestId('test-icon')).toBeTruthy();
    });

    it('sets aria-label based on open state', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        const trigger = screen.getByTestId('chat-header-overflow-btn');
        expect(trigger.getAttribute('aria-label')).toBe('More actions');
        fireEvent.click(trigger);
        expect(trigger.getAttribute('aria-label')).toBe('Close overflow menu');
    });

    it('stamps data-ws-id on the portal div when wsId is provided', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} wsId="ws-abc" />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        const menu = screen.getByTestId('chat-header-overflow-menu');
        expect(menu.getAttribute('data-ws-id')).toBe('ws-abc');
    });

    it('does not stamp data-ws-id on the portal div when wsId is omitted', () => {
        render(<ChatHeaderOverflowMenu items={makeItems()} />);
        fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
        const menu = screen.getByTestId('chat-header-overflow-menu');
        expect(menu.hasAttribute('data-ws-id')).toBe(false);
    });
});
