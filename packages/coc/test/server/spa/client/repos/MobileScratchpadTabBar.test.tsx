/**
 * @vitest-environment jsdom
 *
 * Unit tests for MobileScratchpadTabBar component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileScratchpadTabBar } from '../../../../../src/server/spa/client/react/features/chat/scratchpad/MobileScratchpadTabBar';

describe('MobileScratchpadTabBar', () => {
    it('renders Chat and Scratchpad tab buttons', () => {
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByTestId('mobile-tab-chat')).toBeTruthy();
        expect(screen.getByTestId('mobile-tab-scratchpad')).toBeTruthy();
    });

    it('renders the close button', () => {
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByTestId('mobile-scratchpad-close-btn')).toBeTruthy();
    });

    it('marks Chat tab as selected when activeTab is "chat"', () => {
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByTestId('mobile-tab-chat').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('mobile-tab-scratchpad').getAttribute('aria-selected')).toBe('false');
    });

    it('marks Scratchpad tab as selected when activeTab is "scratchpad"', () => {
        render(
            <MobileScratchpadTabBar
                activeTab="scratchpad"
                onTabChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByTestId('mobile-tab-scratchpad').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('mobile-tab-chat').getAttribute('aria-selected')).toBe('false');
    });

    it('calls onTabChange("scratchpad") when Scratchpad tab is clicked', async () => {
        const onTabChange = vi.fn();
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={onTabChange}
                onClose={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByTestId('mobile-tab-scratchpad'));
        expect(onTabChange).toHaveBeenCalledWith('scratchpad');
    });

    it('calls onTabChange("chat") when Chat tab is clicked', async () => {
        const onTabChange = vi.fn();
        render(
            <MobileScratchpadTabBar
                activeTab="scratchpad"
                onTabChange={onTabChange}
                onClose={vi.fn()}
            />,
        );
        await userEvent.click(screen.getByTestId('mobile-tab-chat'));
        expect(onTabChange).toHaveBeenCalledWith('chat');
    });

    it('calls onClose when close button is clicked', async () => {
        const onClose = vi.fn();
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={vi.fn()}
                onClose={onClose}
            />,
        );
        await userEvent.click(screen.getByTestId('mobile-scratchpad-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('has role="tablist" on the container', () => {
        render(
            <MobileScratchpadTabBar
                activeTab="chat"
                onTabChange={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByRole('tablist')).toBeTruthy();
    });
});
