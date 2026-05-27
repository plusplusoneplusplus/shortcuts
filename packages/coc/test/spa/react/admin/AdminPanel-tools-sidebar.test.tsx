import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
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

// ── AdminPanel grouped sidebar navigation ─────────────────────

describe('AdminPanel — grouped sidebar navigation', () => {
    it('renders user-intent nav groups in the sidebar', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const labels = Array.from(document.querySelectorAll('.ar-sidebar .ar-nav-group-label')).map(node => node.textContent);
            expect(labels).toEqual(['Configure', 'Knowledge', 'Connections', 'Operations', 'Developer / Internals']);
        });
    });

    it('renders embedded tool rows in their task groups by default (servers disabled)', async () => {
        delete (window as any).__DASHBOARD_CONFIG__;
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            expect(document.getElementById('memory-toggle')).toBeTruthy();
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

    it('orders embedded tools by their user-intent groups', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('servers-toggle')).toBeTruthy());

        const groups = Array.from(document.querySelectorAll('.ar-sidebar .ar-nav-group')).map(group => ({
            label: group.querySelector('.ar-nav-group-label')?.textContent ?? '',
            ids: Array.from(group.querySelectorAll('.ar-nav-item')).map(item => item.id).filter(Boolean),
        }));

        expect(groups).toEqual([
            { label: 'Configure', ids: ['models-toggle'] },
            { label: 'Knowledge', ids: ['memory-toggle', 'skills-toggle'] },
            { label: 'Connections', ids: ['servers-toggle'] },
            { label: 'Operations', ids: ['stats-toggle', 'logs-toggle'] },
            { label: 'Developer / Internals', ids: [] },
        ]);
    });

    it('each embedded tool row carries data-tab attribute matching its global route', async () => {
        (window as any).__DASHBOARD_CONFIG__ = {
            apiBasePath: '/api',
            wsPath: '/ws',
            serversEnabled: true,
        };
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('servers-toggle')).toBeTruthy());
        expect(document.getElementById('memory-toggle')!.getAttribute('data-tab')).toBe('memory');
        expect(document.getElementById('skills-toggle')!.getAttribute('data-tab')).toBe('skills');
        expect(document.getElementById('logs-toggle')!.getAttribute('data-tab')).toBe('logs');
        expect(document.getElementById('stats-toggle')!.getAttribute('data-tab')).toBe('stats');
        expect(document.getElementById('models-toggle')!.getAttribute('data-tab')).toBe('models');
        expect(document.getElementById('servers-toggle')!.getAttribute('data-tab')).toBe('servers');
    });

    it('clicking an embedded tool row updates location.hash to the corresponding global route', async () => {
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

    it('embedded tool rows are accessible (aria-label + title)', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('logs-toggle')).toBeTruthy());
        const logs = document.getElementById('logs-toggle')!;
        expect(logs.getAttribute('aria-label')).toBe('Logs');
        expect(logs.getAttribute('title')).toBe('Logs');
    });
});

// ── Tool views render embedded in the admin right panel ──────

describe('AdminPanel — embedded tools render in the right panel', () => {
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

    it('marks the active embedded tool row with is-active + aria-current="page"', async () => {
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
        // Other embedded tool rows are not marked active.
        expect(document.getElementById('logs-toggle')!.className).not.toContain('is-active');
        expect(document.getElementById('logs-toggle')!.getAttribute('aria-current')).toBeNull();
    });

    it('clears admin/settings row is-active styling when an embedded tool view is active', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        // Default admin sub-section is settings; before clicking a tool,
        // the single "Configure" sidebar item is active.
        const configureRow = document.querySelector<HTMLButtonElement>('[data-testid="settings-nav-configure"]')!;
        expect(configureRow.className).toContain('is-active');

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });

        await waitFor(() => {
            // Once a tool is embedded, the Configure sidebar item should no longer be active.
            expect(document.querySelector<HTMLButtonElement>('[data-testid="settings-nav-configure"]')!.className).not.toContain('is-active');
        });
    });

    it('breadcrumb reads "<Group> / <Label>" while a tool is embedded', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('models-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('models-toggle')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-models"]')).toBeTruthy());
        // Both crumbs ("Configure" and the active tool label) sit inside the
        // breadcrumb nav as direct text content.
        const crumb = document.querySelector('.ar-breadcrumb');
        expect(crumb).toBeTruthy();
        expect(crumb!.textContent).toContain('Configure');
        expect(crumb!.textContent).toContain('Models');
    });

    it('clicking the Configure sidebar item after an embedded tool view restores the admin page', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });
        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeTruthy());

        // Click the "Configure" sidebar item — embed should unmount and the settings
        // page should render with the sub-tab bar and default (ai) card.
        await act(async () => {
            fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="settings-nav-configure"]')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeNull());
        // Settings cards container is back.
        expect(document.querySelector('[data-testid="settings-cards"]')).toBeTruthy();
        // Default (AI & Execution) card is visible.
        expect(document.querySelector('[data-testid="settings-ai-execution"]')).toBeTruthy();
        // The in-page sub-tab bar is rendered; clicking Chat switches to that section.
        await act(async () => {
            fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="settings-subtab-chat"]')!);
        });
        await waitFor(() => expect(document.querySelector('[data-testid="settings-chat"]')).toBeTruthy());
        // Chat tab is now marked active.
        expect(document.querySelector<HTMLButtonElement>('[data-testid="settings-subtab-chat"]')!.className).toContain('is-active');
    });
});
