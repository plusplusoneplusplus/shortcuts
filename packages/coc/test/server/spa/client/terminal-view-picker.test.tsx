/**
 * @vitest-environment jsdom
 *
 * Behavioural tests for the compact terminal picker: the terminal list
 * collapses into a "Terminal N ▾" dropdown so a narrow dock never overflows
 * with a horizontal tab strip. Covers open/switch/close/new/rename/badge and
 * the menu-dismiss paths (Escape + outside click).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// xterm.js does not run in jsdom — render a lightweight stand-in.
vi.mock('../../../../src/server/spa/client/react/features/terminal/TerminalPanel', () => ({
    TerminalPanel: ({ sessionId }: { sessionId: string }) => (
        <div data-testid={`mock-terminal-panel-${sessionId}`}>mock terminal</div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '/api',
    isRalphEnabled: () => false,
}));

let uuidCounter = 0;
vi.stubGlobal('crypto', {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
});

// Pinned-terminal hydration fetch resolves with no sessions.
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: vi.fn().mockResolvedValue({ sessions: [] }),
}));

import { TerminalView } from '../../../../src/server/spa/client/react/features/terminal/TerminalView';

describe('TerminalView compact picker', () => {
    beforeEach(() => {
        uuidCounter = 0;
    });

    afterEach(() => {
        cleanup();
    });

    /** Render and create `n` terminals via the toolbar + button. */
    function renderAndCreate(n: number) {
        render(<TerminalView workspaceId="ws1" />);
        for (let i = 0; i < n; i++) {
            fireEvent.click(screen.getByTestId('terminal-new-btn'));
        }
    }

    it('shows "No terminals" and no picker before any terminal exists', () => {
        render(<TerminalView workspaceId="ws1" />);
        expect(screen.getByTestId('terminal-empty-state')).toBeTruthy();
        expect(screen.getByText('No terminals')).toBeTruthy();
        expect(screen.queryByTestId('terminal-picker-btn')).toBeNull();
    });

    it('shows the active terminal in the picker button once created', () => {
        renderAndCreate(1);
        const btn = screen.getByTestId('terminal-picker-btn');
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('data-menu-open')).toBe('false');
        expect(screen.getByTestId('terminal-tab-title-test-uuid-1').textContent).toBe('Terminal 1');
    });

    it('hides the count badge for one terminal and shows it for multiple', () => {
        renderAndCreate(1);
        expect(screen.queryByTestId('terminal-count-badge')).toBeNull();

        fireEvent.click(screen.getByTestId('terminal-new-btn'));
        expect(screen.getByTestId('terminal-count-badge').textContent).toBe('2');
    });

    it('opens the menu and lists every terminal', () => {
        renderAndCreate(2);
        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();

        fireEvent.click(screen.getByTestId('terminal-picker-btn'));

        expect(screen.getByTestId('terminal-picker-menu')).toBeTruthy();
        expect(screen.getByTestId('terminal-menu-item-test-uuid-1')).toBeTruthy();
        expect(screen.getByTestId('terminal-menu-item-test-uuid-2')).toBeTruthy();
        // Newest terminal is active.
        expect(screen.getByTestId('terminal-menu-item-test-uuid-2').getAttribute('aria-checked')).toBe('true');
    });

    it('switches the active terminal from the menu and closes it', () => {
        renderAndCreate(2);
        fireEvent.click(screen.getByTestId('terminal-picker-btn'));

        fireEvent.click(screen.getByTestId('terminal-menu-item-test-uuid-1'));

        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();
        // Picker button now reflects uuid-1 as active.
        expect(screen.getByTestId('terminal-tab-title-test-uuid-1')).toBeTruthy();
    });

    it('creates a new terminal from the menu footer and closes the menu', () => {
        renderAndCreate(1);
        fireEvent.click(screen.getByTestId('terminal-picker-btn'));

        fireEvent.click(screen.getByTestId('terminal-menu-new'));

        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();
        expect(screen.getByTestId('terminal-count-badge').textContent).toBe('2');
        // The freshly created terminal (uuid-2) is active.
        expect(screen.getByTestId('terminal-tab-title-test-uuid-2')).toBeTruthy();
    });

    it('closes a terminal from the menu without dismissing the menu', () => {
        renderAndCreate(2);
        fireEvent.click(screen.getByTestId('terminal-picker-btn'));

        fireEvent.click(screen.getByTestId('terminal-tab-close-test-uuid-1'));

        expect(screen.getByTestId('terminal-picker-menu')).toBeTruthy();
        expect(screen.queryByTestId('terminal-menu-item-test-uuid-1')).toBeNull();
        expect(screen.getByTestId('terminal-menu-item-test-uuid-2')).toBeTruthy();
    });

    it('renames the active terminal via double-click without opening the menu', () => {
        renderAndCreate(1);

        fireEvent.doubleClick(screen.getByTestId('terminal-tab-title-test-uuid-1'));

        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();
        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: 'api' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(screen.getByTestId('terminal-tab-title-test-uuid-1').textContent).toBe('api');
    });

    it('dismisses the menu on Escape', () => {
        renderAndCreate(1);
        fireEvent.click(screen.getByTestId('terminal-picker-btn'));
        expect(screen.getByTestId('terminal-picker-menu')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();
    });

    it('dismisses the menu when clicking outside the toolbar', () => {
        renderAndCreate(1);
        fireEvent.click(screen.getByTestId('terminal-picker-btn'));
        expect(screen.getByTestId('terminal-picker-menu')).toBeTruthy();

        fireEvent.mouseDown(document.body);

        expect(screen.queryByTestId('terminal-picker-menu')).toBeNull();
    });
});
