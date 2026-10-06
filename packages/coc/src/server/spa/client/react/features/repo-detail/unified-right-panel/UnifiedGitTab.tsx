/**
 * UnifiedGitTab — the body of a workspace's Git tab.
 *
 * An empty host: `RepoGitTab` owns the git selection and portals its
 * `RepoGitDetailPane` in here (see `unifiedGitTabHost.ts`), so the diff views,
 * toolbars, comments, and navigation are exactly the ones the middle pane used
 * to show. The node is published by panel scope while this tab is mounted,
 * together with the tab's dirty/save callbacks so an edited diff guards the
 * tab close.
 */

import { useCallback, useEffect, useRef } from 'react';
import {
    clearUnifiedGitTabDirtyBridge, clearUnifiedGitTabHost, setUnifiedGitTabDirtyBridge, setUnifiedGitTabHost,
    type UnifiedGitTabDirtyBridge,
} from './unifiedGitTabHost';

export interface UnifiedGitTabProps {
    /** The panel scope whose `RepoGitTab` portals into this body. */
    scopeWorkspaceId: string;
    /** The panel's dirty report for this tab (bound to its id). */
    onDirtyChange?: (isDirty: boolean) => void;
    /** The panel's save registration for this tab (bound to its id). */
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
}

export function UnifiedGitTab({ scopeWorkspaceId, onDirtyChange, onRegisterSave }: UnifiedGitTabProps) {
    const callbacksRef = useRef({ onDirtyChange, onRegisterSave });
    callbacksRef.current = { onDirtyChange, onRegisterSave };
    const nodeRef = useRef<HTMLDivElement | null>(null);
    const bridgeRef = useRef<UnifiedGitTabDirtyBridge | null>(null);
    const ref = useCallback((node: HTMLDivElement | null) => {
        if (nodeRef.current) clearUnifiedGitTabHost(scopeWorkspaceId, nodeRef.current);
        if (bridgeRef.current) clearUnifiedGitTabDirtyBridge(scopeWorkspaceId, bridgeRef.current);
        nodeRef.current = node;
        bridgeRef.current = null;
        if (!node) return;
        // Published before the host so the portaled detail reports into it.
        const bridge: UnifiedGitTabDirtyBridge = {
            onDirtyChange: isDirty => callbacksRef.current.onDirtyChange?.(isDirty),
            onRegisterSave: save => callbacksRef.current.onRegisterSave?.(save),
        };
        bridgeRef.current = bridge;
        setUnifiedGitTabDirtyBridge(scopeWorkspaceId, bridge);
        setUnifiedGitTabHost(scopeWorkspaceId, node);
    }, [scopeWorkspaceId]);
    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return;
        // Git detail is a React portal owned by the left Git list. A native
        // capture listener follows its DOM host even when React events bubble
        // through that other tree or a diff stops propagation.
        const onMouseDown = (event: MouseEvent) => {
            if (event.button !== 0 || node.offsetParent === null || !(event.target instanceof Element)) return;
            const control = event.target.closest(
                'input, textarea, select, button, a[href], [tabindex], [contenteditable], .monaco-editor',
            );
            // Editors and controls keep their own focus; reading nonfocusable
            // diff content makes this host the shared panel shortcut target.
            if (control && control !== node && node.contains(control)) return;
            node.focus({ preventScroll: true });
        };
        node.addEventListener('mousedown', onMouseDown, true);
        return () => node.removeEventListener('mousedown', onMouseDown, true);
    }, [scopeWorkspaceId]);
    return (
        <div
            ref={ref}
            tabIndex={-1}
            className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
            data-testid="unified-git-tab"
        />
    );
}
