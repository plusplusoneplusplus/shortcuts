import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { AdminPanel } from '../../../../src/server/spa/client/react/admin/AdminPanel';

// AdminPanel pulls config + stats on mount; supply benign defaults so the
// component reaches its idle state quickly.
const mockFetch = vi.fn();

// LogsView opens an SSE stream on mount. jsdom does not implement
// EventSource — supply a minimal stub so the component does not throw
// when it is rendered inside the embedded view tests.
class FakeEventSource {
    static instances: FakeEventSource[] = [];
    onerror: ((this: EventSource, ev: Event) => any) | null = null;
    onopen: ((this: EventSource, ev: Event) => any) | null = null;
    listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
    constructor(public url: string) { FakeEventSource.instances.push(this); }
    addEventListener(type: string, fn: (e: MessageEvent) => void) {
        (this.listeners[type] ||= []).push(fn);
    }
    removeEventListener() { /* noop */ }
    close() { /* noop */ }
}

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

// ── Tool views render embedded in the admin right panel ──────

describe('AdminPanel — Tools embed the view in the right panel', () => {
    it('starts with no embed shown (default activeTab is "repos")', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());
        // None of the tool embed wrappers should be mounted while the
        // dashboard tab is still 'repos'.
        expect(document.querySelector('[data-testid^="admin-tool-embed-"]')).toBeNull();
    });

    it('clicking the Skills row mounts the embedded SkillsView in the right panel', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });

        // Embed wrapper is mounted with the matching testid…
        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeTruthy());
        // …and the SkillsView itself renders inside it (carries `id="view-skills"`).
        await waitFor(() => expect(document.getElementById('view-skills')).toBeTruthy());
        // No standalone admin Configure card should be present in embed mode.
        expect(document.querySelector('[data-testid="settings-cards"]')).toBeNull();
    });

    it('clicking the Logs row mounts the embedded LogsView in the right panel', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('logs-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('logs-toggle')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-logs"]')).toBeTruthy());
        await waitFor(() => expect(document.querySelector('[data-testid="logs-view"]')).toBeTruthy());
    });

    it('marks the active Tools row with is-active + aria-current="page"', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });

        await waitFor(() => {
            const skills = document.getElementById('skills-toggle')!;
            expect(skills.className).toContain('is-active');
            expect(skills.getAttribute('aria-current')).toBe('page');
        });
        // Other Tools rows are not marked active.
        expect(document.getElementById('logs-toggle')!.className).not.toContain('is-active');
        expect(document.getElementById('logs-toggle')!.getAttribute('aria-current')).toBeNull();
    });

    it('clears Configure row is-active styling when a Tool view is embedded', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        // Default admin sub-tab is "settings"; before clicking a tool, the
        // Settings Configure row is active.
        const settingsRow = document.querySelector<HTMLButtonElement>('[data-testid="admin-tab-settings"]')!;
        expect(settingsRow.className).toContain('is-active');

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });

        await waitFor(() => {
            // Once a tool is embedded, no Configure row should show as active.
            expect(document.querySelector<HTMLButtonElement>('[data-testid="admin-tab-settings"]')!.className).not.toContain('is-active');
        });
    });

    it('breadcrumb reads "Tools / <Label>" while a tool is embedded', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('models-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('models-toggle')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-models"]')).toBeTruthy());
        // Both crumbs ("Tools" and the active tool label) sit inside the
        // breadcrumb nav as direct text content.
        const crumb = document.querySelector('.ar-breadcrumb');
        expect(crumb).toBeTruthy();
        expect(crumb!.textContent).toContain('Tools');
        expect(crumb!.textContent).toContain('Models');
    });

    it('clicking a Configure row after a Tool view restores the admin page', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });
        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeTruthy());

        // Click the Settings Configure row — embed should unmount and the
        // standard admin Settings card view should render.
        await act(async () => {
            fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="admin-tab-settings"]')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeNull());
        // Settings cards container is back.
        expect(document.querySelector('[data-testid="settings-cards"]')).toBeTruthy();
        // Settings row regains is-active.
        expect(document.querySelector<HTMLButtonElement>('[data-testid="admin-tab-settings"]')!.className).toContain('is-active');
    });
});
