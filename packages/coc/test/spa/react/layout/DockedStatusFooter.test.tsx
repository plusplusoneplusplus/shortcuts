/**
 * DockedStatusFooter — docks the shared status cluster in a page's own left
 * column footer, gated to the remote-first shell on desktop, and only inside a
 * ThemeProvider (app-shell chrome).
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../../../src/server/spa/client/react/layout/ThemeProvider';

let mockInDock = true;

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useStatusInDock', () => ({
    useStatusInDock: () => mockInDock,
}));
vi.mock('../../../../src/server/spa/client/react/layout/StatusActions', () => ({
    StatusActions: (props: Record<string, unknown>) => (
        <div data-testid="status-actions" data-variant={String(props.variant)} data-has-admin={String(typeof props.onAdminOpen === 'function')} />
    ),
}));

// ThemeProvider persists to the server on mount; stub the client so it no-ops.
vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        preferences: {
            getGlobal: () => Promise.resolve({}),
            patchGlobal: () => Promise.resolve({}),
        },
    }),
}));

import { DockedStatusFooter } from '../../../../src/server/spa/client/react/layout/DockedStatusFooter';

beforeEach(() => {
    mockInDock = true;
    localStorage.clear();
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

describe('DockedStatusFooter', () => {
    it('renders the sidebar StatusActions variant inside a ThemeProvider when docked', () => {
        render(
            <ThemeProvider>
                <DockedStatusFooter />
            </ThemeProvider>,
        );
        const cluster = screen.getByTestId('status-actions');
        expect(cluster.getAttribute('data-variant')).toBe('sidebar');
    });

    it('forwards onAdminOpen to StatusActions', () => {
        render(
            <ThemeProvider>
                <DockedStatusFooter onAdminOpen={() => {}} />
            </ThemeProvider>,
        );
        expect(screen.getByTestId('status-actions').getAttribute('data-has-admin')).toBe('true');
    });

    it('renders nothing when not docked (classic / mobile)', () => {
        mockInDock = false;
        const { container } = render(
            <ThemeProvider>
                <DockedStatusFooter />
            </ThemeProvider>,
        );
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });

    it('renders nothing outside a ThemeProvider (app-shell chrome only)', () => {
        // No ThemeProvider — must no-op rather than throw, so isolated page
        // component tests (Admin, My Work) that render the footer stay green.
        const { container } = render(<DockedStatusFooter />);
        expect(screen.queryByTestId('status-actions')).toBeNull();
        expect(container.firstChild).toBeNull();
    });
});
