/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Scratchpad toggle in AdminPanel Features card.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/admin/SettingsCard', () => ({
    SettingsCard: ({ children, onSave, onCancel, dirty, ...props }: any) => (
        <div data-testid={props['data-testid']}>
            {props.title && <h3>{props.title}</h3>}
            {children}
            {onSave && <button onClick={onSave} disabled={!dirty}>Save</button>}
            {onCancel && <button onClick={onCancel}>Cancel</button>}
        </div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/admin/ProviderTokensSection', () => ({
    ProviderTokensSection: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/admin/PromptsPanel', () => ({
    PromptsPanel: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/admin/DbBrowserSection', () => ({
    DbBrowserSection: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/admin/StorageSection', () => ({
    default: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { activeAdminSubTab: 'settings' },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/welcome/FeatureTip', () => ({
    FeatureTip: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/featureFlags', () => ({
    SHOW_WELCOME_TUTORIAL: false,
}));

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    Button: ({ children, onClick, ...props }: any) => <button onClick={onClick} {...props}>{children}</button>,
    Spinner: () => <div>Loading...</div>,
    useToast: () => ({ toasts: [], addToast: vi.fn(), removeToast: vi.fn() }),
    ToastContainer: () => null,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
    // AdminPanel reads the URL fragment to choose the initial Settings sub-tab.
    // Reset between tests so each one starts on the default ('ai') sub-tab.
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

import { AdminPanel } from '../../../../../src/server/spa/client/react/admin/AdminPanel';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockConfigResponse(overrides: Record<string, any> = {}) {
    return {
        ok: true,
        json: async () => ({
            resolved: {
                terminal: { enabled: false },
                notes: { enabled: false },
                myWork: { enabled: false },
                myLife: { enabled: false },
                scratchpad: { enabled: false },
                ...overrides,
            },
            sources: {},
        }),
    };
}

function mockPreferencesResponse() {
    return {
        ok: true,
        json: async () => ({ theme: 'auto' }),
    };
}

function mockStatsResponse(overrides: Record<string, any> = {}) {
    return {
        ok: true,
        json: async () => ({
            processCount: 0,
            wikiCount: 0,
            totalBytes: 0,
            ...overrides,
        }),
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminPanel — Scratchpad toggle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the scratchpad toggle checkbox', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-scratchpad-enabled')).toBeTruthy();
        });
    });

    it('renders admin stats from the typed admin client', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse({ processCount: 7, wikiCount: 2, totalBytes: 1536 }));
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);

        await waitFor(() => {
            // The sidebar stats block renders the count and label in separate
            // spans, so the row's combined text content is "Processes7".
            expect(screen.getByTestId('stat-processes').textContent).toMatch(/Processes.*7/);
        });
        expect(screen.getByTestId('stat-wikis').textContent).toMatch(/Wikis.*2/);
        expect(screen.getByTestId('stat-disk').textContent).toMatch(/Disk.*1\.5 KB/);
        expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/admin/data/stats?includeWikis=true'))).toBe(true);
    });

    /**
     * Switch the Settings page to the Features sub-tab. Scratchpad controls
     * live on the Features card; without the navigation they are not mounted.
     */
    async function gotoFeaturesSubTab(): Promise<void> {
        await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeDefined());
        fireEvent.click(screen.getByTestId('settings-subtab-features'));
    }

    it('shows scratchpad toggle checked when scratchpad.enabled=true', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ scratchpad: { enabled: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-scratchpad-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
        });
    });

    it('sends scratchpad.enabled in PATCH payload when toggled and saved', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ scratchpad: { enabled: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        // Wait for config to load and checkbox to appear
        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-scratchpad-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
        });

        // Uncheck scratchpad
        const checkbox = screen.getByTestId('toggle-scratchpad-enabled') as HTMLInputElement;
        fireEvent.click(checkbox);
        expect(checkbox.checked).toBe(false);

        // Find and click the Features save button
        const saveButtons = screen.getAllByText('Save');
        // The features card save button — find the one in the features settings card
        const featuresSave = saveButtons.find(btn => {
            const card = btn.closest('[data-testid="settings-features"]');
            return card !== null;
        });
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        // Verify the PUT call includes scratchpad.enabled
        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config')
            );
            expect(putCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(putCalls[0][1].body);
            expect(body['scratchpad.enabled']).toBe(false);
        });
    });

    it('shows layout selector when scratchpad is enabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ scratchpad: { enabled: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('select-scratchpad-layout')).toBeTruthy();
        });
    });

    it('does not show layout selector when scratchpad is disabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ scratchpad: { enabled: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-scratchpad-enabled')).toBeTruthy();
        });
        expect(screen.queryByTestId('select-scratchpad-layout')).toBeNull();
    });

    it('sends scratchpad.layout in PATCH payload when changed and saved', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ scratchpad: { enabled: true, layout: 'horizontal' } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('select-scratchpad-layout')).toBeTruthy();
        });

        // Change layout to vertical
        const select = screen.getByTestId('select-scratchpad-layout') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'vertical' } });

        // Save
        const saveButtons = screen.getAllByText('Save');
        const featuresSave = saveButtons.find(btn => btn.closest('[data-testid="settings-features"]'));
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config')
            );
            expect(putCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(putCalls[0][1].body);
            expect(body['scratchpad.layout']).toBe('vertical');
        });
    });
});
