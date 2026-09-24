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
 * The query and results are local to this host: it owns the request hook and
 * hands it the scope, so the same dialog serves a single repo and a repo-group
 * fan-out. Match opening (AC-04) plugs in through `onOpenMatch`.
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
import type { ContentSearchOpenOutcome } from './contentSearchOpen';

export interface ContentSearchOverlayHostProps {
    /** Selected repo or repo-group workspace. Decides whether we claim the key. */
    workspaceId: string | null | undefined;
    /**
     * Concrete clone owner for the active scope: the repo's clone key, or the
     * group owner's for a repo group.
     */
    routingRef?: string | null;
    /** Group owner's base URL. Only a repo-group scope uses it. */
    baseUrl?: string;
    /** Verify and open a match in the unified right panel. */
    onOpenMatch?: (
        match: ContentSearchOverlayMatch,
        signal: AbortSignal,
    ) => Promise<ContentSearchOpenOutcome>;
}

export function ContentSearchOverlayHost(props: ContentSearchOverlayHostProps) {
    const { workspaceId, routingRef, baseUrl, onOpenMatch } = props;
    const scope = resolveContentSearchScope(workspaceId);
    const [open, setOpen] = useState(false);
    const [focusToken, setFocusToken] = useState(0);
    const [openError, setOpenError] = useState<string | null>(null);
    const { controls, setControls, results, submit } = useContentSearchRequest({
        workspaceId: workspaceId ?? '',
        // The scope decides the route: a group query goes to the group-owning
        // server's fan-out, a repo query straight to the repo.
        scope: scope === 'group' ? 'group' : 'repo',
        routingRef,
        baseUrl,
    });
    const invokerRef = useRef<HTMLElement | null>(null);
    const openRunRef = useRef(0);
    const openPendingRef = useRef(false);
    const openAbortRef = useRef<AbortController | null>(null);

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
        openRunRef.current += 1;
        openAbortRef.current?.abort();
        openAbortRef.current = null;
        openPendingRef.current = false;
        setOpen(false);
        setOpenError(null);
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
        async (match: ContentSearchOverlayMatch) => {
            if (openPendingRef.current) return;
            openPendingRef.current = true;
            const controller = new AbortController();
            openAbortRef.current = controller;
            const run = openRunRef.current + 1;
            openRunRef.current = run;
            setOpenError(null);
            const outcome = onOpenMatch
                ? await onOpenMatch(match, controller.signal).catch(() => ({
                    opened: false as const,
                    error: 'Could not open this result. Check the repository connection and try again.',
                }))
                : {
                    opened: false as const,
                    error: 'The file panel is unavailable in this view.',
                };
            if (openAbortRef.current === controller) openAbortRef.current = null;
            openPendingRef.current = false;
            if (openRunRef.current !== run) return;
            if (outcome.opened) handleClose();
            else setOpenError(outcome.error);
        },
        [handleClose, onOpenMatch],
    );

    const handleSubmit = useCallback(() => {
        openRunRef.current += 1;
        openAbortRef.current?.abort();
        openAbortRef.current = null;
        openPendingRef.current = false;
        setOpenError(null);
        submit();
    }, [submit]);

    if (scope === null) return null;

    return (
        <ContentSearchOverlay
            open={open}
            scope={scope}
            query={controls.query}
            onQueryChange={query => setControls(current => ({ ...current, query }))}
            controls={controls}
            onControlsChange={setControls}
            onSubmit={handleSubmit}
            onClose={handleClose}
            matches={results.matches}
            truncated={results.truncated}
            failures={results.failures}
            busy={results.status === 'loading'}
            status={openError ?? describeContentSearchResults(results)}
            onOpenMatch={handleOpenMatch}
            focusToken={focusToken}
        />
    );
}
