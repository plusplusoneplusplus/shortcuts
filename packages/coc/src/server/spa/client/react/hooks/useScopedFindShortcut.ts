/**
 * useScopedFindShortcut — shared Ctrl+F / Cmd+F routing for panels that own an
 * in-panel search box (chat list, git commit list, tasks, work items).
 *
 * IMPORTANT: the desktop Electron find bar (and the browser's built-in find)
 * only opens when the Ctrl+F keydown's `defaultPrevented` stays `false`. Any
 * panel that wants an in-panel search MUST route through this hook so it only
 * calls `preventDefault()` when it genuinely owns keyboard focus — never from a
 * hidden (display:none) keep-alive tab, and never while focus is in the
 * conversation detail pane. A stray unconditional `preventDefault()` on Ctrl+F
 * silently swallows native find-in-page everywhere in the app.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * True when the keydown originated inside the right-hand conversation detail
 * pane (its reading area OR the message composer). Ctrl+F must yield to the
 * native find-in-page there — the Electron find overlay on desktop, the
 * browser's built-in find on web — which only fires when `defaultPrevented`
 * is false. Never intercept in that region.
 */
export function isWithinDetailPane(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest('[data-pane="detail"]') !== null;
}

export interface ScopedFindShortcutOptions {
    /**
     * When true (default), this panel also handles Ctrl+F when keyboard focus
     * is on nothing in particular (`document.body`) and no other find-scope
     * owns it. Set false for a secondary panel that shares the screen with a
     * primary one (e.g. the git list in the split-workspace layout, where the
     * chat list is the body-focus default).
     */
    claimsBodyFocus?: boolean;
    /** When false, the shortcut is inert. Default true. */
    enabled?: boolean;
}

/**
 * Registers a document-level Ctrl+F / Cmd+F handler scoped to a single panel.
 *
 * Routing rules (checked in order):
 *  - ignore when the container is unmounted or hidden (`offsetParent === null`);
 *  - ignore when focus is in the detail pane (native find wins);
 *  - handle when focus is inside this container;
 *  - when focus is elsewhere: ignore if another find-scope owns it; ignore if
 *    focus is inside any other region (e.g. the workspace right dock — that
 *    region owns its own Ctrl+F story, so native find wins); otherwise focus
 *    is on body/nothing and the panel that claims body focus handles it.
 *
 * The container element is tagged with `data-find-scope` while mounted so
 * sibling panels can detect that focus lives inside *another* search-owning
 * panel and must not steal Ctrl+F from it.
 */
export function useScopedFindShortcut(
    containerRef: RefObject<HTMLElement | null>,
    onTrigger: () => void,
    options: ScopedFindShortcutOptions = {},
): void {
    const { claimsBodyFocus = true, enabled = true } = options;
    const onTriggerRef = useRef(onTrigger);
    onTriggerRef.current = onTrigger;
    const claimsBodyFocusRef = useRef(claimsBodyFocus);
    claimsBodyFocusRef.current = claimsBodyFocus;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!enabledRef.current) return;
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'f') return;
            const container = containerRef.current;
            // Hidden or unmounted keep-alive panel: never intercept.
            if (!container || container.offsetParent === null) return;
            // Conversation detail pane owns native find-in-page.
            if (isWithinDetailPane(e.target)) return;
            const target = e.target;
            const insideThis = target instanceof Node && container.contains(target);
            if (!insideThis) {
                const targetEl = target instanceof Element ? target : null;
                const owningScope = targetEl ? targetEl.closest('[data-find-scope]') : null;
                // Focus lives in a different visible search panel — let it win.
                if (owningScope && owningScope !== container) return;
                // Focus lives in some other region (right dock, chrome, a future
                // panel) — never steal Ctrl+F from it; yield to native find.
                const focusOnBody = !targetEl
                    || targetEl === document.body
                    || targetEl === document.documentElement;
                if (!focusOnBody) return;
                // Focus is on body/nothing: only the body-default panel handles.
                if (!claimsBodyFocusRef.current) return;
            }
            e.preventDefault();
            onTriggerRef.current();
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [containerRef]);

    // Tag the current container element so sibling find-scopes can detect that
    // focus lives inside *another* search-owning panel. Runs every render (no
    // deps) so it also tags a container that mounts *after* the first render
    // (e.g. once a panel finishes its loading state).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.setAttribute('data-find-scope', '');
        return () => { el.removeAttribute('data-find-scope'); };
    });
}
