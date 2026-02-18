import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../src/server/spa/client/react/shared/Badge';

describe('Badge', () => {
    it('renders status string as text when children omitted', () => {
        render(<Badge status="running" />);
        expect(screen.getByText('running')).toBeDefined();
    });

    it('renders children when provided', () => {
        render(<Badge status="running">Custom Text</Badge>);
        expect(screen.getByText('Custom Text')).toBeDefined();
    });

    it('running variant has animate-pulse class', () => {
        render(<Badge status="running" />);
        expect(screen.getByText('running').className).toContain('animate-pulse');
    });

    it('unknown status falls back to neutral gray classes', () => {
        render(<Badge status="unknown" />);
        const el = screen.getByText('unknown');
        expect(el.className).toContain('bg-gray-100');
    });

    it('completed status has correct color', () => {
        render(<Badge status="completed" />);
        expect(screen.getByText('completed').className).toContain('text-[#16825d]');
    });

    it('failed status has correct color', () => {
        render(<Badge status="failed" />);
        expect(screen.getByText('failed').className).toContain('text-[#f14c4c]');
    });

    it('queued status has correct color', () => {
        render(<Badge status="queued" />);
        expect(screen.getByText('queued').className).toContain('text-[#848484]');
    });

    it('cancelled status has correct color', () => {
        render(<Badge status="cancelled" />);
        expect(screen.getByText('cancelled').className).toContain('text-[#e8912d]');
    });

    it('className is forwarded', () => {
        render(<Badge status="running" className="my-badge" />);
        expect(screen.getByText('running').className).toContain('my-badge');
    });
});
