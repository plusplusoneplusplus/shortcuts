/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Default chat style select, which lives on the
 * dedicated Chat Style settings section (`#admin/settings/chat-style`) rather
 * than the registry-driven Features card.
 *
 * `features.defaultChatStyle` deliberately has no `ui` block any more, so
 * these cover what the definition entry cannot: the sub-tab exists and is
 * deep-linkable, the select renders there and nowhere else, the whole section
 * disappears when `features.chatStyleSelector` is off, and the picked value
 * reaches PUT /api/admin/config.
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

    async function gotoChatStyleSubTab(): Promise<void> {
        await waitFor(() => expect(screen.getByTestId('settings-subtab-chat-style')).toBeDefined());
        fireEvent.click(screen.getByTestId('settings-subtab-chat-style'));
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
        await gotoChatStyleSubTab();

        await waitFor(() => expect(screen.getByTestId('select-default-chat-style')).toBeTruthy());
        const select = screen.getByTestId('select-default-chat-style') as HTMLSelectElement;
        expect(select.value).toBe('default');
        expect([...select.options].map(o => o.value)).toEqual(['default', 'human', 'direct', 'structured']);
        expect([...select.options].map(o => o.textContent)).toEqual(['Default', 'Human', 'Direct', 'Structured']);
    });

    it('shows the configured style as the current value', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'direct' });

        render(<AdminPanel />);
        await gotoChatStyleSubTab();

        await waitFor(() => {
            expect((screen.getByTestId('select-default-chat-style') as HTMLSelectElement).value).toBe('direct');
        });
    });

    // The control moved out of the Features card; leaving a copy behind would
    // give two rendered selects writing the same key.
    it('no longer renders the select on the Features sub-tab', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'direct' });

        render(<AdminPanel />);
        await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeDefined());
        fireEvent.click(screen.getByTestId('settings-subtab-features'));

        await waitFor(() => expect(screen.getByTestId('toggle-chat-style-selector-enabled')).toBeTruthy());
        expect(screen.queryByTestId('select-default-chat-style')).toBeNull();
    });

    it('opens the section directly from #admin/settings/chat-style', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'human' });
        window.location.hash = 'admin/settings/chat-style';

        render(<AdminPanel />);

        await waitFor(() => expect(screen.getByTestId('settings-chat-style')).toBeTruthy());
        expect((screen.getByTestId('select-default-chat-style') as HTMLSelectElement).value).toBe('human');
    });

    // A default style is meaningless with no selector to seed.
    it('hides the sub-tab and falls back when the chat style selector feature is off', async () => {
        withFeatures({ chatStyleSelector: false, defaultChatStyle: 'direct' });
        window.location.hash = 'admin/settings/chat-style';

        render(<AdminPanel />);

        await waitFor(() => expect(screen.getByTestId('settings-subtab-features')).toBeTruthy());
        expect(screen.queryByTestId('settings-subtab-chat-style')).toBeNull();
        expect(screen.queryByTestId('settings-chat-style')).toBeNull();
        expect(screen.queryByTestId('select-default-chat-style')).toBeNull();
        await waitFor(() => expect(window.location.hash).toBe('#admin/settings'));
    });

    it('sends features.defaultChatStyle in the PUT payload when changed and saved', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'default' });

        render(<AdminPanel />);
        await gotoChatStyleSubTab();
        await waitFor(() => expect(screen.getByTestId('select-default-chat-style')).toBeTruthy());

        fireEvent.change(screen.getByTestId('select-default-chat-style'), { target: { value: 'direct' } });

        const save = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-chat-style"]'));
        expect(save).toBeTruthy();
        fireEvent.click(save!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(([url, opts]: any[]) => opts?.method === 'PUT' && String(url).includes('/admin/config'));
            expect(putCalls.length).toBeGreaterThan(0);
            expect(JSON.parse(putCalls[0][1].body)['features.defaultChatStyle']).toBe('direct');
        });
    });
});
