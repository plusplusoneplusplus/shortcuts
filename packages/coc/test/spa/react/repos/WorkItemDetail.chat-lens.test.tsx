import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { configMocks, breakpointState } = vi.hoisted(() => ({
    configMocks: {
        isCommitChatLensEnabled: vi.fn(() => true),
    },
    breakpointState: {
        current: { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' },
    },
}));

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateStatus = vi.fn();
const mockPin = vi.fn();
const mockArchive = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workItems: {
            get: (...args: any[]) => mockGet(...args),
            update: (...args: any[]) => mockUpdate(...args),
            updateStatus: (...args: any[]) => mockUpdateStatus(...args),
            pin: (...args: any[]) => mockPin(...args),
            archive: (...args: any[]) => mockArchive(...args),
            delete: (...args: any[]) => mockDelete(...args),
        },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => breakpointState.current,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isWorkItemsHierarchyEnabled: () => false,
    isWorkItemsAiAuthoringEnabled: () => false,
    isCommitChatLensEnabled: configMocks.isCommitChatLensEnabled,
}));

const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/WorkItemContext', () => ({
    useWorkItems: () => ({ state: { workItemsByRepo: {} }, dispatch: mockDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn(async () => ({ comments: [] })),
}));

vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useCommitCommentTotals', () => ({
    useCommitCommentTotals: () => new Map(),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemPlanSection', () => ({
    WorkItemPlanSection: () => null,
    PLAN_MODE_OPTIONS: Object.freeze([{ value: 'preview', label: 'Preview' }]),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemDescriptionEditor', () => ({
    WorkItemDescriptionEditor: ({ value, onChange }: any) => (
        <textarea data-testid="wi-description-editor" value={value} onChange={e => onChange(e.target.value)} />
    ),
    DESCRIPTION_MODE_OPTIONS: Object.freeze([{ value: 'source', label: 'Source' }]),
}));

