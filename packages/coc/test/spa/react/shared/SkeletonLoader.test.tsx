/**
 * Tests for SkeletonLoader shared components.
 * SkeletonLine, SkeletonCard, SkeletonList, SkeletonListItem
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
    SkeletonLine,
    SkeletonCard,
    SkeletonList,
    SkeletonListItem,
} from '../../../../src/server/spa/client/react/ui/SkeletonLoader';

describe('SkeletonLine', () => {
    it('renders an animate-pulse element', () => {
        const { container } = render(<SkeletonLine />);
        const el = container.firstChild as HTMLElement;
        expect(el.className).toContain('animate-pulse');
    });

    it('accepts a width class via className override', () => {
        const { container } = render(<SkeletonLine className="w-1/2" />);
        const el = container.firstChild as HTMLElement;
        expect(el.className).toContain('w-1/2');
    });

    it('accepts a custom className', () => {
        const { container } = render(<SkeletonLine className="my-custom" />);
        const el = container.firstChild as HTMLElement;
        expect(el.className).toContain('my-custom');
    });
});

describe('SkeletonCard', () => {
    it('renders animate-pulse card', () => {
        const { container } = render(<SkeletonCard />);
        const el = container.firstChild as HTMLElement;
        expect(el.className).toContain('animate-pulse');
    });

    it('renders multiple skeleton lines inside', () => {
        const { container } = render(<SkeletonCard />);
        const lines = container.querySelectorAll('[class*="animate-pulse"]');
        expect(lines.length).toBeGreaterThan(0);
    });
});

describe('SkeletonListItem', () => {
    it('renders an animate-pulse row', () => {
        const { container } = render(<SkeletonListItem />);
        // Find the container div
        const el = container.firstChild as HTMLElement;
        expect(el).toBeTruthy();
        // Should have pulse within
        const pulse = container.querySelector('[class*="animate-pulse"]');
        expect(pulse).toBeTruthy();
    });
});

describe('SkeletonList', () => {
    it('renders the correct number of items', () => {
        const { container } = render(<SkeletonList count={4} />);
        // SkeletonList renders count SkeletonListItems
        // Each SkeletonListItem has an animate-pulse inner element
        const items = container.querySelectorAll('[class*="animate-pulse"]');
        expect(items.length).toBeGreaterThanOrEqual(4);
    });

    it('defaults to 5 items when count is omitted', () => {
        const { container } = render(<SkeletonList />);
        const items = container.querySelectorAll('[class*="animate-pulse"]');
        expect(items.length).toBeGreaterThanOrEqual(5);
    });

    it('accepts a custom className on the wrapper', () => {
        const { container } = render(<SkeletonList count={2} className="pt-4" />);
        const wrapper = container.firstChild as HTMLElement;
        expect(wrapper.className).toContain('pt-4');
    });
});
