/**
 * Which file banner to dock at the top edge while the continuous diff scrolls.
 *
 * The docked banner is an overlay rather than `position: sticky` on the in-flow
 * row. The row list lives inside a horizontal scroller (long code lines must
 * scroll sideways), and a sticky descendant anchors to the nearest scrollport —
 * that horizontal scroller, which never scrolls vertically — so it would never
 * engage. `overflow-y: clip` does not buy a way out either: beside a non-visible
 * `overflow-x`, browsers compute it to `hidden`, which is still a scrollport.
 * The viewers therefore keep the overlay *outside* the horizontal scroller,
 * where its nearest scrollport is the host's own scroll container.
 *
 * Two ways to find the current file, because the row list has two shapes:
 * windowed rows are absolutely positioned and off-screen rows are not mounted,
 * so that path reads the top row from the virtualizer; the eager path measures
 * the mounted banner rows directly.
 */

import { useEffect, useState, type RefObject } from 'react';
import { pinnedBannerForTopRow, pinnedBannerFromRowTops, type FileBanner } from './fileBannerModel';

export interface DockedFileBannerOptions {
    /** False on the surfaces that opt out of banners — nothing ever docks. */
    enabled: boolean;
    /** Viewer root; the mounted banner rows are looked up inside it. */
    container: RefObject<HTMLElement | null>;
    /** The host scroll container the diff scrolls inside of. */
    scrollEl: HTMLElement | null;
    /**
     * Banner rows in document order. `rowIndex` is in the viewer's own row-index
     * space (unified: diff-line indices, split: `sxsLines` indices) and is only
     * read on the windowed path.
     */
    entries: { rowIndex: number; banner: FileBanner }[];
    virtualized: boolean;
    /** Topmost windowed row, from the virtualizer; undefined when not windowed. */
    topRowIndex: number | undefined;
}

/** The banner to render in the docked overlay, or undefined for none. */
export function useDockedFileBanner({
    enabled,
    container,
    scrollEl,
    entries,
    virtualized,
    topRowIndex,
}: DockedFileBannerOptions): FileBanner | undefined {
    const [measured, setMeasured] = useState<FileBanner | undefined>(undefined);
    const measures = enabled && !virtualized;

    useEffect(() => {
        if (!measures) {
            setMeasured(undefined);
            return;
        }
        const root = container.current;
        if (!root || !scrollEl) return;

        const update = () => {
            const portTop = scrollEl.getBoundingClientRect().top;
            const rows = root.querySelectorAll<HTMLElement>('[data-testid="diff-file-banner"]');
            const tops: { top: number; banner: FileBanner }[] = [];
            rows.forEach((el, i) => {
                const banner = entries[i]?.banner;
                if (banner) tops.push({ top: el.getBoundingClientRect().top, banner });
            });
            const next = pinnedBannerFromRowTops(tops, portTop);
            // Identity compare: scroll fires constantly, but the docked file only
            // changes at file boundaries, so React bails out of the rest.
            setMeasured(prev => (prev === next ? prev : next));
        };

        update();
        scrollEl.addEventListener('scroll', update, { passive: true });
        window.addEventListener('resize', update);
        return () => {
            scrollEl.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
        };
    }, [measures, container, scrollEl, entries]);

    if (!enabled) return undefined;
    if (!virtualized) return measured;
    if (topRowIndex === undefined) return undefined;
    const docked = pinnedBannerForTopRow(entries, topRowIndex);
    return docked?.overlay ? docked.banner : undefined;
}
