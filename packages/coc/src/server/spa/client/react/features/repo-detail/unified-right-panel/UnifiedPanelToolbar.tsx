/**
 * UnifiedPanelToolbar — the breadcrumb row under the tab strip (AC-02).
 *
 * Rendered only while a file tab is active; every other kind brings its own
 * toolbar inside its own view, and the panel does not stack two of them. It
 * reuses the Explorer's own `Breadcrumbs` so the two surfaces read identically,
 * and hosts the file-tree toggle at its right end.
 *
 * A segment click reveals that folder in the tree column — it never opens,
 * closes, or activates a tab. When the path cannot be located in the tree at
 * all (a trusted absolute path, or a file from a clone the tree is not showing)
 * `unifiedPanelBreadcrumbs` reports it as non-interactive and the row degrades to a
 * plain path label rather than offering clicks that would land in the wrong
 * repo.
 *
 * Long paths truncate from the *left*: the row scrolls itself to the end when
 * the path changes, so the file name — the part you are looking at — stays
 * visible while the leading directories run off, with the whole path in the
 * row's tooltip.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../../ui/cn';
import { Breadcrumbs } from '../explorer/Breadcrumbs';
import type { UnifiedToolbarBreadcrumbs } from './unifiedPanelBreadcrumbs';

export interface UnifiedPanelToolbarProps {
    /** What to show, from `unifiedToolbarBreadcrumbs`. */
    breadcrumbs: UnifiedToolbarBreadcrumbs;
    /** A folder segment was clicked; -1 is the repo root. */
    onNavigate: (segmentIndex: number) => void;
    /** The tree toggle, which lives at the row's right end. */
    trailing?: ReactNode;
}

export function UnifiedPanelToolbar({ breadcrumbs, onNavigate, trailing }: UnifiedPanelToolbarProps) {
    const scrollRef = useRef<HTMLDivElement | null>(null);

    // Keep the tail of the path in view as the active file changes.
    useEffect(() => {
        const nav = scrollRef.current?.querySelector<HTMLElement>('[data-testid="explorer-breadcrumbs"]')
            ?? scrollRef.current;
        if (nav) nav.scrollLeft = nav.scrollWidth;
    }, [breadcrumbs.path]);

    return (
        <div
            className="flex min-w-0 flex-shrink-0 items-center gap-2 border-b border-[#e5e5e5] px-1 py-0.5 dark:border-[#333]"
            data-testid="unified-panel-toolbar"
        >
            {breadcrumbs.repoLabel && (
                <span
                    className="max-w-[96px] flex-shrink-0 truncate rounded bg-[#f0f0f0] px-1 text-[10px] text-[#616161] dark:bg-[#2d2d2d] dark:text-[#9d9d9d]"
                    data-testid="unified-panel-toolbar-repo"
                >
                    {breadcrumbs.repoLabel}
                </span>
            )}
            <div
                ref={scrollRef}
                className={cn('min-w-0 flex-1 overflow-hidden', !breadcrumbs.interactive && 'overflow-x-auto')}
                title={breadcrumbs.path}
            >
                {breadcrumbs.interactive ? (
                    <Breadcrumbs segments={[...breadcrumbs.segments]} onNavigate={onNavigate} />
                ) : (
                    // Not locatable in the tree on screen: orientation only.
                    <span
                        className="block truncate px-2 py-1 text-[10px] text-[#848484]"
                        data-testid="unified-panel-toolbar-path"
                    >
                        {breadcrumbs.path}
                    </span>
                )}
            </div>
            {trailing}
        </div>
    );
}
