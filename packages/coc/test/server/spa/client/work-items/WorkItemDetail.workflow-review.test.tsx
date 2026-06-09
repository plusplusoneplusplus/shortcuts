/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    update: vi.fn(),
    updateStatus: vi.fn(),
    requestChanges: vi.fn(),
    createChatBinding: vi.fn(),
    delete: vi.fn(),
    queueEnqueue: vi.fn(),
    workflowEnabled: true,
    aiAuthoringEnabled: false,
    hierarchyEnabled: false,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsWorkflowEnabled: () => mocks.workflowEnabled,
    isWorkItemsAiAuthoringEnabled: () => mocks.aiAuthoringEnabled,
    isWorkItemsHierarchyEnabled: () => mocks.hierarchyEnabled,
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            get: mocks.get,
            update: mocks.update,
            updateStatus: mocks.updateStatus,
            requestChanges: mocks.requestChanges,
            createChatBinding: mocks.createChatBinding,
            delete: mocks.delete,
        },
        queue: {
            enqueue: mocks.queueEnqueue,
        },
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/hooks/useCommitCommentTotals', () => ({
    useCommitCommentTotals: () => new Map(),
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation', () => ({
    useReviewChatPresentation: () => ({
        chatOpen: false,
        toggleChat: vi.fn(),
        closeChat: vi.fn(),
        minimizeChat: vi.fn(),
        restoreChat: vi.fn(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        isPinned: false,
        isMinimized: false,
        presentation: 'lens',
        lensEnabled: true,
        isDesktop: true,
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: () => ({
        width: 360,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemDescriptionEditor', () => ({
    DESCRIPTION_MODE_OPTIONS: [{ id: 'source', label: 'Source' }],
    WorkItemDescriptionEditor: ({ value }: { value: string }) => (
        <textarea data-testid="mock-description-editor" value={value} readOnly />
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection', () => ({
    PLAN_MODE_OPTIONS: [{ id: 'preview', label: 'Preview' }],
    WorkItemPlanSection: () => <div data-testid="mock-plan-section" />,
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer', () => ({
    WorkItemAiComposer: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemAiDraftApplyDialog', () => ({
    WorkItemAiDraftApplyDialog: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemParentPicker', () => ({
    WorkItemParentPicker: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemChatPlacementFrame', () => ({
    WorkItemChatPlacementFrame: () => <div data-testid="mock-work-item-chat-frame" />,
}));

vi.mock('../../../../../src/server/spa/client/react/features/work-items/WorkItemChatPanel', () => ({
    WorkItemChatPanel: () => <div data-testid="mock-work-item-chat-panel" />,
}));

import { WorkItemDetail } from '../../../../../src/server/spa/client/react/features/work-items/WorkItemDetail';

const BASE_REVIEW_ITEM = {
    id: 'wi-review-1',
    repoId: 'ws-1',
    workItemNumber: 42,
    title: 'Ship review timeline',
    description: 'Show durable execution metadata',
    status: 'aiDone',
    type: 'work-item',
    source: 'manual',
    priority: 'normal',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    tracker: { kind: 'local-only' },
    currentContentVersion: 3,
    plan: {
        version: 3,
        currentVersion: 3,
        content: '## Plan\nReview the command center',
        updatedAt: '2026-01-01T00:00:01.000Z',
        resolvedBy: 'ai',
        source: 'ai',
    },
    taskId: 'task-review-1',
    processId: 'proc-review-1',
    executionHistory: [
        {
            taskId: 'task-review-1',
            processId: 'proc-review-1',
            planVersion: 3,
            startedAt: '2026-01-01T01:00:00.000Z',
            completedAt: '2026-01-01T01:05:00.000Z',
            status: 'completed',
            title: 'Ralph Implement',
            executionMode: 'ralph',
            ralphSessionId: 'ralph-review-1',
            aiSettings: {
                provider: 'claude',
                model: 'claude-sonnet-4.6',
                reasoningEffort: 'high',
            },
            skillNames: ['impl', 'code-review'],
        },
    ],
    changes: [
        {
            id: 'change-review-1',
            planVersion: 3,
            taskId: 'task-review-1',
            startedAt: '2026-01-01T01:00:00.000Z',
            completedAt: '2026-01-01T01:05:00.000Z',
            status: 'closed',
            commits: [
                {
                    sha: 'abcdef1234567890',
                    message: 'Implement review timeline',
                    author: 'Copilot',
                    date: '2026-01-01T01:04:00.000Z',
                },
            ],
        },
    ],
};

describe('WorkItemDetail workflow review command center', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workflowEnabled = true;
        mocks.aiAuthoringEnabled = false;
        mocks.hierarchyEnabled = false;
        mocks.get.mockResolvedValue(BASE_REVIEW_ITEM);
    });

    afterEach(() => {
        cleanup();
    });

    it('presents aiDone as Review and shows version-bound execution metadata when workflow is enabled', async () => {
        render(<WorkItemDetail workspaceId="ws-1" workItemId="wi-review-1" onViewTask={vi.fn()} onViewCommit={vi.fn()} />);

        const statusSelect = await screen.findByTestId('work-item-status-select') as HTMLSelectElement;
        expect(statusSelect.selectedOptions[0].textContent).toBe('Review');
        expect(screen.getByTestId('work-item-review-section').textContent).toContain('Review Required');
        expect(screen.getByTestId('work-item-review-run-summary').textContent).toContain('Latest run #1');
        expect(screen.getByTestId('work-item-review-run-summary').textContent).toContain('abcdef1');

        const timelineEntry = screen.getByTestId('exec-entry-0');
        expect(timelineEntry.textContent).toContain('Run #1: Ralph Implement');
        const metadata = within(timelineEntry).getByTestId('exec-metadata-0');
        expect(metadata.textContent).toContain('Version v3');
        expect(metadata.textContent).toContain('Ralph');
        expect(metadata.textContent).toContain('ralph-review-1');
        expect(metadata.textContent).toContain('Provider Claude');
        expect(metadata.textContent).toContain('Model claude-sonnet-4.6');
        expect(metadata.textContent).toContain('Effort high');
        expect(metadata.textContent).toContain('Skills impl, code-review');
    });

    it('preserves the legacy AI Done label when the workflow flag is disabled', async () => {
        mocks.workflowEnabled = false;

        render(<WorkItemDetail workspaceId="ws-1" workItemId="wi-review-1" />);

        const statusSelect = await screen.findByTestId('work-item-status-select') as HTMLSelectElement;
        expect(statusSelect.selectedOptions[0].textContent).toBe('AI Done');
        expect(screen.getByTestId('work-item-review-section').textContent).toContain('AI Done — Review Required');
        expect(screen.queryByTestId('work-item-review-run-summary')).toBeNull();
    });
});
