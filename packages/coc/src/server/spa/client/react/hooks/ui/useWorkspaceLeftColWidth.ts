import { useEffect } from 'react';

/**
 * CSS custom property (published on `<html>`) that the App-shell
 * `GlobalStatusDock` reads to size its bottom status bar to the current view's
 * left panel, so the bar stays flush under that panel instead of overhanging
 * into the content area.
 */
export const WORKSPACE_LEFT_COL_WIDTH_VAR = '--workspace-left-col-width';

/**
 * Publish a left-column pixel width to `--workspace-left-col-width` so the
 * app-shell `GlobalStatusDock` can match whatever left panel is currently on
 * screen (the split workspace panel, the notes sidebar, …).
 *
 * Dashboard views are routinely kept mounted-but-hidden across tab switches, so
 * a hidden view must NOT keep owning this shared variable. Pass `disabled` when
 * the panel is not the anchor for the dock — on mobile (no docked bar), or when
 * this view is not the active tab — to clear the variable and let the active
 * view (or the dock's own default fallback) take over.
 */
export function usePublishWorkspaceLeftColWidth(width: number, disabled: boolean): void {
    useEffect(() => {
        const root = document.documentElement;
        if (disabled) {
            root.style.removeProperty(WORKSPACE_LEFT_COL_WIDTH_VAR);
            return;
        }
        root.style.setProperty(WORKSPACE_LEFT_COL_WIDTH_VAR, `${width}px`);
        return () => {
            root.style.removeProperty(WORKSPACE_LEFT_COL_WIDTH_VAR);
        };
    }, [width, disabled]);
}
