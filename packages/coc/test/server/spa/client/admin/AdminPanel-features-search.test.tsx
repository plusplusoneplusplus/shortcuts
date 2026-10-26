/**
 * @vitest-environment jsdom
 *
 * Integration tests for the live search/filter input on the AdminPanel
 * "Workspace Features" card. Covers: filtering rows by label+hint, hiding
 * groups that become empty, the zero-match empty-state, the clear button,
 * and the guarantee that the query never leaks into the save payload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@plusplusoneplusplus/forge', () => ({}));

const routing = vi.hoisted(() => ({ apiBase: '', selectedRepoId: null as string | null }));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isContainerMode: () => false,
    getApiBase: () => routing.apiBase,
    isRalphEnabled: () => false,
    isServersEnabled: () => false,
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

// Minimal stateful admin sub-tab so sidebar rows (e.g. Connectors → Teams)
// actually switch pages.
const appState = vi.hoisted(() => ({ adminSubTab: 'settings', listeners: new Set<() => void>() }));
vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', async () => {
    const React = await import('react');
    return {
        useApp: () => {
            const [, rerender] = React.useReducer((n: number) => n + 1, 0);
            React.useEffect(() => {
                appState.listeners.add(rerender);
                return () => { appState.listeners.delete(rerender); };
            }, []);
            return {
                state: { activeAdminSubTab: appState.adminSubTab, selectedRepoId: routing.selectedRepoId },
                dispatch: (action: { type: string; tab?: string }) => {
                    if (action.type !== 'SET_ADMIN_SUB_TAB' || action.tab === appState.adminSubTab) return;
                    appState.adminSubTab = action.tab!;
                    for (const listener of appState.listeners) listener();
                },
            };
        },
    };
});

vi.mock('../../../../../src/server/spa/client/react/admin/TeamsConnectionCard', () => ({
    TeamsConnectionCard: () => <div data-testid="teams-connection-card" />,
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
    routing.apiBase = '';
    routing.selectedRepoId = null;
    appState.adminSubTab = 'settings';
    if (typeof window !== 'undefined') {
        window.location.hash = '';
    }
});

import { AdminPanel } from '../../../../../src/server/spa/client/react/admin/AdminPanel';
import { getCocClientFor } from '../../../../../src/server/spa/client/react/api/cocClient';
import { resolveFeatureBadge } from '../../../../../src/server/spa/client/react/admin/FeatureSettingsCard';
import {
    ADMIN_SETTING_DEFINITIONS,
    FEATURE_CARD_GROUPS,
    getFeatureCardSettings,
    getFeatureSettingTab,
} from '../../../../../src/config/admin-setting-definitions';

/** Config keys that legitimately appear in the Features save payload. */
const FEATURE_KEYS = new Set(
    ADMIN_SETTING_DEFINITIONS.filter(def => def.ui !== undefined && getFeatureSettingTab(def) === 'features').map(def => def.key),
);

// ── Helpers ────────────────────────────────────────────────────────────────

