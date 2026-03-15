/**
 * Tests for Card shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Card } from '../../../../src/server/spa/client/react/shared/Card';

describe('Card', () => {
    it('renders children', () => {
        render(<Card><span>Content</span></Card>);
        expect(screen.getByText('Content')).toBeTruthy();
    });

    it('does not have button role without onClick', () => {
        const { container } = render(<Card>No click</Card>);
        const div = container.firstChild as HTMLElement;
        expect(div.getAttribute('role')).toBeNull();
    });

    it('has button role when onClick is provided', () => {
        render(<Card onClick={() => {}}>Clickable</Card>);
        expect(screen.getByRole('button')).toBeTruthy();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<Card onClick={onClick}>Click</Card>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('calls onClick on Enter key when onClick provided', () => {
        const onClick = vi.fn();
        render(<Card onClick={onClick}>Press</Card>);
        fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('forwards data-testid prop', () => {
        render(<Card data-testid="my-card">Card</Card>);
        expect(screen.getByTestId('my-card')).toBeTruthy();
    });

    it('forwards id prop', () => {
        render(<Card id="card-1">Card</Card>);
        expect(document.getElementById('card-1')).toBeTruthy();
    });

    it('adds cursor-pointer class when onClick provided', () => {
        render(<Card onClick={() => {}}>Click</Card>);
        expect(screen.getByRole('button').className).toContain('cursor-pointer');
    });
});
