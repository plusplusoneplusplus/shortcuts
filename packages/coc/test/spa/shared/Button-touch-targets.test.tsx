import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../../../src/server/spa/client/react/shared/Button';

describe('Button touch targets', () => {
    it('renders with min-h-[44px] class by default (mobile)', () => {
        render(<Button>Touch</Button>);
        const button = screen.getByText('Touch').closest('button')!;
        expect(button.className).toContain('min-h-[44px]');
    });

    it('renders with md:min-h-0 class for desktop reset', () => {
        render(<Button>Touch</Button>);
        const button = screen.getByText('Touch').closest('button')!;
        expect(button.className).toContain('md:min-h-0');
    });

    it('sm size variant includes touch target classes', () => {
        render(<Button size="sm">Small</Button>);
        const button = screen.getByText('Small').closest('button')!;
        expect(button.className).toContain('min-h-[44px]');
        expect(button.className).toContain('md:min-h-0');
    });

    it('md size variant includes touch target classes', () => {
        render(<Button size="md">Medium</Button>);
        const button = screen.getByText('Medium').closest('button')!;
        expect(button.className).toContain('min-h-[44px]');
        expect(button.className).toContain('md:min-h-0');
    });

    it('lg size variant includes touch target classes', () => {
        render(<Button size="lg">Large</Button>);
        const button = screen.getByText('Large').closest('button')!;
        expect(button.className).toContain('min-h-[44px]');
        expect(button.className).toContain('md:min-h-0');
    });
});
