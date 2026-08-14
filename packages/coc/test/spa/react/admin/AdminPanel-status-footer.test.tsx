/**
 * AdminPanel — does NOT dock the shared status cluster in its own sidebar.
 *
 * Admin is an overlay dialog now, not a page: the view behind the dialog keeps
 * its own dock (global band or its own sidebar footer), so docking a second
 * cluster inside the admin sidebar would show two at once — and an admin gear
 * inside admin. `GlobalStatusDock` correspondingly has no admin stand-down.
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
    it('renders no docked status footer inside the admin sidebar', async () => {
        await act(async () => {
            render(
                <AppProvider>
                    <AdminPanel />
                </AppProvider>,
            );
        });

        const sidebar = document.querySelector('.ar-sidebar');
        expect(sidebar).not.toBeNull();
        expect(screen.queryByTestId('docked-status-footer')).toBeNull();
        // The restart cluster is the last thing in the sidebar now.
        expect(sidebar!.lastElementChild?.className).toContain('ar-sidebar-foot');
    });
});
