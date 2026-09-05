/**
 * Repo group Settings tab, end to end in a real browser against a real server.
 *
 * This is the automated stand-in for the manual demo each AC of the
 * repo-group-agent-settings feature asks for: open a group, walk the Settings
 * sidebar, and confirm the Agent sections work and persist for the group alone.
 *
 *   AC-01 — the split sidebar: a "Group" and an "Agent" nav group, hash routing
 *           at #repos/<groupId>/settings/<section>, deep links, the fallback to
 *           Member repos for a section a group does not have, and the filter box.
 *   AC-02 — MCP Servers: toggling a server persists onto the group workspace
 *           record and leaves the member repo's own config alone; the
 *           workspace-scope add/edit affordances are gone.
 *   AC-03 — Agent Skills: the panel renders read-only, with no install button.
 *   AC-04 — LLM Tools: disabling a tool persists into the group's
 *           preferences.json and leaves the member repo's tools enabled.
 *
 * The group's MCP list comes from the GLOBAL config (`~/.copilot/mcp-config.json`),
 * which a temp-dataDir server cannot be given, so the GET is stubbed to supply
 * two servers. Writes are never stubbed — every persistence assertion reads the
 * real API back, which is also what makes the "member repos are untouched"
 * checks meaningful.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MEMBER_ID = 'group-settings-member';
const MEMBER_NAME = 'group-settings-member-repo';
const GROUP_NAME = 'E2E Settings Group';

interface McpConfigResponse {
    availableServers: { name: string; type: string }[];
    enabledMcpServers: string[] | null;
}

const TWO_SERVERS: McpConfigResponse = {
    availableServers: [
        { name: 'code-tools', type: 'stdio' },
        { name: 'web-search', type: 'sse' },
    ],
    enabledMcpServers: null, // null = every server enabled
};

/** Dismiss the onboarding welcome modal so it doesn't swallow clicks. */
async function dismissOnboarding(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/preferences`, {
        method: 'PATCH',
        body: JSON.stringify({
            hasSeenWelcome: true,
            onboardingProgress: { dismissed: true, hasCompletedTour: true },
        }),
    });
}

/**
 * Seed one member repo and a group holding it. Returns the `group-` workspace
 * id the server minted, which is what every settings route below is keyed on.
 */
async function seedGroup(serverUrl: string): Promise<string> {
    await seedWorkspace(serverUrl, MEMBER_ID, MEMBER_NAME);
    await dismissOnboarding(serverUrl);
    const res = await request(`${serverUrl}/api/repo-groups`, {
        method: 'POST',
        body: JSON.stringify({ name: GROUP_NAME, members: [MEMBER_ID] }),
    });
    if (res.status !== 201) {
        throw new Error(`Failed to create repo group: ${res.status} ${res.body}`);
    }
    return JSON.parse(res.body).workspace.id as string;
}

/** Stub GET mcp-config for one workspace; let PUT/POST hit the real server. */
async function mockMcpConfigGet(page: Page, workspaceId: string, config: McpConfigResponse): Promise<void> {
    await page.route(`**/api/workspaces/${workspaceId}/mcp-config`, async (route, req) => {
        if (req.method() === 'GET') {
            return route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(config),
            });
        }
        return route.continue();
    });
}

/** Open a group settings section and wait for the content pane. */
async function openGroupSettings(page: Page, serverUrl: string, groupId: string, section?: string): Promise<void> {
    const suffix = section ? `/${section}` : '';
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(groupId)}/settings${suffix}`);
    await expect(page.locator('[data-testid="settings-content-panel"]')).toBeVisible({ timeout: 15_000 });
}

/** GET a JSON API and parse it. */
async function getJson(serverUrl: string, path: string): Promise<any> {
    const res = await request(`${serverUrl}${path}`);
    return JSON.parse(res.body);
}

/** Read one workspace record back out of the registry listing. */
async function getWorkspaceRecord(serverUrl: string, id: string): Promise<any> {
    const { workspaces } = await getJson(serverUrl, '/api/workspaces');
    return workspaces.find((ws: { id: string }) => ws.id === id);
}

