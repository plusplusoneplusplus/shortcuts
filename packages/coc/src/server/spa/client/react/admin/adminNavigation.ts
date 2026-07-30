/**
 * adminNavigation — pure navigation policy for the admin shell.
 *
 * Owns settings sub-tab parsing, tab labels/icons/descriptions, sidebar nav
 * group construction, active-key derivation, breadcrumb group, page
 * description, and mobile <select> option shaping. Everything here is a pure
 * function of its inputs — container mode and `serversEnabled` are passed in
 * explicitly rather than read from module-level globals — so the routing
 * policy can be unit-tested without mounting `AdminPanel`.
 */
import type { AdminSubTab, DashboardTab } from '../types/dashboard';

// ── Settings sub-tabs ───────────────────────────────────────────────────────
// Settings sections promoted into the sidebar. Each entry maps 1:1 to a
// `SettingsCard` in the admin page. Selection is kept in component state and
// synced to the URL fragment so refreshes land on the same section.
export type SettingsSubTab = 'ai' | 'chat' | 'appearance' | 'features' | 'integrations' | 'providers' | 'advanced';

export const SETTINGS_SUBTABS: { id: SettingsSubTab; label: string; icon: string }[] = [
    { id: 'ai', label: 'AI & Execution', icon: '✦' },
    { id: 'chat', label: 'Chat', icon: '◌' },
    { id: 'appearance', label: 'Appearance', icon: '◐' },
    { id: 'features', label: 'Features', icon: '◫' },
    { id: 'integrations', label: 'Integrations', icon: '⇄' },
    { id: 'providers', label: 'Providers', icon: '◇' },
    { id: 'advanced', label: 'Advanced', icon: '⚙' },
];
export const DEFAULT_SETTINGS_SUBTAB: SettingsSubTab = 'ai';
export const VALID_SETTINGS_SUBTABS = new Set<SettingsSubTab>(SETTINGS_SUBTABS.map(t => t.id));
export const SETTINGS_SUBTAB_DESCRIPTIONS: Record<SettingsSubTab, string> = {
    ai: '',
    chat: 'Conversation behavior, follow-up suggestions, and transcript detail.',
    appearance: 'Theme, layout density, navigation, and prompt autocomplete preferences.',
    features: 'Enable or disable optional workspace and dashboard features.',
    integrations: 'Desktop link handlers and local integration preferences.',
    providers: 'Manage credentials for GitHub, Azure DevOps, and other connected providers.',
    advanced: 'Read-only diagnostics and recovery actions.',
};

export function getSettingsSubTabMeta(subTab: SettingsSubTab): { id: SettingsSubTab; label: string; icon: string } {
    return SETTINGS_SUBTABS.find(t => t.id === subTab) ?? SETTINGS_SUBTABS[0];
}

export function parseSettingsSubTabFromHash(hash: string): SettingsSubTab | null {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'admin' || parts[1] !== 'settings') return null;
    const candidate = parts[2] as SettingsSubTab | undefined;
    if (!candidate) return DEFAULT_SETTINGS_SUBTAB;
    return VALID_SETTINGS_SUBTABS.has(candidate) ? candidate : null;
}

// ── Admin sub-tab meta (container-mode aware) ───────────────────────────────
// The `agents` tab is the only entry whose label/icon/description depend on
// whether we are running in a container, so it is resolved through helpers that
// take `isContainer` explicitly instead of reading a global at module load.
const BASE_TAB_LABELS: Record<AdminSubTab, string> = {
    settings: 'AI & Execution',
    providers: 'Providers',
    data: 'Backup & Reset',
    server: 'Server',
    prompts: 'System Prompts',
    database: 'Database Browser',
    agents: 'AI Provider',
    messaging: 'Messaging',
};
const BASE_TAB_ICONS: Record<AdminSubTab, string> = {
    settings: '⚙',
    providers: '◇',
    data: '▦',
    server: '⌗',
    prompts: '✎',
    database: '◫',
    agents: '◉',
    messaging: '✉',
};
const BASE_TAB_DESCRIPTIONS: Record<AdminSubTab, string> = {
    settings: 'Default model, execution limits, timeout, and output format for AI tasks.',
    providers: 'Manage credentials for GitHub, Azure DevOps, and other connected providers.',
    data: 'Storage backend, JSON import / export, and destructive cleanup actions.',
    server: 'Inspect the running CoC process, change its display name, or restart it.',
    prompts: 'Read-only view of the system prompts the assistant uses.',
    database: 'Browse the underlying SQLite tables that back CoC.',
    agents: '',
    messaging: 'Configure container messaging integrations (e.g. WhatsApp).',
};

