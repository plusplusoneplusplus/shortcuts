/**
 * Tests for RepoTemplatesTab — dashboard Templates sub-tab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';

// Mock fetch and fetchApi so the component can render without a real server
const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
});
vi.stubGlobal('fetch', mockFetch);

const mockFetchApi = vi.fn().mockResolvedValue({ templates: [] });
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
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
    mockFetchApi.mockResolvedValue({ templates });
    const { RepoTemplatesTab } = await import(
        '../../../src/server/spa/client/react/repos/RepoTemplatesTab'
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

    it('fetches templates from the correct API endpoint', async () => {
        await renderTemplatesTab();
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/templates');
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
        mockFetchApi
            .mockResolvedValueOnce({ templates: SAMPLE_TEMPLATES })
            .mockResolvedValueOnce(SAMPLE_DETAIL);
        const { RepoTemplatesTab } = await import(
            '../../../src/server/spa/client/react/repos/RepoTemplatesTab'
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
            expect(mockFetchApi).toHaveBeenCalledWith('/workspaces/ws-1/templates/add-config-field');
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
        const initialCallCount = mockFetchApi.mock.calls.filter(
            (c: any[]) => c[0] === '/workspaces/ws-1/templates'
        ).length;

        window.dispatchEvent(new CustomEvent('templates-changed'));

        await waitFor(() => {
            const newCallCount = mockFetchApi.mock.calls.filter(
                (c: any[]) => c[0] === '/workspaces/ws-1/templates'
            ).length;
            expect(newCallCount).toBeGreaterThan(initialCallCount);
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

    it('sends DELETE request when delete is confirmed from context menu', async () => {
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
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:4000/api/workspaces/ws-1/templates/add-config-field',
                { method: 'DELETE' }
            );
        });
    });
});

// ============================================================================
// Source-level assertions (pattern from RepoDetail.test.ts)
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'src', 'server', 'spa', 'client', 'react', 'repos', 'RepoTemplatesTab.tsx'),
    'utf-8',
);

describe('RepoTemplatesTab — source structure', () => {
    it('exports RepoTemplatesTab as a named export', () => {
        expect(SOURCE).toContain('export function RepoTemplatesTab');
    });

    it('accepts workspaceId prop', () => {
        expect(SOURCE).toContain('workspaceId: string');
    });

    it('uses fetchApi for template list', () => {
        expect(SOURCE).toContain('fetchApi(');
        expect(SOURCE).toContain('/templates');
    });

    it('uses encodeURIComponent for workspace and template names in API calls', () => {
        expect(SOURCE).toContain('enc(workspaceId)');
    });

    it('renders split panel layout with left (list) and right (detail) panels', () => {
        expect(SOURCE).toContain('LEFT PANEL');
        expect(SOURCE).toContain('RIGHT PANEL');
    });

    it('has TemplateDetailView sub-component', () => {
        expect(SOURCE).toContain('function TemplateDetailView');
    });

    it('has CreateTemplateForm sub-component', () => {
        expect(SOURCE).toContain('function CreateTemplateForm');
    });

    it('has ReplicateDialog sub-component', () => {
        expect(SOURCE).toContain('function ReplicateDialog');
    });

    it('has ContextMenu sub-component', () => {
        expect(SOURCE).toContain('function ContextMenu');
    });

    it('uses ReactDOM.createPortal for context menu', () => {
        expect(SOURCE).toContain('ReactDOM.createPortal');
    });

    it('listens for templates-changed window event', () => {
        expect(SOURCE).toContain("'templates-changed'");
    });

    it('supports PATCH method for template editing', () => {
        expect(SOURCE).toContain("method: 'PATCH'");
    });

    it('supports DELETE method for template deletion', () => {
        expect(SOURCE).toContain("method: 'DELETE'");
    });

    it('supports POST method for template creation and replication', () => {
        expect(SOURCE).toContain("method: 'POST'");
    });

    it('validates template name with kebab-case regex', () => {
        expect(SOURCE).toContain('/^[a-z0-9]+(-[a-z0-9]+)*$/');
    });

    it('uses confirm dialog before delete', () => {
        expect(SOURCE).toContain('confirm(');
    });

    it('renders Spinner for loading states', () => {
        expect(SOURCE).toContain('<Spinner');
    });

    it('uses Dialog component for replicate modal', () => {
        expect(SOURCE).toContain('<Dialog');
    });

    it('renders file status colors', () => {
        expect(SOURCE).toContain('function statusColor');
        expect(SOURCE).toContain("case 'added'");
        expect(SOURCE).toContain("case 'deleted'");
        expect(SOURCE).toContain("case 'renamed'");
    });

    it('supports commit hash validation via API on blur', () => {
        expect(SOURCE).toContain('handleCommitBlur');
        expect(SOURCE).toContain('/git/commits/');
    });

    it('edit mode shows name, kind, and commitHash as read-only', () => {
        expect(SOURCE).toContain('isEdit');
    });

    it('resets selection when workspace changes', () => {
        expect(SOURCE).toContain('setSelectedName(null)');
        expect(SOURCE).toContain('setShowCreate(false)');
        expect(SOURCE).toContain('setEditingName(null)');
    });

    it('uses formatRelativeTime for timestamps', () => {
        expect(SOURCE).toContain('formatRelativeTime');
    });

    it('supports clipboard copy for commit hash', () => {
        expect(SOURCE).toContain('navigator.clipboard.writeText');
    });

    it('has dark mode classes throughout', () => {
        expect(SOURCE).toContain('dark:');
    });
});
