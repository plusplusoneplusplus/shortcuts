/**
 * TaskPreview — task panel wrapper for the shared MarkdownReviewEditor.
 */

import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';
import { useTaskPanel } from '../context/TaskContext';
import { Button } from '../shared';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
}

export function TaskPreview({ wsId, filePath }: TaskPreviewProps) {
    const { setOpenFilePath } = useTaskPanel();
    return (
        <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-end gap-1 px-2 py-1 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                <Button variant="ghost" size="sm" className="task-preview-close" onClick={() => setOpenFilePath(null)} aria-label="Close preview">
                    ✕
                </Button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode="tasks"
            />
            </div>
        </div>
    );
}