export function getAdminTabLabel(tab: AdminSubTab, isContainer: boolean): string {
    if (tab === 'agents') return isContainer ? 'Agents' : 'AI Provider';
    return BASE_TAB_LABELS[tab];
}
export function getAdminTabIcon(tab: AdminSubTab, isContainer: boolean): string {
    if (tab === 'agents') return isContainer ? '⊞' : '◉';
    return BASE_TAB_ICONS[tab];
}
export function getAdminTabDescription(tab: AdminSubTab, isContainer: boolean): string {
    if (tab === 'agents') return isContainer ? 'View and manage agents connected to this container.' : '';
    return BASE_TAB_DESCRIPTIONS[tab];
}

// ── Embedded tool routes ────────────────────────────────────────────────────
// Each entry stays a top-level dashboard route (so deep links like `#skills`
// keep working), but the corresponding view is rendered inside the admin right
// panel. Sidebar grouping is defined by user task below, not by whether the
// destination is a config section or a tool route.
export interface ToolNavItem {
    id: string;
    tab: DashboardTab;
    label: string;
    icon: string;
    description: string;
}
export const ALL_TOOL_NAV_ITEMS: ToolNavItem[] = [
    { id: 'memory-toggle', tab: 'memory', label: 'Memory', icon: '◈', description: 'View and manage global and workspace memory facts, reviews, and episodes.' },
    { id: 'skills-toggle', tab: 'skills', label: 'Skills', icon: '⚡', description: 'Install, configure, and inspect agent skills surfaced to the assistant.' },
    { id: 'dreams-admin-toggle', tab: 'dreams-admin', label: 'Dreams', icon: '☾', description: 'Enable Dreams, tune the idle-reflection schedule and defaults, and watch provider activity.' },
    { id: 'logs-toggle', tab: 'logs', label: 'Logs', icon: '📋', description: 'Live and historical server logs streamed via SSE.' },
    { id: 'stats-toggle', tab: 'stats', label: 'Usage & Costs', icon: '📊', description: 'Aggregated usage statistics for chats, tokens, costs, and processes.' },
    { id: 'servers-toggle', tab: 'servers', label: 'Servers', icon: '🖥', description: 'Browse running CoC server instances and their health.' },
];
export const TOOL_TAB_GROUP_LABELS: Partial<Record<DashboardTab, string>> = {
    memory: 'Knowledge',
    skills: 'Knowledge',
    'dreams-admin': 'Knowledge',
    servers: 'Configure',
    stats: 'Operations',
    logs: 'Operations',
};
export const TOOL_NAV_LOOKUP: ReadonlyMap<DashboardTab, ToolNavItem> = new Map(ALL_TOOL_NAV_ITEMS.map(item => [item.tab, item]));

// ── Nav item / group shapes ─────────────────────────────────────────────────
export type AdminNavAction =
    | { kind: 'settings'; subTab: SettingsSubTab }
    | { kind: 'admin'; tab: AdminSubTab }
    | { kind: 'tool'; tab: DashboardTab };

export interface AdminNavItem {
    key: string;
    label: string;
    icon: string;
    testId: string;
    action: AdminNavAction;
}

export interface AdminNavGroup {
    label: string;
    items: AdminNavItem[];
}

export const ADMIN_TAB_GROUP_LABELS: Partial<Record<AdminSubTab, string>> = {
    messaging: 'Connections',
    server: 'Operations',
    data: 'Operations',
    prompts: 'Developer / Internals',
    database: 'Developer / Internals',
    agents: 'Configure',
};

export function settingsNavItem(subTab: SettingsSubTab): AdminNavItem {
    const meta = getSettingsSubTabMeta(subTab);
    return {
        key: `settings:${subTab}`,
        label: meta.label,
        icon: meta.icon,
        testId: `settings-subtab-${subTab}`,
        action: { kind: 'settings', subTab },
    };
}

export function adminNavItem(tab: AdminSubTab, isContainer: boolean): AdminNavItem {
    return {
        key: `admin:${tab}`,
        label: getAdminTabLabel(tab, isContainer),
        icon: getAdminTabIcon(tab, isContainer),
        testId: `admin-tab-${tab}`,
        action: { kind: 'admin', tab },
    };
}

