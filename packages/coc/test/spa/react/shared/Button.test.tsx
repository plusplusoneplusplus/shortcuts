/**
 * Tests for Button shared component.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../../src/server/spa/client/react/shared/Button';

describe('Button', () => {
    it('renders children text', () => {
        render(<Button>Click me</Button>);
        expect(screen.getByText('Click me')).toBeTruthy();
    });

    it('calls onClick when clicked', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Click</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('does not call onClick when disabled', () => {
        const onClick = vi.fn();
        render(<Button disabled onClick={onClick}>Click</Button>);
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('shows spinner and disables button when loading=true', () => {
        render(<Button loading>Submit</Button>);
        const btn = screen.getByRole('button');
        expect(btn).toBeDisabled();
        // Spinner has aria-label="Loading"
        expect(screen.getByLabelText('Loading')).toBeTruthy();
    });

    it('applies primary variant class by default', () => {
        render(<Button>Primary</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('bg-[#0078d4]');
    });

    it('applies secondary variant class', () => {
        render(<Button variant="secondary">Secondary</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('border-[#e0e0e0]');
    });

    it('applies danger variant class', () => {
        render(<Button variant="danger">Danger</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('bg-[#f14c4c]');
    });

    it('applies ghost variant class', () => {
        render(<Button variant="ghost">Ghost</Button>);
        const btn = screen.getByRole('button');
        expect(btn.className).toContain('bg-transparent');
    });

    it('forwards data-testid prop', () => {
        render(<Button data-testid="my-btn">Btn</Button>);
        expect(screen.getByTestId('my-btn')).toBeTruthy();
    });

    it('uses type="submit" when specified', () => {
        render(<Button type="submit">Submit</Button>);
        expect(screen.getByRole('button').getAttribute('type')).toBe('submit');
    });
});
