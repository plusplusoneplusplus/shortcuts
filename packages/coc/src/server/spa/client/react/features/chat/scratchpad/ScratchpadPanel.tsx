import { NoteEditor } from '../../notes/editor/NoteEditor';

export interface ScratchpadPanelProps {
    workspaceId: string;
    notePath: string | null;
    onClose: () => void;
    height: number | string;
}

export function ScratchpadPanel({ workspaceId, notePath, height }: ScratchpadPanelProps) {
    return (
        <div
            className="flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]"
            style={{ height, minHeight: 0 }}
            data-testid="scratchpad-panel"
        >
            <NoteEditor
                workspaceId={workspaceId}
                notePath={notePath}
            />
        </div>
    );
}
