/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';

const mocks = vi.hoisted(() => ({
    planVersions: vi.fn(),
    getPlanVersion: vi.fn(),
    comparePlanVersions: vi.fn(),
    restorePlanVersion: vi.fn(),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            planVersions: mocks.planVersions,
            getPlanVersion: mocks.getPlanVersion,
            comparePlanVersions: mocks.comparePlanVersions,
            restorePlanVersion: mocks.restorePlanVersion,
        },
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useMarkdownPreview', () => ({
    useMarkdownPreview: ({ content }: { content: string }) => ({
        html: `<pre>${content}</pre>`,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/tasks/hooks/useTaskComments', () => ({
    useTaskComments: () => ({
        comments: [],
        loading: false,
        addComment: vi.fn(),
        updateComment: vi.fn(),
        deleteComment: vi.fn(),
        resolveComment: vi.fn(),
        unresolveComment: vi.fn(),
        askAI: vi.fn(),
        aiLoadingIds: new Set(),
        aiErrors: new Map(),
        clearAiError: vi.fn(),
        resolvingIds: new Set(),
        deletingIds: new Set(),
    }),
}));

import { WorkItemPlanSection } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection';

const CURRENT_PLAN = {
    version: 2,
    currentVersion: 2,
    content: 'one\nTWO\nthree',
    updatedAt: '2026-01-01T00:00:02.000Z',
    resolvedBy: 'user',
};

function renderSection(props: Partial<ComponentProps<typeof WorkItemPlanSection>> = {}) {
    const onUpdated = vi.fn();
    const onError = vi.fn();
    render(
        <WorkItemPlanSection
            workspaceId="ws-1"
            workItemId="wi-1"
            plan={CURRENT_PLAN}
            canEdit={true}
            draftContent={CURRENT_PLAN.content}
            onDraftChange={vi.fn()}
            onUpdated={onUpdated}
            onError={onError}
            viewMode="preview"
            onViewModeChange={vi.fn()}
            enableVersionActions={true}
            hasUnsavedChanges={false}
            {...props}
        />,
    );
    return { onUpdated, onError };
}

describe('WorkItemPlanSection version actions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.planVersions.mockResolvedValue([
            {
                version: 1,
                createdAt: '2026-01-01T00:00:01.000Z',
                resolvedBy: 'ai',
                summary: 'Initial AI draft',
            },
            {
                version: 2,
                createdAt: '2026-01-01T00:00:02.000Z',
                resolvedBy: 'user',
                summary: 'User edits',
            },
        ]);
        mocks.getPlanVersion.mockResolvedValue({
            version: 1,
            content: 'one\ntwo\nthree',
            createdAt: '2026-01-01T00:00:01.000Z',
            resolvedBy: 'ai',
            summary: 'Initial AI draft',
        });
        mocks.comparePlanVersions.mockResolvedValue({
            base: {
                version: 1,
                content: 'one\ntwo\nthree',
                createdAt: '2026-01-01T00:00:01.000Z',
                summary: 'Initial AI draft',
            },
            target: {
                version: 2,
                content: 'one\nTWO\nthree',
                createdAt: '2026-01-01T00:00:02.000Z',
                summary: 'User edits',
            },
            diff: [
                { type: 'equal', lines: ['one'] },
                { type: 'removed', lines: ['two'] },
                { type: 'added', lines: ['TWO'] },
                { type: 'equal', lines: ['three'] },
            ],
        });
        mocks.restorePlanVersion.mockResolvedValue({
            version: 3,
            restoredFromVersion: 1,
            plan: {
                version: 3,
                content: 'one\ntwo\nthree',
                createdAt: '2026-01-01T00:00:03.000Z',
                restoredFromVersion: 1,
            },
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('compares a selected historical version against the current version', async () => {
        renderSection();

        fireEvent.click(await screen.findByTestId('plan-version-tab-1'));
        await waitFor(() => expect(mocks.getPlanVersion).toHaveBeenCalledWith('ws-1', 'wi-1', 1));

        fireEvent.click(screen.getByTestId('plan-version-compare-btn'));

        await waitFor(() => expect(mocks.comparePlanVersions).toHaveBeenCalledWith('ws-1', 'wi-1', 1, 2));
        expect(screen.getByTestId('plan-version-compare-body').textContent).toContain('Base v1');
        expect(screen.getByTestId('plan-version-compare-body').textContent).toContain('Current v2');
        expect(screen.getByTestId('plan-version-compare-diff').textContent).toContain('- two');
        expect(screen.getByTestId('plan-version-compare-diff').textContent).toContain('+ TWO');
    });

    it('restores a selected historical version by creating a new current version', async () => {
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { onUpdated } = renderSection();

        fireEvent.click(await screen.findByTestId('plan-version-tab-1'));
        await screen.findByText('"Initial AI draft"');
        fireEvent.click(screen.getByTestId('plan-version-restore-btn'));

        await waitFor(() => expect(mocks.restorePlanVersion).toHaveBeenCalledWith('ws-1', 'wi-1', 1, {
            reason: 'Restored plan v1 from version history',
            summary: 'Restored plan v1',
        }));
        expect(confirmSpy).toHaveBeenCalledWith('Restore plan v1 as a new current version?');
        expect(onUpdated).toHaveBeenCalledTimes(1);
    });

    it('hides workflow-only version actions when disabled', async () => {
        renderSection({ enableVersionActions: false });

        fireEvent.click(await screen.findByTestId('plan-version-tab-1'));

        expect(screen.queryByTestId('plan-version-compare-btn')).toBeNull();
        expect(screen.queryByTestId('plan-version-restore-btn')).toBeNull();
    });

    it('does not restore while the parent detail has unsaved changes', async () => {
        renderSection({ hasUnsavedChanges: true });

        fireEvent.click(await screen.findByTestId('plan-version-tab-1'));
        const restoreButton = await screen.findByTestId('plan-version-restore-btn');

        expect((restoreButton as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(restoreButton);
        expect(mocks.restorePlanVersion).not.toHaveBeenCalled();
    });
});
