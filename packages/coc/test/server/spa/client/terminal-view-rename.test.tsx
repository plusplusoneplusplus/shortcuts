/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

describe('TerminalView tab rename', () => {
    beforeEach(() => {
        uuidCounter = 0;
    });

    function getTitleSpan() {
        return screen.getByTestId('terminal-tab-title-test-uuid-1');
    }

    it('enters edit mode on double-click', async () => {
        render(<TerminalView workspaceId="ws1" />);
        const title = getTitleSpan();
        expect(title.textContent).toBe('Terminal 1');

        fireEvent.doubleClick(title);

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1') as HTMLInputElement;
        expect(input).toBeTruthy();
        expect(input.value).toBe('Terminal 1');
    });

    it('commits rename on Enter', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: 'My Server' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('My Server');
    });

    it('cancels rename on Escape', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: 'Something else' } });
        fireEvent.keyDown(input, { key: 'Escape' });

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('Terminal 1');
    });

    it('commits rename on blur', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: 'Backend' } });
        fireEvent.blur(input);

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('Backend');
    });

    it('reverts to previous title when input is empty', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: '' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('Terminal 1');
    });

    it('reverts when input is only whitespace', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: '   ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('Terminal 1');
    });

    it('trims whitespace from the new name', async () => {
        render(<TerminalView workspaceId="ws1" />);
        fireEvent.doubleClick(getTitleSpan());

        const input = screen.getByTestId('terminal-tab-rename-input-test-uuid-1');
        fireEvent.change(input, { target: { value: '  Dev Server  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const title = screen.getByTestId('terminal-tab-title-test-uuid-1');
        expect(title.textContent).toBe('Dev Server');
    });
});
