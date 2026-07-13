/**
 * @vitest-environment jsdom
 *
 * Integration tests for the live search/filter input on the AdminPanel
 * "Workspace Features" card. Covers: filtering rows by label+hint, hiding
 * groups that become empty, the zero-match empty-state, the clear button,
 * and the guarantee that the query never leaks into the save payload.
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
    applyRuntimeConfigPatch: () => { },
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
import { ADMIN_SETTING_DEFINITIONS } from '../../../../../src/config/admin-setting-definitions';

/** Config keys that legitimately appear in the Features save payload. */
const FEATURE_KEYS = new Set(
    ADMIN_SETTING_DEFINITIONS.filter(def => def.ui !== undefined).map(def => def.key),
);

// ── Helpers ────────────────────────────────────────────────────────────────

function mockConfigResponse(overrides: Record<string, any> = {}) {
    return {
        ok: true,
        json: async () => ({
            resolved: {
                terminal: { enabled: true },
                notes: { enabled: true },
                myWork: { enabled: true },
                ...overrides,
            },
            sources: {},
        }),
    };
}

function mockPreferencesResponse() {
    return { ok: true, json: async () => ({ theme: 'auto' }) };
}

function mockStatsResponse() {
    return { ok: true, json: async () => ({ processCount: 0, wikiCount: 0, totalBytes: 0 }) };
}

function defaultFetchImpl(url: string, opts?: any) {
    if (opts?.method === 'PUT' && url.includes('/admin/config')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
    if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
    if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
    return Promise.resolve({ ok: true, json: async () => ({}) });
}

async function gotoFeaturesSubTab(): Promise<void> {
    await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeDefined());
    fireEvent.click(screen.getByTestId('settings-subtab-features'));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AdminPanel — Workspace Features search', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation(defaultFetchImpl);
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the search input at the top of the Features card', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => {
            expect(screen.getByTestId('feature-search-input')).toBeTruthy();
            expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        });
    });

    it('(a) filters visible feature rows by label+hint and (b) hides empty groups', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        // Sanity: Notes (dashboard group) is visible before filtering.
        expect(screen.getByTestId('toggle-notes-enabled')).toBeTruthy();

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'terminal' } });

        // Only the Terminal row (devTools group) survives the filter.
        expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        expect(screen.queryByTestId('toggle-notes-enabled')).toBeNull();
        // Its group heading is kept; groups with no matches are hidden entirely.
        expect(screen.getByTestId('feature-group-dev-tools')).toBeTruthy();
        expect(screen.queryByTestId('feature-group-dashboard')).toBeNull();
    });

    it('is case-insensitive and matches against hint text', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        // "shell access" appears only in the Terminal hint, in mixed case.
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'SHELL ACCESS' } });

        expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        expect(screen.queryByTestId('toggle-notes-enabled')).toBeNull();
    });

    it('(c) renders the empty-state when nothing matches', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'zzzznomatch' } });

        expect(screen.getByTestId('feature-search-empty')).toBeTruthy();
        expect(screen.queryByTestId('toggle-terminal-enabled')).toBeNull();
        expect(screen.queryByTestId('feature-group-dev-tools')).toBeNull();
        expect(screen.queryByTestId('feature-group-dashboard')).toBeNull();
    });

    it('treats whitespace-only queries as empty (full list shown)', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: '   ' } });

        expect(screen.queryByTestId('feature-search-empty')).toBeNull();
        expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        expect(screen.getByTestId('toggle-notes-enabled')).toBeTruthy();
    });

    it('clear button restores the full grouped list', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'terminal' } });
        expect(screen.queryByTestId('toggle-notes-enabled')).toBeNull();

        fireEvent.click(screen.getByTestId('feature-search-clear'));

        expect(screen.getByTestId('toggle-notes-enabled')).toBeTruthy();
        expect(screen.getByTestId('feature-group-dashboard')).toBeTruthy();
        expect((screen.getByTestId('feature-search-input') as HTMLInputElement).value).toBe('');
    });

    it('(d) never includes the search query in the admin.updateConfig payload', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        // Type a query, then make a real toggle change so Save is enabled.
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'terminal' } });
        const toggle = screen.getByTestId('toggle-terminal-enabled') as HTMLInputElement;
        fireEvent.click(toggle);

        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-features"]'));
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config'),
            );
            expect(putCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(putCalls[0][1].body);
            // The toggle change is present…
            expect(body['terminal.enabled']).toBe(false);
            // …but no UI-search state leaked in: there is no `featureSearch`
            // key, and every payload key is a known feature-definition key.
            expect(Object.keys(body)).not.toContain('featureSearch');
            for (const key of Object.keys(body)) {
                expect(FEATURE_KEYS.has(key)).toBe(true);
            }
        });
    });
});
