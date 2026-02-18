/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { TaskProvider, useTaskPanel } from '../context/TaskContext';
import { useTaskTree } from '../hooks/useTaskTree';
import { TaskTree } from './TaskTree';
import { TaskPreview } from './TaskPreview';
import { TaskActions } from './TaskActions';
import { Spinner } from '../shared';

interface TasksPanelProps {
    wsId: string;
}

function TasksPanelInner({ wsId }: TasksPanelProps) {
    const { tree, commentCounts, loading, error } = useTaskTree(wsId);
    const { openFilePath, selectedFilePaths, clearSelection } = useTaskPanel();

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full gap-2 text-sm text-[#848484]">
                <Spinner /> Loading tasks…
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-[#f14c4c]" data-testid="tasks-error">
                {error}
            </div>
        );
    }

    if (!tree) {
        return (
            <div className="p-4 text-sm text-[#848484]">
                No tasks folder found. Create a <code>.vscode/tasks/</code> directory to get started.
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <TaskActions
                wsId={wsId}
                openFilePath={openFilePath}
                selectedFilePaths={Array.from(selectedFilePaths)}
                tasksFolderPath=".vscode/tasks"
                onClearSelection={clearSelection}
            />
            <div className="flex flex-1 overflow-hidden">
                <div className="flex-shrink-0 overflow-x-auto border-r border-[#e0e0e0] dark:border-[#3c3c3c]">
                    <TaskTree tree={tree} commentCounts={commentCounts} wsId={wsId} />
                </div>
                {openFilePath && (
                    <div className="flex-1 overflow-hidden">
                        <TaskPreview wsId={wsId} filePath={openFilePath} />
                    </div>
                )}
            </div>
        </div>
    );
}

export function TasksPanel({ wsId }: TasksPanelProps) {
    return (
        <TaskProvider>
            <TasksPanelInner wsId={wsId} />
        </TaskProvider>
    );
}
