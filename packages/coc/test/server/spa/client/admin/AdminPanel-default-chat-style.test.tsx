/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Default chat style select in the AdminPanel
 * Features card.
 *
 * The select is registry-driven (`features.defaultChatStyle`, a `select`
 * control with `dependsOn: 'features.chatStyleSelector'`), so this covers the
 * three things a definition entry alone cannot: it renders, it hides when the
 * selector feature is off, and the picked value reaches PUT /api/admin/config.
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

describe('AdminPanel — Default chat style select', () => {
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

    async function gotoFeaturesSubTab(): Promise<void> {
        await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeDefined());
        fireEvent.click(screen.getByTestId('settings-subtab-features'));
    }

    function withFeatures(features: Record<string, unknown>) {
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse({ features }));
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    }

    it('renders the select with one option per stable style', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'default' });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => expect(screen.getByTestId('select-default-chat-style')).toBeTruthy());
        const select = screen.getByTestId('select-default-chat-style') as HTMLSelectElement;
        expect(select.value).toBe('default');
        expect([...select.options].map(o => o.value)).toEqual(['default', 'human', 'direct', 'structured']);
        expect([...select.options].map(o => o.textContent)).toEqual(['Default', 'Human', 'Direct', 'Structured']);
    });

    it('shows the configured style as the current value', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'direct' });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => {
            expect((screen.getByTestId('select-default-chat-style') as HTMLSelectElement).value).toBe('direct');
        });
    });

    // dependsOn — a default style is meaningless with no selector to seed.
    it('hides the select when the chat style selector feature is off', async () => {
        withFeatures({ chatStyleSelector: false, defaultChatStyle: 'direct' });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();

        await waitFor(() => expect(screen.getByTestId('toggle-chat-style-selector-enabled')).toBeTruthy());
        expect(screen.queryByTestId('select-default-chat-style')).toBeNull();
    });

    it('sends features.defaultChatStyle in the PUT payload when changed and saved', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'default' });

        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('select-default-chat-style')).toBeTruthy());

        fireEvent.change(screen.getByTestId('select-default-chat-style'), { target: { value: 'direct' } });

        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-features"]'));
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(([url, opts]: any[]) => opts?.method === 'PUT' && String(url).includes('/admin/config'));
            expect(putCalls.length).toBeGreaterThan(0);
            expect(JSON.parse(putCalls[0][1].body)['features.defaultChatStyle']).toBe('direct');
        });
    });
});
