import { NoteEditor } from '../../notes/editor/NoteEditor';

export interface ScratchpadPanelProps {
    workspaceId: string;
    notePath: string | null;
    onClose: () => void;
    height: number | string;
    /** Called when the note file is not found (404); closes the panel silently. */
    onNotFound?: () => void;
}

export function ScratchpadPanel({ workspaceId, notePath, height, onNotFound }: ScratchpadPanelProps) {
    const style: React.CSSProperties = height === 'auto'
        ? { flex: '1 1 auto', minHeight: 0 }
        : { height, minHeight: 0 };

    return (
        <div
            className="flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]"
            style={style}
            data-testid="scratchpad-panel"
        >
            <NoteEditor
                workspaceId={workspaceId}
                notePath={notePath}
                onNotFound={onNotFound}
            />
        </div>
    );
}
