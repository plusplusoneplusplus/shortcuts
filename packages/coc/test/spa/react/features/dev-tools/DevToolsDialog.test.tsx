/**
 * DevToolsDialog / DevToolsPanel — the shell: dialog open/close plus the
 * filter box, empty state and card expansion.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { DevToolsDialog } from '../../../../../src/server/spa/client/react/features/dev-tools/DevToolsDialog';
import { DEV_TOOLS, DEFAULT_EXPANDED_TOOL_ID } from '../../../../../src/server/spa/client/react/features/dev-tools/registry';

describe('DevToolsDialog pop-out', () => {
    function stubOpen(handle: Window | null) {
        const open = vi.fn().mockReturnValue(handle);
        vi.stubGlobal('open', open);
        return open;
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens the dev-tools pop-out window and closes the dialog', () => {
        const open = stubOpen({} as Window);
        const onClose = vi.fn();
        render(<DevToolsDialog open onClose={onClose} />);
        fireEvent.click(screen.getByTestId('dev-tools-popout-btn'));
        expect(open).toHaveBeenCalledTimes(1);
        const [url, name] = open.mock.calls[0];
        expect(url.endsWith('#popout/dev-tools')).toBe(true);
        expect(name).toBe('coc-dev-tools');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Regression: the button used to render the bare glyph ⧉ (U+29C9), which has
    // no coverage in the dashboard's UI font stack, so it shipped invisible.
    // Every pop-out affordance must draw an SVG icon, never a text glyph.
    it('draws the pop-out affordance as an SVG icon, not a text glyph', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        const btn = screen.getByTestId('dev-tools-popout-btn');
        expect(btn.querySelector('svg')).toBeTruthy();
        expect(btn.textContent ?? '').not.toContain('⧉');
        // Nothing renders as bare text — no glyph can silently go missing again.
        expect((btn.textContent ?? '').trim()).toBe('');
    });

    it('keeps the dialog open when the pop-out is blocked in the browser', () => {
        stubOpen(null);
        const onClose = vi.fn();
        render(<DevToolsDialog open onClose={onClose} />);
        fireEvent.click(screen.getByTestId('dev-tools-popout-btn'));
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('dev-tools-panel')).toBeTruthy();
    });
});

describe('DevToolsDialog', () => {
    it('renders nothing while closed', () => {
        render(<DevToolsDialog open={false} onClose={vi.fn()} />);
        expect(screen.queryByTestId('dev-tools-panel')).toBeNull();
    });

    it('renders a titled dialog with the tool cards when open', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        expect(document.getElementById('dev-tools-dialog')).toBeTruthy();
        expect(screen.getByText('Dev Tools')).toBeTruthy();
        expect(screen.getByTestId('dev-tools-panel')).toBeTruthy();
        for (const tool of DEV_TOOLS) {
            expect(screen.getByTestId(`dev-tool-card-${tool.id}`)).toBeTruthy();
        }
    });

    it('expands the programmer calculator by default and leaves the rest collapsed', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        expect(DEFAULT_EXPANDED_TOOL_ID).toBe('calculator');
        for (const tool of DEV_TOOLS) {
            const expected = tool.id === DEFAULT_EXPANDED_TOOL_ID ? 'true' : 'false';
            expect(screen.getByTestId(`dev-tool-card-${tool.id}`).getAttribute('data-expanded')).toBe(expected);
        }
    });

    it('closes on the header close button and on Escape', () => {
        const onClose = vi.fn();
        render(<DevToolsDialog open onClose={onClose} />);
        fireEvent.click(screen.getByTestId('dialog-close-btn'));
        expect(onClose).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('toggles a card open and closed from its header', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        const id = DEFAULT_EXPANDED_TOOL_ID;
        expect(screen.getByTestId(`dev-tool-body-${id}`)).toBeTruthy();
        fireEvent.click(screen.getByTestId(`dev-tool-toggle-${id}`));
        expect(screen.queryByTestId(`dev-tool-body-${id}`)).toBeNull();
        fireEvent.click(screen.getByTestId(`dev-tool-toggle-${id}`));
        expect(screen.getByTestId(`dev-tool-body-${id}`)).toBeTruthy();
    });

    it('narrows the card list by filter text and restores it when cleared', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        const filter = screen.getByTestId('dev-tools-filter');
        // 'hex' is a calculator keyword, not part of its visible name.
        fireEvent.change(filter, { target: { value: 'hex' } });
        expect(screen.getByTestId('dev-tool-card-calculator')).toBeTruthy();
        fireEvent.change(filter, { target: { value: '' } });
        expect(screen.getAllByTestId(/^dev-tool-card-/).length).toBe(DEV_TOOLS.length);
    });

    it('shows the empty state when the filter matches no tool', () => {
        render(<DevToolsDialog open onClose={vi.fn()} />);
        fireEvent.change(screen.getByTestId('dev-tools-filter'), { target: { value: 'nothing-matches-this' } });
        expect(screen.getByTestId('dev-tools-empty').textContent).toBe('No tools match');
        expect(screen.queryAllByTestId(/^dev-tool-card-/).length).toBe(0);
    });
});
