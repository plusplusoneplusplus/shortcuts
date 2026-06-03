/**
 * Render-based tests for WorkItemDetail always-on inline editing (Ctrl+S save).
 *
 * Covers:
 * - AC-01: every field renders editable at all times; no Edit button.
 * - AC-02: Ctrl+S batches all dirty fields, including plan, into a single PATCH;
 *   status no longer instant-saves.
 * - AC-04: a dirty indicator appears when there are unsaved changes.
 * - AC-05: save failure keeps the user on the page, shows an inline error, and
 *   preserves the edited values for retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';


// --- Mock the CoC client ---
const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockUpdatePlan = vi.fn();
const mockUpdateStatus = vi.fn();

vi.mock(`../../../../src/server/spa/client/react/api/cocClient`, () => ({
    getSpaCocClient: () => ({
        workItems: {
            get: (...args: any[]) => mockGet(...args),
            update: (...args: any[]) => mockUpdate(...args),
            updatePlan: (...args: any[]) => mockUpdatePlan(...args),
            updateStatus: (...args: any[]) => mockUpdateStatus(...args),
        },
    }),
    getSpaCocClientErrorMessage: (e: any) => (e && e.message) || 'error',
}));

// --- Mock context + hooks ---
const mockDispatch = vi.fn();
vi.mock(`../../../../src/server/spa/client/react/contexts/WorkItemContext`, () => ({
    useWorkItems: () => ({ state: { workItemsByRepo: {} }, dispatch: mockDispatch }),
}));

vi.mock(`../../../../src/server/spa/client/react/hooks/useApi`, () => ({
    fetchApi: vi.fn(async () => ({ comments: [] })),
}));

vi.mock(`../../../../src/server/spa/client/react/features/git/hooks/useCommitCommentTotals`, () => ({
    useCommitCommentTotals: () => new Map(),
}));

vi.mock(`../../../../src/server/spa/client/react/utils/config`, () => ({
    isWorkItemsHierarchyEnabled: () => false,
    isWorkItemsAiAuthoringEnabled: () => false,
}));

// --- Stub heavy child components ---
// Lightweight controlled stub that mirrors the real plan section's draft wiring
// so we can assert plan edits join the parent's unified Ctrl+S batch.
vi.mock(`../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection`, () => ({
    WorkItemPlanSection: ({ draftContent, onDraftChange }: any) => (
        <input
            data-testid="mock-plan-input"
            value={draftContent ?? ''}
            onChange={(e) => onDraftChange(e.target.value)}
        />
    ),
}));
vi.mock(`../../../../src/server/spa/client/react/features/work-items/WorkItemExecuteDialog`, () => ({
    WorkItemExecuteDialog: () => null,
}));
vi.mock(`../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer`, () => ({
    WorkItemAiComposer: () => null,
}));
vi.mock(`../../../../src/server/spa/client/react/features/work-items/WorkItemParentPicker`, () => ({
    WorkItemParentPicker: () => null,
}));
vi.mock(`../../../../src/server/spa/client/react/features/work-items/WorkItemGitHubMirrorBadge`, () => ({
    WorkItemGitHubMirrorBadge: () => null,
}));

import { WorkItemDetail } from '../../../../src/server/spa/client/react/features/work-items/WorkItemDetail';

const baseItem = {
    id: 'wi-1',
    workItemNumber: 7,
    title: 'Original title',
    description: 'Original description',
    status: 'created',
    type: 'work-item',
    priority: 'normal',
    tags: ['alpha'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

function renderDetail() {
    return render(
        <WorkItemDetail workItemId="wi-1" workspaceId="ws-1" onBack={vi.fn()} />
    );
}

describe('WorkItemDetail inline editing (render)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGet.mockResolvedValue({ ...baseItem });
        mockUpdate.mockImplementation(async (_ws: string, _id: string, updates: any) => ({ ...baseItem, ...updates }));
        mockUpdatePlan.mockResolvedValue({ version: 2 });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        window.location.hash = '';
    });

    it('AC-01: renders all fields editable with no Edit button', async () => {
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        expect((title as HTMLInputElement).value).toBe('Original title');
        expect(screen.getByTestId('wi-description-editor')).toBeTruthy();
        expect(screen.getByTestId('wi-priority-select')).toBeTruthy();
        expect(screen.getByTestId('wi-tags-input')).toBeTruthy();
        expect(screen.getByTestId('work-item-status-select')).toBeTruthy();
        // No Edit button / edit-toggle affordance.
        expect(screen.queryByTestId('wi-edit-btn')).toBeNull();
    });

    it('AC-04: dirty indicator appears once a field changes', async () => {
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        expect(screen.queryByTestId('wi-dirty-indicator')).toBeNull();
        fireEvent.change(title, { target: { value: 'Edited title' } });
        expect(screen.getByTestId('wi-dirty-indicator')).toBeTruthy();
    });

    it('AC-02: Ctrl+S sends one PATCH with all dirty metadata fields', async () => {
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });
        const descEditor = within(screen.getByTestId('wi-description-editor')).getByRole('textbox');
        fireEvent.change(descEditor, { target: { value: 'Edited desc' } });
        fireEvent.change(screen.getByTestId('wi-priority-select'), { target: { value: 'high' } });
        fireEvent.change(screen.getByTestId('wi-tags-input'), { target: { value: 'a, b, a' } });
        fireEvent.change(screen.getByTestId('work-item-status-select'), { target: { value: 'planning' } });

        // Status must not instant-save.
        expect(mockUpdateStatus).not.toHaveBeenCalled();

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
        const [, , updates] = mockUpdate.mock.calls[0];
        expect(updates).toMatchObject({
            title: 'Edited title',
            description: 'Edited desc',
            priority: 'high',
            tags: ['a', 'b'],
            status: 'planning',
        });
        // No standalone status save.
        expect(mockUpdateStatus).not.toHaveBeenCalled();
    });

    it('AC-05: save failure keeps values and shows an inline error', async () => {
        mockUpdate.mockRejectedValueOnce(new Error('boom'));
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        const err = await screen.findByTestId('wi-edit-error');
        expect(err.textContent).toContain('boom');
        // Value preserved for retry, still dirty.
        expect((screen.getByTestId('wi-title-input') as HTMLInputElement).value).toBe('Edited title');
        expect(screen.getByTestId('wi-dirty-indicator')).toBeTruthy();
    });

    it('AC-03: editing the plan marks dirty and Ctrl+S includes plan in the single PATCH', async () => {
        renderDetail();
        await screen.findByTestId('wi-title-input');
        const planInput = screen.getByTestId('mock-plan-input');
        // Plan starts clean (no plan content) — editing it should dirty the batch.
        expect(screen.queryByTestId('wi-dirty-indicator')).toBeNull();
        fireEvent.change(planInput, { target: { value: '# New plan' } });
        expect(screen.getByTestId('wi-dirty-indicator')).toBeTruthy();

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
        const [, , updates] = mockUpdate.mock.calls[0];
        expect(updates).toMatchObject({
            plan: {
                content: '# New plan',
                resolvedBy: 'user',
            },
        });
        expect(mockUpdatePlan).not.toHaveBeenCalled();
    });

    it('AC-03: description has a Source/Preview toggle and edits flow into the batch', async () => {
        renderDetail();
        await screen.findByTestId('wi-title-input');
        const editor = screen.getByTestId('wi-description-editor');
        // Per-field rich/source toggle is present.
        expect(within(editor).getByTestId('wi-description-mode-source')).toBeTruthy();
        expect(within(editor).getByTestId('wi-description-mode-preview')).toBeTruthy();

        // Source mode renders an editable textarea wired into the dirty batch.
        const descEditor = within(editor).getByRole('textbox');
        fireEvent.change(descEditor, { target: { value: 'Edited via source' } });
        expect(screen.getByTestId('wi-dirty-indicator')).toBeTruthy();

        // Switching to Preview hides the textarea and shows rendered markdown.
        fireEvent.click(within(editor).getByTestId('wi-description-mode-preview'));
        expect(within(editor).queryByRole('textbox')).toBeNull();
        expect(within(editor).getByTestId('wi-description-preview')).toBeTruthy();

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
        const [, , updates] = mockUpdate.mock.calls[0];
        expect(updates).toMatchObject({ description: 'Edited via source' });
    });

    it('AC-02: empty-batch Ctrl+S with no edits issues no network calls', async () => {
        renderDetail();
        await screen.findByTestId('wi-title-input');
        fireEvent.keyDown(window, { key: 's', ctrlKey: true });
        await Promise.resolve();
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockUpdatePlan).not.toHaveBeenCalled();
    });

    it('AC-04: blocks programmatic hash route changes when dirty and the user cancels', async () => {
        window.location.hash = '#repos/ws-1/work-items/wi-1';
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });

        window.location.hash = '#repos/ws-1/activity';
        fireEvent(window, new HashChangeEvent('hashchange'));

        await waitFor(() => expect(window.location.hash).toBe('#repos/ws-1/work-items/wi-1'));
        expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave without saving?');
    });

    it('AC-04: prevents hash-link navigation when dirty and the user cancels', async () => {
        window.location.hash = '#repos/ws-1/work-items/wi-1';
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });

        const link = document.createElement('a');
        link.href = '#repos/ws-1/activity';
        link.textContent = 'Activity';
        document.body.appendChild(link);
        fireEvent.click(link);

        expect(window.location.hash).toBe('#repos/ws-1/work-items/wi-1');
        expect(confirm).toHaveBeenCalledWith('You have unsaved changes. Leave without saving?');
    });
});
