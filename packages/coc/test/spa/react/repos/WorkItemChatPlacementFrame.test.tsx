import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../../src/server/spa/client/react/features/work-items/WorkItemChatPanel', () => ({
    getWorkItemChatIdentifier: (workItemId: string, workItemNumber?: number, type?: string) => (
        workItemNumber != null ? `${type === 'bug' ? 'BUG' : 'WI'}-${workItemNumber}` : workItemId
    ),
    WorkItemChatPanel: (props: any) => (
        <div
            data-testid="work-item-chat-panel"
            data-workspace-id={props.workspaceId}
            data-work-item-id={props.workItemId}
            data-title={props.title ?? ''}
            data-has-unsaved={props.hasUnsavedChanges ? 'true' : 'false'}
            data-hide-empty-header={props.hideEmptyHeader ? 'true' : 'false'}
        />
    ),
}));

import { WorkItemChatPlacementFrame } from '../../../../src/server/spa/client/react/features/work-items/WorkItemChatPlacementFrame';

describe('WorkItemChatPlacementFrame', () => {
    it('renders a bottom-right Work Item chat lens with close, minimize, and pin controls', () => {
        const onClose = vi.fn();
        const onMinimize = vi.fn();
        const onPin = vi.fn();

        render(
            <WorkItemChatPlacementFrame
                workspaceId="ws-1"
                workItemId="wi-1"
                workItemNumber={7}
                title="Saved title"
                type="bug"
                hasUnsavedChanges
                presentation="lens"
                onClose={onClose}
                onMinimize={onMinimize}
                onPin={onPin}
            />,
        );

        const lens = screen.getByTestId('work-item-chat-lens');
        expect(lens.className).toContain('absolute');
        expect(lens.className).toContain('bottom-4');
        expect(screen.getByTestId('work-item-chat-lens-resize-grip')).toHaveClass('cursor-nwse-resize');
        expect(screen.getByTestId('work-item-chat-lens-header')).toHaveTextContent('Work Item Chat');
        expect(screen.getByTestId('work-item-chat-lens-header')).toHaveTextContent('BUG-7');
        expect(screen.getByTestId('work-item-chat-panel').getAttribute('data-hide-empty-header')).toBe('true');
        expect(screen.getByTestId('work-item-chat-panel').getAttribute('data-has-unsaved')).toBe('true');

        fireEvent.click(screen.getByTestId('work-item-chat-minimize-btn'));
        fireEvent.click(screen.getByTestId('work-item-chat-pin-btn'));
        fireEvent.click(screen.getByTestId('work-item-chat-frame-close-btn'));

        expect(onMinimize).toHaveBeenCalledOnce();
        expect(onPin).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('keeps the chat tree mounted while the lens is minimized', () => {
        const onRestore = vi.fn();

        render(
            <WorkItemChatPlacementFrame
                workspaceId="ws-1"
                workItemId="wi-1"
                workItemNumber={7}
                type="bug"
                presentation="lens"
                onClose={() => {}}
                isMinimized
                onRestore={onRestore}
            />,
        );

        expect(screen.getByTestId('work-item-chat-lens-minimized')).toHaveTextContent('Work Item Chat');
        expect(screen.getByTestId('work-item-chat-lens-minimized')).toHaveTextContent('BUG-7');
        expect(screen.getByTestId('work-item-chat-lens-hidden-body')).toHaveClass('hidden');
        expect(screen.getByTestId('work-item-chat-panel')).toBeTruthy();

        fireEvent.click(screen.getByTestId('work-item-chat-restore-btn'));

        expect(onRestore).toHaveBeenCalledOnce();
    });

    it('renders a side-panel frame with an unpin action', () => {
        const onUnpin = vi.fn();

        render(
            <WorkItemChatPlacementFrame
                workspaceId="ws-1"
                workItemId="wi-1"
                presentation="side-panel"
                onClose={() => {}}
                onUnpin={onUnpin}
            />,
        );

        expect(screen.getByTestId('work-item-chat-side-panel')).toBeTruthy();
        expect(screen.queryByTestId('work-item-chat-lens-resize-grip')).toBeNull();
        fireEvent.click(screen.getByTestId('work-item-chat-unpin-btn'));
        expect(onUnpin).toHaveBeenCalledOnce();
    });
});
