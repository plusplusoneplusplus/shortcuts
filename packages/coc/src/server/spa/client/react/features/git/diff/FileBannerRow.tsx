/**
 * FileBannerRow — the single row that replaces a file's raw git preamble in the
 * continuous (whole-commit) diff view.
 *
 * Shows the full path (directory dimmed, basename bold, so it stays greppable),
 * a status badge, the previous path for renames, and the file's `+N −M` counts.
 *
 * The row always renders in normal flow. Keeping the current file visible while
 * its hunks scroll past — the whole point of the banner — is the job of the
 * docked overlay copy the viewers render outside the horizontal scroller; see
 * {@link useDockedFileBanner} for why `position: sticky` cannot do it here.
 *
 * The blob hashes and file mode dropped from the row are not lost: they are
 * exposed on the details control's tooltip.
 */

import {
    BANNER_ACCENT_CLASSES,
    BANNER_STATUS_CLASSES,
    BANNER_STATUS_LABELS,
    BANNER_SURFACE_CLASSES,
    bannerDetailsText,
    splitPath,
    type FileBanner,
} from './fileBannerModel';

export interface FileBannerRowProps {
    banner: FileBanner;
    pinned?: boolean;
    'data-testid'?: string;
}

export function FileBannerRow({ banner, pinned = false, 'data-testid': testId = 'diff-file-banner' }: FileBannerRowProps) {
    const { dir, base } = splitPath(banner.path);
    const details = bannerDetailsText(banner);

    return (
        <div
            className={`relative flex min-h-11 w-full items-center gap-2.5 border-y py-1.5 pl-4 pr-2.5 font-sans text-[11px] text-[#24292f] shadow-sm dark:text-[#c9d1d9] ${BANNER_SURFACE_CLASSES[banner.status]} ${pinned ? 'shadow-md' : ''}`}
            data-testid={testId}
            data-file-path={banner.path}
            data-file-banner-status={banner.status}
        >
            <span
                className={`absolute inset-y-[-1px] left-0 w-1 ${BANNER_ACCENT_CLASSES[banner.status]}`}
                aria-hidden="true"
                data-testid="diff-file-banner-accent"
            />
            <span className="shrink-0 text-base leading-none text-[#57606a] dark:text-[#8b949e]" aria-hidden="true">▤</span>
            <span className="min-w-0 leading-tight" title={banner.path} data-testid="diff-file-banner-path">
                {dir && <span className="block truncate text-[10px] text-[#6e7781] dark:text-[#8b949e]">{dir}</span>}
                <span className="block truncate text-xs font-semibold">{base}</span>
            </span>
            <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BANNER_STATUS_CLASSES[banner.status]}`}
                data-testid="diff-file-banner-status"
            >
                {BANNER_STATUS_LABELS[banner.status]}
            </span>
            {banner.oldPath && (
                // Hidden on narrow widths — the current path is the important part.
                <span
                    className="hidden min-w-0 truncate text-[10px] text-[#57606a] sm:inline dark:text-[#8b949e]"
                    title={banner.oldPath}
                    data-testid="diff-file-banner-oldpath"
                >
                    ← {banner.oldPath}
                </span>
            )}
            {banner.binary && (
                <span className="shrink-0 text-[10px] text-[#57606a] dark:text-[#8b949e]" data-testid="diff-file-banner-binary">
                    binary
                </span>
            )}
            <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-semibold tabular-nums" data-testid="diff-file-banner-counts">
                <span className="text-emerald-700 dark:text-emerald-400">+{banner.additions}</span>
                <span className="mx-1 text-[#8b949e]" aria-hidden="true">·</span>
                <span className="text-rose-700 dark:text-rose-400">−{banner.deletions}</span>
            </span>
            {details && (
                <span
                    className="shrink-0 cursor-help select-none text-[10px] text-[#8b949e] dark:text-[#6e7681]"
                    title={details}
                    data-testid="diff-file-banner-details"
                >
                    ⓘ
                </span>
            )}
        </div>
    );
}
