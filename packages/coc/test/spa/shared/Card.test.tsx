import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../../../src/server/spa/client/react/shared/Card';

describe('Card', () => {
    it('renders children', () => {
        render(<Card>Card Content</Card>);
        expect(screen.getByText('Card Content')).toBeDefined();
    });

    it('without onClick: no cursor-pointer class', () => {
        const { container } = render(<Card>Content</Card>);
        const div = container.firstElementChild as HTMLElement;
        expect(div.className).not.toContain('cursor-pointer');
    });

    it('with onClick: fires handler on click', () => {
        const onClick = vi.fn();
        render(<Card onClick={onClick}>Clickable</Card>);
        fireEvent.click(screen.getByText('Clickable'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('with onClick: has cursor-pointer class', () => {
        const onClick = vi.fn();
        const { container } = render(<Card onClick={onClick}>Clickable</Card>);
        const div = container.firstElementChild as HTMLElement;
        expect(div.className).toContain('cursor-pointer');
    });

    it('className is appended', () => {
        const { container } = render(<Card className="extra">Content</Card>);
        const div = container.firstElementChild as HTMLElement;
        expect(div.className).toContain('extra');
    });

    it('has border and rounded classes', () => {
        const { container } = render(<Card>Content</Card>);
        const div = container.firstElementChild as HTMLElement;
        expect(div.className).toContain('rounded-md');
        expect(div.className).toContain('border');
    });
});
