/**
 * TaskPreview — task panel wrapper for the shared MarkdownReviewEditor.
 */

import { useCallback } from 'react';
import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';
import { useTaskPanel } from '../context/TaskContext';
import { Button } from '../shared';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
    initialViewMode?: 'review' | 'source' | null;
}

export function TaskPreview({ wsId, filePath, initialViewMode }: TaskPreviewProps) {
    const { setOpenFilePath } = useTaskPanel();

    const handleViewModeChange = useCallback((mode: 'review' | 'source') => {
        const hash = location.hash.replace(/^#/, '').split('?')[0];
        const newHash = mode === 'source' ? `#${hash}?mode=source` : `#${hash}`;
        history.replaceState(null, '', newHash);
    }, []);

    return (
        <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode="tasks"
                initialViewMode={initialViewMode ?? undefined}
                onViewModeChange={handleViewModeChange}
                showAiButtons={true}
                toolbarRight={
                    <Button variant="ghost" size="sm" className="task-preview-close" data-testid="task-preview-close" title="Close preview" onClick={() => setOpenFilePath(null)}>
                        ✕
                    </Button>
                }
            />
        </div>
    );
}
