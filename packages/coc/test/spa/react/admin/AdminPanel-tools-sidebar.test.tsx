import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { AdminPanel } from '../../../../src/server/spa/client/react/admin/AdminPanel';

// AdminPanel pulls config + stats on mount; supply benign defaults so the
// component reaches its idle state quickly.
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
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

afterEach(() => {
    delete (window as any).__DASHBOARD_CONFIG__;
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

function renderAdmin() {
    return render(
        <AppProvider>
            <AdminPanel />
        </AppProvider>,
    );
}

// ── AdminPanel sidebar Tools group ─────────────────────────────

describe('AdminPanel — Tools sidebar group', () => {
    it('renders a Tools nav group label in the sidebar', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(screen.getByText('Tools')).toBeTruthy());
    });

    it('renders Skills, Logs, Usage, Models rows by default (servers disabled)', async () => {
        delete (window as any).__DASHBOARD_CONFIG__;
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            expect(document.getElementById('skills-toggle')).toBeTruthy();
            expect(document.getElementById('logs-toggle')).toBeTruthy();
            expect(document.getElementById('stats-toggle')).toBeTruthy();
            expect(document.getElementById('models-toggle')).toBeTruthy();
        });
        // Servers is gated behind serversEnabled, off by default.
        expect(document.getElementById('servers-toggle')).toBeNull();
    });

    it('renders Servers row when serversEnabled is true', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('servers-toggle')).toBeTruthy());
    });

    it('Tools rows order: skills → logs → stats → models → servers', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('servers-toggle')).toBeTruthy());
        const ids = ['skills-toggle', 'logs-toggle', 'stats-toggle', 'models-toggle', 'servers-toggle'];
        const positions = ids.map(id => document.getElementById(id)!.compareDocumentPosition(document.body));
        for (let i = 0; i < ids.length - 1; i++) {
            const a = document.getElementById(ids[i])!;
            const b = document.getElementById(ids[i + 1])!;
            expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        // Reference `positions` so eslint does not complain about unused locals.
        void positions;
    });

    it('each Tools row carries data-tab attribute matching its global route', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('servers-toggle')).toBeTruthy());
        expect(document.getElementById('skills-toggle')!.getAttribute('data-tab')).toBe('skills');
        expect(document.getElementById('logs-toggle')!.getAttribute('data-tab')).toBe('logs');
        expect(document.getElementById('stats-toggle')!.getAttribute('data-tab')).toBe('stats');
        expect(document.getElementById('models-toggle')!.getAttribute('data-tab')).toBe('models');
        expect(document.getElementById('servers-toggle')!.getAttribute('data-tab')).toBe('servers');
    });

    it('clicking a Tools row updates location.hash to the corresponding global route', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('logs-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('logs-toggle')!);
        });
        expect(window.location.hash).toBe('#logs');

        await act(async () => {
            fireEvent.click(document.getElementById('stats-toggle')!);
        });
        expect(window.location.hash).toBe('#stats');

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });
        expect(window.location.hash).toBe('#skills');

        await act(async () => {
            fireEvent.click(document.getElementById('models-toggle')!);
        });
        expect(window.location.hash).toBe('#models');
    });

    it('Tools rows are accessible (aria-label + title)', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('logs-toggle')).toBeTruthy());
        const logs = document.getElementById('logs-toggle')!;
        expect(logs.getAttribute('aria-label')).toBe('Logs');
        expect(logs.getAttribute('title')).toBe('Logs');
    });
});