vi.mock('../../../../src/server/spa/client/react/ui/ModeToggleToolbar', () => ({
    ModeToggleToolbar: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemExecuteDialog', () => ({
    WorkItemExecuteDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemAiComposer', () => ({
    WorkItemAiComposer: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemParentPicker', () => ({
    WorkItemParentPicker: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemGitHubMirrorBadge', () => ({
    WorkItemRemoteMirrorBadge: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemChatPlacementFrame', () => ({
    WorkItemChatPlacementFrame: (props: any) => (
        <div
            data-testid={`work-item-chat-${props.presentation}`}
            data-workspace-id={props.workspaceId}
            data-work-item-id={props.workItemId}
            data-title={props.title}
            data-unsaved={props.hasUnsavedChanges ? 'true' : 'false'}
            data-minimized={props.isMinimized ? 'true' : 'false'}
        >
            <button type="button" data-testid="mock-chat-minimize" onClick={props.onMinimize}>minimize</button>
            <button type="button" data-testid="mock-chat-restore" onClick={props.onRestore}>restore</button>
            <button type="button" data-testid="mock-chat-pin" onClick={props.onPin}>pin</button>
            <button type="button" data-testid="mock-chat-unpin" onClick={props.onUnpin}>unpin</button>
            <button type="button" data-testid="mock-chat-close" onClick={props.onClose}>close</button>
        </div>
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemChatPanel', () => ({
    WorkItemChatPanel: (props: any) => (
        <div
            data-testid="work-item-chat-panel-fallback"
            data-workspace-id={props.workspaceId}
            data-work-item-id={props.workItemId}
            data-unsaved={props.hasUnsavedChanges ? 'true' : 'false'}
        />
    ),
}));

import { WorkItemDetail } from '../../../../src/server/spa/client/react/features/work-items/WorkItemDetail';
import {
    getReviewChatMinimizedStorageKey,
    getReviewChatOpenStorageKey,
    getReviewChatPlacementStorageKey,
} from '../../../../src/server/spa/client/react/features/git/commits/commitChatPlacement';

const baseItem = {
    id: 'wi-1',
    workItemNumber: 7,
    title: 'Saved title one',
    description: 'Saved description',
    status: 'planning',
    type: 'bug',
    priority: 'normal',
    tags: [],
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z',
};

function makeItem(id: string, title: string, workItemNumber: number) {
    return {
        ...baseItem,
        id,
        title,
        workItemNumber,
    };
}

describe('WorkItemDetail Work Item chat lens', () => {
    let itemsById: Map<string, ReturnType<typeof makeItem>>;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        configMocks.isCommitChatLensEnabled.mockReturnValue(true);
        breakpointState.current = { isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' };
        itemsById = new Map([
            ['wi-1', makeItem('wi-1', 'Saved title one', 7)],
            ['wi-2', makeItem('wi-2', 'Saved title two', 8)],
        ]);
        mockGet.mockImplementation(async (_workspaceId: string, workItemId: string) => {
            return itemsById.get(workItemId) ?? makeItem(workItemId, 'Saved title one', 7);
        });
        mockUpdate.mockImplementation(async (_workspaceId: string, workItemId: string, updates: any) => {
            const updated = {
                ...(itemsById.get(workItemId) ?? makeItem(workItemId, 'Saved title one', 7)),
                ...updates,
            };
            itemsById.set(workItemId, updated);
            return updated;
        });
    });

    afterEach(() => {
        cleanup();
        localStorage.clear();
    });

    it('opens Ask AI as a Work Item-scoped lens and warns when edits are unsaved', async () => {
        render(<WorkItemDetail workItemId="wi-1" workspaceId="ws-1" onBack={vi.fn()} />);

        const title = await screen.findByTestId('wi-title-input');
        fireEvent.change(title, { target: { value: 'Unsaved title' } });
        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        const target = { type: 'work-item' as const, workspaceId: 'ws-1', workItemId: 'wi-1' };
        await waitFor(() => expect(screen.getByTestId('work-item-chat-lens')).toBeTruthy());
        expect(localStorage.getItem(getReviewChatOpenStorageKey(target))).toBe('true');
        expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-work-item-id')).toBe('wi-1');
        expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-title')).toBe('Saved title one');
        expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-unsaved')).toBe('true');

        fireEvent.click(screen.getByTestId('wi-save-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-unsaved')).toBe('false');
        });
    });

    it('scopes open, minimized, pinned, and selection state by workspace and Work Item', async () => {
        const { rerender } = render(<WorkItemDetail workItemId="wi-1" workspaceId="ws-1" onBack={vi.fn()} />);

        await screen.findByTestId('work-item-ask-ai-btn');
        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        const targetOne = { type: 'work-item' as const, workspaceId: 'ws-1', workItemId: 'wi-1' };
        await waitFor(() => expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-work-item-id')).toBe('wi-1'));

        fireEvent.click(screen.getByTestId('mock-chat-minimize'));
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetOne))).toBe('true');
        expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-minimized')).toBe('true');

        fireEvent.click(screen.getByTestId('mock-chat-pin'));
        expect(localStorage.getItem(getReviewChatPlacementStorageKey(targetOne))).toBe('side-panel');
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetOne))).toBeNull();
        expect(screen.getByTestId('work-item-chat-side-panel').getAttribute('data-work-item-id')).toBe('wi-1');

        fireEvent.click(screen.getByTestId('mock-chat-unpin'));
        expect(localStorage.getItem(getReviewChatPlacementStorageKey(targetOne))).toBeNull();
        expect(screen.getByTestId('work-item-chat-lens')).toBeTruthy();

        rerender(<WorkItemDetail workItemId="wi-2" workspaceId="ws-1" onBack={vi.fn()} />);

        await waitFor(() => expect(screen.queryByTestId('work-item-chat-lens')).toBeNull());
        expect(localStorage.getItem(getReviewChatOpenStorageKey(targetOne))).toBe('true');

        fireEvent.click(await screen.findByTestId('work-item-ask-ai-btn'));
        const targetTwo = { type: 'work-item' as const, workspaceId: 'ws-1', workItemId: 'wi-2' };
        await waitFor(() => expect(screen.getByTestId('work-item-chat-lens').getAttribute('data-work-item-id')).toBe('wi-2'));
        expect(localStorage.getItem(getReviewChatOpenStorageKey(targetTwo))).toBe('true');
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetTwo))).toBeNull();
    });

    it('closes a minimized Work Item chat without clearing another Work Item lens state', async () => {
        render(<WorkItemDetail workItemId="wi-1" workspaceId="ws-1" onBack={vi.fn()} />);

        const targetOne = { type: 'work-item' as const, workspaceId: 'ws-1', workItemId: 'wi-1' };
        const targetTwo = { type: 'work-item' as const, workspaceId: 'ws-1', workItemId: 'wi-2' };

        fireEvent.click(await screen.findByTestId('work-item-ask-ai-btn'));
        await waitFor(() => expect(screen.getByTestId('work-item-chat-lens')).toBeTruthy());

        fireEvent.click(screen.getByTestId('mock-chat-minimize'));
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetOne))).toBe('true');
        localStorage.setItem(getReviewChatMinimizedStorageKey(targetTwo), 'true');

        fireEvent.click(screen.getByTestId('mock-chat-close'));

        await waitFor(() => expect(screen.queryByTestId('work-item-chat-lens')).toBeNull());
        expect(localStorage.getItem(getReviewChatOpenStorageKey(targetOne))).toBe('false');
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetOne))).toBeNull();
        expect(localStorage.getItem(getReviewChatMinimizedStorageKey(targetTwo))).toBe('true');

        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        await waitFor(() => {
            expect(screen.getByTestId('work-item-chat-lens')).toHaveAttribute('data-work-item-id', 'wi-1');
        });
        expect(screen.getByTestId('work-item-chat-lens')).toHaveAttribute('data-minimized', 'false');
    });

    it('keeps the lens presentation on non-desktop viewports when the feature flag is enabled', async () => {
        breakpointState.current = { isMobile: true, isTablet: false, isDesktop: false, breakpoint: 'mobile' };
        render(<WorkItemDetail workItemId="wi-1" workspaceId="ws-1" isMobile onBack={vi.fn()} />);

        await screen.findByTestId('work-item-ask-ai-btn');
        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        await waitFor(() => expect(screen.getByTestId('work-item-chat-lens')).toBeTruthy());
        expect(screen.queryByTestId('work-item-chat-side-panel')).toBeNull();
    });

    it('uses the non-lens fallback panel when the commit chat lens flag is disabled', async () => {
        configMocks.isCommitChatLensEnabled.mockReturnValue(false);
        const { rerender } = render(<WorkItemDetail workItemId="wi-1" workspaceId="ws-1" onBack={vi.fn()} />);

        await screen.findByTestId('work-item-ask-ai-btn');
        fireEvent.click(screen.getByTestId('work-item-ask-ai-btn'));

        await waitFor(() => expect(screen.getByTestId('work-item-chat-panel-fallback')).toBeTruthy());
        expect(screen.queryByTestId('work-item-chat-lens')).toBeNull();

        rerender(<WorkItemDetail workItemId="wi-2" workspaceId="ws-1" onBack={vi.fn()} />);

        await waitFor(() => expect(screen.queryByTestId('work-item-chat-panel-fallback')).toBeNull());
    });
});
