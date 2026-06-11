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
import { CocApiError, WORK_ITEM_SYNC_CONFLICT_CODE, type WorkItemSyncConflictDetails } from '@plusplusoneplusplus/coc-client';


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
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isWorkItemsHierarchyEnabled: () => false,
    isWorkItemsAiAuthoringEnabled: () => false,
    isWorkItemsWorkflowEnabled: () => false,
    isCommitChatLensEnabled: () => false,
    getCommitChatLensDormantMode: () => 'ghost' as const,
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
    PLAN_MODE_OPTIONS: Object.freeze([
        { value: 'preview', label: 'Preview' },
        { value: 'source', label: 'Source', testId: 'work-item-plan-mode-source' },
    ]),
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
    WorkItemRemoteMirrorBadge: () => null,
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

function makeItem(overrides: Record<string, any> & { id: string; title: string }) {
    return {
        ...baseItem,
        ...overrides,
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function makeSyncConflict(overrides: Partial<WorkItemSyncConflictDetails> = {}): WorkItemSyncConflictDetails {
    return {
        kind: 'work-item-sync-conflict',
        provider: 'github',
        providerLabel: 'GitHub',
        workItemId: 'wi-1',
        issueNumber: 42,
        localUpdatedAt: '2026-06-05T10:00:00.000Z',
        remoteUpdatedAt: '2026-06-05T10:05:00.000Z',
        fields: [
            { field: 'title', draft: 'Edited title', base: 'Original title', remote: 'Remote title' },
            { field: 'description', draft: 'Edited description', base: 'Original description', remote: 'Remote description' },
            { field: 'tags', draft: 'alpha, local', base: 'alpha', remote: 'alpha, remote' },
        ],
        ...overrides,
    };
}

function makeConflictError(details = makeSyncConflict()) {
    return new CocApiError({
        status: 409,
        statusText: 'Conflict',
        url: '/api/workspaces/ws-1/work-items/wi-1',
        message: 'Resolve the conflict before saving local edits.',
        code: WORK_ITEM_SYNC_CONFLICT_CODE,
        details,
        body: {
            error: {
                code: WORK_ITEM_SYNC_CONFLICT_CODE,
                message: 'Resolve the conflict before saving local edits.',
                details,
            },
        },
    });
}

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

    it('AC-02 conflict UI: renders provider-owned fields and cancel dismisses without changing the draft', async () => {
        mockUpdate.mockRejectedValueOnce(makeConflictError());
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });
        const descEditor = within(screen.getByTestId('wi-description-editor')).getByRole('textbox');
        fireEvent.change(descEditor, { target: { value: 'Edited description' } });

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        const panel = await screen.findByTestId('wi-sync-conflict-panel');
        expect(panel.textContent).toContain('Remote changes found on GitHub');
        expect(within(panel).getByTestId('wi-sync-conflict-field-title').textContent).toContain('Remote title');
        expect(within(panel).getByTestId('wi-sync-conflict-field-description').textContent).toContain('Remote description');
        expect(within(panel).getByTestId('wi-sync-conflict-field-tags').textContent).toContain('alpha, remote');

        fireEvent.click(within(panel).getByTestId('wi-sync-conflict-cancel'));

        expect(screen.queryByTestId('wi-sync-conflict-panel')).toBeNull();
        expect((screen.getByTestId('wi-title-input') as HTMLInputElement).value).toBe('Edited title');
        expect((within(screen.getByTestId('wi-description-editor')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Edited description');
        expect(mockUpdate).toHaveBeenCalledTimes(1);
    });

    it('AC-02 conflict UI: applies per-field choices and retries through the normal PATCH save', async () => {
        mockUpdate
            .mockRejectedValueOnce(makeConflictError())
            .mockImplementationOnce(async (_ws: string, _id: string, updates: any) => ({ ...baseItem, ...updates, title: updates.title ?? baseItem.title }));
        renderDetail();
        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Edited title' } });
        const descEditor = within(screen.getByTestId('wi-description-editor')).getByRole('textbox');
        fireEvent.change(descEditor, { target: { value: 'Edited description' } });
        fireEvent.change(screen.getByTestId('wi-tags-input'), { target: { value: 'alpha, local' } });

        fireEvent.keyDown(window, { key: 's', ctrlKey: true });

        const panel = await screen.findByTestId('wi-sync-conflict-panel');
        fireEvent.click(within(panel).getByText('Remote title'));
        fireEvent.click(within(panel).getByText('alpha, remote'));
        fireEvent.click(within(panel).getByTestId('wi-sync-conflict-apply'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));
        const [, , retryUpdates] = mockUpdate.mock.calls[1];
        expect(retryUpdates).toMatchObject({
            title: 'Remote title',
            description: 'Edited description',
            tags: ['alpha', 'remote'],
            syncConflictResolution: {
                provider: 'github',
                acknowledgedRemoteUpdatedAt: '2026-06-05T10:05:00.000Z',
            },
        });
        expect(screen.queryByTestId('wi-sync-conflict-panel')).toBeNull();
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

    it('AC-02 regression: switching from a loaded Epic to a Feature initializes and saves the Feature draft only', async () => {
        const featureDetail = deferred<any>();
        const epic = makeItem({
            id: 'epic-1',
            title: 'Epic title',
            description: 'Epic description',
            status: 'created',
            type: 'epic',
            priority: 'high',
            tags: ['epic-tag'],
        });
        const feature = makeItem({
            id: 'feature-1',
            title: 'Feature title',
            description: 'Feature description',
            status: 'planning',
            type: 'feature',
            parentId: 'epic-1',
            priority: 'low',
            tags: ['feature-tag'],
        });
        mockGet.mockImplementation((_ws: string, id: string) => {
            if (id === 'epic-1') return Promise.resolve(epic);
            if (id === 'feature-1') return featureDetail.promise;
            return Promise.resolve({ ...baseItem, id });
        });
        mockUpdate.mockImplementation(async (_ws: string, id: string, updates: any) => ({ ...feature, id, ...updates }));

        const { rerender } = render(
            <WorkItemDetail workItemId="epic-1" workspaceId="ws-1" onBack={vi.fn()} />
        );
        expect((await screen.findByTestId('wi-title-input') as HTMLInputElement).value).toBe('Epic title');

        rerender(<WorkItemDetail workItemId="feature-1" workspaceId="ws-1" onBack={vi.fn()} />);
        featureDetail.resolve(feature);

        await waitFor(() => {
            expect((screen.getByTestId('wi-title-input') as HTMLInputElement).value).toBe('Feature title');
        });
        expect((within(screen.getByTestId('wi-description-editor')).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Feature description');
        expect((screen.getByTestId('wi-priority-select') as HTMLSelectElement).value).toBe('low');
        expect((screen.getByTestId('work-item-status-select') as HTMLSelectElement).value).toBe('planning');
        expect(screen.getByTestId('work-item-parent-info').textContent).toContain('epic-1');
        expect((screen.getByTestId('wi-tags-input') as HTMLInputElement).value).toBe('feature-tag');
        expect(screen.queryByTestId('wi-dirty-indicator')).toBeNull();
        expect(screen.getByTestId('wi-save-btn').hasAttribute('disabled')).toBe(true);

        fireEvent.change(screen.getByTestId('wi-title-input'), { target: { value: 'Edited feature title' } });
        expect(screen.getByTestId('wi-dirty-indicator')).toBeTruthy();
        fireEvent.click(screen.getByTestId('wi-save-btn'));

        await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
        expect(mockUpdate.mock.calls[0][0]).toBe('ws-1');
        expect(mockUpdate.mock.calls[0][1]).toBe('feature-1');
        expect(mockUpdate.mock.calls[0][2]).toEqual({ title: 'Edited feature title' });
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
