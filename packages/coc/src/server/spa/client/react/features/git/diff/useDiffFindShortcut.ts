/**
 * useDiffFindShortcut — Ctrl+F / Cmd+F ownership for the in-diff find widget.
 *
 * This is a PEER of `hooks/useScopedFindShortcut.ts`: where that hook routes
 * Ctrl+F to a panel's own search box (commit list, tasks, work items), this one
 * claims Ctrl+F for the diff's find widget — but ONLY when keyboard focus lives
 * inside the diff scroll container. It deliberately does NOT yield to the
 * conversation detail pane the way `useScopedFindShortcut` does: the diff often
 * lives *inside* a detail pane (CommitDetail, PrFilesPanel), and there the diff
 * widget is the thing that should win over native find-in-page.
 *
 * The container is tagged with `data-find-scope` while mounted so sibling
 * find-scopes (e.g. the commit-list search) detect that focus lives inside
 * *this* search-owning region and yield rather than double-triggering.
 *
 * IMPORTANT: `preventDefault()` fires only when focus is genuinely inside the
 * diff container. When focus is elsewhere (commit list, composer, body) this
 * hook is inert, so it never swallows native find-in-page outside the diff.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Registers a document-level Ctrl+F / Cmd+F handler that opens the diff find
 * widget when — and only when — the keydown originates inside `containerRef`.
 *
 * @param containerRef The diff scroll container (the focus-owning region).
 * @param onTrigger Called (after `preventDefault`) to open the find widget.
 * @param enabled When false the shortcut is inert. Default true.
 */
export function useDiffFindShortcut(
    containerRef: RefObject<HTMLElement | null>,
    onTrigger: () => void,
    enabled = true,
): void {
    const onTriggerRef = useRef(onTrigger);
    onTriggerRef.current = onTrigger;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!enabledRef.current) return;
            if (!(e.ctrlKey || e.metaKey) || e.key !== 'f') return;
            const container = containerRef.current;
            // Hidden or unmounted keep-alive panel: never intercept.
            if (!container || container.offsetParent === null) return;
            const target = e.target;
            // Only claim Ctrl+F when focus is genuinely inside the diff pane;
            // otherwise stay inert so native find-in-page still works elsewhere.
            if (!(target instanceof Node) || !container.contains(target)) return;
            e.preventDefault();
            onTriggerRef.current();
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [containerRef]);

    // Tag the container so sibling find-scopes (commit list, tasks) detect that
    // focus lives inside *this* search-owning region and yield. Runs every
    // render (no deps) so it also tags a container that mounts after the first
    // render (e.g. once the diff finishes loading).
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        el.setAttribute('data-find-scope', '');
        return () => { el.removeAttribute('data-find-scope'); };
    });
}
