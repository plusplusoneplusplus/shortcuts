import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../../../src/server/spa/client/react/processes/dag/ZoomControls';

describe('ZoomControls', () => {
    const defaultProps = {
        zoomLabel: '100%',
        onZoomIn: vi.fn(),
        onZoomOut: vi.fn(),
        onReset: vi.fn(),
        onFitToView: vi.fn(),
    };

    it('renders all four buttons', () => {
        render(<ZoomControls {...defaultProps} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        expect(buttons.length).toBe(4);
    });

    it('displays the zoom label', () => {
        render(<ZoomControls {...defaultProps} zoomLabel="150%" />);
        expect(screen.getByTestId('zoom-label').textContent).toBe('150%');
    });

    it('zoom out button fires onZoomOut', () => {
        const onZoomOut = vi.fn();
        render(<ZoomControls {...defaultProps} onZoomOut={onZoomOut} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        fireEvent.click(buttons[0]); // first button = zoom out (−)
        expect(onZoomOut).toHaveBeenCalledOnce();
    });

    it('zoom in button fires onZoomIn', () => {
        const onZoomIn = vi.fn();
        render(<ZoomControls {...defaultProps} onZoomIn={onZoomIn} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        fireEvent.click(buttons[1]); // second button = zoom in (+)
        expect(onZoomIn).toHaveBeenCalledOnce();
    });

    it('reset button fires onReset', () => {
        const onReset = vi.fn();
        render(<ZoomControls {...defaultProps} onReset={onReset} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        fireEvent.click(buttons[2]); // third button = reset (⟲)
        expect(onReset).toHaveBeenCalledOnce();
    });

    it('fit to view button fires onFitToView', () => {
        const onFitToView = vi.fn();
        render(<ZoomControls {...defaultProps} onFitToView={onFitToView} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        fireEvent.click(buttons[3]); // fourth button = fit (⊞)
        expect(onFitToView).toHaveBeenCalledOnce();
    });

    it('has data-no-drag attribute to prevent drag initiation', () => {
        render(<ZoomControls {...defaultProps} />);
        const container = screen.getByTestId('zoom-controls');
        expect(container.getAttribute('data-no-drag')).not.toBeNull();
    });

    it('buttons have correct titles', () => {
        render(<ZoomControls {...defaultProps} />);
        const buttons = screen.getByTestId('zoom-controls').querySelectorAll('button');
        expect(buttons[0].title).toBe('Zoom out');
        expect(buttons[1].title).toBe('Zoom in');
        expect(buttons[2].title).toBe('Reset zoom');
        expect(buttons[3].title).toBe('Fit to view');
    });
});
