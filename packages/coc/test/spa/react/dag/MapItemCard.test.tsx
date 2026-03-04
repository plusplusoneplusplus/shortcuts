import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapItemCard } from '../../../../src/server/spa/client/react/processes/dag/MapItemCard';
import { vi } from 'vitest';

function makeProcess(overrides: Record<string, any> = {}) {
    return {
        processId: 'proc-1-m0',
        itemIndex: 0,
        status: 'completed',
        promptPreview: 'Analyze this bug report',
        durationMs: 5000,
        ...overrides,
    };
}

describe('MapItemCard', () => {
    it('renders item index and status icon', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess()} onClick={onClick} />);
        expect(screen.getByText(/Item 0/)).toBeDefined();
        // Completed status icon (✅)
        expect(screen.getByText('✅')).toBeDefined();
    });

    it('renders prompt preview truncated to 80 chars', () => {
        const longPrompt = 'A'.repeat(100);
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ promptPreview: longPrompt })} onClick={onClick} />);
        const preview = screen.getByText(new RegExp('A{80}…'));
        expect(preview).toBeDefined();
    });

    it('renders full prompt preview when under 80 chars', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ promptPreview: 'Short prompt' })} onClick={onClick} />);
        expect(screen.getByText('Short prompt')).toBeDefined();
    });

    it('renders duration text', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ durationMs: 65000 })} onClick={onClick} />);
        expect(screen.getByText('1m 5s')).toBeDefined();
    });

    it('renders error badge when error is present', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ error: 'Some error', status: 'failed' })} onClick={onClick} />);
        expect(screen.getByTestId('map-item-error-proc-1-m0')).toBeDefined();
        expect(screen.getByText('Error')).toBeDefined();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess()} onClick={onClick} />);
        const card = screen.getByTestId('map-item-card-proc-1-m0');
        fireEvent.click(card);
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('applies animate-pulse class for running status', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ status: 'running' })} onClick={onClick} />);
        const card = screen.getByTestId('map-item-card-proc-1-m0');
        expect(card.className).toContain('animate-pulse');
    });

    it('does not apply animate-pulse for completed status', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ status: 'completed' })} onClick={onClick} />);
        const card = screen.getByTestId('map-item-card-proc-1-m0');
        expect(card.className).not.toContain('animate-pulse');
    });

    it('applies border color from node state colors', () => {
        const onClick = vi.fn();
        render(<MapItemCard process={makeProcess({ status: 'failed' })} onClick={onClick} />);
        const card = screen.getByTestId('map-item-card-proc-1-m0');
        // Browser normalizes hex to rgb
        const borderColor = card.style.borderColor;
        expect(borderColor === '#f14c4c' || borderColor === 'rgb(241, 76, 76)').toBe(true);
    });

    it('does not render prompt preview when not provided', () => {
        const onClick = vi.fn();
        const { container } = render(
            <MapItemCard process={makeProcess({ promptPreview: undefined })} onClick={onClick} />,
        );
        const truncateEls = container.querySelectorAll('.truncate');
        expect(truncateEls.length).toBe(0);
    });
});
