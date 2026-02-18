import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../../../src/server/spa/client/react/shared/Button';

describe('Button', () => {
    it('renders children for primary variant', () => {
        render(<Button variant="primary">Primary</Button>);
        expect(screen.getByText('Primary')).toBeDefined();
    });

    it('renders children for secondary variant', () => {
        render(<Button variant="secondary">Secondary</Button>);
        expect(screen.getByText('Secondary')).toBeDefined();
    });

    it('renders children for danger variant', () => {
        render(<Button variant="danger">Danger</Button>);
        expect(screen.getByText('Danger')).toBeDefined();
    });

    it('renders children for ghost variant', () => {
        render(<Button variant="ghost">Ghost</Button>);
        expect(screen.getByText('Ghost')).toBeDefined();
    });

    it('disabled prop sets disabled attribute', () => {
        render(<Button disabled>Disabled</Button>);
        expect(screen.getByText('Disabled').closest('button')!.disabled).toBe(true);
    });

    it('loading prop renders a Spinner', () => {
        render(<Button loading>Loading</Button>);
        expect(screen.getByLabelText('Loading')).toBeDefined();
    });

    it('loading prop disables the button', () => {
        render(<Button loading>Loading</Button>);
        expect(screen.getByText('Loading').closest('button')!.disabled).toBe(true);
    });

    it('onClick is called on click when not disabled', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick}>Click Me</Button>);
        fireEvent.click(screen.getByText('Click Me'));
        expect(onClick).toHaveBeenCalledOnce();
    });

    it('onClick is not called when disabled', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick} disabled>Click Me</Button>);
        fireEvent.click(screen.getByText('Click Me'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('onClick is not called when loading', () => {
        const onClick = vi.fn();
        render(<Button onClick={onClick} loading>Click Me</Button>);
        fireEvent.click(screen.getByText('Click Me'));
        expect(onClick).not.toHaveBeenCalled();
    });

    it('className is forwarded and appended', () => {
        render(<Button className="my-custom-class">Styled</Button>);
        const button = screen.getByText('Styled').closest('button')!;
        expect(button.className).toContain('my-custom-class');
    });

    it('defaults to type="button"', () => {
        render(<Button>Default</Button>);
        expect(screen.getByText('Default').closest('button')!.type).toBe('button');
    });

    it('supports type="submit"', () => {
        render(<Button type="submit">Submit</Button>);
        expect(screen.getByText('Submit').closest('button')!.type).toBe('submit');
    });

    it('applies primary variant classes by default', () => {
        render(<Button>Default</Button>);
        const button = screen.getByText('Default').closest('button')!;
        expect(button.className).toContain('bg-[#0078d4]');
    });

    it('applies md size classes by default', () => {
        render(<Button>Default</Button>);
        const button = screen.getByText('Default').closest('button')!;
        expect(button.className).toContain('px-3');
        expect(button.className).toContain('text-sm');
    });
});
