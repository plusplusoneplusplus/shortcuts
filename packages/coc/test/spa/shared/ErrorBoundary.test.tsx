import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../../../src/server/spa/client/react/shared/ErrorBoundary';

/* ---------- helpers ---------- */

/** Child that optionally throws during render */
function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) throw new Error('boom');
    return <div>ok</div>;
}

/** Suppress React error-boundary console noise during tests */
function suppressErrorOutput() {
    const origError = console.error;
    beforeEach(() => {
        console.error = vi.fn();
    });
    afterEach(() => {
        console.error = origError;
    });
}

/* ---------- tests ---------- */

describe('ErrorBoundary', () => {
    suppressErrorOutput();

    /* ---- happy path ---- */

    it('renders children when no error is thrown', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={false} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('ok')).toBeDefined();
    });

    it('does not render fallback UI when children render successfully', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={false} />
            </ErrorBoundary>,
        );
        expect(screen.queryByText(/something went wrong/i)).toBeNull();
    });

    /* ---- getDerivedStateFromError → fallback UI ---- */

    it('renders fallback UI after a child throw', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        expect(screen.getByText(/something went wrong/i)).toBeDefined();
    });

    it('shows error details section with the error message', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        // The error message appears inside a <pre> within a <details>
        expect(screen.getByText(/boom/)).toBeDefined();
    });

    it('shows "Error details" summary that can be expanded', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Error details')).toBeDefined();
    });

    /* ---- componentDidCatch → console.error ---- */

    it('logs the error via console.error in componentDidCatch', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        expect(console.error).toHaveBeenCalledWith(
            '[CoC] Unhandled render error:',
            expect.objectContaining({ message: 'boom' }),
            expect.objectContaining({ componentStack: expect.any(String) }),
        );
    });

    /* ---- Reload button ---- */

    it('renders a Reload button in the fallback UI', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Reload')).toBeDefined();
    });

    it('calls window.location.reload when Reload is clicked', () => {
        const reloadSpy = vi.fn();
        Object.defineProperty(window, 'location', {
            value: { ...window.location, reload: reloadSpy },
            writable: true,
            configurable: true,
        });

        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );

        fireEvent.click(screen.getByText('Reload'));
        expect(reloadSpy).toHaveBeenCalledOnce();
    });

    /* ---- Clear Cache & Reload button ---- */

    it('renders a "Clear Cache & Reload" button in the fallback UI', () => {
        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );
        expect(screen.getByText('Clear Cache & Reload')).toBeDefined();
    });

    it('clears CoC-specific localStorage keys on Clear Cache & Reload', () => {
        // Seed some CoC and non-CoC keys
        localStorage.setItem('coc-theme', 'dark');
        localStorage.setItem('coc.sidebar', 'open');
        localStorage.setItem('other-key', 'keep');

        const locationDescriptor = {
            value: {
                ...window.location,
                pathname: '/dashboard',
                href: '',
            },
            writable: true,
            configurable: true,
        };
        Object.defineProperty(window, 'location', locationDescriptor);

        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );

        fireEvent.click(screen.getByText('Clear Cache & Reload'));

        // CoC keys should be removed
        expect(localStorage.getItem('coc-theme')).toBeNull();
        expect(localStorage.getItem('coc.sidebar')).toBeNull();
        // Non-CoC keys should remain
        expect(localStorage.getItem('other-key')).toBe('keep');
    });

    it('performs a hard reload with cache-busting query param', () => {
        const loc = {
            ...window.location,
            pathname: '/dashboard',
            href: '',
        };
        Object.defineProperty(window, 'location', {
            value: loc,
            writable: true,
            configurable: true,
        });

        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );

        fireEvent.click(screen.getByText('Clear Cache & Reload'));

        expect(loc.href).toMatch(/^\/dashboard\?_t=\d+$/);
    });

    it('handles localStorage being unavailable during Clear Cache & Reload', () => {
        // Make localStorage.length throw to simulate unavailability
        const origLength = Object.getOwnPropertyDescriptor(
            Storage.prototype,
            'length',
        );
        Object.defineProperty(Storage.prototype, 'length', {
            get() {
                throw new DOMException('storage disabled');
            },
            configurable: true,
        });

        const loc = {
            ...window.location,
            pathname: '/',
            href: '',
        };
        Object.defineProperty(window, 'location', {
            value: loc,
            writable: true,
            configurable: true,
        });

        render(
            <ErrorBoundary>
                <ThrowingChild shouldThrow={true} />
            </ErrorBoundary>,
        );

        // Should not throw — the catch block handles it gracefully
        expect(() =>
            fireEvent.click(screen.getByText('Clear Cache & Reload')),
        ).not.toThrow();

        // Still navigates despite localStorage failure
        expect(loc.href).toMatch(/^\/\?_t=\d+$/);

        // Restore
        if (origLength) {
            Object.defineProperty(Storage.prototype, 'length', origLength);
        }
    });

    /* ---- nested boundaries ---- */

    it('inner boundary catches before outer boundary', () => {
        render(
            <ErrorBoundary>
                <div data-testid="outer-children">
                    <ErrorBoundary>
                        <ThrowingChild shouldThrow={true} />
                    </ErrorBoundary>
                </div>
            </ErrorBoundary>,
        );

        // The inner boundary should show the fallback
        expect(screen.getByText(/something went wrong/i)).toBeDefined();
        // The outer boundary's normal children wrapper should still be in the tree
        expect(screen.getByTestId('outer-children')).toBeDefined();
    });

    /* ---- multiple children ---- */

    it('renders multiple children when none throw', () => {
        render(
            <ErrorBoundary>
                <div>child-a</div>
                <div>child-b</div>
            </ErrorBoundary>,
        );
        expect(screen.getByText('child-a')).toBeDefined();
        expect(screen.getByText('child-b')).toBeDefined();
    });
});
