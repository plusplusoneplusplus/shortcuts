import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { AdminPanel } from '../../../../src/server/spa/client/react/admin/AdminPanel';

// AdminPanel pulls config + stats on mount; supply benign defaults so the
// component reaches its idle state quickly.
const mockFetch = vi.fn();

function jsonResponse(body: unknown) {
    return {
        ok: true,
        json: () => Promise.resolve(body),
        headers: new Headers(),
    } as Response;
}

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
    mockFetch.mockResolvedValue(jsonResponse({}));
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

describe('AdminPanel — sidebar layout zones', () => {
    it('renders the sidebar with fixed header, scrollable nav, and fixed footer zones', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const sidebar = document.querySelector('.ar-sidebar');
            expect(sidebar).toBeTruthy();
            expect(sidebar!.querySelector('.ar-sidebar-head')).toBeTruthy();
            expect(sidebar!.querySelector('.ar-sidebar-nav')).toBeTruthy();
            expect(sidebar!.querySelector('.ar-sidebar-foot')).toBeTruthy();
        });
    });

    it('renders brand/title inside the fixed header zone', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const head = document.querySelector('.ar-sidebar-head');
            expect(head).toBeTruthy();
            expect(head!.querySelector('.ar-brand')).toBeTruthy();
            expect(head!.textContent).toContain('CoC Admin');
        });
    });

    it('renders nav groups inside the scrollable middle zone', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const nav = document.querySelector('.ar-sidebar-nav');
            expect(nav).toBeTruthy();
            const labels = Array.from(nav!.querySelectorAll('.ar-nav-group-label')).map(el => el.textContent);
            expect(labels).toEqual(['Configure', 'Knowledge', 'Operations', 'Developer / Internals']);
        });
    });

    it('renders restart button in the fixed footer zone', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const foot = document.querySelector('.ar-sidebar-foot');
            expect(foot).toBeTruthy();
            const restartBtn = foot!.querySelector('[data-testid="sidebar-restart-btn"]') as HTMLButtonElement;
            expect(restartBtn).toBeTruthy();
            expect(restartBtn.textContent).toContain('Restart Server');
            expect(restartBtn.disabled).toBe(false);
        });
    });

    it('sidebar restart button triggers the restart handler', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.querySelector('[data-testid="sidebar-restart-btn"]')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.querySelector('[data-testid="sidebar-restart-btn"]')!);
        });

        const restartCall = mockFetch.mock.calls.find(
            (call: any[]) => typeof call[0] === 'string' && call[0].includes('/api/admin/restart')
        );
        expect(restartCall).toBeTruthy();
    });
});

describe('AdminPanel — grouped sidebar navigation', () => {
    it('renders user-intent nav groups in the sidebar', async () => {
        await act(async () => { renderAdmin(); });
        await waitFor(() => {
            const labels = Array.from(document.querySelectorAll('.ar-sidebar .ar-nav-group-label')).map(node => node.textContent);
            expect(labels).toEqual(['Configure', 'Knowledge', 'Operations', 'Developer / Internals']);
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
        });
        // Models and Servers are not in tool nav (models moved to Agent Provider, servers gated).
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
            { label: 'Configure', ids: ['servers-toggle'] },
            { label: 'Knowledge', ids: ['memory-toggle', 'skills-toggle', 'dreams-admin-toggle'] },
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
        expect(document.getElementById('dreams-admin-toggle')!.getAttribute('data-tab')).toBe('dreams-admin');
        expect(document.getElementById('logs-toggle')!.getAttribute('data-tab')).toBe('logs');
        expect(document.getElementById('stats-toggle')!.getAttribute('data-tab')).toBe('stats');
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
        await waitFor(() => expect(document.getElementById('skills-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('skills-toggle')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="admin-tool-embed-skills"]')).toBeTruthy());
        const crumb = document.querySelector('.ar-breadcrumb');
        expect(crumb).toBeTruthy();
        expect(crumb!.textContent).toContain('Knowledge');
        expect(crumb!.textContent).toContain('Skills');
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

    it('saves the Dreams idle check interval in milliseconds after editing minutes', async () => {
        mockFetch.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.includes('/api/admin/config') && init?.method === 'PUT') {
                return Promise.resolve(jsonResponse({ success: true }));
            }
            if (url.includes('/api/admin/config')) {
                return Promise.resolve(jsonResponse({
                    resolved: {
                        dreams: {
                            enabled: false,
                            idleCheckIntervalMs: 300_000,
                        },
                    },
                }));
            }
            if (url.includes('/api/admin/dream-provider-activity')) {
                return Promise.resolve(jsonResponse({ items: [] }));
            }
            return Promise.resolve(jsonResponse({}));
        });

        await act(async () => { renderAdmin(); });
        await waitFor(() => expect(document.getElementById('dreams-admin-toggle')).toBeTruthy());

        await act(async () => {
            fireEvent.click(document.getElementById('dreams-admin-toggle')!);
        });

        await waitFor(() => expect(document.querySelector('[data-testid="dreams-admin-page"]')).toBeTruthy());
        const intervalInput = document.querySelector<HTMLInputElement>('[data-testid="dreams-idle-check-interval-minutes"]')!;
        expect(intervalInput.value).toBe('5');

        await act(async () => {
            fireEvent.change(intervalInput, { target: { value: '12' } });
        });
        await act(async () => {
            fireEvent.click(document.querySelector<HTMLButtonElement>('[data-testid="dreams-settings-save"]')!);
        });

        const saveCall = mockFetch.mock.calls.find(([input, init]: [RequestInfo | URL, RequestInit | undefined]) =>
            String(input).includes('/api/admin/config') && init?.method === 'PUT'
        );
        expect(saveCall).toBeTruthy();
        expect(JSON.parse(String(saveCall![1]!.body))).toMatchObject({
            'dreams.enabled': false,
            'dreams.idleCheckIntervalMs': 720_000,
        });
    });
});
