/**
 * Tests for the Run Script Templates section now located in TemplatesTab.
 * (Moved from RepoSettingsTab in commit fad6d11a.)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d || 'unknown',
}));

const mockFetchApi = vi.fn().mockResolvedValue({ templates: [] });
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
vi.stubGlobal('fetch', mockFetch);

vi.mock('../../../../src/server/spa/client/react/contexts/ReposContext', () => ({
    useRepos: () => ({ repos: [] }),
}));

const mockDeleteScriptTemplate = vi.fn();
const mockUseScriptTemplates = vi.fn().mockReturnValue({
    templates: [],
    saveTemplate: vi.fn(),
    deleteTemplate: mockDeleteScriptTemplate,
    loaded: true,
});
vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useScriptTemplates', () => ({
    useScriptTemplates: (...args: any[]) => mockUseScriptTemplates(...args),
}));

const mockUseSkillTemplates = vi.fn().mockReturnValue({
    templates: [],
    deleteTemplate: vi.fn(),
    loaded: true,
});
vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useSkillTemplates', () => ({
    useSkillTemplates: (...args: any[]) => mockUseSkillTemplates(...args),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

const baseRepo = {
    workspace: { id: 'ws-1', rootPath: '/repo', color: '#ccc', description: '' },
    gitInfo: { branch: 'main', dirty: false, ahead: 0, behind: 0 },
    stats: { success: 0, failed: 0, running: 0 },
    workflows: [],
    taskCount: 0,
};

async function renderTemplatesTab(scriptTemplates: any[] = []) {
    mockUseScriptTemplates.mockReturnValue({
        templates: scriptTemplates,
        saveTemplate: vi.fn(),
        deleteTemplate: mockDeleteScriptTemplate,
        loaded: true,
    });
    const { TemplatesTab } = await import(
        '../../../../src/server/spa/client/react/features/templates/TemplatesTab'
    );
    return render(
        <Wrap>
            <TemplatesTab repo={baseRepo as any} />
        </Wrap>
    );
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockFetchApi.mockResolvedValue({ templates: [] });
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    mockUseSkillTemplates.mockReturnValue({ templates: [], deleteTemplate: vi.fn(), loaded: true });
    mockUseScriptTemplates.mockReturnValue({
        templates: [],
        saveTemplate: vi.fn(),
        deleteTemplate: mockDeleteScriptTemplate,
        loaded: true,
    });
});

describe('RunScriptTemplatesSection', () => {
    it('renders the Run Script Templates collapsible section in TemplatesTab', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(screen.getByTestId('script-templates-section')).toBeTruthy();
        });
        expect(screen.getByTestId('script-templates-section').textContent).toContain('Prompt & Script Templates');
    });

    it('shows empty state when no templates', async () => {
        await renderTemplatesTab([]);
        await waitFor(() => {
            expect(screen.getByTestId('script-templates-empty')).toBeTruthy();
        });
        expect(screen.getByTestId('script-templates-empty').textContent).toContain('No prompt & script templates');
    });

    it('renders template items with name and scriptPath', async () => {
        const templates = [
            { id: 't1', name: 'Build', scriptPath: './build.sh' },
            { id: 't2', name: 'Test', scriptPath: './test.sh' },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByTestId('script-template-item-t1')).toBeTruthy();
            expect(screen.getByTestId('script-template-item-t2')).toBeTruthy();
        });
        expect(screen.getByText(/Build/)).toBeTruthy();
        expect(screen.getByText('./build.sh')).toBeTruthy();
        expect(screen.getByText(/Test/)).toBeTruthy();
        expect(screen.getByText('./test.sh')).toBeTruthy();
    });

    it('renders args when present', async () => {
        const templates = [
            { id: 't1', name: 'Deploy', scriptPath: './deploy.sh', args: '--prod --verbose' },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByText('--prod --verbose')).toBeTruthy();
        });
    });

    it('does not render workingDirectory (not shown in TemplatesTab)', async () => {
        const templates = [
            { id: 't1', name: 'Lint', scriptPath: './lint.sh', workingDirectory: '/workspace/src' },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByTestId('script-template-item-t1')).toBeTruthy();
        });
        expect(screen.queryByText('cwd: /workspace/src')).toBeNull();
    });

    it('renders model badge when present', async () => {
        const templates = [
            { id: 't1', name: 'Analyze', scriptPath: './analyze.sh', model: 'gpt-4' },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByText('gpt-4')).toBeTruthy();
        });
    });

    it('renders pauseOnFailure indicator when true', async () => {
        const templates = [
            { id: 't1', name: 'Run', scriptPath: './run.sh', pauseOnFailure: true },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByText('pause on failure')).toBeTruthy();
        });
    });

    it('does not render pauseOnFailure indicator when false', async () => {
        const templates = [
            { id: 't1', name: 'Run', scriptPath: './run.sh', pauseOnFailure: false },
        ];
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByTestId('script-template-item-t1')).toBeTruthy();        });
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
        await renderTemplatesTab(templates);
        await waitFor(() => {
            expect(screen.getByText(/Full Template/)).toBeTruthy();
        });
        expect(screen.getByText('./full.sh')).toBeTruthy();
        expect(screen.getByText('--all')).toBeTruthy();
        expect(screen.getByText('claude-sonnet')).toBeTruthy();
        expect(screen.getByText('pause on failure')).toBeTruthy();
    });
});

