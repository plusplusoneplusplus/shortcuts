/**
 * ContentSearchOverlayHost — the one piece a page mounts to get the shortcut.
 *
 * It keeps the three things the overlay itself must not own: whether the dialog
 * is up, which element to hand focus back to when it closes, and the focus
 * token that makes a repeated Ctrl/Cmd+Shift+F re-focus the open dialog instead
 * of stacking a second one.
 *
 * Focus restoration is captured at open time from `document.activeElement` —
 * the sub-tab button, tree row or editor the user came from — because by the
 * time the dialog closes the overlay has long since taken focus away.
 *
 * The query and results are still local to this host. The search request
 * (AC-02), group aggregation (AC-03) and match opening (AC-04) plug in here in
 * later slices; mounting the host now is what makes the shortcut real on every
 * repo and repo-group sub-tab.
 */
import { useCallback, useRef, useState } from 'react';
import {
    ContentSearchOverlay,
    type ContentSearchOverlayMatch,
} from './ContentSearchOverlay';
import {
    describeContentSearchResults,
    useContentSearchRequest,
} from './contentSearchRequest';
import { resolveContentSearchScope } from './contentSearchShortcut';
import { useContentSearchShortcut } from './useContentSearchShortcut';

export interface ContentSearchOverlayHostProps {
    /** Selected repo or repo-group workspace. Decides whether we claim the key. */
    workspaceId: string | null | undefined;
    /** Concrete clone owner for the active repo scope, when it is a clone. */
    routingRef?: string | null;
    /** Open a match in the unified right panel. Wired in the AC-04 slice. */
    onOpenMatch?: (match: ContentSearchOverlayMatch) => void;
}

export function ContentSearchOverlayHost(props: ContentSearchOverlayHostProps) {
    const { workspaceId, routingRef, onOpenMatch } = props;
    const scope = resolveContentSearchScope(workspaceId);
    const [open, setOpen] = useState(false);
    const [focusToken, setFocusToken] = useState(0);
    const { controls, setControls, results, submit } = useContentSearchRequest({
        workspaceId: workspaceId ?? '',
        routingRef,
    });
    const invokerRef = useRef<HTMLElement | null>(null);

    const handleOpen = useCallback(() => {
        const active = document.activeElement;
        invokerRef.current = active instanceof HTMLElement ? active : null;
        setFocusToken((token) => token + 1);
        setOpen(true);
    }, []);

    const handleFocusExisting = useCallback(() => {
        setFocusToken((token) => token + 1);
    }, []);

    const handleClose = useCallback(() => {
        setOpen(false);
        const invoker = invokerRef.current;
        invokerRef.current = null;
        // Guard against an invoker that unmounted while the overlay was up;
        // focusing a detached node silently sends focus to <body>.
        if (invoker !== null && invoker.isConnected) invoker.focus();
    }, []);

    useContentSearchShortcut({
        scope,
        overlayOpen: open,
        onOpen: handleOpen,
        onFocusExisting: handleFocusExisting,
    });

    const handleOpenMatch = useCallback(
        (match: ContentSearchOverlayMatch) => {
            onOpenMatch?.(match);
            handleClose();
        },
        [handleClose, onOpenMatch],
    );

    if (scope === null) return null;

    return (
        <ContentSearchOverlay
            open={open}
            scope={scope}
            query={controls.query}
            onQueryChange={query => setControls(current => ({ ...current, query }))}
            controls={controls}
            onControlsChange={setControls}
            onSubmit={submit}
            onClose={handleClose}
            matches={results.matches}
            busy={results.status === 'loading'}
            status={describeContentSearchResults(results)}
            onOpenMatch={handleOpenMatch}
            focusToken={focusToken}
        />
    );
}