export function toolNavItem(tab: DashboardTab): AdminNavItem {
    const item = TOOL_NAV_LOOKUP.get(tab);
    if (!item) {
        throw new Error(`Unknown admin tool tab: ${tab}`);
    }
    return {
        key: `tool:${tab}`,
        label: item.label,
        icon: item.icon,
        testId: item.id,
        action: { kind: 'tool', tab },
    };
}

export interface AdminNavContext {
    isContainer: boolean;
    serversEnabled: boolean;
}

/**
 * Builds the sidebar nav groups for the given runtime context. The Servers row
 * is gated by the dashboard runtime config (independent of the editable
 * `serversEnabled` Features form state), and the Agents/Messaging placement
 * depends on container mode. Empty groups are dropped.
 */
export function buildAdminNavGroups({ isContainer, serversEnabled }: AdminNavContext): AdminNavGroup[] {
    const serversNavItems = serversEnabled ? [toolNavItem('servers')] : [];
    const containerNavItems = isContainer ? [adminNavItem('messaging', isContainer)] : [];
    const containerAgentsNavItem = isContainer ? [adminNavItem('agents', isContainer)] : [];
    const nonContainerAgentsNavItem = !isContainer ? [adminNavItem('agents', isContainer)] : [];

    return [
        {
            label: 'Configure',
            items: [
                {
                    key: 'settings:configure',
                    label: 'Configure',
                    icon: '✦',
                    testId: 'settings-nav-configure',
                    action: { kind: 'settings', subTab: DEFAULT_SETTINGS_SUBTAB } as AdminNavAction,
                },
                ...nonContainerAgentsNavItem,
                ...serversNavItems,
            ],
        },
        {
            label: 'Knowledge',
            items: [
                toolNavItem('memory'),
                toolNavItem('skills'),
                toolNavItem('dreams-admin'),
            ],
        },
        {
            label: 'Connections',
            items: [
                ...containerNavItems,
                ...containerAgentsNavItem,
            ],
        },
        {
            label: 'Operations',
            items: [
                toolNavItem('stats'),
                toolNavItem('logs'),
                adminNavItem('server', isContainer),
                adminNavItem('data', isContainer),
            ],
        },
        {
            label: 'Developer / Internals',
            items: [
                adminNavItem('prompts', isContainer),
                adminNavItem('database', isContainer),
                settingsNavItem('advanced'),
            ],
        },
    ].filter(group => group.items.length > 0);
}

export interface ActiveNavInput {
    isContainer: boolean;
    isToolEmbedded: boolean;
    activeDashboardTab: DashboardTab;
    activeTab: AdminSubTab;
    settingsSubTab: SettingsSubTab;
}

export interface ActiveNavDerivation {
    activeNavKey: string;
    activeTabLabel: string;
    activeBreadcrumbGroup: string;
    activePageDescription: string;
}

/** Derives the highlighted nav key, breadcrumb group, tab label, and page description. */
export function deriveActiveNav({
    isContainer,
    isToolEmbedded,
    activeDashboardTab,
    activeTab,
    settingsSubTab,
}: ActiveNavInput): ActiveNavDerivation {
    const activeNavKey = isToolEmbedded
        ? `tool:${activeDashboardTab}`
        : activeTab === 'settings'
            ? (settingsSubTab === 'advanced' ? 'settings:advanced' : 'settings:configure')
            : `admin:${activeTab}`;
    const activeTabLabel = activeTab === 'settings'
        ? getSettingsSubTabMeta(settingsSubTab).label
        : getAdminTabLabel(activeTab, isContainer);
    const activeBreadcrumbGroup = isToolEmbedded
        ? TOOL_TAB_GROUP_LABELS[activeDashboardTab] ?? 'Operations'
        : activeTab === 'settings'
            ? 'Configure'
            : ADMIN_TAB_GROUP_LABELS[activeTab] ?? 'Configure';
    const activePageDescription = activeTab === 'settings'
        ? SETTINGS_SUBTAB_DESCRIPTIONS[settingsSubTab]
        : getAdminTabDescription(activeTab, isContainer);
    return { activeNavKey, activeTabLabel, activeBreadcrumbGroup, activePageDescription };
}
