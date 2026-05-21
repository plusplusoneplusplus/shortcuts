/**
 * @vitest-environment jsdom
 *
 * Integration tests for the PR Review Suggestions toggle in AdminPanel Features card.
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

describe('AdminPanel — PR Review Suggestions toggle', () => {
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

    it('does not render the suggestions toggle when pull requests tab is disabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-pull-requests-enabled')).toBeTruthy();
        });
        expect(screen.queryByTestId('toggle-pull-requests-suggestions-enabled')).toBeNull();
    });

    it('renders the suggestions toggle when pull requests tab is enabled', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('toggle-pull-requests-suggestions-enabled')).toBeTruthy();
        });
    });

    it('shows suggestions toggle checked when pullRequests.suggestions=true', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: true, suggestions: true } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-pull-requests-suggestions-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(true);
        });
    });

    it('shows suggestions toggle unchecked when pullRequests.suggestions=false', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: true, suggestions: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-pull-requests-suggestions-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
        });
    });

    it('includes pullRequests.suggestions in save payload', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: true, suggestions: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            const checkbox = screen.getByTestId('toggle-pull-requests-suggestions-enabled') as HTMLInputElement;
            expect(checkbox.checked).toBe(false);
        });

        // Enable suggestions
        fireEvent.click(screen.getByTestId('toggle-pull-requests-suggestions-enabled'));

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
            expect(body['pullRequests.suggestions']).toBe(true);
        });
    });

    it('hides suggestions toggle when pull requests tab is turned off via the UI', async () => {
        mockFetch.mockImplementation((url: string) => {
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ pullRequests: { enabled: true, suggestions: false } }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        // Suggestions toggle initially visible
        await waitFor(() => {
            expect(screen.getByTestId('toggle-pull-requests-suggestions-enabled')).toBeTruthy();
        });

        // Disable the Pull Requests tab toggle
        fireEvent.click(screen.getByTestId('toggle-pull-requests-enabled'));

        // Suggestions toggle should now be gone
        await waitFor(() => {
            expect(screen.queryByTestId('toggle-pull-requests-suggestions-enabled')).toBeNull();
        });
    });
});
