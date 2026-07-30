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
    parseSettingsSubTabFromHash,
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
    });

    it('returns null for an unknown sub-tab', () => {
        expect(parseSettingsSubTabFromHash('#admin/settings/nope')).toBeNull();
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

    it('web + servers disabled: no Connections group, no servers row, agents in Configure', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: false });
        expect(labels(groups)).toEqual(['Configure', 'Knowledge', 'Operations', 'Developer / Internals']);
        expect(keys(groups, 'Configure')).toEqual(['settings:configure', 'admin:agents']);
        expect(keys(groups, 'Configure')).not.toContain('tool:servers');
    });

    it('web + servers enabled: adds the servers tool row to Configure', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: true });
        expect(keys(groups, 'Configure')).toEqual(['settings:configure', 'admin:agents', 'tool:servers']);
    });

    it('container: Connections group holds messaging + agents, Configure has no agents', () => {
        const groups = buildAdminNavGroups({ isContainer: true, serversEnabled: false });
        expect(labels(groups)).toContain('Connections');
        expect(keys(groups, 'Connections')).toEqual(['admin:messaging', 'admin:agents']);
        expect(keys(groups, 'Configure')).toEqual(['settings:configure']);
        const agents = groups.flatMap(g => g.items).find(i => i.key === 'admin:agents');
        expect(agents?.label).toBe('Agents');
    });

    it('Knowledge group always lists memory, skills, dreams in order', () => {
        const groups = buildAdminNavGroups({ isContainer: false, serversEnabled: false });
        expect(keys(groups, 'Knowledge')).toEqual(['tool:memory', 'tool:skills', 'tool:dreams-admin']);
    });
});

describe('deriveActiveNav', () => {
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
