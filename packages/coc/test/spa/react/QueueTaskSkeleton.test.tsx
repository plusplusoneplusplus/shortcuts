import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueueTaskSkeleton, ProcessesViewSkeleton } from '../../../src/server/spa/client/react/processes/QueueTaskSkeleton';

describe('QueueTaskSkeleton', () => {
    it('renders a Card with shimmer placeholders', () => {
        const { container } = render(<QueueTaskSkeleton />);
        const shimmers = container.querySelectorAll('.skeleton-shimmer');
        // icon circle + title bar + elapsed bar + prompt bar = 4
        expect(shimmers.length).toBe(4);
    });

    it('renders a rounded-full icon placeholder', () => {
        const { container } = render(<QueueTaskSkeleton />);
        const circle = container.querySelector('.skeleton-shimmer.rounded-full');
        expect(circle).toBeTruthy();
    });
});

describe('ProcessesViewSkeleton', () => {
    it('renders Running and Queued section labels', () => {
        render(<ProcessesViewSkeleton heightClass="h-full" />);
        expect(screen.getByText(/Running Tasks/)).toBeTruthy();
        expect(screen.getByText(/Queued Tasks/)).toBeTruthy();
    });

    it('renders 3 skeleton cards for Running and 2 for Queued', () => {
        const { container } = render(<ProcessesViewSkeleton heightClass="h-full" />);
        // Each QueueTaskSkeleton produces a Card (rounded-md border ...)
        // 3 running + 2 queued = 5 cards total
        const cards = container.querySelectorAll('.rounded-md.border');
        expect(cards.length).toBe(5);
    });

    it('applies the given heightClass to the container', () => {
        const { container } = render(<ProcessesViewSkeleton heightClass="h-[calc(100vh-48px)]" />);
        const root = container.querySelector('#view-processes');
        expect(root?.className).toContain('h-[calc(100vh-48px)]');
    });

    it('has overflow-hidden on the container', () => {
        const { container } = render(<ProcessesViewSkeleton heightClass="h-full" />);
        const root = container.querySelector('#view-processes');
        expect(root?.className).toContain('overflow-hidden');
    });
});