/**
 * The MCP toggle checkbox is `sr-only`, so the visible slider swallows clicks —
 * click the wrapping label like the repo MCP spec does.
 */
function clickMcpToggle(page: Page, serverName: string) {
    return page.locator(`[data-testid="mcp-toggle-${serverName}"]`).locator('..').click();
}

// ---------------------------------------------------------------------------
// AC-01 — the sidebar shell
// ---------------------------------------------------------------------------

test.describe('Repo group Settings — sidebar (AC-01)', () => {
    test('GS.1 renders the Group and Agent nav groups, and none of the repo-only sections', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await openGroupSettings(page, serverUrl, groupId);

        await expect(page.locator('[data-testid="settings-sidebar"]')).toBeVisible();
        await expect(page.locator('[data-testid="nav-group-group"] [data-testid="nav-item-members"]')).toBeVisible();

        const agentNav = page.locator('[data-testid="nav-group-agent"]');
        await expect(agentNav).toContainText('Agent');
        await expect(agentNav.locator('[data-testid="nav-item-mcp"]')).toBeVisible();
        await expect(agentNav.locator('[data-testid="nav-item-skills"]')).toBeVisible();
        await expect(agentNav.locator('[data-testid="nav-item-llm-tools"]')).toBeVisible();

        // A group has no checkout, so the sections needing writable repo files stay off.
        await expect(page.locator('[data-testid="nav-item-info"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="nav-item-instructions"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="nav-item-memory"]')).toHaveCount(0);

        // No hash section => Member repos.
        await expect(page.locator('[data-testid="settings-section-title"]')).toHaveText('Member repos');
    });

    test('GS.2 clicking each Agent item swaps the pane and rewrites the hash', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await mockMcpConfigGet(page, groupId, TWO_SERVERS);
        await openGroupSettings(page, serverUrl, groupId);

        await page.locator('[data-testid="nav-item-mcp"]').click();
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeAttached({ timeout: 10_000 });
        expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#repos/${groupId}/settings/mcp`);

        await page.locator('[data-testid="nav-item-skills"]').click();
        await expect(page.locator('[data-testid="agent-skills-panel"]')).toBeVisible({ timeout: 10_000 });
        expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#repos/${groupId}/settings/skills`);

        await page.locator('[data-testid="nav-item-llm-tools"]').click();
        await expect(page.locator('[data-testid="llm-tools-panel"]')).toBeVisible({ timeout: 10_000 });
        expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#repos/${groupId}/settings/llm-tools`);

        await page.locator('[data-testid="nav-item-members"]').click();
        await expect(page.locator('[data-testid="settings-section-title"]')).toHaveText('Member repos');
        expect(decodeURIComponent(new URL(page.url()).hash)).toBe(`#repos/${groupId}/settings/members`);
    });

    test('GS.3 a deep link to llm-tools lands on LLM Tools after a full reload', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await openGroupSettings(page, serverUrl, groupId, 'llm-tools');

        await expect(page.locator('[data-testid="llm-tools-panel"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="settings-section-title"]')).toHaveText('LLM Tools');
    });

    test('GS.4 a section a group does not have falls back to Member repos', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await openGroupSettings(page, serverUrl, groupId, 'instructions');

        await expect(page.locator('[data-testid="settings-section-title"]')).toHaveText('Member repos');
    });

    test('GS.5 the filter box narrows the nav, keeping the active section rendered', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await openGroupSettings(page, serverUrl, groupId);

        await page.locator('[data-testid="settings-filter-input"]').fill('llm');
        await expect(page.locator('[data-testid="nav-item-llm-tools"]')).toBeVisible();
        await expect(page.locator('[data-testid="nav-item-mcp"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="nav-item-skills"]')).toHaveCount(0);

        // The filtered-out active section keeps its pane.
        await expect(page.locator('[data-testid="nav-item-members"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="settings-section-title"]')).toHaveText('Member repos');
    });
});

// ---------------------------------------------------------------------------
// AC-02 — MCP Servers
// ---------------------------------------------------------------------------

