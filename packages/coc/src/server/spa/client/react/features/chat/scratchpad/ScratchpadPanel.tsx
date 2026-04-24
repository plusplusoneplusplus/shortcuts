import React from 'react';
import { NoteEditor } from '../../notes/editor/NoteEditor';
import { useQueue } from '../../../contexts/QueueContext';

export interface ScratchpadPanelProps {
    workspaceId: string;
    notePath: string | null;
    onClose: () => void;
    height: number | string;
    /** Called when the note file is not found (404); closes the panel silently. */
    onNotFound?: () => void;
}

function isPlanFile(notePath: string | null): boolean {
    if (!notePath) return false;
    const name = notePath.replace(/\\/g, '/').split('/').pop() ?? '';
    return name === 'plan.md' || name.endsWith('.plan.md');
}

export function ScratchpadPanel({ workspaceId, notePath, height, onNotFound }: ScratchpadPanelProps) {
    const { dispatch: queueDispatch } = useQueue();

    const style: React.CSSProperties = height === 'auto'
        ? { flex: '1 1 auto', minHeight: 0 }
        : { height, minHeight: 0 };

    const runSkillButton = isPlanFile(notePath) ? (
        <button
            type="button"
            title="Run Skill"
            data-testid="scratchpad-run-skill"
            className="h-7 px-2 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
            onMouseDown={(e) => {
                e.preventDefault();
                queueDispatch({
                    type: 'OPEN_DIALOG',
                    workspaceId,
                    contextFiles: [notePath!],
                });
            }}
        >⚡</button>
    ) : null;

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
                toolbarRight={runSkillButton}
            />
        </div>
    );
}
