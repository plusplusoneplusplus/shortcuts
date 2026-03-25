/**
 * Tests for the Run Script Templates section in RepoSettingsTab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── Mocks ───────────────────────────────────────────────────────────────────

const mockFetchApi = vi.fn();
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../../src/server/spa/client/react/context/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/context/ReposContext', () => ({
    useRepos: () => ({ repos: [] }),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

const baseRepo = {
    workspace: { id: 'ws-1', rootPath: '/repo', color: '#ccc', description: '' },
    gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
};

const defaultMcpResponse = { availableServers: [], enabledMcpServers: null };
const defaultSkillsConfig = { disabledSkills: [], extraSkillFolders: [] };
const defaultPreferences = {};
const defaultProcesses = { processes: [] };
const defaultTasksSettings = {};
const defaultInstructions = { base: null, ask: null, plan: null, autopilot: null };

function setupMocks(opts: { scriptTemplates?: any[] } = {}) {
    mockFetchApi.mockImplementation((url: string) => {
        if (url.includes('/mcp-config')) return Promise.resolve(defaultMcpResponse);
        if (url.includes('/skills-config')) return Promise.resolve(defaultSkillsConfig);
        if (url.includes('/preferences')) return Promise.resolve({ ...defaultPreferences, scriptTemplates: opts.scriptTemplates ?? [] });
        if (url.includes('/processes')) return Promise.resolve(defaultProcesses);
        if (url.includes('/tasks/settings')) return Promise.resolve(defaultTasksSettings);
        if (url.includes('/instructions')) return Promise.resolve(defaultInstructions);
        return Promise.resolve({});
    });
    // global fetch for skills list and preferences (useScriptTemplates uses global fetch)
    mockFetch.mockImplementation((url: string) => {
        if (url.includes('/skills')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ skills: [] }) });
        if (url.includes('/preferences')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ scriptTemplates: opts.scriptTemplates ?? [] }) });
        if (url.includes('/instructions')) return Promise.resolve({ ok: true, json: () => Promise.resolve(defaultInstructions) });
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

async function renderSettings(opts: { scriptTemplates?: any[] } = {}) {
    setupMocks(opts);
    const { RepoSettingsTab } = await import(
        '../../../../src/server/spa/client/react/repos/RepoSettingsTab'
    );
    const { AppProvider } = await import(
        '../../../../src/server/spa/client/react/context/AppContext'
    );
    const result = render(
        <AppProvider>
            <RepoSettingsTab workspaceId="ws-1" repo={baseRepo as any} />
        </AppProvider>
    );
    // Navigate to the run-script-template section
    await waitFor(() => expect(screen.getByTestId('nav-item-run-script-template')).toBeTruthy());
    await act(async () => {
        fireEvent.click(screen.getByTestId('nav-item-run-script-template'));
    });
    return result;
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.resetAllMocks();
    location.hash = '#repos/ws-1/settings/run-script-template';
});

describe('RunScriptTemplatesSection', () => {
    it('renders the nav item for run-script-template', async () => {
        await renderSettings();
        const navItem = screen.getByTestId('nav-item-run-script-template');
        expect(navItem).toBeTruthy();
        expect(navItem.textContent).toContain('Run Script Templates');
    });

    it('shows empty state when no templates', async () => {
        await renderSettings({ scriptTemplates: [] });
        await waitFor(() => {
            expect(screen.getByTestId('templates-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('templates-empty').textContent).toBe('No run script templates saved yet.');
    });

    it('renders template cards with name and scriptPath', async () => {
        const templates = [
            { id: 't1', name: 'Build', scriptPath: './build.sh' },
            { id: 't2', name: 'Test', scriptPath: './test.sh' },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            const cards = screen.getAllByTestId('template-card');
            expect(cards.length).toBe(2);
        });
        expect(screen.getByText('Build')).toBeTruthy();
        expect(screen.getByText('./build.sh')).toBeTruthy();
        expect(screen.getByText('Test')).toBeTruthy();
        expect(screen.getByText('./test.sh')).toBeTruthy();
    });

    it('renders args when present', async () => {
        const templates = [
            { id: 't1', name: 'Deploy', scriptPath: './deploy.sh', args: '--prod --verbose' },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByText('--prod --verbose')).toBeTruthy();
        });
    });

    it('renders workingDirectory when present', async () => {
        const templates = [
            { id: 't1', name: 'Lint', scriptPath: './lint.sh', workingDirectory: '/workspace/src' },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByText('cwd: /workspace/src')).toBeTruthy();
        });
    });

    it('renders model badge when present', async () => {
        const templates = [
            { id: 't1', name: 'Analyze', scriptPath: './analyze.sh', model: 'gpt-4' },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByText('gpt-4')).toBeTruthy();
        });
    });

    it('renders pauseOnFailure indicator when true', async () => {
        const templates = [
            { id: 't1', name: 'Run', scriptPath: './run.sh', pauseOnFailure: true },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByText('pause on failure')).toBeTruthy();
        });
    });

    it('does not render pauseOnFailure indicator when false', async () => {
        const templates = [
            { id: 't1', name: 'Run', scriptPath: './run.sh', pauseOnFailure: false },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByTestId('template-card')).toBeTruthy();
        });
        expect(screen.queryByText('pause on failure')).toBeNull();
    });

    it('renders a fully populated template card', async () => {
        const templates = [
            {
                id: 't1',
                name: 'Full Template',
                scriptPath: './full.sh',
                args: '--all',
                workingDirectory: '/src',
                model: 'claude-sonnet',
                pauseOnFailure: true,
            },
        ];
        await renderSettings({ scriptTemplates: templates });
        await waitFor(() => {
            expect(screen.getByText('Full Template')).toBeTruthy();
        });
        expect(screen.getByText('./full.sh')).toBeTruthy();
        expect(screen.getByText('--all')).toBeTruthy();
        expect(screen.getByText('cwd: /src')).toBeTruthy();
        expect(screen.getByText('claude-sonnet')).toBeTruthy();
        expect(screen.getByText('pause on failure')).toBeTruthy();
    });
});
