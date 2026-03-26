/**
 * Tests for AI Chat Templates section in WorkflowsTab.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/context/ToastContext';
import type { SkillTemplate } from '../../../../src/server/spa/client/react/hooks/useSkillTemplates';

// ── Global stubs ──

vi.stubGlobal('confirm', () => true);

const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
vi.stubGlobal('fetch', mockFetch);

// ── Module mocks ──

const mockFetchApi = vi.fn().mockResolvedValue({ templates: [] });
vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (d: string) => d || 'unknown',
}));

const mockDeleteTemplate = vi.fn();

vi.mock('../../../../src/server/spa/client/react/hooks/useSkillTemplates', () => ({
    useSkillTemplates: vi.fn().mockReturnValue({
        templates: [],
        deleteTemplate: vi.fn(),
        loaded: true,
    }),
}));

// ── Wrapper ──

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

// ── Sample data ──

const SKILL_TEMPLATES: SkillTemplate[] = [
    { id: 'st-1', name: 'Default setup', model: 'gpt-4o', mode: 'task', skills: ['research', 'code'] },
    { id: 'st-2', name: 'Quick ask', model: '', mode: 'ask', skills: [] },
];

// ── Helpers ──

function makeRepo() {
    return {
        workspace: { id: 'ws-1' },
        workflows: [],
    } as any;
}

async function renderWorkflowsTab(skillTemplateOverride: SkillTemplate[] = SKILL_TEMPLATES) {
    const { useSkillTemplates } = await import('../../../../src/server/spa/client/react/hooks/useSkillTemplates');
    vi.mocked(useSkillTemplates).mockReturnValue({
        templates: skillTemplateOverride,
        deleteTemplate: mockDeleteTemplate,
        loaded: true,
    });
    const { WorkflowsTab } = await import('../../../../src/server/spa/client/react/repos/WorkflowsTab');
    const repo = makeRepo();
    render(<Wrap><WorkflowsTab repo={repo} /></Wrap>);
    await waitFor(() => expect(screen.getByTestId('skill-templates-section')).toBeDefined());
}

// ── Tests ──

describe('AI Chat Templates section', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDeleteTemplate.mockReset();
    });

    it('renders "AI Chat Templates" section header', async () => {
        await renderWorkflowsTab();
        const section = screen.getByTestId('skill-templates-section');
        expect(section.textContent).toContain('AI Chat Templates');
    });

    it('shows empty state when no skill templates', async () => {
        await renderWorkflowsTab([]);
        const empty = screen.getByTestId('skill-templates-empty');
        expect(empty).toBeDefined();
        expect(empty.textContent).toContain('Save templates from the AI chat dialog');
    });

    it('renders list of skill templates', async () => {
        await renderWorkflowsTab();
        expect(screen.getByTestId('skill-templates-list')).toBeDefined();
        expect(screen.getByTestId('skill-template-item-st-1')).toBeDefined();
        expect(screen.getByTestId('skill-template-item-st-2')).toBeDefined();
    });

    it('shows mode badge and model in list item', async () => {
        await renderWorkflowsTab();
        const item1 = screen.getByTestId('skill-template-item-st-1');
        expect(item1.textContent).toContain('task');
        expect(item1.textContent).toContain('gpt-4o');

        const item2 = screen.getByTestId('skill-template-item-st-2');
        expect(item2.textContent).toContain('ask');
        expect(item2.textContent).toContain('default');
    });

    it('clicking a list item shows SkillTemplateDetailView', async () => {
        await renderWorkflowsTab();
        fireEvent.click(screen.getByTestId('skill-template-item-st-1'));
        await waitFor(() => {
            const detail = screen.getByTestId('skill-template-detail');
            expect(detail).toBeDefined();
            expect(detail.textContent).toContain('Default setup');
        });
    });

    it('detail view shows mode, model, and skills', async () => {
        await renderWorkflowsTab();
        fireEvent.click(screen.getByTestId('skill-template-item-st-1'));
        await waitFor(() => {
            const detail = screen.getByTestId('skill-template-detail');
            expect(detail.textContent).toContain('task');
            expect(detail.textContent).toContain('gpt-4o');
            expect(detail.textContent).toContain('research');
            expect(detail.textContent).toContain('code');
        });
    });

    it('detail view shows "None" for empty skills', async () => {
        await renderWorkflowsTab();
        fireEvent.click(screen.getByTestId('skill-template-item-st-2'));
        await waitFor(() => {
            const detail = screen.getByTestId('skill-template-detail');
            expect(detail.textContent).toContain('None');
        });
    });

    it('detail view shows "default" for empty model', async () => {
        await renderWorkflowsTab();
        fireEvent.click(screen.getByTestId('skill-template-item-st-2'));
        await waitFor(() => {
            const detail = screen.getByTestId('skill-template-detail');
            expect(detail.textContent).toContain('default');
        });
    });

    it('deleting a skill template via context menu calls deleteTemplate', async () => {
        await renderWorkflowsTab();
        const item = screen.getByTestId('skill-template-item-st-1');
        fireEvent.contextMenu(item);
        await waitFor(() => {
            const deleteBtn = screen.getByText('Delete');
            expect(deleteBtn).toBeDefined();
        });
        fireEvent.click(screen.getByText('Delete'));
        expect(mockDeleteTemplate).toHaveBeenCalledWith('st-1');
    });

    it('deleting clears right panel when deleted item was selected', async () => {
        await renderWorkflowsTab();
        // Select st-1
        fireEvent.click(screen.getByTestId('skill-template-item-st-1'));
        await waitFor(() => expect(screen.getByTestId('skill-template-detail')).toBeDefined());

        // Delete via context menu — use getAllByText since detail view also has a Delete button
        fireEvent.contextMenu(screen.getByTestId('skill-template-item-st-1'));
        const deleteButtons = await waitFor(() => screen.getAllByText('Delete'));
        // Click the context menu Delete (last one rendered via portal)
        fireEvent.click(deleteButtons[deleteButtons.length - 1]);

        // Detail should disappear because internal state clears selectedSkillTemplateId
        // and mock returns same templates array, but the component sets selectedSkillTemplateId to null
        await waitFor(() => {
            expect(screen.queryByTestId('skill-template-detail')).toBeNull();
        });
    });

    it('section collapses on header click', async () => {
        await renderWorkflowsTab();
        expect(screen.getByTestId('skill-templates-list')).toBeDefined();

        // Click the section header (the clickable div inside skill-templates-section)
        const section = screen.getByTestId('skill-templates-section');
        const header = section.querySelector('[class*="cursor-pointer"]') as HTMLElement;
        fireEvent.click(header);

        await waitFor(() => {
            expect(screen.queryByTestId('skill-templates-list')).toBeNull();
        });
    });

    it('selecting a skill template clears selected workflow', async () => {
        await renderWorkflowsTab();
        // Click a skill template item; the handler dispatches SET_SELECTED_WORKFLOW with name: null
        // We verify indirectly: after selecting a skill template, the detail view appears
        // (which means no workflow is shown in the right panel)
        fireEvent.click(screen.getByTestId('skill-template-item-st-1'));
        await waitFor(() => {
            expect(screen.getByTestId('skill-template-detail')).toBeDefined();
        });
        // The right panel shows skill template detail, not a workflow — confirming dispatch happened
        expect(screen.queryByTestId('templates-empty-detail')).toBeNull();
    });
});
