/**
 * useEditorFileBlame — the file view's side of `features.fileBlame`: reports
 * whether the shown file can carry blame, reads it from the file's owner while
 * the host shows it, and paints it into the mounted editor.
 *
 * Blame is supported only for a repo-relative text file shown in the code
 * editor: never for binary or truncated blobs, trusted/absolute or workspace
 * preview paths, or rendered Markdown.
 */

import { useEffect, useRef } from 'react';
import type { EditorModelMountContext } from '../../../shared/file-viewer/MonacoFileEditor';
import { attachFileBlameDecorations } from './fileBlameDecorations';
import { useFileBlame, type FileBlameState } from './useFileBlame';

export interface FileBlameHostProps {
    /** Whether the host shows blame; ignored while the file cannot carry it. */
    blame?: boolean;
    /** Reports whether this view can show blame (and `false` on unmount). */
    onBlameSupportChange?: (supported: boolean) => void;
    /** Opens a clicked attributed line's commit; absent leaves labels inert. */
    onOpenBlameCommit?: (hash: string) => void;
}

/** True for a path relative to the repository root. */
export function isRepoRelativePath(path: string): boolean {
    return path.length > 0 && !/^([\\/]|[A-Za-z]:)/.test(path);
}

export function useEditorFileBlame({
    supported, workspaceId, routingRef, filePath, editor, blame, onBlameSupportChange, onOpenBlameCommit,
}: FileBlameHostProps & {
    supported: boolean;
    workspaceId: string;
    routingRef?: string | null;
    filePath: string;
    editor: EditorModelMountContext | null;
}): FileBlameState {
    useEffect(() => {
        onBlameSupportChange?.(supported);
    }, [onBlameSupportChange, supported]);
    useEffect(() => () => onBlameSupportChange?.(false), [onBlameSupportChange]);

    const state = useFileBlame({ enabled: supported && blame === true, workspaceId, routingRef, filePath });
    const openRef = useRef(onOpenBlameCommit);
    openRef.current = onOpenBlameCommit;
    const loaded = state.status === 'loaded' ? state.blame : null;
    useEffect(() => {
        if (!loaded || !editor) return undefined;
        return attachFileBlameDecorations(editor, loaded, hash => openRef.current?.(hash));
    }, [loaded, editor]);

    return state;
}
