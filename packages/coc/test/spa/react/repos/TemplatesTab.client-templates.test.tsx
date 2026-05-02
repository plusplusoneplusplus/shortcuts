import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Template, TemplateDetail } from '@plusplusoneplusplus/coc-client';
import { AppProvider } from '../../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';

const mockTemplatesClient = vi.hoisted(() => ({
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    replicate: vi.fn(),
}));

const mockFetchApi = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ templates: mockTemplatesClient }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d || 'unknown',
}));

vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useSkillTemplates', () => ({
    useSkillTemplates: vi.fn().mockReturnValue({
        templates: [],
        deleteTemplate: vi.fn(),
        loaded: true,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/templates/hooks/useScriptTemplates', () => ({
    useScriptTemplates: vi.fn().mockReturnValue({
        templates: [],
        saveTemplate: vi.fn(),
        updateTemplate: vi.fn(),
        deleteTemplate: vi.fn(),
        loaded: true,
    }),
}));

vi.stubGlobal('confirm', () => true);
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

const TEMPLATE: Template = {
    name: 'fix-parser',
    kind: 'commit',
    commitHash: 'abcdef123456',
    description: 'Fix parser template',
    hints: ['keep tests green'],
    createdAt: '2026-05-02T00:00:00.000Z',
};

const TEMPLATE_DETAIL: TemplateDetail = {
    ...TEMPLATE,
    changedFiles: [{ path: 'src/parser.ts', status: 'modified', additions: 2, deletions: 1 }],
};

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

function makeRepo() {
    return {
        workspace: { id: 'ws-1' },
        workflows: [],
    } as any;
}

async function renderTemplatesTab() {
    const { TemplatesTab } = await import('../../../../src/server/spa/client/react/features/templates/TemplatesTab');
    render(<Wrap><TemplatesTab repo={makeRepo()} /></Wrap>);
}

async function renderRepoTemplatesTab() {
    const { RepoTemplatesTab } = await import('../../../../src/server/spa/client/react/features/templates/RepoTemplatesTab');
    render(<RepoTemplatesTab workspaceId="ws-1" />);
}

describe('TemplatesTab typed templates client migration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTemplatesClient.list.mockResolvedValue([TEMPLATE]);
        mockTemplatesClient.detail.mockResolvedValue(TEMPLATE_DETAIL);
        mockTemplatesClient.create.mockResolvedValue({ name: 'new-template', path: '/repo/.vscode/templates/new-template.yaml' });
        mockTemplatesClient.update.mockResolvedValue({ name: 'fix-parser', path: '/repo/.vscode/templates/fix-parser.yaml' });
        mockTemplatesClient.delete.mockResolvedValue({ deleted: 'fix-parser' });
        mockTemplatesClient.replicate.mockResolvedValue({ taskId: 'task-1' });
        mockFetchApi.mockResolvedValue({ subject: 'Valid commit' });
    });

    it('loads and refreshes commit templates through client.templates', async () => {
        await renderTemplatesTab();

        await waitFor(() => expect(screen.getByTestId('template-item-fix-parser')).toBeDefined());
        expect(mockTemplatesClient.list).toHaveBeenCalledWith('ws-1');

        const callsBefore = mockTemplatesClient.list.mock.calls.length;
        fireEvent.click(screen.getByTestId('templates-refresh-btn'));
        await waitFor(() => expect(mockTemplatesClient.list.mock.calls.length).toBeGreaterThan(callsBefore));
    });

    it('reads selected template detail through client.templates', async () => {
        await renderTemplatesTab();
        await waitFor(() => expect(screen.getByTestId('template-item-fix-parser')).toBeDefined());

        fireEvent.click(screen.getByTestId('template-item-fix-parser'));

        await waitFor(() => expect(screen.getByTestId('template-detail')).toBeDefined());
        expect(mockTemplatesClient.detail).toHaveBeenCalledWith('ws-1', 'fix-parser');
        expect(screen.getByTestId('template-detail').textContent).toContain('src/parser.ts');
    });

    it('creates templates through client.templates without changing commit validation behavior', async () => {
        await renderTemplatesTab();
        await waitFor(() => expect(screen.getByTestId('templates-new-btn')).toBeDefined());

        fireEvent.click(screen.getByTestId('templates-new-btn'));
        fireEvent.change(screen.getByTestId('template-name-input'), { target: { value: 'new-template' } });
        fireEvent.change(screen.getByTestId('template-commit-input'), { target: { value: 'abc123' } });
        fireEvent.blur(screen.getByTestId('template-commit-input'));

        await waitFor(() => expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/git/commits/abc123'));
        fireEvent.change(screen.getByTestId('template-description-input'), { target: { value: 'New template description' } });
        fireEvent.change(screen.getByTestId('template-hints-input'), { target: { value: 'one\ntwo' } });
        fireEvent.click(screen.getByTestId('template-form-submit'));

        await waitFor(() => {
            expect(mockTemplatesClient.create).toHaveBeenCalledWith('ws-1', {
                name: 'new-template',
                kind: 'commit',
                commitHash: 'abc123',
                description: 'New template description',
                hints: ['one', 'two'],
            });
        });
    });
});

describe('RepoTemplatesTab typed templates client migration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTemplatesClient.list.mockResolvedValue([TEMPLATE]);
        mockTemplatesClient.detail.mockResolvedValue(TEMPLATE_DETAIL);
        mockTemplatesClient.create.mockResolvedValue({ name: 'new-template', path: '/repo/.vscode/templates/new-template.yaml' });
        mockTemplatesClient.update.mockResolvedValue({ name: 'fix-parser', path: '/repo/.vscode/templates/fix-parser.yaml' });
        mockTemplatesClient.delete.mockResolvedValue({ deleted: 'fix-parser' });
        mockTemplatesClient.replicate.mockResolvedValue({ taskId: 'task-1' });
        mockFetchApi.mockResolvedValue({ subject: 'Valid commit' });
    });

    it('loads repo templates and reads details through the same templates client domain', async () => {
        await renderRepoTemplatesTab();
        await waitFor(() => expect(screen.getByTestId('template-item-fix-parser')).toBeDefined());

        fireEvent.click(screen.getByTestId('template-item-fix-parser'));

        await waitFor(() => expect(screen.getByTestId('template-detail')).toBeDefined());
        expect(mockTemplatesClient.list).toHaveBeenCalledWith('ws-1');
        expect(mockTemplatesClient.detail).toHaveBeenCalledWith('ws-1', 'fix-parser');
    });

    it('deletes repo templates through client.templates and refreshes the list', async () => {
        await renderRepoTemplatesTab();
        await waitFor(() => expect(screen.getByTestId('template-item-fix-parser')).toBeDefined());

        fireEvent.contextMenu(screen.getByTestId('template-item-fix-parser'));
        fireEvent.click(await screen.findByText('Delete'));

        await waitFor(() => expect(mockTemplatesClient.delete).toHaveBeenCalledWith('ws-1', 'fix-parser'));
        expect(mockTemplatesClient.list.mock.calls.length).toBeGreaterThan(1);
    });
});
