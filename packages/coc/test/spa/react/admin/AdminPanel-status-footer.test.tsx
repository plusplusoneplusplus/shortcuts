/**
 * AdminPanel — docks the shared status cluster inside its own left sidebar
 * footer (remote-first shell), so the app-wide GlobalStatusDock stands down and
 * no partial-width empty strip is painted beneath the admin content pane.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';

// Stub the docked footer — assert placement, not its internals.
vi.mock('../../../../src/server/spa/client/react/layout/DockedStatusFooter', () => ({
    DockedStatusFooter: () => <div data-testid="docked-status-footer" />,
}));

// LogsView (embedded) opens an SSE stream; jsdom has no EventSource.
class FakeEventSource {
    onerror: unknown = null;
    onopen: unknown = null;
    constructor(public url: string) {}
    addEventListener() {}
    removeEventListener() {}
    close() {}
}

const mockFetch = vi.fn();

beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        headers: new Headers(),
    });
    global.fetch = mockFetch;
    (globalThis as any).EventSource = FakeEventSource;
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

import { AdminPanel } from '../../../../src/server/spa/client/react/admin/AdminPanel';

describe('AdminPanel — docked status footer', () => {
    it('renders the docked status footer inside the admin sidebar', async () => {
        await act(async () => {
            render(
                <AppProvider>
                    <AdminPanel />
                </AppProvider>,
            );
        });

        const footer = screen.getByTestId('docked-status-footer');
        const sidebar = document.querySelector('.ar-sidebar');
        expect(sidebar).not.toBeNull();
        expect(sidebar!.contains(footer)).toBe(true);
        // Pinned to the very bottom of the sidebar, after the Restart footer.
        expect(sidebar!.lastElementChild).toBe(footer);
    });
});
