/**
 * Tests for RepoTemplatesTab — dashboard Templates sub-tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';

// Mock fetch and fetchApi so the component can render without a real server
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
});
vi.stubGlobal('fetch', mockFetch);

const mockTemplatesClient = vi.hoisted(() => ({
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    replicate: vi.fn(),
}));

const mockFetchApi = vi.fn().mockResolvedValue({ templates: [] });
vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ templates: mockTemplatesClient }),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
}));

vi.mock('../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d || 'unknown',
}));

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

const SAMPLE_TEMPLATES = [
    {
        name: 'add-config-field',
        kind: 'commit' as const,
        commitHash: 'abc123def456',
        description: 'Add a new config field',
        hints: ['Update schema', 'Add migration'],
        createdAt: '2025-01-01T00:00:00Z',
    },
    {
        name: 'add-api-endpoint',
        kind: 'commit' as const,
        commitHash: 'def789abc012',
        createdAt: '2025-01-02T00:00:00Z',
    },
];

const SAMPLE_DETAIL = {
    ...SAMPLE_TEMPLATES[0],
    changedFiles: [
        { path: 'src/config.ts', status: 'modified', additions: 5, deletions: 2 },
        { path: 'src/schema.ts', status: 'added', additions: 20 },
    ],
};

// Lazy-import the component after mocks are set up
async function renderTemplatesTab(templates = SAMPLE_TEMPLATES) {
    mockTemplatesClient.list.mockResolvedValue(templates);
    mockTemplatesClient.detail.mockResolvedValue(SAMPLE_DETAIL);
    mockTemplatesClient.create.mockResolvedValue({ name: 'created-template', path: '/repo/.vscode/templates/created-template.yaml' });
    mockTemplatesClient.update.mockResolvedValue({ name: 'add-config-field', path: '/repo/.vscode/templates/add-config-field.yaml' });
    mockTemplatesClient.delete.mockResolvedValue({ deleted: 'add-config-field' });
    mockTemplatesClient.replicate.mockResolvedValue({ taskId: 'task-1' });
    const { RepoTemplatesTab } = await import(
        '../../../src/server/spa/client/react/features/templates/RepoTemplatesTab'
    );
    const result = render(
        <Wrap>
            <RepoTemplatesTab workspaceId="ws-1" />
        </Wrap>,
    );
    await waitFor(() => {
        expect(screen.getByTestId('templates-tab')).toBeTruthy();
    });
    return result;
}

// ============================================================================
// Empty State
// ============================================================================

describe('RepoTemplatesTab — empty state', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows empty state when no templates exist', async () => {
        await renderTemplatesTab([]);
        await waitFor(() => {
            expect(screen.getByTestId('templates-empty')).toBeTruthy();
        });
        expect(screen.getByText('No templates yet')).toBeTruthy();
    });

    it('shows right panel empty detail message', async () => {
        await renderTemplatesTab([]);
        await waitFor(() => {
            expect(screen.getByTestId('templates-empty-detail')).toBeTruthy();
        });
        expect(screen.getByText('Select a template to view details')).toBeTruthy();
    });
});

// ============================================================================
// Template List
// ============================================================================

describe('RepoTemplatesTab — template list', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders template items in the list', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(screen.getByTestId('templates-list')).toBeTruthy();
        });
        expect(screen.getByTestId('template-item-add-config-field')).toBeTruthy();
        expect(screen.getByTestId('template-item-add-api-endpoint')).toBeTruthy();
    });

    it('shows count badge in header', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(screen.getByTestId('templates-count')).toBeTruthy();
        });
        expect(screen.getByTestId('templates-count').textContent).toBe('(2)');
    });

    it('displays template name and commit hash', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(screen.getByText('add-config-field')).toBeTruthy();
        });
        expect(screen.getByText(/abc123de/)).toBeTruthy();
    });

    it('fetches templates through the typed client domain', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(mockTemplatesClient.list).toHaveBeenCalledWith('ws-1');
        });
    });
});

// ============================================================================
// Template Selection and Detail
// ============================================================================

describe('RepoTemplatesTab — detail view', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches detail when a template is selected', async () => {
        mockTemplatesClient.list.mockResolvedValue(SAMPLE_TEMPLATES);
        mockTemplatesClient.detail.mockResolvedValue(SAMPLE_DETAIL);
        const { RepoTemplatesTab } = await import(
            '../../../src/server/spa/client/react/features/templates/RepoTemplatesTab'
        );
        render(
            <Wrap>
                <RepoTemplatesTab workspaceId="ws-1" />
            </Wrap>,
        );
        await waitFor(() => {
            expect(screen.getByTestId('template-item-add-config-field')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('template-item-add-config-field'));
        await waitFor(() => {
            expect(mockTemplatesClient.detail).toHaveBeenCalledWith('ws-1', 'add-config-field');
        });
    });
});

// ============================================================================
// Create Form
// ============================================================================

describe('RepoTemplatesTab — create form', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('opens create form when + New is clicked', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-form')).toBeTruthy();
        });
        expect(screen.getByText('Create Template')).toBeTruthy();
    });

    it('has name, commit hash, description, and hints inputs', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-name-input')).toBeTruthy();
        });
        expect(screen.getByTestId('template-commit-input')).toBeTruthy();
        expect(screen.getByTestId('template-description-input')).toBeTruthy();
        expect(screen.getByTestId('template-hints-input')).toBeTruthy();
    });

    it('cancel button closes the form', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-form')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('template-form-cancel'));
        await waitFor(() => {
            expect(screen.queryByTestId('template-form')).toBeNull();
        });
    });

    it('back button closes the form', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-form-back')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('template-form-back'));
        await waitFor(() => {
            expect(screen.queryByTestId('template-form')).toBeNull();
        });
    });
});

// ============================================================================
// Name Validation
// ============================================================================

describe('RepoTemplatesTab — name validation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows error for non-kebab-case name', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-name-input')).toBeTruthy();
        });
        fireEvent.change(screen.getByTestId('template-name-input'), { target: { value: 'Invalid Name' } });
        await waitFor(() => {
            expect(screen.getByText('Must be kebab-case (e.g., fix-parser)')).toBeTruthy();
        });
    });

    it('accepts valid kebab-case name', async () => {
        await renderTemplatesTab([]);
        fireEvent.click(screen.getByTestId('templates-new-btn'));
        await waitFor(() => {
            expect(screen.getByTestId('template-name-input')).toBeTruthy();
        });
        fireEvent.change(screen.getByTestId('template-name-input'), { target: { value: 'valid-name' } });
        await waitFor(() => {
            expect(screen.queryByText('Must be kebab-case (e.g., fix-parser)')).toBeNull();
        });
    });
});

// ============================================================================
// WebSocket Events
// ============================================================================

describe('RepoTemplatesTab — WebSocket events', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('refreshes template list when templates-changed event fires', async () => {
        await renderTemplatesTab();
        const initialCallCount = mockTemplatesClient.list.mock.calls.length;

        window.dispatchEvent(new CustomEvent('templates-changed'));

        await waitFor(() => {
            expect(mockTemplatesClient.list.mock.calls.length).toBeGreaterThan(initialCallCount);
        });
    });
});

// ============================================================================
// Delete
// ============================================================================

describe('RepoTemplatesTab — delete', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    });

    it('deletes through the typed client when confirmed from context menu', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(screen.getByTestId('template-item-add-config-field')).toBeTruthy();
        });

        // Right-click to open context menu
        fireEvent.contextMenu(screen.getByTestId('template-item-add-config-field'));

        await waitFor(() => {
            expect(screen.getByTestId('template-context-menu')).toBeTruthy();
        });

        // Click delete
        fireEvent.click(screen.getByText('Delete'));

        await waitFor(() => {
            expect(mockTemplatesClient.delete).toHaveBeenCalledWith('ws-1', 'add-config-field');
        });
    });
});

// ============================================================================
// Source-level assertions (pattern from RepoDetail.test.ts)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

const TEMPLATES_DIR = path.join(
    __dirname, '..', '..', '..',
    'src', 'server', 'spa', 'client', 'react', 'features', 'templates',
);
const readTemplateSource = (...parts: string[]) => fs.readFileSync(path.join(TEMPLATES_DIR, ...parts), 'utf-8');

const SOURCE = readTemplateSource('RepoTemplatesTab.tsx');
const COMPONENTS_SOURCE = readTemplateSource('commit-templates', 'components.tsx');
const CONTEXT_MENU_SOURCE = readTemplateSource('commit-templates', 'ContextMenu.tsx');
const HELPERS_SOURCE = readTemplateSource('commit-templates', 'helpers.ts');
const CONTROLLER_SOURCE = readTemplateSource('commit-templates', 'useCommitTemplatesController.ts');

describe('RepoTemplatesTab — source structure', () => {
    it('exports RepoTemplatesTab as a named export', () => {
        expect(SOURCE).toContain('export function RepoTemplatesTab');
    });

    it('accepts workspaceId prop', () => {
        expect(SOURCE).toContain('workspaceId: string');
    });

    it('drives state through the shared useCommitTemplatesController', () => {
        expect(SOURCE).toContain('useCommitTemplatesController(workspaceId)');
    });

    it('imports the shared commit-template components', () => {
        expect(SOURCE).toContain("from './commit-templates'");
    });

    it('renders split panel layout with left (list) and right (detail) panels', () => {
        expect(SOURCE).toContain('LEFT PANEL');
        expect(SOURCE).toContain('RIGHT PANEL');
    });

    it('renders Spinner for loading states', () => {
        expect(SOURCE).toContain('<Spinner');
    });

    it('has dark mode classes throughout', () => {
        expect(SOURCE).toContain('dark:');
    });
});

describe('commit-templates shared module — source structure', () => {
    it('exports the presentational commit-template components', () => {
        expect(COMPONENTS_SOURCE).toContain('export function TemplateListItem');
        expect(COMPONENTS_SOURCE).toContain('export function TemplateDetailView');
        expect(COMPONENTS_SOURCE).toContain('export function CreateTemplateForm');
        expect(COMPONENTS_SOURCE).toContain('export function ReplicateDialog');
    });

    it('exports a portal-based ContextMenu', () => {
        expect(CONTEXT_MENU_SOURCE).toContain('export function ContextMenu');
        expect(CONTEXT_MENU_SOURCE).toContain('ReactDOM.createPortal');
    });

    it('reads template list and detail through the typed client (controller)', () => {
        expect(CONTROLLER_SOURCE).toContain('getSpaCocClient().templates.list');
        expect(CONTROLLER_SOURCE).toContain('getSpaCocClient().templates.detail');
    });

    it('listens for templates-changed window event in the controller', () => {
        expect(CONTROLLER_SOURCE).toContain("'templates-changed'");
    });

    it('deletes through client.templates with a confirm guard in the controller', () => {
        expect(CONTROLLER_SOURCE).toContain('getSpaCocClient().templates.delete');
        expect(CONTROLLER_SOURCE).toContain('confirm(');
    });

    it('resets selection when the workspace changes in the controller', () => {
        expect(CONTROLLER_SOURCE).toContain('setSelectedName(null)');
        expect(CONTROLLER_SOURCE).toContain('setShowCreate(false)');
        expect(CONTROLLER_SOURCE).toContain('setEditingName(null)');
    });

    it('supports template editing, creation, and replication through client.templates', () => {
        expect(COMPONENTS_SOURCE).toContain('getSpaCocClient().templates.update');
        expect(COMPONENTS_SOURCE).toContain('getSpaCocClient().templates.create');
        expect(COMPONENTS_SOURCE).toContain('getSpaCocClient().templates.replicate');
    });

    it('uses encodeURIComponent for commit validation calls', () => {
        expect(COMPONENTS_SOURCE).toContain('enc(workspaceId)');
    });

    it('supports commit hash validation via API on blur', () => {
        expect(COMPONENTS_SOURCE).toContain('handleCommitBlur');
        expect(COMPONENTS_SOURCE).toContain('/git/commits/');
    });

    it('edit mode shows name, kind, and commitHash as read-only', () => {
        expect(COMPONENTS_SOURCE).toContain('isEdit');
    });

    it('uses Dialog component for replicate modal', () => {
        expect(COMPONENTS_SOURCE).toContain('<Dialog');
    });

    it('uses formatRelativeTime for timestamps', () => {
        expect(COMPONENTS_SOURCE).toContain('formatRelativeTime');
    });

    it('supports clipboard copy for commit hash', () => {
        expect(COMPONENTS_SOURCE).toContain('navigator.clipboard.writeText');
    });

    it('validates template name with kebab-case regex', () => {
        expect(HELPERS_SOURCE).toContain('/^[a-z0-9]+(-[a-z0-9]+)*$/');
    });

    it('renders file status colors', () => {
        expect(HELPERS_SOURCE).toContain('export function statusColor');
        expect(HELPERS_SOURCE).toContain("case 'added'");
        expect(HELPERS_SOURCE).toContain("case 'deleted'");
        expect(HELPERS_SOURCE).toContain("case 'renamed'");
    });
});
