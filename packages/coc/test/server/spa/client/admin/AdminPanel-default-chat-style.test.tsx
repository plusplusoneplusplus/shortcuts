/**
 * @vitest-environment jsdom
 *
 * Integration tests for the Chat Style card, which lives inside the Chat
 * settings tab (`#admin/settings/chat`) rather than the registry-driven
 * Features card or a tab of its own.
 *
 * `features.defaultChatStyle` deliberately has no `ui` block any more, so
 * these cover what the definition entry cannot: the Chat tab hosts the card
 * and is deep-linkable, each control renders there exactly once and nowhere
 * else, the card disappears when `features.chatStyleSelector` is off, and the
 * picked values reach PUT /api/admin/config without dropping sibling edits.
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
import {
    CHAT_STYLE_FOCUS_LINES,
    EDITABLE_CHAT_STYLES,
} from '../../../../../src/config/chat-style-prompts';

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
        await waitFor(() => expect(screen.getByTestId('settings-subtab-chat')).toBeDefined());
        fireEvent.click(screen.getByTestId('settings-subtab-chat'));
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
        expect([...select.options].map(o => o.value)).toEqual(['default', 'human', 'direct', 'terse', 'structured']);
        expect([...select.options].map(o => o.textContent)).toEqual(['Default', 'Human', 'Direct', 'Terse', 'Structured']);
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

        await waitFor(() => expect(screen.getByTestId('feature-search-input')).toBeTruthy());
        expect(screen.queryByTestId('toggle-chat-style-selector-enabled')).toBeNull();
        expect(screen.queryByTestId('select-default-chat-style')).toBeNull();
    });

    it('opens the card directly from #admin/settings/chat', async () => {
        withFeatures({ chatStyleSelector: true, defaultChatStyle: 'human' });
        window.location.hash = 'admin/settings/chat';

        render(<AdminPanel />);

        await waitFor(() => expect(screen.getByTestId('settings-chat-style')).toBeTruthy());
        expect((screen.getByTestId('select-default-chat-style') as HTMLSelectElement).value).toBe('human');
        expect(screen.getByTestId('settings-subtab-chat').getAttribute('aria-selected')).toBe('true');
    });

    // A default style is meaningless with no selector to seed.
    it('hides only the Chat Style card when the chat style selector feature is off', async () => {
        withFeatures({ chatStyleSelector: false, defaultChatStyle: 'direct' });
        window.location.hash = 'admin/settings/chat';

        render(<AdminPanel />);

        await waitFor(() => expect(screen.getByTestId('settings-chat')).toBeTruthy());
        expect(screen.getByTestId('settings-subtab-chat').getAttribute('aria-selected')).toBe('true');
        expect(screen.queryByTestId('settings-chat-style')).toBeNull();
        expect(screen.queryByTestId('select-default-chat-style')).toBeNull();
        expect(window.location.hash).toBe('#admin/settings/chat');
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

// ── AC-03: per-style prompt text ───────────────────────────────────────────

describe('AdminPanel — chat style prompt overrides', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

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

    async function openSection(features: Record<string, unknown>) {
        withFeatures(features);
        window.location.hash = 'admin/settings/chat';
        render(<AdminPanel />);
        await waitFor(() => expect(screen.getByTestId('settings-chat-style')).toBeTruthy());
    }

    function putBodies() {
        return mockFetch.mock.calls
            .filter(([url, opts]: any[]) => opts?.method === 'PUT' && String(url).includes('/admin/config'))
            .map(([, opts]: any[]) => JSON.parse(opts.body));
    }

    function saveSection() {
        const save = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-chat-style"]'));
        expect(save).toBeTruthy();
        fireEvent.click(save!);
    }

    it('prefills each editable style with its built-in text and marks it uncustomized', async () => {
        await openSection({ chatStyleSelector: true, defaultChatStyle: 'default' });

        for (const style of EDITABLE_CHAT_STYLES) {
            const textarea = screen.getByTestId(`textarea-chat-style-prompt-${style}`) as HTMLTextAreaElement;
            expect(textarea.value).toBe(CHAT_STYLE_FOCUS_LINES[style]);
            expect(screen.getByTestId(`chat-style-prompt-state-${style}`).textContent).toBe('Built-in default');
            expect((screen.getByTestId(`reset-chat-style-prompt-${style}`) as HTMLButtonElement).disabled).toBe(true);
        }
        // 'default' carries no prompt, so it gets no textarea.
        expect(screen.queryByTestId('textarea-chat-style-prompt-default')).toBeNull();
    });

    it('shows a configured override and enables its reset action', async () => {
        await openSection({
            chatStyleSelector: true,
            defaultChatStyle: 'default',
            chatStylePrompts: { direct: 'SENTINEL-DIRECT' },
        });

        expect((screen.getByTestId('textarea-chat-style-prompt-direct') as HTMLTextAreaElement).value)
            .toBe('SENTINEL-DIRECT');
        expect(screen.getByTestId('chat-style-prompt-state-direct').textContent).toBe('Customized');
        expect((screen.getByTestId('reset-chat-style-prompt-direct') as HTMLButtonElement).disabled).toBe(false);
        // Untouched styles stay on their built-in wording.
        expect((screen.getByTestId('textarea-chat-style-prompt-human') as HTMLTextAreaElement).value)
            .toBe(CHAT_STYLE_FOCUS_LINES.human);
    });

    it('sends only the edited style in features.chatStylePrompts', async () => {
        await openSection({ chatStyleSelector: true, defaultChatStyle: 'default' });

        fireEvent.change(screen.getByTestId('textarea-chat-style-prompt-direct'), {
            target: { value: '  SENTINEL-DIRECT  ' },
        });
        saveSection();

        await waitFor(() => {
            expect(putBodies()[0]?.['features.chatStylePrompts']).toEqual({ direct: 'SENTINEL-DIRECT' });
        });
    });

    // Reset writes the built-in text back into the box; saving then drops the
    // key entirely rather than persisting a copy of the default.
    it('clears the override when a style is reset to default and saved', async () => {
        await openSection({
            chatStyleSelector: true,
            defaultChatStyle: 'default',
            chatStylePrompts: { direct: 'SENTINEL-DIRECT' },
        });

        fireEvent.click(screen.getByTestId('reset-chat-style-prompt-direct'));
        expect((screen.getByTestId('textarea-chat-style-prompt-direct') as HTMLTextAreaElement).value)
            .toBe(CHAT_STYLE_FOCUS_LINES.direct);
        expect((screen.getByTestId('reset-chat-style-prompt-direct') as HTMLButtonElement).disabled).toBe(true);

        saveSection();
        await waitFor(() => {
            expect(putBodies()[0]?.['features.chatStylePrompts']).toEqual({});
        });
    });

    it('treats whitespace-only text as no override', async () => {
        await openSection({
            chatStyleSelector: true,
            defaultChatStyle: 'default',
            chatStylePrompts: { human: 'SENTINEL-HUMAN' },
        });

        fireEvent.change(screen.getByTestId('textarea-chat-style-prompt-human'), { target: { value: '   ' } });
        expect(screen.getByTestId('chat-style-prompt-state-human').textContent).toBe('Built-in default');

        saveSection();
        await waitFor(() => {
            expect(putBodies()[0]?.['features.chatStylePrompts']).toEqual({});
        });
    });
});

// ── Merged Chat tab ────────────────────────────────────────────────────────
// Chat and Chat Style used to be separate sub-tabs. Now one Chat tab hosts the
// Chat card, the Chat Style card and the chat registry card; each keeps its
// own Save/Cancel, and Ctrl+S saves every dirty card on the tab.

describe('AdminPanel — single Chat tab', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PUT' && url.includes('/admin/config')) {
                return Promise.resolve({ ok: true, json: async () => ({}) });
            }
            if (url.includes('/admin/config')) {
                return Promise.resolve(mockConfigResponse({ features: { chatStyleSelector: true, defaultChatStyle: 'default' } }));
            }
            if (url.includes('/admin/data/stats')) return Promise.resolve(mockStatsResponse());
            if (url.includes('/preferences')) return Promise.resolve(mockPreferencesResponse());
            return Promise.resolve({ ok: true, json: async () => ({}) });
        });
    });

    afterEach(() => {
        cleanup();
    });

    function putBodies() {
        return mockFetch.mock.calls
            .filter(([url, opts]: any[]) => opts?.method === 'PUT' && String(url).includes('/admin/config'))
            .map(([, opts]: any[]) => JSON.parse(opts.body));
    }

    async function openChatTab() {
        window.location.hash = 'admin/settings/chat';
        render(<AdminPanel />);
        await waitFor(() => expect(screen.getByTestId('settings-chat-style')).toBeTruthy());
    }

    it('shows one Chat sub-tab and no Chat Style sub-tab', async () => {
        await openChatTab();
        const tabs = screen.getAllByRole('tab');
        expect(tabs.filter(t => /chat/i.test(t.textContent ?? '')).map(t => t.getAttribute('data-testid')))
            .toEqual(['settings-subtab-chat']);
        expect(screen.queryByTestId('settings-subtab-chat-style')).toBeNull();
        expect(screen.getByTestId('settings-subtab-chat').getAttribute('aria-selected')).toBe('true');
        expect(tabs.filter(t => t.getAttribute('aria-selected') === 'true')).toHaveLength(1);
    });

    it('renders the Chat and Chat Style cards with every control exactly once', async () => {
        await openChatTab();
        expect(screen.getAllByTestId('settings-chat')).toHaveLength(1);
        expect(screen.getAllByTestId('settings-chat-style')).toHaveLength(1);
        expect(screen.getAllByTestId('settings-tab-features-chat')).toHaveLength(1);
        expect(screen.getAllByTestId('toggle-chat-followup-enabled')).toHaveLength(1);
        expect(screen.getAllByTestId('select-default-chat-style')).toHaveLength(1);
        expect(screen.getAllByTestId('chat-style-selector-mirror')).toHaveLength(1);
        for (const style of EDITABLE_CHAT_STYLES) {
            expect(screen.getAllByTestId(`textarea-chat-style-prompt-${style}`)).toHaveLength(1);
            expect(screen.getAllByTestId(`reset-chat-style-prompt-${style}`)).toHaveLength(1);
        }
        // Clearly headed sections, Chat first.
        const headings = screen.getAllByRole('heading').map(h => h.textContent);
        expect(headings.indexOf('Chat Style')).toBeGreaterThan(-1);
        expect(screen.getByTestId('settings-chat').compareDocumentPosition(screen.getByTestId('settings-chat-style'))
            & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('Chat Style Save writes only style keys and keeps unsaved Chat card edits', async () => {
        await openChatTab();
        fireEvent.click(screen.getByTestId('toggle-chat-followup-enabled'));
        fireEvent.change(screen.getByTestId('select-default-chat-style'), { target: { value: 'terse' } });

        const save = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-chat-style"]'));
        fireEvent.click(save!);

        await waitFor(() => expect(putBodies()).toHaveLength(1));
        expect(putBodies()[0]['features.defaultChatStyle']).toBe('terse');
        expect(putBodies()[0]).not.toHaveProperty('chat.followUpSuggestions.enabled');
        // The Chat card edit is still pending with its Save enabled.
        const chatSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-chat"]')) as HTMLButtonElement;
        expect(chatSave.disabled).toBe(false);
    });

    it('Chat Style Cancel restores the loaded values without touching the Chat card', async () => {
        await openChatTab();
        fireEvent.click(screen.getByTestId('toggle-chat-followup-enabled'));
        fireEvent.change(screen.getByTestId('select-default-chat-style'), { target: { value: 'direct' } });
        fireEvent.change(screen.getByTestId('textarea-chat-style-prompt-human'), { target: { value: 'EDITED' } });

        const cancel = screen.getAllByText('Cancel').find(btn => btn.closest('[data-testid="settings-chat-style"]'));
        fireEvent.click(cancel!);

        expect((screen.getByTestId('select-default-chat-style') as HTMLSelectElement).value).toBe('default');
        expect((screen.getByTestId('textarea-chat-style-prompt-human') as HTMLTextAreaElement).value)
            .toBe(CHAT_STYLE_FOCUS_LINES.human);
        const chatSave = screen.getAllByText('Save').find(btn => btn.closest('[data-testid="settings-chat"]')) as HTMLButtonElement;
        expect(chatSave.disabled).toBe(false);
        expect(putBodies()).toHaveLength(0);
    });

    it('Ctrl+S saves both dirty Chat and Chat Style cards', async () => {
        await openChatTab();
        fireEvent.click(screen.getByTestId('toggle-chat-followup-enabled'));
        fireEvent.change(screen.getByTestId('textarea-chat-style-prompt-direct'), { target: { value: 'MY DIRECT' } });

        const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);

        await waitFor(() => expect(putBodies()).toHaveLength(2));
        expect(putBodies().some(b => b['chat.followUpSuggestions.enabled'] === false)).toBe(true);
        expect(putBodies().some(b => b['features.chatStylePrompts']?.direct === 'MY DIRECT')).toBe(true);
    });

    it('keeps the Chat Style card off other tabs, including Editors', async () => {
        await openChatTab();
        for (const sub of ['ai', 'sentinel', 'appearance', 'editors', 'features', 'integrations']) {
            fireEvent.click(screen.getByTestId(`settings-subtab-${sub}`));
            await waitFor(() => expect(screen.getByTestId(`settings-subtab-${sub}`).getAttribute('aria-selected')).toBe('true'));
            expect(screen.queryByTestId('settings-chat-style')).toBeNull();
            expect(screen.queryByTestId('settings-chat')).toBeNull();
            if (sub === 'editors') expect(screen.getByTestId('settings-tab-features-editors')).toBeTruthy();
        }
    });
});
