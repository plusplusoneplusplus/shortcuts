import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScratchpadDivider } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadDivider';
import type { ScratchpadDividerProps } from '../../../../../../src/server/spa/client/react/features/chat/scratchpad/ScratchpadDivider';

function renderDivider(overrides: Partial<ScratchpadDividerProps> = {}) {
    const props: ScratchpadDividerProps = {
        linkedNotePath: null,
        expandMode: 'split',
        isDragging: false,
        onMouseDown: vi.fn(),
        onOpenFilePicker: vi.fn(),
        onExpandTop: vi.fn(),
        onExpandBottom: vi.fn(),
        onSplitReset: vi.fn(),
        onClose: vi.fn(),
        ...overrides,
    };
    const result = render(<ScratchpadDivider {...props} />);
    return { ...result, props };
}

describe('ScratchpadDivider', () => {
    it('renders "Scratchpad" when linkedNotePath is null', () => {
        renderDivider({ linkedNotePath: null });
        expect(screen.getByTestId('scratchpad-file-btn').textContent).toContain('Scratchpad');
    });

    it('renders filename with .md stripped when linkedNotePath is set', () => {
        renderDivider({ linkedNotePath: 'tasks/my-notes.md' });
        const btn = screen.getByTestId('scratchpad-file-btn');
        expect(btn.textContent).toContain('my-notes');
        expect(btn.textContent).not.toContain('.md');
    });

    it('renders all five control buttons with correct data-testid', () => {
        renderDivider();
        expect(screen.getByTestId('scratchpad-file-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-expand-top-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-expand-bottom-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-split-btn')).toBeTruthy();
        expect(screen.getByTestId('scratchpad-close-btn')).toBeTruthy();
    });

    it('active expand-mode "top" button has blue accent class', () => {
        renderDivider({ expandMode: 'top' });
        expect(screen.getByTestId('scratchpad-expand-top-btn').className).toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-expand-bottom-btn').className).not.toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-split-btn').className).not.toContain('text-[#0078d4]');
    });

    it('active expand-mode "bottom" button has blue accent class', () => {
        renderDivider({ expandMode: 'bottom' });
        expect(screen.getByTestId('scratchpad-expand-bottom-btn').className).toContain('text-[#0078d4]');
        expect(screen.getByTestId('scratchpad-expand-top-btn').className).not.toContain('text-[#0078d4]');
    });

    it('active expand-mode "split" button has blue accent class', () => {
        renderDivider({ expandMode: 'split' });
        expect(screen.getByTestId('scratchpad-split-btn').className).toContain('text-[#0078d4]');
    });

    it('clicking expand-top calls onExpandTop and NOT onMouseDown', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-expand-top-btn'));
        expect(props.onExpandTop).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking expand-bottom calls onExpandBottom', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-expand-bottom-btn'));
        expect(props.onExpandBottom).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking split-reset calls onSplitReset', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-split-btn'));
        expect(props.onSplitReset).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking close calls onClose', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-close-btn'));
        expect(props.onClose).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('clicking file button calls onOpenFilePicker', () => {
        const { props } = renderDivider();
        fireEvent.click(screen.getByTestId('scratchpad-file-btn'));
        expect(props.onOpenFilePicker).toHaveBeenCalledTimes(1);
        expect(props.onMouseDown).not.toHaveBeenCalled();
    });

    it('onMouseDown is called when mouse-downing on the divider bar background', () => {
        const { props } = renderDivider();
        fireEvent.mouseDown(screen.getByTestId('scratchpad-divider'));
        expect(props.onMouseDown).toHaveBeenCalledTimes(1);
    });

    it('isDragging=true applies the active-drag background class', () => {
        renderDivider({ isDragging: true });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).toContain('bg-[#e8f4fd]');
    });

    it('isDragging=false does not apply the active-drag background class', () => {
        renderDivider({ isDragging: false });
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.className).not.toContain('bg-[#e8f4fd]');
    });

    it('has role=separator with horizontal orientation', () => {
        renderDivider();
        const divider = screen.getByTestId('scratchpad-divider');
        expect(divider.getAttribute('role')).toBe('separator');
        expect(divider.getAttribute('aria-orientation')).toBe('horizontal');
    });
});
