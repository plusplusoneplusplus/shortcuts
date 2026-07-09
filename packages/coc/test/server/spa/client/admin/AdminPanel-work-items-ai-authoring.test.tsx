/**
 * @vitest-environment jsdom
 *
 * Integration tests for Work Items feature toggles in AdminPanel Features card (AC-05).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isServersEnabled: () => false,
    isRemoteShellEnabled: () => false,
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
                workItems: { hierarchy: { enabled: false }, aiAuthoring: { enabled: false }, workflow: { enabled: false } },
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

function mockStatsResponse() {
    return {
        ok: true,
        json: async () => ({ processCount: 0, wikiCount: 0, totalBytes: 0 }),
    };
}

async function gotoFeaturesSubTab(): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeDefined());
    fireEvent.click(screen.getByTestId('settings-subtab-features'));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminPanel — Work Items AI Authoring toggle (AC-05)', () => {
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

    it('renders the AI authoring toggle in the Features sub-tab', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-work-items-ai-authoring-enabled')).toBeTruthy();
        });
    });

    it('toggle defaults to unchecked (feature flag default is false)', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const toggle = screen.getByTestId('toggle-work-items-ai-authoring-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);
        });
    });

    it('reflects workItems.aiAuthoring.enabled=true from config', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve(mockConfigResponse({
                    workItems: { hierarchy: { enabled: false }, aiAuthoring: { enabled: true } },
                }));
            }
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const toggle = screen.getByTestId('toggle-work-items-ai-authoring-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(true);
        });
    });

    it('sends workItems.aiAuthoring.enabled in PUT payload when toggled and saved', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        // Wait for config to load
        await waitFor(() => {
            expect(screen.getByTestId('toggle-work-items-ai-authoring-enabled')).toBeTruthy();
        });

        // Enable the feature
        const toggle = screen.getByTestId('toggle-work-items-ai-authoring-enabled') as HTMLInputElement;
        fireEvent.click(toggle);
        expect(toggle.checked).toBe(true);

        // Click Save in the features card
        const saveButtons = screen.getAllByText('Save');
        const featuresSave = saveButtons.find(btn =>
            btn.closest('[data-testid="settings-features"]') !== null
        );
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        // Verify the PUT call includes the flag
        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config')
            );
            expect(putCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(putCalls[0][1].body);
            expect(body['workItems.aiAuthoring.enabled']).toBe(true);
        });
    });

    it('resets toggle to saved state when Cancel is clicked', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            expect(screen.getByTestId('toggle-work-items-ai-authoring-enabled')).toBeTruthy();
        });

        // Enable (dirty state)
        const toggle = screen.getByTestId('toggle-work-items-ai-authoring-enabled') as HTMLInputElement;
        fireEvent.click(toggle);
        expect(toggle.checked).toBe(true);

        // Cancel
        const cancelButtons = screen.getAllByText('Cancel');
        const featuresCancel = cancelButtons.find(btn =>
            btn.closest('[data-testid="settings-features"]') !== null
        );
        expect(featuresCancel).toBeTruthy();
        fireEvent.click(featuresCancel!);

        // Should revert to false (server returned false)
        expect(toggle.checked).toBe(false);
    });
});

describe('AdminPanel — Work Items Workflow toggle (AC-01)', () => {
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

    it('renders the durable workflow toggle in the Features sub-tab', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-work-items-workflow-enabled')).toBeTruthy();
        });
    });

    it('toggle defaults to unchecked (feature flag default is false)', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const toggle = screen.getByTestId('toggle-work-items-workflow-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(false);
        });
    });

    it('reflects workItems.workflow.enabled=true from config', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve(mockConfigResponse({
                    workItems: { hierarchy: { enabled: false }, aiAuthoring: { enabled: false }, workflow: { enabled: true } },
                }));
            }
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const toggle = screen.getByTestId('toggle-work-items-workflow-enabled') as HTMLInputElement;
            expect(toggle.checked).toBe(true);
        });
    });

    it('sends workItems.workflow.enabled in PUT payload when toggled and saved', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            expect(screen.getByTestId('toggle-work-items-workflow-enabled')).toBeTruthy();
        });

        const toggle = screen.getByTestId('toggle-work-items-workflow-enabled') as HTMLInputElement;
        fireEvent.click(toggle);
        expect(toggle.checked).toBe(true);

        const saveButtons = screen.getAllByText('Save');
        const featuresSave = saveButtons.find(btn =>
            btn.closest('[data-testid="settings-features"]') !== null
        );
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config')
            );
            expect(putCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(putCalls[0][1].body);
            expect(body['workItems.workflow.enabled']).toBe(true);
        });
    });
});
