/**
 * Unit tests for the pure `adminNavigation` policy module extracted from
 * `AdminPanel`. Covers settings sub-tab hash parsing, sidebar nav group
 * construction across web / container / serversEnabled inputs, and the
 * active-nav derivation (highlight key, breadcrumb group, page description).
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_SETTINGS_SUBTAB,
    buildAdminNavGroups,
    deriveActiveNav,
    getAdminTabLabel,
    getAdminTabIcon,
    getFeatureSettingTabLink,
    getSettingsSubTabMeta,
    parseSettingsSubTabFromHash,
    SETTINGS_SUBTABS,
    SETTINGS_SUBTAB_DESCRIPTIONS,
} from '../../../src/server/spa/client/react/admin/adminNavigation';

describe('parseSettingsSubTabFromHash', () => {
    it('returns null for non-settings hashes', () => {
        expect(parseSettingsSubTabFromHash('#admin/server')).toBeNull();
        expect(parseSettingsSubTabFromHash('#skills')).toBeNull();
    });

    it('defaults to the first sub-tab for a bare settings hash', () => {
        expect(parseSettingsSubTabFromHash('#admin/settings')).toBe(DEFAULT_SETTINGS_SUBTAB);
    });

    it('parses a valid explicit sub-tab', () => {
        expect(parseSettingsSubTabFromHash('#admin/settings/appearance')).toBe('appearance');
        expect(parseSettingsSubTabFromHash('#admin/settings/advanced')).toBe('advanced');
        expect(parseSettingsSubTabFromHash('#admin/settings/sentinel')).toBe('sentinel');
    });

    it('returns null for an unknown sub-tab', () => {
        expect(parseSettingsSubTabFromHash('#admin/settings/nope')).toBeNull();
    });

    // Chat Style lives as a card inside the Chat tab; its old sub-tab id is gone.
    it('no longer accepts a chat-style sub-tab', () => {
        expect(parseSettingsSubTabFromHash('#admin/settings/chat-style')).toBeNull();
        expect(parseSettingsSubTabFromHash('#admin/settings/chat')).toBe('chat');
    });
});

describe('Chat sub-tab registration', () => {
    it('has exactly one chat-related settings tab that covers chat style', () => {
        expect(SETTINGS_SUBTABS.filter(t => /chat/i.test(t.id) || /chat/i.test(t.label))).toEqual([
            { id: 'chat', label: 'Chat', icon: '◌' },
        ]);
        expect(SETTINGS_SUBTAB_DESCRIPTIONS.chat).toMatch(/chat style/i);
        expect(getSettingsSubTabMeta('chat').label).toBe('Chat');
    });

    it('keeps the other settings tabs, including Editors, in order', () => {
        expect(SETTINGS_SUBTABS.map(t => t.id)).toEqual([
            'ai', 'chat', 'sentinel', 'appearance', 'editors', 'features', 'integrations', 'providers', 'advanced',
        ]);
    });
});

describe('Sentinel sub-tab registration', () => {
    it('has one ungated settings tab with stable navigation metadata', () => {
        expect(SETTINGS_SUBTABS.filter(t => t.id === 'sentinel')).toEqual([
            { id: 'sentinel', label: 'Sentinel', icon: '🛡️' },
        ]);
        expect(SETTINGS_SUBTAB_DESCRIPTIONS.sentinel).toBeTruthy();
        const nav = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'settings', settingsSubTab: 'sentinel',
        });
        expect(nav).toMatchObject({
            activeNavKey: 'settings:configure',
            activeTabLabel: 'Sentinel',
            activeBreadcrumbGroup: 'Configure',
        });
    });
});

describe('Editors sub-tab registration', () => {
    it('is listed right after Appearance and deep-links through #admin/settings/editors', () => {
        const ids = SETTINGS_SUBTABS.map(t => t.id);
        expect(ids.filter(id => id === 'editors')).toHaveLength(1);
        expect(ids.indexOf('editors')).toBe(ids.indexOf('appearance') + 1);
        expect(getSettingsSubTabMeta('editors')).toMatchObject({ label: 'Editors' });
        expect(SETTINGS_SUBTAB_DESCRIPTIONS.editors).toBeTruthy();
        expect(parseSettingsSubTabFromHash('#admin/settings/editors')).toBe('editors');
        expect(deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'settings', settingsSubTab: 'editors',
        })).toMatchObject({ activeNavKey: 'settings:configure', activeTabLabel: 'Editors', activeBreadcrumbGroup: 'Configure' });
    });
});

describe('getFeatureSettingTabLink', () => {
    it('targets Connectors → Teams for Teams placements without adding a settings sub-tab', () => {
        expect(getFeatureSettingTabLink('teams', false)).toEqual({ href: '#admin/messaging', label: 'Teams' });
        expect(getFeatureSettingTabLink('teams', true)).toEqual({ href: '#admin/messaging', label: 'Messaging' });
        expect(SETTINGS_SUBTABS.map(t => t.id)).not.toContain('teams');
        expect(parseSettingsSubTabFromHash('#admin/settings/teams')).toBeNull();
    });

    it('targets the existing Admin → Browser page for browser placements, not a settings sub-tab', () => {
        expect(getFeatureSettingTabLink('browser', false)).toEqual({ href: '#admin/browser', label: 'Browser' });
        expect(getFeatureSettingTabLink('browser', true)).toEqual({ href: '#admin/browser', label: 'Browser' });
        expect(SETTINGS_SUBTABS.map(t => t.id)).not.toContain('browser');
        expect(parseSettingsSubTabFromHash('#admin/settings/browser')).toBeNull();
    });

    it('keeps Configure → Settings links for every other placement', () => {
        expect(getFeatureSettingTabLink('integrations', false)).toEqual({ href: '#admin/settings/integrations', label: 'Integrations' });
        expect(getFeatureSettingTabLink('editors', true)).toEqual({ href: '#admin/settings/editors', label: 'Editors' });
    });
});

describe('getAdminTabLabel / getAdminTabIcon — container-aware agents entry', () => {
    it('labels agents "AI Provider" on the web and "Agents" in a container', () => {
        expect(getAdminTabLabel('agents', false)).toBe('AI Provider');
        expect(getAdminTabLabel('agents', true)).toBe('Agents');
        expect(getAdminTabIcon('agents', false)).toBe('◉');
        expect(getAdminTabIcon('agents', true)).toBe('⊞');
    });

    it('keeps non-agents labels stable regardless of container mode', () => {
        expect(getAdminTabLabel('server', false)).toBe('Server');
        expect(getAdminTabLabel('server', true)).toBe('Server');
    });
});

describe('buildAdminNavGroups', () => {
    const labels = (groups: ReturnType<typeof buildAdminNavGroups>) => groups.map(g => g.label);
    const keys = (groups: ReturnType<typeof buildAdminNavGroups>, label: string) =>
        groups.find(g => g.label === label)?.items.map(i => i.key) ?? [];

    it('non-container + servers disabled: Teams and WhatsApp get their own rows, no container agents, no servers row', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: false });
        expect(labels(groups)).toEqual(['Configure', 'Knowledge', 'Connections', 'Operations', 'Developer / Internals']);
        expect(keys(groups, 'Connections')).toEqual(['admin:messaging', 'admin:whatsapp']);
        const connections = groups.find(g => g.label === 'Connections')?.items ?? [];
        expect(connections.map(i => i.label)).toEqual(['Teams', 'WhatsApp']);
        expect(connections[1].testId).toBe('admin-tab-whatsapp');
        expect(keys(groups, 'Configure')).toEqual(['settings:configure', 'admin:agents', 'admin:browser']);
        expect(keys(groups, 'Configure')).not.toContain('tool:servers');
    });

    it('non-container + servers enabled: adds the servers tool row to Configure', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: true });
        expect(keys(groups, 'Configure')).toEqual(['settings:configure', 'admin:agents', 'admin:browser', 'tool:servers']);
    });

    it('container: Connections group holds messaging + agents, Configure has no agents', () => {
        const groups = buildAdminNavGroups({ isContainer: true, serversEnabled: false });
        expect(labels(groups)).toContain('Connections');
        expect(keys(groups, 'Connections')).toEqual(['admin:messaging', 'admin:agents']);
        expect(keys(groups, 'Connections')).not.toContain('admin:whatsapp');
        expect(keys(groups, 'Configure')).toEqual(['settings:configure', 'admin:browser']);
        const agents = groups.flatMap(g => g.items).find(i => i.key === 'admin:agents');
        expect(agents?.label).toBe('Agents');
    });

    it('Browser row follows AI Provider with its own label, icon, and test id', () => {
        const configure = buildAdminNavGroups({ isContainer: false, serversEnabled: true }).find(g => g.label === 'Configure')?.items ?? [];
        const browser = configure.find(i => i.key === 'admin:browser');
        expect(configure.map(i => i.label)).toEqual(['Configure', 'AI Provider', 'Browser', 'Servers']);
        expect(browser).toMatchObject({ label: 'Browser', icon: '◎', testId: 'admin-tab-browser', action: { kind: 'admin', tab: 'browser' } });
    });

    // Browser hosts server-backed browser features too, so the row shows in
    // the web dashboard and container mode, not just the desktop shell.
    it('always shows the Browser row, including the web dashboard and container mode', () => {
        const web = buildAdminNavGroups({ isContainer: false, serversEnabled: true });
        expect(keys(web, 'Configure')).toEqual(['settings:configure', 'admin:agents', 'admin:browser', 'tool:servers']);
        const container = buildAdminNavGroups({ isContainer: true, serversEnabled: false });
        expect(keys(container, 'Configure')).toEqual(['settings:configure', 'admin:browser']);
        expect(web.flatMap(g => g.items).filter(i => i.key === 'admin:browser')).toHaveLength(1);
    });

    it('Knowledge group always lists memory, skills, dreams in order', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: false });
        expect(keys(groups, 'Knowledge')).toEqual(['tool:memory', 'tool:skills', 'tool:dreams-admin']);
    });
});

describe('deriveActiveNav', () => {
    it('whatsapp tab highlights its own row under Connections', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'whatsapp', settingsSubTab: 'ai',
        });
        expect(d.activeNavKey).toBe('admin:whatsapp');
        expect(d.activeTabLabel).toBe('WhatsApp');
        expect(d.activeBreadcrumbGroup).toBe('Connections');
    });

    it('browser tab highlights its own row under Configure with a description', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'browser', settingsSubTab: 'ai',
        });
        expect(d.activeNavKey).toBe('admin:browser');
        expect(d.activeTabLabel).toBe('Browser');
        expect(d.activeBreadcrumbGroup).toBe('Configure');
        expect(d.activePageDescription).toBe('Desktop browser engines, sign-ins and history, plus AI browser features.');
    });

    it('settings sub-tab (non-advanced) highlights settings:configure', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'settings', settingsSubTab: 'chat',
        });
        expect(d.activeNavKey).toBe('settings:configure');
        expect(d.activeBreadcrumbGroup).toBe('Configure');
        expect(d.activeTabLabel).toBe('Chat');
    });

    it('advanced sub-tab highlights settings:advanced', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'settings', settingsSubTab: 'advanced',
        });
        expect(d.activeNavKey).toBe('settings:advanced');
    });

    it('embedded tool routes highlight the tool key and use the tool group', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: true,
            activeDashboardTab: 'logs', activeTab: 'settings', settingsSubTab: 'ai',
        });
        expect(d.activeNavKey).toBe('tool:logs');
        expect(d.activeBreadcrumbGroup).toBe('Operations');
    });

    it('admin sub-tab uses the admin key and its group label', () => {
        const d = deriveActiveNav({
            isContainer: false, isToolEmbedded: false,
            activeDashboardTab: 'admin', activeTab: 'data', settingsSubTab: 'ai',
        });
        expect(d.activeNavKey).toBe('admin:data');
        expect(d.activeBreadcrumbGroup).toBe('Operations');
    });
});