function mockConfigResponse(overrides: Record<string, any> = {}) {
    return {
        ok: true,
        json: async () => ({
            resolved: {
                terminal: { enabled: true },
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
    return { ok: true, json: async () => ({ processCount: 0, totalBytes: 0 }) };
}

function defaultFetchImpl(url: string, opts?: any) {
    if (opts?.method === 'PUT' && url.includes('/admin/config')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    if (url.includes('/admin/config')) return Promise.resolve(mockConfigResponse());
    if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
    if (url.endsWith('/workspaces')) return Promise.resolve({ ok: true, json: async () => ({ workspaces: [] }) });
    if (url.endsWith('/ic3-own-commands/status')) return Promise.resolve({
        ok: true, json: async () => ({ state: 'disabled', trouter: { state: 'disabled', error: null } }),
    });
    if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
    return Promise.resolve({ ok: true, json: async () => ({}) });
}

/**
 * Feature groups where no row's label or hint contains `query`, i.e. the
 * groups the search filter must hide entirely.
 */
function groupsWithoutMatch(query: string) {
    const needle = query.toLowerCase();
    return FEATURE_CARD_GROUPS.filter(group => !getFeatureCardSettings(group.id).some(def => {
        const ui = def.ui!;
        return ui.label.toLowerCase().includes(needle) || ui.hint.toLowerCase().includes(needle);
    }));
}

async function gotoTeamsPage(): Promise<void> {
    fireEvent.click(await screen.findByTestId('admin-tab-messaging'));
    await screen.findByTestId('settings-tab-features-teams');
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
        expect(screen.queryByTestId('toggle-vim-navigation-enabled')).toBeNull();
    });

    it('saves the Teams message reaction toggle through admin config', async () => {
        render(<AdminPanel />);
        await gotoTeamsPage();
        const toggle = await screen.findByTestId('toggle-teams-message-reaction-enabled') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
        fireEvent.click(toggle);
        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-tab-features-teams"]'));
        fireEvent.click(featuresSave!);
        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config'),
            );
            expect(putCalls.length).toBe(1);
            expect(JSON.parse(putCalls[0][1].body)['features.teamsMessageReaction']).toBe(true);
        });
    });

    it('loads an enabled Teams message reaction and saves disabling it', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) =>
            url.includes('/admin/config') && opts?.method !== 'PUT'
                ? Promise.resolve(mockConfigResponse({ features: { teamsMessageReaction: true } }))
                : defaultFetchImpl(url, opts));
        render(<AdminPanel />);
        await gotoTeamsPage();
        const toggle = await screen.findByTestId('toggle-teams-message-reaction-enabled') as HTMLInputElement;
        expect(toggle.checked).toBe(true);
        fireEvent.click(toggle);
        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-tab-features-teams"]'));
        fireEvent.click(featuresSave!);
        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config'),
            );
            expect(putCalls.length).toBe(1);
            expect(JSON.parse(putCalls[0][1].body)['features.teamsMessageReaction']).toBe(false);
        });
    });

    it('defaults omitted Teams answer relay on and saves the live opt-out through admin config', async () => {
        render(<AdminPanel />);
        await gotoTeamsPage();
        const toggle = await screen.findByTestId('toggle-teams-ai-answer-relay-enabled') as HTMLInputElement;
        expect(toggle.checked).toBe(true);
        const definition = ADMIN_SETTING_DEFINITIONS.find(def => def.key === 'features.teamsAiAnswerRelay')!;
        expect(resolveFeatureBadge(definition)).toBeUndefined();
        expect(screen.getByText(definition.ui!.hint)).toBeDefined();

        fireEvent.click(toggle);
        expect(toggle.checked).toBe(false);
        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-tab-features-teams"]'));
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config'),
            );
            expect(putCalls.length).toBe(1);
            expect(JSON.parse(putCalls[0][1].body)['features.teamsAiAnswerRelay']).toBe(false);
        });
    });

    it('preserves an explicit disabled Teams answer relay and saves enabling it', async () => {
        mockFetch.mockImplementation((url: string, opts?: any) =>
            url.includes('/admin/config') && opts?.method !== 'PUT'
                ? Promise.resolve(mockConfigResponse({ features: { teamsAiAnswerRelay: false } }))
                : defaultFetchImpl(url, opts));
        render(<AdminPanel />);
        await gotoTeamsPage();
        const toggle = await screen.findByTestId('toggle-teams-ai-answer-relay-enabled') as HTMLInputElement;
        expect(toggle.checked).toBe(false);

        fireEvent.click(toggle);
        expect(toggle.checked).toBe(true);
        const featuresSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-tab-features-teams"]'));
        expect(featuresSave).toBeTruthy();
        fireEvent.click(featuresSave!);

        await waitFor(() => {
            const putCalls = mockFetch.mock.calls.filter(
                ([url, opts]: [string, any]) => opts?.method === 'PUT' && url.includes('/admin/config'),
            );
            expect(putCalls.length).toBe(1);
            expect(JSON.parse(putCalls[0][1].body)['features.teamsAiAnswerRelay']).toBe(true);
        });
    });

    it('(a) filters visible feature rows by label+hint and (b) hides empty groups', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        // Sanity: My Work (dashboard group) is visible before filtering.
        expect(screen.getByTestId('toggle-mywork-enabled')).toBeTruthy();

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'terminal' } });

        // Only the Terminal row (devTools group) survives the filter.
        expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        expect(screen.queryByTestId('toggle-mywork-enabled')).toBeNull();
        // Its group heading is kept; groups with no matches are hidden entirely.
        expect(screen.getByTestId('feature-group-dev-tools')).toBeTruthy();
        // Which groups have no match is read off the live catalog rather than
        // hard-coded: adding a feature whose label or hint happens to mention
        // "terminal" must not make this assertion fail spuriously.
        const emptyGroups = groupsWithoutMatch('terminal');
        expect(emptyGroups.length).toBeGreaterThan(0);
        for (const group of emptyGroups) {
            expect(screen.queryByTestId(group.testId)).toBeNull();
        }
    });

    it('finds Vim navigation across tabs and links to Appearance without showing a duplicate toggle', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'vim' } });
        const link = screen.getByRole('link', { name: 'in Appearance' });
        expect(link.getAttribute('href')).toBe('#admin/settings/appearance');
        expect(screen.queryByTestId('toggle-vim-navigation-enabled')).toBeNull();
        fireEvent.click(link);
        expect(window.location.hash).toBe('#admin/settings/appearance');
        expect(screen.getByTestId('settings-tab-features-appearance')).toBeTruthy();
    });

    it('links every Teams-only setting to Connectors → Teams and keeps shared rows on Integrations', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'Teams' } });
        const defs = ADMIN_SETTING_DEFINITIONS.filter(def => def.ui && getFeatureSettingTab(def) === 'teams');
        expect(defs.map(def => def.key)).toEqual([
            'features.teamsBridgeObservability', 'features.teamsAiAnswerRelay', 'features.teamsMessageReaction',
            'features.teamsIc3OwnCommands', 'teamsIc3OwnCommands.workspaceId',
            'features.teamsReactionDelegation', 'teamsReactionDelegation.workspaceId',
            'teamsReactionDelegation.dispatcherSkill',
        ]);
        for (const def of defs) {
            expect(screen.queryByTestId(def.ui!.testId)).toBeNull();
            const link = screen.getByTestId(`feature-search-link-${def.ui!.testId}`);
            expect(link.getAttribute('href')).toBe('#admin/messaging');
            expect(link.textContent).toBe('in Teams');
        }
        const shared = screen.getByTestId('feature-search-link-toggle-bot-managed-conversations-enabled');
        expect(shared.getAttribute('href')).toBe('#admin/settings/integrations');

        fireEvent.click(screen.getByTestId('feature-search-link-toggle-teams-ai-answer-relay-enabled'));
        await screen.findByTestId('settings-tab-features-teams');
        expect(window.location.hash).toBe('#admin/messaging');
        expect(screen.getByTestId('teams-connection-card')).toBeTruthy();
        for (const def of defs) expect(screen.getAllByTestId(def.ui!.testId)).toHaveLength(1);
        expect(screen.queryByTestId('feature-search-input')).toBeNull();
        expect(mockFetch.mock.calls.some(([, opts]) => opts?.method === 'PUT')).toBe(false);
    });

    it('discovers every Sentinel setting as a link to its single owning tab', async () => {
        // Sentinel Mode on, so dependsOn-gated rows (To-do jobs) are discoverable too.
        mockFetch.mockImplementation((url: string, opts?: any) => url.includes('/admin/config') && opts?.method !== 'PUT'
            ? Promise.resolve(mockConfigResponse({ sentinel: { enabled: true } }))
            : defaultFetchImpl(url, opts));
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        const defs = ADMIN_SETTING_DEFINITIONS.filter(def => getFeatureSettingTab(def) === 'sentinel');
        // Presentation-only result cards live on Appearance, not Sentinel.
        expect(defs).toHaveLength(14);
        expect(defs.some(def => def.key === 'features.sentinelResultCards')).toBe(false);
        expect(defs.some(def => def.key === 'features.sentinelTargetAutocomplete')).toBe(true);
        expect(defs.some(def => def.key === 'features.sentinelRemoteResults')).toBe(true);
        expect(defs.some(def => def.key === 'features.sentinelTodoJobs')).toBe(true);
        expect(defs.some(def => def.key === 'features.sentinelAdditionalInstructions')).toBe(true);
        for (const def of defs) {
            expect(screen.queryByText(def.ui!.label)).toBeNull();
        }
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'Sentinel' } });
        for (const def of defs) {
            expect(screen.queryByTestId(def.ui!.testId)).toBeNull();
            const link = screen.getByTestId(`feature-search-link-${def.ui!.testId}`);
            expect(link.getAttribute('href')).toBe('#admin/settings/sentinel');
            expect(link.textContent).toBe('in Sentinel');
        }
        fireEvent.click(screen.getByTestId('feature-search-link-toggle-sentinel-todo-external-references-enabled'));
        expect(window.location.hash).toBe('#admin/settings/sentinel');
        expect(screen.getByRole('tab', { name: /Sentinel/ }).getAttribute('aria-selected')).toBe('true');
        for (const def of defs) {
            expect(screen.getAllByTestId(def.ui!.testId)).toHaveLength(1);
        }
        expect(screen.getByText('Mode & Results')).toBeTruthy();
        expect(screen.getByText('To-do & PR Outcomes')).toBeTruthy();
        for (const tab of ['ai', 'chat', 'integrations']) {
            fireEvent.click(screen.getByTestId(`settings-subtab-${tab}`));
            for (const def of defs) expect(screen.queryByTestId(def.ui!.testId)).toBeNull();
        }
        expect(screen.getByTestId('toggle-kusto-enabled')).toBeTruthy();
        expect(mockFetch.mock.calls.some(([, opts]) => opts?.method === 'PUT')).toBe(false);
    });

    it('opens Sentinel with the standard keyboard-focusable settings tab', async () => {
        const user = userEvent.setup();
        render(<AdminPanel />);
        const tab = await screen.findByRole('tab', { name: /Sentinel/ });
        tab.focus();
        await user.keyboard('{Enter}');
        expect(await screen.findByTestId('settings-tab-features-sentinel')).toBeTruthy();
        expect(document.activeElement).toBe(tab);
        expect(tab.getAttribute('aria-selected')).toBe('true');
        expect(tab.classList.contains('ar-subtab')).toBe(true);
        expect(window.location.hash).toBe('#admin/settings/sentinel');
    });

    it.each(['/api', '/api/agents/test-agent'])(
        'loads and saves Sentinel through the existing Admin owner at %s, independently of other drafts',
        async apiBase => {
            routing.apiBase = apiBase;
            routing.selectedRepoId = 'remote:test-server:test-repo';
            getCocClientFor('https://remote.example.com');
            window.location.hash = '#admin/settings/sentinel';
            render(<AdminPanel />);
            const sentinelCard = await screen.findByTestId('settings-tab-features-sentinel');
            const mode = screen.getByTestId('toggle-sentinel-enabled') as HTMLInputElement;
            expect(mode.checked).toBe(false);
            expect(screen.queryByTestId('toggle-sentinel-result-cards-enabled')).toBeNull();
            expect(mockFetch.mock.calls.some(([url]) => url === `${apiBase}/admin/config`)).toBe(true);
            expect(mockFetch.mock.calls.some(([, opts]) => opts?.method === 'PUT')).toBe(false);
            expect(within(sentinelCard).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);

            fireEvent.click(mode);
            fireEvent.click(screen.getByTestId('settings-subtab-ai'));
            const aiToggle = screen.getByTestId('toggle-ralph-enabled') as HTMLInputElement;
            const aiBefore = aiToggle.checked;
            fireEvent.click(aiToggle);
            fireEvent.click(screen.getByTestId('settings-subtab-chat'));
            fireEvent.click(screen.getByTestId('toggle-quick-ask-sidenotes-enabled'));
            fireEvent.click(screen.getByTestId('settings-subtab-integrations'));
            fireEvent.click(screen.getByTestId('toggle-kusto-enabled'));
            fireEvent.click(screen.getByTestId('settings-subtab-features'));
            fireEvent.click(screen.getByTestId('toggle-terminal-enabled'));
            fireEvent.click(screen.getByTestId('settings-subtab-sentinel'));
            expect((screen.getByTestId('toggle-sentinel-enabled') as HTMLInputElement).checked).toBe(true);

            const card = screen.getByTestId('settings-tab-features-sentinel');
            fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
            expect((screen.getByTestId('toggle-sentinel-enabled') as HTMLInputElement).checked).toBe(false);
            fireEvent.click(screen.getByTestId('toggle-sentinel-todo-external-references-enabled'));
            fireEvent.keyDown(window, { key: 's', ctrlKey: true });
            await waitFor(() => expect(within(card).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true));

            const puts = mockFetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');
            expect(puts).toHaveLength(1);
            expect(puts[0][0]).toBe(`${apiBase}/admin/config`);
            const payload = JSON.parse(puts[0][1].body);
            const defs = ADMIN_SETTING_DEFINITIONS.filter(def => getFeatureSettingTab(def) === 'sentinel');
            expect(Object.keys(payload).sort()).toEqual(defs.map(def => def.key).sort());
            expect(payload['features.sentinelTodoExternalReferences']).toBe(true);
            expect(payload['sentinel.enabled']).toBe(false);
            expect(payload).not.toHaveProperty('features.sentinelResultCards');

            for (const [tab, testId, expected] of [
                ['ai', 'toggle-ralph-enabled', !aiBefore],
                ['chat', 'toggle-quick-ask-sidenotes-enabled', true],
                ['integrations', 'toggle-kusto-enabled', true],
                ['features', 'toggle-terminal-enabled', false],
            ] as const) {
                fireEvent.click(screen.getByTestId(`settings-subtab-${tab}`));
                expect(screen.getByTestId(testId)).toHaveProperty('checked', expected);
                const testIdCard = tab === 'features' ? 'settings-features' : `settings-tab-features-${tab}`;
                expect(within(screen.getByTestId(testIdCard)).getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);
            }
        },
    );

    it('keeps pending Appearance edits when canceling or saving the Features card', async () => {
        render(<AdminPanel />);
        fireEvent.click(await screen.findByTestId('settings-subtab-appearance'));
        const vim = await screen.findByTestId('toggle-vim-navigation-enabled') as HTMLInputElement;
        fireEvent.click(vim);
        expect(vim.checked).toBe(true);

        await gotoFeaturesSubTab();
        const terminal = await screen.findByTestId('toggle-terminal-enabled') as HTMLInputElement;
        fireEvent.click(terminal);
        const card = screen.getByTestId('settings-features');
        fireEvent.click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Cancel')!);
        expect(terminal.checked).toBe(true);

        fireEvent.click(terminal);
        fireEvent.click(Array.from(card.querySelectorAll('button')).find(b => b.textContent === 'Save')!);
        await waitFor(() => {
            const put = mockFetch.mock.calls.find(([url, opts]: [string, any]) =>
                opts?.method === 'PUT' && url.includes('/admin/config'));
            expect(put).toBeDefined();
            expect(JSON.parse(put![1].body)['vimNavigation.enabled']).toBeUndefined();
        });
        fireEvent.click(screen.getByTestId('settings-subtab-appearance'));
        expect((screen.getByTestId('toggle-vim-navigation-enabled') as HTMLInputElement).checked).toBe(true);
    });

    it('is case-insensitive and matches against hint text', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        // "shell access" appears only in the Terminal hint, in mixed case.
        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'SHELL ACCESS' } });

        expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy();
        expect(screen.queryByTestId('toggle-mywork-enabled')).toBeNull();
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
        expect(screen.getByTestId('toggle-mywork-enabled')).toBeTruthy();
    });

    it('clear button restores the full grouped list', async () => {
        render(<AdminPanel />);
        await gotoFeaturesSubTab();
        await waitFor(() => expect(screen.getByTestId('toggle-terminal-enabled')).toBeTruthy());

        fireEvent.change(screen.getByTestId('feature-search-input'), { target: { value: 'terminal' } });
        expect(screen.queryByTestId('toggle-mywork-enabled')).toBeNull();

        fireEvent.click(screen.getByTestId('feature-search-clear'));

        expect(screen.getByTestId('toggle-mywork-enabled')).toBeTruthy();
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