test.describe('Repo group Settings — MCP Servers (AC-02)', () => {
    test('GS.6 disabling a server persists on the group and leaves the member repo alone', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await mockMcpConfigGet(page, groupId, TWO_SERVERS);
        await openGroupSettings(page, serverUrl, groupId, 'mcp');

        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeChecked({ timeout: 15_000 });
        await clickMcpToggle(page, 'code-tools');
        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).not.toBeChecked({ timeout: 10_000 });

        // The write landed on the group's workspace record...
        await expect.poll(
            async () => (await getWorkspaceRecord(serverUrl, groupId))?.enabledMcpServers,
            { timeout: 10_000 },
        ).toEqual(['web-search']);

        // ...and nowhere near the member repo.
        const member = await getWorkspaceRecord(serverUrl, MEMBER_ID);
        expect(member.enabledMcpServers ?? null).toBeNull();
    });

    test('GS.7 the workspace-scope add-server affordances are absent for a group', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await mockMcpConfigGet(page, groupId, TWO_SERVERS);
        await openGroupSettings(page, serverUrl, groupId, 'mcp');

        await expect(page.locator('[data-testid="mcp-toggle-code-tools"]')).toBeAttached({ timeout: 15_000 });
        await expect(page.getByRole('button', { name: /Add server/ })).toHaveCount(0);
        await expect(page.getByRole('link', { name: /New server/ })).toHaveCount(0);
        // A group has no repo-local config file either.
        await expect(page.getByText('.vscode/mcp.json')).toHaveCount(0);
        // Instead the panel explains why there is nothing to add.
        await expect(page.locator('[data-testid="mcp-group-readonly-hint"]')).toBeVisible();
    });
});

// ---------------------------------------------------------------------------
// AC-03 — Agent Skills
// ---------------------------------------------------------------------------

test.describe('Repo group Settings — Agent Skills (AC-03)', () => {
    test('GS.8 the skills panel is read-only for a group', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);
        await openGroupSettings(page, serverUrl, groupId, 'skills');

        await expect(page.locator('[data-testid="agent-skills-panel"]')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('[data-testid="skills-group-readonly-hint"]')).toBeVisible();
        await expect(page.locator('[data-testid="skills-install-btn"]')).toHaveCount(0);
        await expect(page.locator('[data-testid="link-from-repo-btn"]')).toHaveCount(0);
    });
});

// ---------------------------------------------------------------------------
// AC-04 — LLM Tools
// ---------------------------------------------------------------------------

test.describe('Repo group Settings — LLM Tools (AC-04)', () => {
    test('GS.9 disabling a tool persists for the group across a reload, and not for the member repo', async ({ page, serverUrl }) => {
        const groupId = await seedGroup(serverUrl);

        // Pick a tool that is on by default so the toggle has somewhere to go.
        const config = await getJson(serverUrl, `/api/workspaces/${encodeURIComponent(groupId)}/llm-tools-config`);
        const disabled: string[] = config.disabledLlmTools ?? [];
        const tool = config.tools.find((t: { name: string }) => !disabled.includes(t.name));
        expect(tool, 'expected at least one enabled LLM tool').toBeTruthy();

        await openGroupSettings(page, serverUrl, groupId, 'llm-tools');
        const toggle = page.locator(`[data-testid="llm-tool-toggle-${tool.name}"]`);
        await expect(toggle).toBeChecked({ timeout: 15_000 });

        await page.locator(`[data-testid="llm-tool-label-${tool.name}"]`).click();
        await expect(toggle).not.toBeChecked({ timeout: 10_000 });

        // Reload: the panel re-reads from the server, so this is the persistence check.
        await openGroupSettings(page, serverUrl, groupId, 'llm-tools');
        await expect(page.locator(`[data-testid="llm-tool-toggle-${tool.name}"]`)).not.toBeChecked({ timeout: 15_000 });

        // The member repo keeps the tool.
        const memberConfig = await getJson(serverUrl, `/api/workspaces/${MEMBER_ID}/llm-tools-config`);
        expect(memberConfig.disabledLlmTools ?? []).not.toContain(tool.name);
    });
});
