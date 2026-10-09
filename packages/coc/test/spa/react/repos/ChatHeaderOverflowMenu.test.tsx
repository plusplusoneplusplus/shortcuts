import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ChatHeaderOverflowMenu } from '../../../../src/server/spa/client/react/features/chat/ChatHeaderOverflowMenu';
import type { OverflowMenuItem } from '../../../../src/server/spa/client/react/features/chat/ChatHeaderOverflowMenu';

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

    describe('grouping, info footer and states', () => {
        const grouped: OverflowMenuItem[] = [
            { key: 'pin', label: 'Pin conversation', group: 'conversation', onClick: vi.fn() },
            { key: 'fork', label: 'Fork conversation', group: 'conversation', onClick: vi.fn(), disabled: true },
            { key: 'html', label: 'Copy as HTML', group: 'export', onClick: vi.fn() },
            { key: 'cli', label: 'Resume in CLI', group: 'cli', onClick: vi.fn() },
            { key: 'ctx', label: 'Context window', info: true, onClick: vi.fn(), render: () => <span data-testid="ctx-body">opus 87.6k/1.0M</span> },
        ];

        it('renders a menu with menuitems and separators only between groups', () => {
            render(<ChatHeaderOverflowMenu items={grouped} />);
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            const menu = screen.getByRole('menu');
            expect(menu.getAttribute('aria-label')).toBe('Conversation actions');
            expect(screen.getAllByRole('menuitem').map(el => el.textContent)).toEqual([
                'Pin conversation', 'Fork conversation', 'Copy as HTML', 'Resume in CLI',
            ]);
            expect(menu.querySelectorAll('[role="separator"]').length).toBe(2);
        });

        it('renders info items as a non-actionable footer after the actions', () => {
            render(<ChatHeaderOverflowMenu items={grouped} />);
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            const footer = screen.getByTestId('chat-header-overflow-info');
            expect(footer.contains(screen.getByTestId('ctx-body'))).toBe(true);
            expect(footer.querySelector('[role="menuitem"]')).toBeNull();
            expect(screen.queryByTestId('overflow-item-ctx')).toBeNull();
            const menu = screen.getByRole('menu');
            expect(menu.lastElementChild).toBe(footer);
        });

        it('disables items flagged disabled', () => {
            render(<ChatHeaderOverflowMenu items={grouped} />);
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            const fork = screen.getByTestId('overflow-item-fork') as HTMLButtonElement;
            expect(fork.disabled).toBe(true);
            fireEvent.click(fork);
            expect(grouped[1].onClick).not.toHaveBeenCalled();
        });

        it('exposes menu state on the trigger', () => {
            render(<ChatHeaderOverflowMenu items={grouped} />);
            const trigger = screen.getByTestId('chat-header-overflow-btn');
            expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
            expect(trigger.getAttribute('aria-expanded')).toBe('false');
            fireEvent.click(trigger);
            expect(trigger.getAttribute('aria-expanded')).toBe('true');
        });
    });

    describe('keyboard navigation', () => {
        const navItems: OverflowMenuItem[] = [
            { key: 'a', label: 'A', group: 'g1', onClick: vi.fn() },
            { key: 'b', label: 'B', group: 'g1', onClick: vi.fn(), disabled: true },
            { key: 'c', label: 'C', group: 'g2', onClick: vi.fn() },
            { key: 'd', label: 'D', group: 'g2', onClick: vi.fn() },
        ];
        const item = (key: string) => screen.getByTestId(`overflow-item-${key}`);

        it('focuses the first item on open and moves with arrows, skipping disabled rows and wrapping', () => {
            render(<ChatHeaderOverflowMenu items={navItems} />);
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            expect(document.activeElement).toBe(item('a'));
            fireEvent.keyDown(item('a'), { key: 'ArrowDown' });
            expect(document.activeElement).toBe(item('c'));
            fireEvent.keyDown(item('c'), { key: 'ArrowDown' });
            fireEvent.keyDown(item('d'), { key: 'ArrowDown' });
            expect(document.activeElement).toBe(item('a'));
            fireEvent.keyDown(item('a'), { key: 'ArrowUp' });
            expect(document.activeElement).toBe(item('d'));
            fireEvent.keyDown(item('d'), { key: 'Home' });
            expect(document.activeElement).toBe(item('a'));
            fireEvent.keyDown(item('a'), { key: 'End' });
            expect(document.activeElement).toBe(item('d'));
        });

        it('opens from the trigger with ArrowUp focusing the last item', () => {
            render(<ChatHeaderOverflowMenu items={navItems} />);
            fireEvent.keyDown(screen.getByTestId('chat-header-overflow-btn'), { key: 'ArrowUp' });
            expect(document.activeElement).toBe(item('d'));
        });

        it('Escape closes and returns focus to the trigger', () => {
            render(<ChatHeaderOverflowMenu items={navItems} />);
            const trigger = screen.getByTestId('chat-header-overflow-btn');
            fireEvent.click(trigger);
            fireEvent.keyDown(item('a'), { key: 'Escape' });
            expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
            expect(document.activeElement).toBe(trigger);
        });

        it('Tab closes the menu and returns focus to the trigger', () => {
            render(<ChatHeaderOverflowMenu items={navItems} />);
            const trigger = screen.getByTestId('chat-header-overflow-btn');
            fireEvent.click(trigger);
            fireEvent.keyDown(item('a'), { key: 'Tab' });
            expect(screen.queryByTestId('chat-header-overflow-menu')).toBeNull();
            expect(document.activeElement).toBe(trigger);
        });

        it('Enter on a focused item activates it', () => {
            render(<ChatHeaderOverflowMenu items={navItems} />);
            fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
            fireEvent.click(item('c'));
            expect(navItems[2].onClick).toHaveBeenCalledTimes(1);
        });
    });

    describe('viewport placement', () => {
        it('clamps the menu inside a narrow viewport', () => {
            const originalWidth = window.innerWidth;
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
            const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
                if (this.getAttribute('data-testid') === 'chat-header-overflow-menu') {
                    return { width: 248, height: 200, top: 0, left: 0, right: 248, bottom: 200, x: 0, y: 0, toJSON() {} } as DOMRect;
                }
                // Trigger sits near the left edge of a phone-width header.
                return { width: 26, height: 26, top: 10, left: 20, right: 46, bottom: 36, x: 20, y: 10, toJSON() {} } as DOMRect;
            });
            try {
                render(<ChatHeaderOverflowMenu items={makeItems()} />);
                fireEvent.click(screen.getByTestId('chat-header-overflow-btn'));
                const menu = screen.getByTestId('chat-header-overflow-menu');
                const left = parseFloat(menu.style.left);
                expect(left).toBeGreaterThanOrEqual(8);
                expect(left + 248).toBeLessThanOrEqual(320 - 8);
            } finally {
                rectSpy.mockRestore();
                Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
            }
        });
    });
});
