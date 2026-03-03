/**
 * TaskPreview — task panel wrapper for the shared MarkdownReviewEditor.
 */

import { useCallback, useState } from 'react';
import { MarkdownReviewEditor } from '../shared/MarkdownReviewEditor';
import { FollowPromptDialog } from '../shared/FollowPromptDialog';
import { UpdateDocumentDialog } from '../shared/UpdateDocumentDialog';
import { useTaskPanel } from '../context/TaskContext';
import { Button } from '../shared';

interface TaskPreviewProps {
    wsId: string;
    filePath: string;
    initialViewMode?: 'review' | 'source' | null;
}

export function TaskPreview({ wsId, filePath, initialViewMode }: TaskPreviewProps) {
    const { setOpenFilePath } = useTaskPanel();
    const [aiDialogType, setAiDialogType] = useState<'follow-prompt' | 'update-document' | null>(null);

    const handleViewModeChange = useCallback((mode: 'review' | 'source') => {
        const hash = location.hash.replace(/^#/, '').split('?')[0];
        const newHash = mode === 'source' ? `#${hash}?mode=source` : `#${hash}`;
        history.replaceState(null, '', newHash);
    }, []);

    // Derive taskName from filePath (filename without extension)
    const taskName = filePath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? filePath;

    return (
        <div className="flex flex-col h-full min-h-0 min-w-0 overflow-hidden">
            <MarkdownReviewEditor
                wsId={wsId}
                filePath={filePath}
                fetchMode="tasks"
                initialViewMode={initialViewMode ?? undefined}
                onViewModeChange={handleViewModeChange}
                toolbarRight={
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            data-testid="task-preview-follow-prompt"
                            title="Follow Prompt"
                            onClick={() => setAiDialogType('follow-prompt')}
                        >
                            📝
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            data-testid="task-preview-update-document"
                            title="Update Document"
                            onClick={() => setAiDialogType('update-document')}
                        >
                            ✏️
                        </Button>
                        <span className="w-px h-4 bg-[#e0e0e0] dark:bg-[#3c3c3c] mx-1 self-center" aria-hidden="true" />
                        <Button variant="ghost" size="sm" className="task-preview-close" data-testid="task-preview-close" title="Close preview" onClick={() => setOpenFilePath(null)}>
                            ✕
                        </Button>
                    </>
                }
            />
            {aiDialogType === 'follow-prompt' && (
                <FollowPromptDialog
                    wsId={wsId}
                    taskPath={filePath}
                    taskName={taskName}
                    onClose={() => setAiDialogType(null)}
                />
            )}
            {aiDialogType === 'update-document' && (
                <UpdateDocumentDialog
                    wsId={wsId}
                    taskPath={filePath}
                    taskName={taskName}
                    onClose={() => setAiDialogType(null)}
                />
            )}
        </div>
    );
}
