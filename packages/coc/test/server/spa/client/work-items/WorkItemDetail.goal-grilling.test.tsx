/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    update: vi.fn(),
    createChatBinding: vi.fn(),
    delete: vi.fn(),
    queueEnqueue: vi.fn(),
    workflowEnabled: true,
    aiAuthoringEnabled: false,
    hierarchyEnabled: false,
    toggleChat: vi.fn(),
    restoreChat: vi.fn(),
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
        toggleChat: mocks.toggleChat,
        closeChat: vi.fn(),
        minimizeChat: vi.fn(),
        restoreChat: mocks.restoreChat,
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
    WorkItemDescriptionEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
        <textarea data-testid="mock-description-editor" value={value} onChange={event => onChange(event.currentTarget.value)} />
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

const BASE_GOAL = {
    id: 'goal-1',
    repoId: 'ws-1',
    workItemNumber: 7,
    title: 'Ship durable goals',
    description: 'Make Goals durable',
    status: 'created',
    type: 'goal',
    source: 'manual',
    priority: 'normal',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    successCriteria: 'Users can resume grilling',
    plan: undefined,
    tracker: { kind: 'local-only' },
};

describe('WorkItemDetail Goal grilling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.workflowEnabled = true;
        mocks.aiAuthoringEnabled = false;
        mocks.hierarchyEnabled = false;
        mocks.get.mockResolvedValue(BASE_GOAL);
        mocks.update.mockResolvedValue({
            ...BASE_GOAL,
            status: 'drafting',
            grillSessionId: 'queue_grill-task-1',
            updatedAt: '2026-01-01T00:00:01.000Z',
        });
        mocks.createChatBinding.mockResolvedValue({ workItemId: 'goal-1', taskId: 'grill-task-1' });
        mocks.queueEnqueue.mockResolvedValue({ task: { id: 'grill-task-1' } });
    });

    afterEach(() => {
        cleanup();
    });

    it('starts a Work-Item-bound Ralph grilling chat for a local Goal', async () => {
        render(<WorkItemDetail workspaceId="ws-1" workItemId="goal-1" />);

        fireEvent.click(await screen.findByTestId('work-item-goal-grilling-btn'));

        await waitFor(() => expect(mocks.queueEnqueue).toHaveBeenCalledTimes(1));
        const enqueueRequest = mocks.queueEnqueue.mock.calls[0][0];
        expect(enqueueRequest.payload).toMatchObject({
            kind: 'chat',
            mode: 'ask',
            workspaceId: 'ws-1',
            context: {
                skills: ['grill-me'],
                ralph: expect.objectContaining({ phase: 'grilling' }),
                workItemGoalGrilling: {
                    workspaceId: 'ws-1',
                    workItemId: 'goal-1',
                    title: 'Ship durable goals',
                    contentVersion: null,
                },
                workItemChat: {
                    workspaceId: 'ws-1',
                    workItemId: 'goal-1',
                    workItemNumber: 7,
                    status: 'created',
                    type: 'goal',
                },
            },
        });
        expect(enqueueRequest.payload.prompt).toContain('Goal title: Ship durable goals');
        expect(enqueueRequest.payload.prompt).toContain('Current success criteria');
        expect(mocks.createChatBinding).toHaveBeenCalledWith('ws-1', 'goal-1', 'grill-task-1');
        expect(mocks.update).toHaveBeenCalledWith('ws-1', 'goal-1', {
            grillSessionId: 'queue_grill-task-1',
            status: 'drafting',
        });
        expect(mocks.toggleChat).toHaveBeenCalledTimes(1);
    });

    it('hides Goal grilling when the workflow flag is disabled', async () => {
        mocks.workflowEnabled = false;

        render(<WorkItemDetail workspaceId="ws-1" workItemId="goal-1" />);

        await screen.findByTestId('wi-title-input');
        expect(screen.queryByTestId('work-item-goal-grilling-btn')).toBeNull();
    });
});
