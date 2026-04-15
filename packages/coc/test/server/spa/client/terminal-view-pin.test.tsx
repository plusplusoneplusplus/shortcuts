/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock TerminalPanel (it uses xterm.js which doesn't work in jsdom)
vi.mock('../../../../src/server/spa/client/react/repos/TerminalPanel', () => ({
    TerminalPanel: ({ sessionId }: { sessionId: string }) => (
        <div data-testid={`mock-terminal-panel-${sessionId}`}>mock terminal</div>
    ),
}));

// Mock crypto.randomUUID to return predictable IDs
let uuidCounter = 0;
vi.stubGlobal('crypto', {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
});

import { TerminalView } from '../../../../src/server/spa/client/react/repos/TerminalView';

describe('TerminalView pin/unpin', () => {
    beforeEach(() => {
        uuidCounter = 0;
    });

    function renderAndCreate() {
        const result = render(<TerminalView workspaceId="ws1" />);
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        return result;
    }

    it('renders pin button on terminal tab', () => {
        renderAndCreate();
        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        expect(pinBtn).toBeTruthy();
        expect(pinBtn.textContent).toBe('📌');
    });

    it('toggles pin state on click', () => {
        renderAndCreate();
        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');

        // Initially unpinned — button has low opacity class
        expect(pinBtn.className).toContain('opacity-0');

        // Click to pin
        fireEvent.click(pinBtn);

        // Now pinned — button should have visible style
        const pinnedBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        expect(pinnedBtn.className).toContain('opacity-80');
        expect(pinnedBtn.className).not.toContain('opacity-0');
    });

    it('shows unpin title when pinned', () => {
        renderAndCreate();
        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        expect(pinBtn.title).toBe('Pin terminal');

        fireEvent.click(pinBtn);
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').title).toBe('Unpin terminal');
    });

    it('toggles back to unpinned on second click', () => {
        renderAndCreate();
        const pinBtn = screen.getByTestId('terminal-tab-pin-test-uuid-1');

        // Pin
        fireEvent.click(pinBtn);
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');

        // Unpin
        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-0');
    });

    it('pin click does not switch active tab', () => {
        renderAndCreate();
        // Create a second terminal
        fireEvent.click(screen.getByTestId('terminal-new-btn'));

        // Active tab should be the second one
        const tab2 = screen.getByTestId('terminal-tab-test-uuid-2');
        expect(tab2.className).toContain('font-medium');

        // Pin the first tab (without clicking the tab itself)
        const pinBtn1 = screen.getByTestId('terminal-tab-pin-test-uuid-1');
        fireEvent.click(pinBtn1);

        // Active tab should still be the second one
        expect(screen.getByTestId('terminal-tab-test-uuid-2').className).toContain('font-medium');
    });

    it('multiple tabs can be pinned independently', () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        fireEvent.click(screen.getByTestId('terminal-new-btn'));

        // Pin first tab
        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-1'));
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-2').className).toContain('opacity-0');

        // Pin second tab
        fireEvent.click(screen.getByTestId('terminal-tab-pin-test-uuid-2'));
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-1').className).toContain('opacity-80');
        expect(screen.getByTestId('terminal-tab-pin-test-uuid-2').className).toContain('opacity-80');
    });
});
