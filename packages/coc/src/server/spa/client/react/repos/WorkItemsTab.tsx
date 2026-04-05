/**
 * WorkItemsTab — sub-tab for managing work items within a repository.
 * Replaces the Plans tab with a list + detail split view.
 */

import { useState, useCallback } from 'react';
import { Button, cn } from '../shared';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useResizablePanel } from '../hooks/useResizablePanel';
import { WorkItemSection } from './WorkItemSection';
import { WorkItemDetail } from './WorkItemDetail';
import { WorkItemExecutionSession } from './WorkItemExecutionSession';
import { CreateWorkItemDialog } from './CreateWorkItemDialog';
import { useWorkItems } from '../context/WorkItemContext';

export interface WorkItemsTabProps {
    workspaceId: string;
}

export function WorkItemsTab({ workspaceId }: WorkItemsTabProps) {
    const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
    const [selectedSessionTaskId, setSelectedSessionTaskId] = useState<string | null>(null);
    const [showCreateDialog, setShowCreateDialog] = useState(false);
    const [mobileShowDetail, setMobileShowDetail] = useState(false);
    const { isMobile, isTablet } = useBreakpoint();
    const { dispatch } = useWorkItems();
    const { width: leftPanelWidth, isDragging, handleMouseDown, handleTouchStart } = useResizablePanel({
        initialWidth: isTablet ? 280 : 340,
        minWidth: 200,
        maxWidth: 600,
        storageKey: 'work-items-left-panel-width',
    });

    const handleSelectWorkItem = useCallback((id: string) => {
        setSelectedWorkItemId(id);
        setSelectedSessionTaskId(null);
        if (isMobile) setMobileShowDetail(true);
    }, [isMobile]);

    const handleBack = useCallback(() => {
        setSelectedWorkItemId(null);
        setSelectedSessionTaskId(null);
        setMobileShowDetail(false);
    }, []);

    const handleBackFromSession = useCallback(() => {
        setSelectedSessionTaskId(null);
    }, []);

    const handleViewTask = useCallback((taskId: string) => {
        setSelectedSessionTaskId(taskId);
    }, []);

    const handleCreated = useCallback((item: any) => {
        dispatch({ type: 'WORK_ITEM_ADDED', repoId: workspaceId, item });
        setSelectedWorkItemId(item.id);
        setSelectedSessionTaskId(null);
        if (isMobile) setMobileShowDetail(true);
    }, [dispatch, workspaceId, isMobile]);

    const handleExecuted = useCallback(() => {
        // Refresh work items after execution
        dispatch({ type: 'SET_LOADING', repoId: workspaceId, loading: true });
    }, [dispatch, workspaceId]);

    const listPane = (
        <div className="p-4 flex flex-col gap-3 overflow-y-auto flex-1">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Work Items</h2>
                <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(true)} data-testid="create-work-item-btn">
                    + New
                </Button>
            </div>
            <WorkItemSection
                workspaceId={workspaceId}
                onSelectWorkItem={handleSelectWorkItem}
                selectedWorkItemId={selectedWorkItemId}
            />
        </div>
    );

    const detailPane = selectedWorkItemId ? (
        selectedSessionTaskId ? (
            <WorkItemExecutionSession
                taskId={selectedSessionTaskId}
                workspaceId={workspaceId}
                onBack={handleBackFromSession}
            />
        ) : (
            <WorkItemDetail
                workItemId={selectedWorkItemId}
                workspaceId={workspaceId}
                onBack={handleBack}
                onExecuted={handleExecuted}
                onViewTask={handleViewTask}
            />
        )
    ) : (
        <div className="flex items-center justify-center h-full text-sm text-[#848484]">
            <div className="text-center space-y-2">
                <div className="text-3xl">📋</div>
                <div>Select a work item or create a new one</div>
                <Button variant="ghost" size="sm" onClick={() => setShowCreateDialog(true)}>
                    + Create Work Item
                </Button>
            </div>
        </div>
    );

    if (isMobile) {
        return (
            <>
                <div className="flex flex-col h-full overflow-hidden" data-testid="work-items-panel">
                    {mobileShowDetail && selectedWorkItemId ? (
                        <div className="flex-1 flex flex-col overflow-hidden">{detailPane}</div>
                    ) : (
                        <div className="flex-1 flex flex-col overflow-hidden">{listPane}</div>
                    )}
                </div>
                <CreateWorkItemDialog
                    open={showCreateDialog}
                    onClose={() => setShowCreateDialog(false)}
                    workspaceId={workspaceId}
                    onCreated={handleCreated}
                />
            </>
        );
    }

    return (
        <>
            <div className={cn('flex h-full overflow-hidden', isDragging && 'select-none')} data-testid="work-items-panel">
                <div
                    className="flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                    style={{ width: leftPanelWidth }}
                >
                    {listPane}
                </div>
                <div
                    className="flex items-center justify-center w-1 cursor-col-resize hover:bg-[#007acc]/30 active:bg-[#007acc]/50 transition-colors flex-shrink-0"
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    role="separator"
                    aria-orientation="vertical"
                />
                <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
                    {detailPane}
                </div>
            </div>
            <CreateWorkItemDialog
                open={showCreateDialog}
                onClose={() => setShowCreateDialog(false)}
                workspaceId={workspaceId}
                onCreated={handleCreated}
            />
        </>
    );
}
