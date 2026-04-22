/**
 * Tests for Badge shared component.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../../src/server/spa/client/react/ui/Badge';

describe('Badge', () => {
    it('renders status text when no children', () => {
        render(<Badge status="running" />);
        expect(screen.getByText('running')).toBeTruthy();
    });

    it('renders children when provided', () => {
        render(<Badge status="completed">Done</Badge>);
        expect(screen.getByText('Done')).toBeTruthy();
    });

    it('applies running status class (animate-pulse)', () => {
        render(<Badge status="running" />);
        expect(screen.getByText('running').className).toContain('animate-pulse');
    });

    it('applies completed status class (green text)', () => {
        render(<Badge status="completed">Ready</Badge>);
        expect(screen.getByText('Ready').className).toContain('text-[#16825d]');
    });

    it('applies failed status class (red text)', () => {
        render(<Badge status="failed" />);
        expect(screen.getByText('failed').className).toContain('text-[#f14c4c]');
    });

    it('applies fallback class for unknown status', () => {
        render(<Badge status="custom-unknown" />);
        expect(screen.getByText('custom-unknown').className).toContain('bg-gray-100');
    });

    it('forwards className prop', () => {
        render(<Badge status="queued" className="my-custom-class" />);
        expect(screen.getByText('queued').className).toContain('my-custom-class');
    });

    it('forwards id prop', () => {
        render(<Badge status="running" id="my-badge" />);
        expect(document.getElementById('my-badge')).toBeTruthy();
    });
});
