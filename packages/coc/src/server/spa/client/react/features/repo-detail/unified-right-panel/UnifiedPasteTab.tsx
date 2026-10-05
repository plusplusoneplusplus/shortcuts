import { useCallback, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { RichEditorCore } from '../../notes/editor/RichEditorCore';
import { markdownToHtml } from '../../notes/editor/noteMarkdown';
import { copyToClipboard } from '../../../utils/format';
import { readPasteSnapshot } from './unifiedPasteTabs';

export interface UnifiedPasteTabProps {
    scopeWorkspaceId: string;
    resourceId: string;
}

export function UnifiedPasteTab({ scopeWorkspaceId, resourceId }: UnifiedPasteTabProps) {
    const content = readPasteSnapshot(scopeWorkspaceId, resourceId);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const hydrate = useCallback((editor: Editor) => {
        editor.commands.setContent(markdownToHtml(content ?? ''), { emitUpdate: false });
    }, [content]);

    if (content === undefined) {
        return <div className="p-4 text-sm">This pasted text is no longer available.</div>;
    }

    const copy = async () => {
        try {
            await copyToClipboard(content);
            setCopyState('copied');
        } catch {
            setCopyState('error');
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col" data-testid="unified-paste-tab">
            <div className="flex shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-2 py-1 text-xs dark:border-[#333]">
                <button type="button" onClick={() => void copy()}
                    className="rounded px-2 py-1 hover:bg-black/5 dark:hover:bg-white/10">
                    Copy full content
                </button>
                <span role="status">{copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Could not copy' : ''}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-4">
                <RichEditorCore readOnly placeholder="" onEditorReady={hydrate} />
            </div>
        </div>
    );
}
