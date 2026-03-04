import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MapItemGrid } from '../../../../src/server/spa/client/react/processes/dag/MapItemGrid';

function makeItems(count: number, overrides: Record<string, any> = {}) {
    return Array.from({ length: count }, (_, i) => ({
        processId: `proc-m${i}`,
        itemIndex: i,
        status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'failed' : 'running',
        promptPreview: `Item ${i} prompt`,
        durationMs: 1000 * (i + 1),
        ...overrides,
    }));
}

describe('MapItemGrid', () => {
    it('renders correct number of item cards', () => {
        const items = makeItems(5);
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        for (let i = 0; i < 5; i++) {
            expect(screen.getByTestId(`map-item-card-proc-m${i}`)).toBeDefined();
        }
    });

    it('displays aggregate stats bar', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'completed' },
            { processId: 'c', itemIndex: 2, status: 'failed' },
            { processId: 'd', itemIndex: 3, status: 'running' },
        ];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        const stats = screen.getByTestId('map-item-stats');
        expect(stats.textContent).toContain('2 completed');
        expect(stats.textContent).toContain('1 failed');
        expect(stats.textContent).toContain('1 running');
    });

    it('filters by completed status', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'failed' },
            { processId: 'c', itemIndex: 2, status: 'running' },
        ];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        fireEvent.click(screen.getByTestId('map-filter-completed'));

        expect(screen.queryByTestId('map-item-card-a')).toBeDefined();
        expect(screen.queryByTestId('map-item-card-b')).toBeNull();
        expect(screen.queryByTestId('map-item-card-c')).toBeNull();
    });

    it('filters by failed status', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'failed' },
        ];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        fireEvent.click(screen.getByTestId('map-filter-failed'));

        expect(screen.queryByTestId('map-item-card-a')).toBeNull();
        expect(screen.queryByTestId('map-item-card-b')).toBeDefined();
    });

    it('filters by running status', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'running' },
        ];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        fireEvent.click(screen.getByTestId('map-filter-running'));

        expect(screen.queryByTestId('map-item-card-a')).toBeNull();
        expect(screen.queryByTestId('map-item-card-b')).toBeDefined();
    });

    it('shows "all" by default', () => {
        const items = [
            { processId: 'a', itemIndex: 0, status: 'completed' },
            { processId: 'b', itemIndex: 1, status: 'failed' },
        ];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        expect(screen.queryByTestId('map-item-card-a')).toBeDefined();
        expect(screen.queryByTestId('map-item-card-b')).toBeDefined();
    });

    it('calls onItemClick with process ID when card is clicked', () => {
        const items = [{ processId: 'proc-m0', itemIndex: 0, status: 'completed' }];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        fireEvent.click(screen.getByTestId('map-item-card-proc-m0'));
        expect(onItemClick).toHaveBeenCalledWith('proc-m0');
    });

    it('shows empty message when filter matches no items', () => {
        const items = [{ processId: 'a', itemIndex: 0, status: 'completed' }];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        fireEvent.click(screen.getByTestId('map-filter-failed'));

        expect(screen.getByText('No items match the current filter.')).toBeDefined();
    });

    it('renders with grid layout style', () => {
        const items = [{ processId: 'a', itemIndex: 0, status: 'completed' }];
        const onItemClick = vi.fn();
        render(<MapItemGrid items={items} onItemClick={onItemClick} isLive={false} />);

        const grid = screen.getByTestId('map-item-grid-container');
        expect(grid.style.display).toBe('grid');
        expect(grid.style.gridTemplateColumns).toContain('repeat(auto-fill');
    });
});
