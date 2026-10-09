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

import { useId, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { DiffFilePicker } from './DiffFilePicker';
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
    files?: readonly string[];
    onSelectFile?: (path: string) => void;
    'data-testid'?: string;
}

interface TooltipPosition {
    left: number;
    top: number;
    above: boolean;
}

function FileBannerDetails({ details }: { details: string }) {
    const tooltipId = useId();
    const [position, setPosition] = useState<TooltipPosition | null>(null);

    const showTooltip = (target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        const maxTooltipWidth = Math.min(360, window.innerWidth - 16);
        setPosition({
            left: Math.max(8, Math.min(rect.left, window.innerWidth - maxTooltipWidth - 8)),
            top: rect.top >= 96 ? rect.top - 6 : rect.bottom + 6,
            above: rect.top >= 96,
        });
    };

    return (
        <>
            <button
                type="button"
                className="shrink-0 cursor-help select-none rounded text-[10px] leading-none text-[#8b949e] hover:text-[#57606a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:text-[#6e7681] dark:hover:text-[#8b949e]"
                aria-label="Show Git file details"
                aria-describedby={position ? tooltipId : undefined}
                data-testid="diff-file-banner-details"
                onMouseEnter={(event: MouseEvent<HTMLButtonElement>) => showTooltip(event.currentTarget)}
                onMouseLeave={() => setPosition(null)}
                onFocus={(event: FocusEvent<HTMLButtonElement>) => showTooltip(event.currentTarget)}
                onBlur={() => setPosition(null)}
            >
                ⓘ
            </button>
            {position && createPortal(
                <div
                    id={tooltipId}
                    role="tooltip"
                    className="pointer-events-none fixed z-[1000] max-w-[min(360px,calc(100vw-16px))] whitespace-pre-line rounded border border-[#d0d7de] bg-white px-2.5 py-2 font-mono text-[11px] leading-4 text-[#24292f] shadow-lg dark:border-[#30363d] dark:bg-[#161b22] dark:text-[#c9d1d9]"
                    style={{
                        left: position.left,
                        top: position.top,
                        transform: position.above ? 'translateY(-100%)' : undefined,
                    }}
                    data-testid="diff-file-banner-tooltip"
                >
                    {details}
                </div>,
                document.body,
            )}
        </>
    );
}

export function FileBannerRow({ banner, pinned = false, files = [], onSelectFile, 'data-testid': testId = 'diff-file-banner' }: FileBannerRowProps) {
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
            <DiffFilePicker key={banner.path} filePath={banner.path} files={files} onSelect={onSelectFile}
                className="min-w-0 leading-tight" title={banner.path} data-testid="diff-file-banner-path">
                {dir && <span className="block truncate text-[10px] text-[#6e7781] dark:text-[#8b949e]">{dir}</span>}
                <span className="block truncate text-xs font-semibold">{base}</span>
            </DiffFilePicker>
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
            {details && <FileBannerDetails details={details} />}
        </div>
    );
}
