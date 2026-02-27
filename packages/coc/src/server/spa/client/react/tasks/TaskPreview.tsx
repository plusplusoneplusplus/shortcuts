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
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode="tasks"
                toolbarRight={
                    <Button variant="ghost" size="sm" className="task-preview-close" data-testid="task-preview-close" title="Close preview" onClick={() => setOpenFilePath(null)}>
                        ✕
                    </Button>
                }
            />
        </div>
    );
}
