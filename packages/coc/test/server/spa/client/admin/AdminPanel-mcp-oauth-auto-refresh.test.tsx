/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isServersEnabled: () => false,
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

describe('AdminPanel — MCP OAuth auto-refresh toggle', () => {
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

    it('does not render the auto-refresh toggle when mcpOauth is disabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ mcpOauth: { enabled: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-mcp-oauth-enabled')).toBeTruthy();
        });
        expect(screen.queryByTestId('toggle-mcp-oauth-auto-refresh-enabled')).toBeNull();
    });

    it('shows auto-refresh toggle when mcpOauth is enabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ mcpOauth: { enabled: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-mcp-oauth-auto-refresh-enabled')).toBeTruthy();
        });
    });

    it('includes mcpOauth.autoRefresh.enabled in the save payload', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) {
                return Promise.resolve(mockConfigResponse({
                    mcpOauth: { enabled: true, autoRefresh: { enabled: false } },
                }));
            }
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-mcp-oauth-auto-refresh-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
        });

        fireEvent.click(screen.getByTestId('toggle-mcp-oauth-auto-refresh-enabled'));

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
            expect(body['mcpOauth.autoRefresh.enabled']).toBe(true);
            expect(body['mcpOauth.enabled']).toBe(true);
        });
    });

    it('hides auto-refresh toggle when MCP OAuth is turned off via the UI', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) {
                return Promise.resolve(mockConfigResponse({
                    mcpOauth: { enabled: true, autoRefresh: { enabled: false } },
                }));
            }
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            expect(screen.getByTestId('toggle-mcp-oauth-auto-refresh-enabled')).toBeTruthy();
        });

        // Turn parent toggle off; sub-toggle should disappear.
        fireEvent.click(screen.getByTestId('toggle-mcp-oauth-enabled'));

        await waitFor(() => {
            expect(screen.queryByTestId('toggle-mcp-oauth-auto-refresh-enabled')).toBeNull();
        });
    });
});
