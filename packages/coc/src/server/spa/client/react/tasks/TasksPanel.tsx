/**
 * TasksPanel — top-level component for the Tasks sub-tab.
 * Renders a two-zone flex layout: left = TaskTree, right = TaskPreview.
 */

import { useEffect, useRef, useState } from 'react';
import { TaskProvider, useTaskPanel } from '../context/TaskContext';
import { useTaskTree } from '../hooks/useTaskTree';
import { TaskTree } from './TaskTree';
import { TaskPreview } from './TaskPreview';
import { TaskActions } from './TaskActions';
import { Spinner } from '../shared';

interface TasksPanelProps {
    wsId: string;
}

export function parseTaskHashParams(hash: string, wsId: string) {
    const parts = hash.replace(/^#/, '').split('/');
    if (parts[0] !== 'repos' || decodeURIComponent(parts[1] || '') !== wsId || parts[2] !== 'tasks')
        return { initialFolderPath: null, initialFilePath: null };
    const taskParts = parts.slice(3).map(p => decodeURIComponent(p)).filter(Boolean);
    if (!taskParts.length) return { initialFolderPath: null, initialFilePath: null };
    const last = taskParts[taskParts.length - 1];
    if (last.endsWith('.md')) {
        return {
            initialFolderPath: taskParts.slice(0, -1).join('/') || null,
            initialFilePath: taskParts.join('/'),
        };
    }
    return { initialFolderPath: taskParts.join('/'), initialFilePath: null };
}

function scrollToEnd(el: HTMLElement | null) {
    if (!el) return;
    requestAnimationFrame(() => {
        const target = el.scrollWidth - el.clientWidth;
        if (typeof el.scrollTo === 'function') {
            el.scrollTo({ left: target, behavior: 'smooth' });
        } else {
            el.scrollLeft = target;
        }
    });
}

function TasksPanelInner({ wsId }: TasksPanelProps) {
    const { tree, commentCounts, loading, error } = useTaskTree(wsId);
    const { openFilePath, selectedFilePaths, clearSelection } = useTaskPanel();
    const [initialParams] = useState(() => parseTaskHashParams(location.hash, wsId));
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        scrollToEnd(scrollRef.current);
    }, [openFilePath]);

    const handleColumnsChange = () => {
        scrollToEnd(scrollRef.current);
    };

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
            <div
                ref={scrollRef}
                className="flex-1 overflow-x-auto overflow-y-hidden min-h-0 min-w-0"
                data-testid="tasks-miller-scroll-container"
            >
                <div className="flex h-full min-h-0 w-max min-w-full">
                    <div className="flex-shrink-0 h-full min-h-0">
                        <TaskTree
                            tree={tree}
                            commentCounts={commentCounts}
                            wsId={wsId}
                            initialFolderPath={initialParams.initialFolderPath}
                            initialFilePath={initialParams.initialFilePath}
                            onColumnsChange={handleColumnsChange}
                        />
                    </div>

                    {openFilePath && (
                        <div className="h-full min-h-0 min-w-[72rem] w-[72rem] max-w-[72rem] border-r border-[#e0e0e0] dark:border-[#3c3c3c]">
                            <TaskPreview wsId={wsId} filePath={openFilePath} />
                        </div>
                    )}
                </div>
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
