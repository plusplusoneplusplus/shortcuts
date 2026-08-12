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
    BANNER_STATUS_CLASSES,
    BANNER_STATUS_LABELS,
    bannerDetailsText,
    splitPath,
    type FileBanner,
} from './fileBannerModel';

export interface FileBannerRowProps {
    banner: FileBanner;
    'data-testid'?: string;
}

export function FileBannerRow({ banner, 'data-testid': testId = 'diff-file-banner' }: FileBannerRowProps) {
    const { dir, base } = splitPath(banner.path);
    const details = bannerDetailsText(banner);

    return (
        <div
            className={`flex w-full items-center gap-2 border-y border-[#e0e0e0] bg-[#eef2f7] px-2 py-1 font-sans text-[11px] text-[#24292f] dark:border-[#3c3c3c] dark:bg-[#22272e] dark:text-[#c9d1d9]`}
            data-testid={testId}
            data-file-path={banner.path}
            data-file-banner-status={banner.status}
        >
            <span className="shrink-0 text-[#57606a] dark:text-[#8b949e]" aria-hidden="true">📄</span>
            <span className="min-w-0 truncate" title={banner.path}>
                {dir && <span className="text-[#8b949e] dark:text-[#6e7681]">{dir}</span>}
                <span className="font-semibold">{base}</span>
            </span>
            <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${BANNER_STATUS_CLASSES[banner.status]}`}
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
            <span className="ml-auto shrink-0 whitespace-nowrap tabular-nums text-[10px]" data-testid="diff-file-banner-counts">
                <span className="text-emerald-700 dark:text-emerald-400">+{banner.additions}</span>
                {' '}
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
