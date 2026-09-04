/**
 * The settings sections a repo group exposes, and how to narrow an arbitrary
 * one down to them.
 *
 * A group is a virtual workspace with no git checkout, so it gets the Agent
 * settings that live on the workspace record / its `preferences.json` plus its
 * own member list — but none of the sections that need a writable repo (Info,
 * Plans Folder, Notes, Instructions, Memory).
 *
 * This lives apart from `RepoGroupSettingsTab` so the hash builder in
 * `dashboardRoutes` can reuse it without pulling the whole settings pane — and
 * its panels — into the router module.
 */
import type { SettingsNavGroup } from '../features/repo-settings/SettingsShell';
import type { SettingsSection } from '../types/dashboard';

export const REPO_GROUP_SETTINGS_NAV: SettingsNavGroup[] = [
    {
        id: 'group',
        label: 'Group',
        items: [
            { id: 'members', label: 'Member repos', title: 'Member repos', description: 'Repos in this group and what each one is for' },
        ],
    },
    {
        id: 'agent',
        label: 'Agent',
        items: [
            { id: 'mcp',       label: 'MCP Servers',  title: 'MCP Servers',  description: 'Enable or disable Model Context Protocol servers for this group' },
            { id: 'skills',    label: 'Agent Skills', title: 'Agent Skills', description: 'Skills available to chats in this group' },
            { id: 'llm-tools', label: 'LLM Tools',    title: 'LLM Tools',    description: 'Toggle individual tools available to the agent' },
        ],
    },
];

const GROUP_SETTINGS_SECTIONS = new Set<string>(
    REPO_GROUP_SETTINGS_NAV.flatMap(group => group.items.map(item => item.id)),
);

/** Landing section when the hash names no section, or one a group does not have. */
export const REPO_GROUP_DEFAULT_SECTION: SettingsSection = 'members';

/** Narrow an arbitrary settings section to one a group actually renders. */
export function resolveRepoGroupSection(section: string | undefined | null): SettingsSection {
    return section && GROUP_SETTINGS_SECTIONS.has(section)
        ? (section as SettingsSection)
        : REPO_GROUP_DEFAULT_SECTION;
}
